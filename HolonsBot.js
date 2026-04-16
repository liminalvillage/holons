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

    // POST /roles — list roles in a holon
    if (req.method === 'POST' && req.url === '/roles') {
      const { chatId } = await getBody();
      if (!chatId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return; }
      const db = await bot.container.get('database');
      const roles = await db.getAll(String(chatId), 'roles');
      res.writeHead(200); res.end(JSON.stringify({ holon: chatId, roles: Array.isArray(roles) ? roles : [] })); return;
    }

    // POST /roles/add — add a role
    if (req.method === 'POST' && req.url === '/roles/add') {
      const { chatId, name, description, checklist } = await getBody();
      if (!chatId || !name) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and name required' })); return; }
      const db = await bot.container.get('database');
      const telebot = await bot.container.get('telebot');
      const holon = String(chatId);
      const role = { id: `r_${Date.now()}`, name, description: description || '', members: [], checklist: checklist || [] };
      await db.put(holon, 'roles', role);
      await telebot.telegram.sendMessage(chatId, `👤 Role added: ${name}${description ? '\n📝 ' + description : ''}`);
      res.writeHead(200); res.end(JSON.stringify({ success: true, role })); return;
    }

    // POST /roles/remove — remove a role
    if (req.method === 'POST' && req.url === '/roles/remove') {
      const { chatId, roleId } = await getBody();
      if (!chatId || !roleId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and roleId required' })); return; }
      const db = await bot.container.get('database');
      await db.delete(String(chatId), 'roles', roleId);
      res.writeHead(200); res.end(JSON.stringify({ success: true, deleted: roleId })); return;
    }

    // POST /checklists — list checklists
    if (req.method === 'POST' && req.url === '/checklists') {
      const { chatId } = await getBody();
      if (!chatId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return; }
      const db = await bot.container.get('database');
      const lists = await db.getAll(String(chatId), 'checklists');
      res.writeHead(200); res.end(JSON.stringify({ holon: chatId, checklists: Array.isArray(lists) ? lists : [] })); return;
    }

    // POST /checklists/create — create a checklist
    if (req.method === 'POST' && req.url === '/checklists/create') {
      const { chatId, name, items } = await getBody();
      if (!chatId || !name) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and name required' })); return; }
      const db = await bot.container.get('database');
      const telebot = await bot.container.get('telebot');
      const checklist = { id: `cl_${Date.now()}`, name, items: (items || []).map((t, i) => ({ id: `i_${i}`, text: t, checked: false })) };
      await db.put(String(chatId), 'checklists', checklist);
      await telebot.telegram.sendMessage(chatId, `📋 Checklist created: ${name}\n${checklist.items.map(i => `☐ ${i.text}`).join('\n') || '(empty)'}`);
      res.writeHead(200); res.end(JSON.stringify({ success: true, checklist })); return;
    }

    // POST /checklists/toggle — toggle a checklist item
    if (req.method === 'POST' && req.url === '/checklists/toggle') {
      const { chatId, checklistId, itemId } = await getBody();
      if (!chatId || !checklistId || !itemId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId, checklistId, itemId required' })); return; }
      const db = await bot.container.get('database');
      const holon = String(chatId);
      const cl = await db.get(holon, 'checklists', checklistId);
      if (!cl) { res.writeHead(404); res.end(JSON.stringify({ error: 'Checklist not found' })); return; }
      const item = cl.items?.find(i => i.id === itemId);
      if (item) item.checked = !item.checked;
      await db.put(holon, 'checklists', cl);
      res.writeHead(200); res.end(JSON.stringify({ success: true, checklist: cl })); return;
    }

    // POST /leaderboard — get appreciation scores
    if (req.method === 'POST' && req.url === '/leaderboard') {
      const { chatId } = await getBody();
      if (!chatId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return; }
      const db = await bot.container.get('database');
      const holon = String(chatId);
      const quests = await db.getAll(holon, 'quests');
      const scores = {};
      if (Array.isArray(quests)) {
        for (const q of quests) {
          if (q.appreciation) for (const u of q.appreciation) { scores[u.first_name || u.id] = (scores[u.first_name || u.id] || 0) + 1; }
          if (q.participants) for (const u of q.participants) { scores[u.first_name || u.id] = (scores[u.first_name || u.id] || 0) + 1; }
        }
      }
      const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([name, score]) => ({ name, score }));
      res.writeHead(200); res.end(JSON.stringify({ holon: chatId, leaderboard: sorted })); return;
    }

    // POST /settings — get holon settings
    if (req.method === 'POST' && req.url === '/settings') {
      const { chatId } = await getBody();
      if (!chatId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return; }
      const settings = await bot.container.get('settings');
      const s = await settings.getSettings(String(chatId));
      res.writeHead(200); res.end(JSON.stringify({ holon: chatId, settings: s })); return;
    }

    // POST /settings/update — update holon settings
    if (req.method === 'POST' && req.url === '/settings/update') {
      const { chatId, name, language, theme, purpose, values, domains, currencies } = await getBody();
      if (!chatId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return; }
      const db = await bot.container.get('database');
      const holon = String(chatId);
      const current = await db.getAll(holon, 'settings');
      const s = (Array.isArray(current) && current[0]) ? current[0] : { id: chatId, version: 0.1 };
      if (name !== undefined) s.name = name;
      if (language !== undefined) s.language = language;
      if (theme !== undefined) s.theme = theme;
      if (purpose !== undefined) s.purpose = purpose;
      if (values !== undefined) s.values = values;
      if (domains !== undefined) s.domains = domains;
      if (currencies !== undefined) s.currencies = currencies;
      await db.put(holon, 'settings', s);
      res.writeHead(200); res.end(JSON.stringify({ success: true, settings: s })); return;
    }

    // POST /federation — get federation links
    if (req.method === 'POST' && req.url === '/federation') {
      const { chatId } = await getBody();
      if (!chatId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return; }
      const db = await bot.container.get('database');
      const fed = await db.getGlobal('federation', String(chatId));
      res.writeHead(200); res.end(JSON.stringify({ holon: chatId, federation: fed || {} })); return;
    }

    // POST /federation/add — federate with another holon
    if (req.method === 'POST' && req.url === '/federation/add') {
      const { chatId, targetId } = await getBody();
      if (!chatId || !targetId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and targetId required' })); return; }
      const db = await bot.container.get('database');
      const holon = String(chatId);
      const target = String(targetId);
      const fed = await db.getGlobal('federation', holon) || {};
      fed[target] = { joined: Date.now(), active: true };
      await db.putGlobal('federation', holon, fed);
      // Bidirectional
      const targetFed = await db.getGlobal('federation', target) || {};
      targetFed[holon] = { joined: Date.now(), active: true };
      await db.putGlobal('federation', target, targetFed);
      res.writeHead(200); res.end(JSON.stringify({ success: true, federation: fed })); return;
    }

    // POST /federation/remove — unfederate
    if (req.method === 'POST' && req.url === '/federation/remove') {
      const { chatId, targetId } = await getBody();
      if (!chatId || !targetId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId and targetId required' })); return; }
      const db = await bot.container.get('database');
      const holon = String(chatId);
      const target = String(targetId);
      const fed = await db.getGlobal('federation', holon) || {};
      delete fed[target];
      await db.putGlobal('federation', holon, fed);
      res.writeHead(200); res.end(JSON.stringify({ success: true, removed: targetId })); return;
    }

    // POST /members — list members
    if (req.method === 'POST' && req.url === '/members') {
      const { chatId } = await getBody();
      if (!chatId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return; }
      const db = await bot.container.get('database');
      const users = await db.getAll(String(chatId), 'users');
      res.writeHead(200); res.end(JSON.stringify({ holon: chatId, members: Array.isArray(users) ? users : [] })); return;
    }

    // POST /ledger — get expense balances
    if (req.method === 'POST' && req.url === '/ledger') {
      const { chatId } = await getBody();
      if (!chatId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return; }
      const db = await bot.container.get('database');
      const holon = String(chatId);
      const expenses = await db.getAll(holon, 'expenses');
      const balances = {};
      if (Array.isArray(expenses)) {
        for (const e of expenses) {
          const payer = String(e.paidBy);
          const splitCount = e.splitWith?.length || 1;
          const perPerson = e.amount / splitCount;
          balances[payer] = (balances[payer] || 0) + e.amount - perPerson;
          if (e.splitWith) for (const uid of e.splitWith) {
            const u = String(uid);
            if (u !== payer) balances[u] = (balances[u] || 0) - perPerson;
          }
        }
      }
      res.writeHead(200); res.end(JSON.stringify({ holon: chatId, balances, expenseCount: expenses?.length || 0 })); return;
    }

    // POST /agenda — get upcoming scheduled quests/events
    if (req.method === 'POST' && req.url === '/agenda') {
      const { chatId, days } = await getBody();
      if (!chatId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return; }
      const db = await bot.container.get('database');
      const holon = String(chatId);
      const now = Date.now();
      const horizon = now + (days || 7) * 86400000;
      const [quests, events] = await Promise.all([
        db.getAll(holon, 'quests').catch(() => []),
        db.getAll(holon, 'events').catch(() => []),
      ]);
      const upcoming = [];
      for (const q of (quests || [])) {
        if (q.when) { const d = new Date(q.when).getTime(); if (d >= now && d <= horizon) upcoming.push({ type: 'quest', ...q }); }
      }
      for (const e of (events || [])) {
        if (e.when) { const d = new Date(e.when).getTime(); if (d >= now && d <= horizon) upcoming.push({ type: 'event', ...e }); }
      }
      upcoming.sort((a, b) => new Date(a.when) - new Date(b.when));
      res.writeHead(200); res.end(JSON.stringify({ holon: chatId, days: days || 7, upcoming })); return;
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

