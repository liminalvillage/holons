import HolonsBot from './core/HolonsBotCore.js';
import http from 'http';

const bot = new HolonsBot();

// Start API server right away — bot.init() blocks forever (Telegraf polling)
// The API handlers wait for bot services to be available before processing requests.

// ── HTTP API for external tool integration (Atlas/MCP) ─────────────
const API_PORT = process.env.API_PORT || 3101;

const apiServer = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  // Parse body for POST
  const getBody = () => new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });

  try {
    // POST /quest — create quest through bot's actual code path
    if (req.method === 'POST' && req.url === '/quest') {
      const { chatId, title, description, type, category, when, until, sender } = await getBody();
      if (!chatId || !title) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'chatId and title required' }));
        return;
      }

      const db = await bot.container.get('database');
      const quests = await bot.container.get('quests');
      const telebot = await bot.container.get('telebot');
      const settings = await bot.container.get('settings');
      const telegram = telebot.telegram;
      const holon = String(chatId);

      // Get language for this holon
      const language = await settings.getLanguage(holon) || 'en';

      // Build sender (initiator) — use provided sender or default
      const initiator = sender || { id: Number(chatId), first_name: 'Atlas', username: 'atlas_ai' };

      // Create quest object matching bot's exact structure
      const quest = {
        id: '',  // Will be set to message_id after sending
        version: '0.1',
        holon,
        message_thread_id: null,
        initiator,
        title,
        picture: null,
        type: type || 'task',
        status: 'ongoing',
        date: Date.now(),
        participants: [],
        appreciation: [],
        stoppers: [],
        dependencies: [],
        frequency: null,
        recurringTaskId: null,
        timeTracking: {},
        checklistId: null,
        reminderId: null,
        activeHolograms: [],
        category: category || '',
        document: '',
        where: { latitude: '', longitude: '' },
        when: when || '',
        until: until || '',
        completed: '',
        description: description || '',
      };

      // Send message first to get message_id
      const message = await quests.createMessage(quest, language);
      const mkp = quests.markup(quest, language);
      const sent = await telegram.sendMessage(chatId, message, mkp);

      // Set quest ID to message_id (same as bot's normal flow)
      quest.id = sent.message_id;

      // Save to HoloSphere using the holon's DB
      const holonDB = await quests.getHolonDB(holon);
      await holonDB.put(holon, 'quests', quest);

      // Update buttons now that quest has an ID
      try {
        await telegram.editMessageReplyMarkup(holon, quest.id, null,
          quests.markup(quest, language).reply_markup);
      } catch {}

      // Pin the message
      telegram.pinChatMessage(holon, quest.id, { disable_notification: true }).catch(() => {});

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, questId: quest.id, messageId: sent.message_id }));
      return;
    }

    // POST /expense — create expense through bot's actual code path
    if (req.method === 'POST' && req.url === '/expense') {
      const { chatId, amount, currency, description, sender } = await getBody();
      if (!chatId || !amount || !currency) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'chatId, amount, and currency required' }));
        return;
      }

      const expenses = await bot.container.get('expenses');
      const telebot = await bot.container.get('telebot');
      const telegram = telebot.telegram;
      const holon = String(chatId);
      const paidBy = sender?.id || Number(chatId);

      // Send a placeholder message to get a message_id
      const placeholder = await telegram.sendMessage(chatId, '💰 Recording expense...');
      const messageId = placeholder.message_id;

      // Create expense through bot's actual method
      const expense = await expenses.addExpense(
        messageId, holon, parseFloat(amount), 
        currency.toLowerCase().replace(/s$/, ''), 
        description || '', paidBy, [holon]
      );

      if (!expense) {
        await telegram.editMessageText(chatId, messageId, null, '❌ Failed to create expense');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid expense data' }));
        return;
      }

      // Format and update the message
      const msg = await expenses.createMessage(holon, expense);
      const buttons = {
        inline_keyboard: [
          [{ text: '🔀 Split', callback_data: `split:${expense.id}` },
           { text: '🔀 Split All', callback_data: `splitall:${expense.id}` }],
          [{ text: '👥 Select participants', callback_data: `select_participants:${expense.id}` }]
        ]
      };
      await telegram.editMessageText(chatId, messageId, null, msg, { reply_markup: buttons });

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, expenseId: expense.id, messageId }));
      return;
    }

    // POST /shopping — add item to shopping list
    if (req.method === 'POST' && req.url === '/shopping') {
      const { chatId, item, sender } = await getBody();
      if (!chatId || !item) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and item required' })); return; }
      const shopping = await bot.container.get('shopping');
      const db = await bot.container.get('database');
      const holon = String(chatId);
      const shoppingItem = { id: `s_${Date.now()}`, title: item, checked: false, addedBy: sender?.first_name || 'Atlas', date: Date.now() };
      await db.put(holon, 'shopping', shoppingItem);
      const telebot = await bot.container.get('telebot');
      await telebot.telegram.sendMessage(chatId, `🛒 Added to shopping list: ${item}`);
      res.writeHead(200); res.end(JSON.stringify({ success: true, item: shoppingItem })); return;
    }

    // POST /announce — send announcement
    if (req.method === 'POST' && req.url === '/announce') {
      const { chatId, message: msg, sender } = await getBody();
      if (!chatId || !msg) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and message required' })); return; }
      const db = await bot.container.get('database');
      const telebot = await bot.container.get('telebot');
      const holon = String(chatId);
      const announcement = { id: `a_${Date.now()}`, title: msg, author: sender?.first_name || 'Atlas', date: Date.now() };
      await db.put(holon, 'announcements', announcement);
      const sent = await telebot.telegram.sendMessage(chatId, `📢 ${msg}`);
      res.writeHead(200); res.end(JSON.stringify({ success: true, announcement, messageId: sent.message_id })); return;
    }

    // POST /event — create event
    if (req.method === 'POST' && req.url === '/event') {
      const { chatId, title, description, when, until, sender } = await getBody();
      if (!chatId || !title) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and title required' })); return; }
      const db = await bot.container.get('database');
      const telebot = await bot.container.get('telebot');
      const holon = String(chatId);
      const event = {
        id: `e_${Date.now()}`, version: '0.1', holon, title, description: description || '',
        type: 'event', status: 'upcoming', date: Date.now(), when: when || '', until: until || '',
        participants: [], initiator: sender || { id: Number(chatId), first_name: 'Atlas' },
      };
      await db.put(holon, 'events', event);
      let text = `📅 Event: ${title}`;
      if (description) text += `\n📝 ${description}`;
      if (when) text += `\n🕐 ${new Date(when).toLocaleString()}`;
      const sent = await telebot.telegram.sendMessage(chatId, text);
      res.writeHead(200); res.end(JSON.stringify({ success: true, event, messageId: sent.message_id })); return;
    }

    // POST /library/add — add item to library of things
    if (req.method === 'POST' && req.url === '/library/add') {
      const { chatId, item, value, category, sender } = await getBody();
      if (!chatId || !item) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and item required' })); return; }
      const db = await bot.container.get('database');
      const library = await bot.container.get('library');
      const telebot = await bot.container.get('telebot');
      const holon = String(chatId);
      const existing = await db.get(holon, 'library', item);
      if (existing) { res.writeHead(409); res.end(JSON.stringify({ error: `${item} already in library` })); return; }
      const itemType = library.detectItemType(item);
      const libraryItem = library.createLibraryItem(item, itemType, {
        createdBy: sender?.id || Number(chatId),
        createdByUsername: sender?.username || 'atlas',
        category: category || 'Uncategorized',
        value: parseInt(value) || 0,
      });
      await db.put(holon, 'library', libraryItem);
      const icon = library.getItemIcon(libraryItem);
      await telebot.telegram.sendMessage(chatId, `${icon} Added ${item} to the library${value ? ` (value: ${value})` : ''}.`);
      res.writeHead(200); res.end(JSON.stringify({ success: true, item: libraryItem })); return;
    }

    // POST /library/remove — remove item from library
    if (req.method === 'POST' && req.url === '/library/remove') {
      const { chatId, item } = await getBody();
      if (!chatId || !item) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and item required' })); return; }
      const db = await bot.container.get('database');
      const telebot = await bot.container.get('telebot');
      await db.delete(String(chatId), 'library', item);
      await telebot.telegram.sendMessage(chatId, `🗑️ Removed ${item} from the library.`);
      res.writeHead(200); res.end(JSON.stringify({ success: true, removed: item })); return;
    }

    // POST /library/borrow — borrow an item
    if (req.method === 'POST' && req.url === '/library/borrow') {
      const { chatId, item, sender } = await getBody();
      if (!chatId || !item) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and item required' })); return; }
      const db = await bot.container.get('database');
      const telebot = await bot.container.get('telebot');
      const holon = String(chatId);
      const libItem = await db.get(holon, 'library', item);
      if (!libItem) { res.writeHead(404); res.end(JSON.stringify({ error: `${item} not found in library` })); return; }
      if (libItem.borrowedBy) { res.writeHead(409); res.end(JSON.stringify({ error: `${item} already borrowed by ${libItem.borrowedByUsername || libItem.borrowedBy}` })); return; }
      libItem.borrowedBy = sender?.id || Number(chatId);
      libItem.borrowedByUsername = sender?.username || sender?.first_name || 'unknown';
      libItem.borrowedAt = Date.now();
      await db.put(holon, 'library', libItem);
      await telebot.telegram.sendMessage(chatId, `📦 ${sender?.first_name || 'Someone'} borrowed ${item}.`);
      res.writeHead(200); res.end(JSON.stringify({ success: true, item: libItem })); return;
    }

    // POST /library/return — return a borrowed item
    if (req.method === 'POST' && req.url === '/library/return') {
      const { chatId, item } = await getBody();
      if (!chatId || !item) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and item required' })); return; }
      const db = await bot.container.get('database');
      const telebot = await bot.container.get('telebot');
      const holon = String(chatId);
      const libItem = await db.get(holon, 'library', item);
      if (!libItem) { res.writeHead(404); res.end(JSON.stringify({ error: `${item} not found` })); return; }
      const borrower = libItem.borrowedByUsername || 'someone';
      libItem.borrowedBy = null; libItem.borrowedByUsername = null; libItem.borrowedAt = null;
      await db.put(holon, 'library', libItem);
      await telebot.telegram.sendMessage(chatId, `✅ ${item} returned (was borrowed by ${borrower}).`);
      res.writeHead(200); res.end(JSON.stringify({ success: true, item: libItem })); return;
    }

    // POST /message — send plain text message
    if (req.method === 'POST' && req.url === '/message') {
      const { chatId, text } = await getBody();
      if (!chatId || !text) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and text required' })); return; }
      const telebot = await bot.container.get('telebot');
      const sent = await telebot.telegram.sendMessage(chatId, text);
      res.writeHead(200); res.end(JSON.stringify({ success: true, messageId: sent.message_id })); return;
    }

    // GET /status
    if (req.method === 'GET' && req.url === '/status') {
      res.end(JSON.stringify({ status: 'ok', services: bot.container.getServiceNames() }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found. POST /quest or GET /status' }));
  } catch (err) {
    console.error('API error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

apiServer.listen(API_PORT, () => {
  console.log(`HolonsBot API listening on port ${API_PORT}`);
}).on('error', (err) => {
  console.error(`API server error: ${err.message}`);
});

// Now start the bot (blocks forever due to Telegraf polling)
bot.init().then(() => {
  console.log('HolonsBot started successfully');
}).catch(err => {
  console.error('Bot init failed:', err);
  process.exit(1);
});

