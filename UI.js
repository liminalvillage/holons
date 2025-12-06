import puppetteer from 'puppeteer';
import i18next from 'i18next';
import * as utils from './utilities.js'
import fs from 'fs';
import { Markup } from 'telegraf';
import { getDisplayName, getAvatarUrl, getHolonName, createPaddedCaption } from './utilities.js';
import QRCode from 'qrcode';

const DASHBOARD_ADDRESS = process.env.DASHBOARD_ADDRESS || 'https://dashboard.holons.io';

let browser = null;

class UI {
  constructor(bot, db, settings) {
    this.bot = bot;
    this.db = db;
    this.settings = settings
    this.expensesInstance = null;
    //=========== UI COMMANDS ===============

    //Set up a command to display the appreciation score for each user
    this.bot.command(['leaderboard', 'appreciation', 'credits', 'scores', 'score', 'points', 'rank', 'status'], async (ctx) => this.leaderboard(ctx))
    this.bot.command(['fiorini','apprezzamento', 'crediti', 'punti', 'punteggio', 'punteggi', 'classifica', 'stato'], async (ctx) => this.leaderboard(ctx))

    // Set up a command to display the quests
    this.bot.command(['tasks', 'todos', 'proposals'],  (ctx) =>  this.questboard(ctx))
    this.bot.command(['compiti', 'missioni', 'proposte'], (ctx) => this.questboard(ctx))

    // Set up a command to display the requests
    this.bot.command(['requests', 'wishes'], (ctx) => this.requestsboard(ctx))
    this.bot.command('offers', (ctx) => this.offersboard(ctx))

    this.bot.command(['richieste', 'sogni', 'bisogni'], (ctx) => this.requestsboard(ctx))
    this.bot.command('offerte', (ctx) => this.offersboard(ctx))

    this.bot.command(['bulletin', 'billboard', 'board'], (ctx) => this.bulletinboard(ctx))
    this.bot.command(['bacheca', 'lavagna'], (ctx) => this.bulletinboard(ctx))

    this.bot.command('values', (ctx) => this.valuescloud(ctx))
    this.bot.command('needs', (ctx) => this.needscloud(ctx))
    this.bot.command('cloud', (ctx) => this.valuescloud(ctx))
 
    this.bot.command('dashboard', async (ctx) => {
      let chatID = ctx.message.chat.id
      const language = await this.settings.getLanguage(chatID)
      const dashboardUrl = `${DASHBOARD_ADDRESS}/${chatID}/dashboard`
      
      try {
        // Generate QR code
        const qrCodePath = `./temp/qr_dashboard_${chatID}.png`
        
        // Ensure temp directory exists
        if (!fs.existsSync('./temp')) {
          fs.mkdirSync('./temp', { recursive: true })
        }
        
        // Generate QR code as PNG
        await QRCode.toFile(qrCodePath, dashboardUrl, {
          width: 300,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        })
        
        // Send QR code image with caption and button
        await ctx.replyWithPhoto(
          { source: fs.createReadStream(qrCodePath) },
          {
            caption: createPaddedCaption(''),
            reply_markup: Markup.inlineKeyboard([
              Markup.button.url(i18next.t('Open Dashboard', { lng: language }), dashboardUrl)
            ]).reply_markup
          }
        )
        
        // Clean up the temporary QR code file
        fs.unlinkSync(qrCodePath)
        
      } catch (error) {
        console.error('Error generating QR code:', error)
        // Fallback to original behavior if QR generation fails
        ctx.reply('Holonic Dashboard', Markup.inlineKeyboard([
          Markup.button.url(i18next.t('Open Dashboard', { lng: language }), dashboardUrl)
        ]))
      }
    })
  }

  // Get optimized Puppeteer launch options for emoji support
  getPuppeteerLaunchOptions() {
    return {
          headless: true,
          protocolTimeout: 10000, // Fast timeout - 10 seconds
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
        '--disable-images', // Skip loading images for faster performance
        // Emoji and font rendering support
        '--font-render-hinting=none',
        '--disable-font-subpixel-positioning',
        '--disable-features=VizDisplayCompositor',
        // Enable emoji fonts
        '--enable-features=FontAccess',
        '--disable-web-security', // Allow access to system fonts
        '--allow-running-insecure-content',
        // Force enable color emoji
        '--force-color-profile=srgb',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    };
  }

  async init() {
    // Initialize browser on startup
    try {
      if (!browser || !browser.connected) {
        console.log('Initializing Puppeteer browser...');
        browser = await puppetteer.launch(this.getPuppeteerLaunchOptions());
        console.log('Browser initialized successfully');
      }
    } catch (error) {
      console.error('Failed to initialize browser:', error);
    }
  }

  setExpensesInstance(expensesInstance) {
    this.expensesInstance = expensesInstance;
  }

  async closeBrowser() {
    if (browser) {
      try {
        console.log('Closing Puppeteer browser...');
        await browser.close();
        browser = null;
        console.log('Browser closed successfully');
      } catch (error) {
        console.error('Error closing browser:', error);
      }
    }
  }




  async leaderboard(ctx) {
    let chatID = ctx.message.chat.id
    let users = await this.db.holosphere.getAll(chatID.toString(), 'users')
    const language = await this.settings.getLanguage(chatID)

    // Assuming Expenses class instance is available via this.bot.expenses
    // If not, this needs to be instantiated or passed to UI class constructor
    const expensesInstance = this.expensesInstance;
    if (!expensesInstance) {
        console.error('Expenses instance not available in UI.js for leaderboard calculation.');
        ctx.reply('Error calculating leaderboard: Expenses module not accessible.');
        return;
    }

    // Calculate user scores using the Settings class method
    this.getRankTable(users, chatID, expensesInstance).then((path) => {
      if (path) {
        ctx.replyWithPhoto(
          { source: fs.createReadStream(path) },
          {
            caption: createPaddedCaption(''),
            ...Markup.inlineKeyboard([
              Markup.button.url(i18next.t('Open Dashboard', { lng: language }),
                `${DASHBOARD_ADDRESS}/${chatID}/status`)
            ])
          }
        ).catch(err => console.error('Error sending leaderboard photo:', err));
      } else {
        ctx.reply(i18next.t('leaderboardgenerror', {lng: language}) || 'Could not generate leaderboard image.');
      }
    }).catch(err => {
        console.error('Error in getRankTable promise chain:', err);
        ctx.reply(i18next.t('leaderboarderror', {lng: language}) || 'An error occurred while generating the leaderboard.');
    });
    return;
  }

  async getRankTable(users, chatID, expensesInstance) {
    const language = await this.settings.getLanguage(chatID)
    const rows = []

    // Get currencies from settings
    const settings = await this.settings.getSettings(chatID);
    const currencies = settings.currencies || [];

    // Calculate and sort user scores using the Settings class method
    const sortedUsers = await this.settings.calculateUserScores(users, chatID, expensesInstance);

    for (let i = 0; i < sortedUsers.length; i++) {
      const user = sortedUsers[i]
      const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      const scoreClass = i < 3 ? 'top-performer' : '';
      
      // Get currency balances for this user
      const currencyBalances = [];
      if (currencies.length > 0 && expensesInstance) {
        for (const currency of currencies) {
          try {
            const balance = await expensesInstance.getUserCurrencyBalance(chatID, user.id, currency);
            currencyBalances.push(balance);
          } catch (e) {
            console.error(`Error getting balance for ${currency} for user ${user.id}:`, e);
            currencyBalances.push(0);
          }
        }
      }
      
      // Build currency cells HTML
      const currencyCells = currencyBalances.map(balance => 
        `<td class="currency-cell">
          <span class="stat-value">${balance.toFixed(2)}</span>
        </td>`
      ).join('');
      
      // Score is already calculated and part of the user object in sortedUsers
      const row = `<tr class="${scoreClass}">
        <td class="rank-cell">
          <div class="rank-container">
            <span class="rank-icon">${rankIcon}</span>
          </div>
        </td>
        <td class="name-cell">
          <div class="user-info">
            <div class="user-details">
              <span class="user-name">${getDisplayName(user)}</span>
              ${user.username ? `<span class="user-handle">@${user.username}</span>` : ''}
            </div>
          </div>
        </td>
        <td class="stat-cell">
          <span class="stat-value">${user.initiated && user.initiated.length || 0}</span>
        </td>
        <td class="stat-cell">
          <span class="stat-value">${user.completed && user.completed.length || 0}</span>
        </td>
        <td class="stat-cell">
          <span class="stat-value" style="white-space: normal; word-wrap: break-word;">${user.sent || 0}</span>
        </td>
        <td class="stat-cell">
          <span class="stat-value" style="white-space: normal; word-wrap: break-word;">${user.received || 0}</span>
        </td>
        ${currencyCells}
        <td class="score-cell">
          <span class="score-value">${user.score.toFixed(1)}</span>
        </td>
      </tr>`

      rows.push(row)
    }

    // Build currency headers
    const currencyHeaders = currencies.map(currency => 
      `<th class="stat-header">${currency.toUpperCase()}</th>`
    ).join('');

    const element = `<div class="status-table-container">
      <div class="table-wrapper">
        <table class="status-table">
          <thead>
            <tr>
              <th class="rank-header">${i18next.t('rank', { lng: language })}</th>
              <th class="name-header">${i18next.t('name', { lng: language })}</th>
              <th class="stat-header">${i18next.t('tasksinitiated', { lng: language })}</th>
              <th class="stat-header">${i18next.t('taskscompleted', { lng: language })}</th>
              <th class="stat-header" style="white-space: normal; word-wrap: break-word;">${i18next.t('appreciation_sent', { lng: language, defaultValue: 'Appreciation Sent' })}</th>
              <th class="stat-header" style="white-space: normal; word-wrap: break-word;">${i18next.t('appreciation_received', { lng: language, defaultValue: 'Appreciation Received' })}</th>
              ${currencyHeaders}
              <th class="score-header">${i18next.t('score', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`

    const path = './images/rank' + chatID + '.png'
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID))
    await this.screenshotHtml(html, path, '.status-table-container')
    return path
  }
  async bulletinboard(ctx) {
    if (!this.db) return
    
    try {
    let chatID = ctx.message.chat.id
    let language = await this.settings.getLanguage(chatID)
    const isTopic = ctx.message.is_topic_message;
    const threadId = isTopic ? ctx.message.message_thread_id : null;
    
      // Wait for users and quests to be retrieved using holosphere.getAll with holograms
    let users = await this.db.holosphere.getAll(chatID.toString(), 'users')
    let quests = await this.db.holosphere.getAll(chatID.toString(), 'quests')

    // If in a topic, filter quests by message_thread_id
    if (isTopic && threadId) {
      quests = quests.filter(quest => quest.message_thread_id === threadId);
    }
    
      // Wait for the table image to be generated
      const path = await this.getBulletinTable(users, quests, chatID);
      
      if (!path) {
        ctx.reply(i18next.t('bulletinboardgenerror', {lng: language}) || 'Could not generate bulletin board image.');
        return;
      }
      
      // Send the image
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        {
          caption: createPaddedCaption(''),
          ...Markup.inlineKeyboard([
            Markup.button.url(i18next.t('Open in Holons', { lng: language }),
              `${DASHBOARD_ADDRESS}/${chatID}/offers`)
          ])
        }
      );
      
    } catch (err) {
      console.error('Error in bulletinboard:', err);
      const language = await this.settings.getLanguage(ctx.message.chat.id).catch(() => 'en');
      ctx.reply(i18next.t('bulletinboardgenerror', {lng: language}) || 'Could not generate bulletin board image.');
    }
  }

  async valuescloud(ctx) {
    let chatID = ctx.message.chat.id
    let values = [] // = this.getFederatedValues(chatID)
    const language = await this.settings.getLanguage(chatID)
   
    const entities = ctx.message.entities;
    let mentions = entities.filter((entity) => (entity.type === 'mention' || entity.type === 'text_mention'));
    mentions = mentions.map((entity) => ctx.message.text.substring(entity.offset + 1, entity.offset + entity.length))

    let users = await this.db.getAll(chatID + '/users')
    //only select the mentioned users

    if (mentions.length > 0)
      users = users.filter(user => mentions.includes(user.username))

    for (let i = 0; i < users.length; i++) {
      values = values.concat(users[i].values)
    }
    
    const page = await browser.newPage();
    let path = './images/valuecloud' + utils.getChatId(ctx) + '.png'
    page.setContent(fs.readFileSync('./html/cloud.html', 'utf8'))
    page.on('console', msg => {
      for (let i = 0; i < msg.args().length; ++i) {
        console.log(`${i}: ${msg.args()[i]}`);
      }
    });
    await page.addScriptTag({
      content: `
          const words = ${JSON.stringify(values)};
          window.myWordCloud.update(getWords(words));
      `
    });

    await page.waitForSelector('svg')

    // Screenshot the word cloud
    const svgElement = await page.$('svg');
    await svgElement.screenshot({
      path: path
    });
    await ctx.replyWithPhoto(
      { source: fs.createReadStream(path) },
      {
        caption: createPaddedCaption(''),
        ...Markup.inlineKeyboard([
          Markup.button.url(i18next.t('Open Dashboard', { lng: language }),
            `${DASHBOARD_ADDRESS}/${chatID}/values/`)
        ])
      }
    )
  }
  async needscloud(ctx) {
    let needs = [] // = this.getFederatedValues(chatID)
    const chatID = ctx.message.chat.id;
    const language = await this.settings.getLanguage(chatID)
    const entities = ctx.message.entities;
    let mentions = entities.filter((entity) => (entity.type === 'mention' || entity.type === 'text_mention'));
    mentions = mentions.map((entity) => ctx.message.text.substring(entity.offset + 1, entity.offset + entity.length))

    let users = await this.db.getAll(chatID + '/users')
    //only select the mentioned users

    if (mentions.length > 0)
      users = users.filter(user => mentions.includes(user.username))

    for (let i = 0; i < users.length; i++) {
      needs = needs.concat(users[i].needs)
    }

    const page = await browser.newPage();
    let path = './images/needscloud' + utils.getChatId(ctx) + '.png'
    page.setContent(fs.readFileSync('./html/cloud.html', 'utf8'))
    page.on('console', msg => {
      for (let i = 0; i < msg.args().length; ++i) {
        console.log(`${i}: ${msg.args()[i]}`);
      }
    });
    await page.addScriptTag({
      content: `
          const words = ${JSON.stringify(needs)};
          window.myWordCloud.update(getWords(words));
      `
    });
    await page.waitForSelector('svg')

    // Screenshot the word cloud
    const svgElement = await page.$('svg');
    await svgElement.screenshot({
      path: path
    });
    await ctx.replyWithPhoto(
      { source: fs.createReadStream(path) },
      {
        caption: createPaddedCaption(''),
        ...Markup.inlineKeyboard([
          Markup.button.url(i18next.t('Open Dashboard', { lng: language }),
            `${DASHBOARD_ADDRESS}/${chatID}/needs/`)
        ])
      }
    )
  }


  // Set up a command to display the quests
  async questboard(ctx) {
    if (!this.db) return
    
    try {
    // Get a list of incomplete quests
    let chatID = ctx.message.chat.id
    const language = await this.settings.getLanguage(chatID)
    const isTopic = ctx.message.is_topic_message;
    const threadId = isTopic ? ctx.message.message_thread_id : null;

      // Wait for all quests to be retrieved using holosphere.getAll with holograms
    let quests = await this.db.holosphere.getAll(chatID.toString(), 'quests')
    
      // Ensure we have a valid array before filtering
      if (!Array.isArray(quests)) {
        quests = [];
      }
      
      // Initial filter for type and status - include tasks, holograms, and recurring tasks
      quests = quests.filter(quest =>
        (quest.type === 'task' || quest.type === 'hologram' || quest.type === 'recurring') &&
        (quest.status === 'ongoing' || quest.status === 'scheduled') &&
        // Only show quests that belong to this holon (not federated from elsewhere)
        (!quest.chat || quest.chat.toString() === chatID.toString())
      )

    // If in a topic, filter further by message_thread_id
    if (isTopic && threadId) {
      quests = quests.filter(quest => quest.message_thread_id === threadId);
    }

      // Check if there are any quests to display
      if (!quests || quests.length === 0) {
        await ctx.reply(i18next.t('noquests', {lng: language}) || 'No tasks to display.');
        return;
      }

      // Create inline keyboard buttons
      const inline_keyboard_buttons = quests.map(quest => {
        const title = typeof quest.title === 'string' ? quest.title.substring(0, 50) : 'Untitled Quest';
        // Get the source holon: prefer _hologram.sourceHolon for resolved holograms, then quest.chat, fallback to chatID
        const sourceHolon = quest._hologram?.sourceHolon || quest.chat || chatID;
        return [Markup.button.callback(title, 'view_original_quest_' + sourceHolon + '_' + quest.id)];
      });

      inline_keyboard_buttons.push([
        Markup.button.url(i18next.t('Open Dashboard', { lng: language }),
          `${DASHBOARD_ADDRESS}/${chatID}/tasks`)
      ]);

      // Try to generate the table image
      try {
        const path = await this.getQuestsTable(quests, chatID, ctx);

        if (path) {
          // Send the photo with buttons
          await ctx.replyWithPhoto(
            { source: fs.createReadStream(path) },
            {
              caption: createPaddedCaption(''),
              ...Markup.inlineKeyboard(inline_keyboard_buttons)
            }
          );
        } else {
          // Image generation failed, send just the buttons
          await ctx.reply(
            i18next.t('questboard', {lng: language}) || 'Task Board:',
            Markup.inlineKeyboard(inline_keyboard_buttons)
          );
        }
      } catch (imageError) {
        console.error('Error generating quest board image:', imageError);
        // Image generation failed, send just the buttons
        await ctx.reply(
          i18next.t('questboard', {lng: language}) || 'Task Board:',
          Markup.inlineKeyboard(inline_keyboard_buttons)
        );
      }
      
    } catch (err) {
      console.error('Error in questboard:', err);
      const language = await this.settings.getLanguage(ctx.message.chat.id).catch(() => 'en');
      ctx.reply(i18next.t('questboardgenerror', {lng: language}) || 'Could not generate quest board image.');
    }
  }

  async requestsboard(ctx) {
    if (!this.db) return
    
    try {
    // Get a list of requests
    let chatID = ctx.message.chat.id
    const language = await this.settings.getLanguage(chatID)
    const isTopic = ctx.message.is_topic_message;
    const threadId = isTopic ? ctx.message.message_thread_id : null;

      // Get requests from quests collection using holosphere.getAll with holograms
    let allQuests = await this.db.holosphere.getAll(chatID.toString(), 'quests') || []
    let requests = allQuests.filter(quest => quest.type === 'request')

    // If in a topic, filter further by message_thread_id
    if (isTopic && threadId) {
      requests = requests.filter(quest => quest.message_thread_id === threadId);
    }

      // Wait for the table image to be generated
      const path = await this.getRequestsTable(requests, chatID);
      
      if (!path) {
        ctx.reply(i18next.t('requestsboardgenerror', {lng: language}) || 'Could not generate requests board image.');
        return;
      }
      
      // Send the image
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        {
          caption: createPaddedCaption(''),
          ...Markup.inlineKeyboard([
            Markup.button.url(i18next.t('Open Dashboard', { lng: language }),
              `${DASHBOARD_ADDRESS}/${chatID}/offers`)
          ])
        }
      );
      
    } catch (err) {
      console.error('Error in requestsboard:', err);
      const language = await this.settings.getLanguage(ctx.message.chat.id).catch(() => 'en');
      ctx.reply(i18next.t('requestsboardgenerror', {lng: language}) || 'Could not generate requests board image.');
    }
  }

  async offersboard(ctx) {
    if (!this.db) return
    
    try {
    // Get a list of offers
    let chatID = ctx.message.chat.id
    const language = await this.settings.getLanguage(chatID)
    const isTopic = ctx.message.is_topic_message;
    const threadId = isTopic ? ctx.message.message_thread_id : null;

      // Get offers from quests collection using holosphere.getAll with holograms
    let allQuests = await this.db.holosphere.getAll(chatID.toString(), 'quests') || []
    let offers = allQuests.filter(quest => quest.type === 'offer')

    // If in a topic, filter further by message_thread_id
    if (isTopic && threadId) {
      offers = offers.filter(quest => quest.message_thread_id === threadId);
    }

      // Wait for the table image to be generated
      const path = await this.getOffersTable(offers, chatID);
      
      if (!path) {
        ctx.reply(i18next.t('offersboardgenerror', {lng: language}) || 'Could not generate offers board image.');
        return;
      }
      
      // Send the image
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        {
          caption: createPaddedCaption(''),
          ...Markup.inlineKeyboard([
            Markup.button.url(i18next.t('Open Dashboard', { lng: language }),
              `${DASHBOARD_ADDRESS}/${chatID}/offers/`)
          ])
        }
      );
      
    } catch (err) {
      console.error('Error in offersboard:', err);
      const language = await this.settings.getLanguage(ctx.message.chat.id).catch(() => 'en');
      ctx.reply(i18next.t('offersboardgenerror', {lng: language}) || 'Could not generate offers board image.');
    }
  }

  // Fast quest image generation with aggressive optimizations
  async getQuestImage(quest, chatID, isHologram = false) {
    // PERFORMANCE OPTIMIZATION: Skip heavy operations for faster generation
    const useSimplifiedMode = process.env.QUEST_IMAGE_FAST_MODE === 'true' || false;
    
    if (useSimplifiedMode) {
      return this.getSimplifiedQuestImage(quest, chatID, isHologram);
    }
    
    // Cache frequently used data to avoid repeated database calls
    const cachedLanguage = this.languageCache?.get(chatID) || await this.settings.getLanguage(chatID);
    if (!this.languageCache) this.languageCache = new Map();
    this.languageCache.set(chatID, cachedLanguage);
    
    // Check if this is a hologram by examining the quest's origin
    if (!isHologram && quest.chat && quest.chat.toString() !== chatID.toString()) {
      isHologram = true;
    }
    // Also check for meta information indicating it's from another chat
    if (!isHologram && quest._meta && quest._meta.origin_chat_name) {
      isHologram = true;
    }
    
    // OPTIMIZED: Simple date formatting without timezone complexity
    const formatDate = (timestamp) => {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleDateString(cachedLanguage, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    // Status icon mapping
    const statusIcons = {
      'ongoing': '🔄',
      'completed': '✅', 
      'scheduled': '📅',
      'stopped': '🛑'
    };

    // Type icon mapping
    const typeIcons = {
      'task': '📋',
      'quest': '⚔️',
      'event': '📅',
      'proposal': '💭',
      'offer': '🎁',
      'request': '🙏',
      'todo': '✔️',
      'mission': '🎯',
      'hologram': '👻',
      'recurring': '🔄'
    };

    const statusIcon = statusIcons[quest.status] || '❓';
    const typeIcon = typeIcons[quest.type] || '📝';

    // OPTIMIZED: Build minimal HTML structure for speed
    let infoRows = '';

    // Header with type, status badges, and initiator
    infoRows += `
      <div class="quest-header">
        <span class="quest-type">${typeIcon} ${quest.type.charAt(0).toUpperCase() + quest.type.slice(1)}</span>
        <span class="quest-initiator-name">by ${getDisplayName(quest.initiator)}</span>
        <span class="quest-status">${statusIcon} ${quest.status}</span>
      </div>
    `;

    // Check if we have an image to determine layout
    let imageDataUrl = null;
    if (quest.picture) {
      try {
        imageDataUrl = quest.picture;

        // If it's a Telegram file_id, download and convert to base64
        if (quest.picture.startsWith('AgAC') || quest.picture.startsWith('BAAL') || quest.picture.includes('file_id')) {
          const fileUrl = await this.bot.telegram.getFileLink(quest.picture);
          const response = await fetch(fileUrl.href);
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64 = buffer.toString('base64');
          const mimeType = response.headers.get('content-type') || 'image/jpeg';
          imageDataUrl = `data:${mimeType};base64,${base64}`;
        }
      } catch (error) {
        console.log('Failed to convert quest image:', error);
        imageDataUrl = null;
      }
    }

    // If we have an image, use side-by-side layout
    if (imageDataUrl) {
      infoRows += `
        <div class="quest-content-with-image">
          <div class="quest-info-side">
            <div class="quest-title">${quest.title}</div>
      `;
    } else {
      // No image, use full-width layout
      infoRows += `
        <div class="quest-title">${quest.title}</div>
      `;
    }

    // PERFORMANCE: Only add essential sections to reduce HTML complexity
    
    // Description if available (truncate for performance)
    if (quest.description) {
      const truncatedDesc = quest.description.length > 100 ? 
        quest.description.substring(0, 100) + '...' : quest.description;
      infoRows += `
        <div class="quest-section">
          <div class="section-label">📝</div>
          <div class="section-content">${truncatedDesc}</div>
        </div>
      `;
    }

    // Participants (show names with time tracking, limit for performance)
    if (quest.participants && quest.participants.length > 0) {
      const maxParticipantsToShow = 5; // Limit for performance
      const participantsToShow = quest.participants.slice(0, maxParticipantsToShow);
      const participantBadges = participantsToShow.map(u => {
        const hours = quest.timeTracking && quest.timeTracking[u.id];
        if (hours && hours > 0) {
          return `<span class="participant-name">${getDisplayName(u)} (${hours.toFixed(2)}h)</span>`;
        }
        return `<span class="participant-name">${getDisplayName(u)}</span>`;
      }).join(' ');
      
      const extraCount = quest.participants.length > maxParticipantsToShow ? 
        ` +${quest.participants.length - maxParticipantsToShow} more` : '';
      
      infoRows += `
        <div class="quest-section">
          <div class="section-label">🙋‍♂</div>
          <div class="section-content participants">${participantBadges}${extraCount}</div>
        </div>
      `;
    }

    // Appreciation (show names, limit for performance)
    if (quest.appreciation && quest.appreciation.length > 0) {
      const maxAppreciationsToShow = 5; // Limit for performance
      const appreciationsToShow = quest.appreciation.slice(0, maxAppreciationsToShow);
      const appreciationBadges = appreciationsToShow.map(u => 
        `<span class="participant-name">${getDisplayName(u)}</span>`
      ).join(' ');
      
      const extraCount = quest.appreciation.length > maxAppreciationsToShow ? 
        ` +${quest.appreciation.length - maxAppreciationsToShow} more` : '';
      
      infoRows += `
        <div class="quest-section">
          <div class="section-label">👍</div>
          <div class="section-content">${appreciationBadges}${extraCount}</div>
        </div>
      `;
    }

    // Dependencies (if any)
    if (quest.dependencies && quest.dependencies.length > 0) {
      try {
        const deps = await Promise.all(
          quest.dependencies.map(async id => {
            const dep = await this.db.get(quest.chat + '/quests', id);
            return dep?.title || '';
          })
        );
        const dependencyTitles = deps.filter(d => d).join(', ');
        if (dependencyTitles) {
          infoRows += `
            <div class="quest-section">
              <div class="section-label">🔗</div>
              <div class="section-content">${dependencyTitles}</div>
            </div>
          `;
        }
      } catch (error) {
        // Silently skip dependencies if there's an error
      }
    }

    // Timing information (simplified)
    if (quest.when) {
      infoRows += `
        <div class="quest-section">
          <div class="section-label">📅</div>
          <div class="section-content">${formatDate(quest.when)}</div>
        </div>
      `;
    }

    // Close the layout sections
    if (imageDataUrl) {
      infoRows += `
          </div>
          <div class="quest-image-side">
            <img src="${imageDataUrl}" alt="Quest image" class="quest-side-image" />
          </div>
        </div>
      `;
    }

    // SKIP HEAVY OPERATIONS FOR PERFORMANCE:
    // - Skip timezone calculations
    // - Skip dependency lookups
    // - Skip checklist queries
    // - Skip complex time tracking calculations

    // Determine CSS classes based on quest status
    let containerClasses = 'quest-card-container';
    containerClasses += ` ${quest.status}`;
    
    if (quest.participants && quest.participants.length > 0) {
      containerClasses += ' has-participants';
    }
    
    if (quest.type === 'hologram' || isHologram) {
      containerClasses += ' hologram';
    }

    // Get hologram source name with timeout
    let hologramBadge = '';
    if (isHologram) {
      let hologramSource = '';
      
      // First try meta information
      if (quest._meta && quest._meta.origin_chat_name) {
        hologramSource = quest._meta.origin_chat_name;
      } 
      // Then try to get actual holon name with timeout using utility function
      else if (quest.chat) {
        try {
          // Check cache first for performance
          const cacheKey = `holon_name_${quest.chat}`;
          if (!this.holonNameCache) this.holonNameCache = new Map();
          
          if (this.holonNameCache.has(cacheKey)) {
            hologramSource = this.holonNameCache.get(cacheKey);
          } else {
            // Add timeout to holon name lookup using the utility function
            const holonNamePromise = getHolonName(this.db, quest.chat, null);
            
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Holon name lookup timeout')), 2000)
            );
            
            // Use the utility function result directly, it has its own fallback logic
            const nameFromUtil = await Promise.race([holonNamePromise, timeoutPromise]);
            hologramSource = nameFromUtil || 'Unknown Holon';
            
            // Cache the result for 10 minutes
            this.holonNameCache.set(cacheKey, hologramSource);
            setTimeout(() => this.holonNameCache.delete(cacheKey), 600000);
          }
        } catch (e) {
          hologramSource = 'External Holon';
        }
      }
      
      // Show badge for meaningful holon names (not generic fallbacks or chat IDs)
      if (hologramSource && 
          hologramSource.trim() !== '' && 
          !hologramSource.startsWith('Holon ') &&
          hologramSource !== 'Unknown Holon' &&
          hologramSource !== 'External Holon') {
        hologramBadge = `<div class="hologram-badge">📡 ${hologramSource}</div>`;
      }
    }

    // OPTIMIZED: Minimal HTML structure
    const element = `
      <div class="${containerClasses}">
        <div class="quest-card">
          ${infoRows}
          <div class="quest-footer">
            <div class="quest-id">ID: #${quest.id}</div>
            <div class="quest-date">Created: ${formatDate(quest.date)}</div>
          </div>
          ${hologramBadge}
        </div>
      </div>
    `;

    // Include source chat/holon ID and hologram status in filename for unique identification
    const sourceIdentifier = chatID ? chatID.toString() : 'unknown';
    const hologramSuffix = isHologram ? '_hologram' : '';
    const path = `./images/quest${quest.id}_from_${sourceIdentifier}${hologramSuffix}.png`;
    
    // PERFORMANCE: Cache theme data to avoid repeated lookups
    const cachedTheme = this.themeCache?.get(chatID) || await this.settings.getTheme(chatID);
    if (!this.themeCache) this.themeCache = new Map();
    this.themeCache.set(chatID, cachedTheme);
    
    const html = await this.generateHtml(element, cachedTheme);
    await this.screenshotHtml(html, path, '.quest-card-container');
    return path;
  }

  // Helper function to convert picture file_id to HTML with embedded base64
  async getSimplePictureHtml(picture) {
    try {
      let imageDataUrl = picture;

      // If it's a Telegram file_id, download and convert to base64
      if (picture.startsWith('AgAC') || picture.startsWith('BAAL') || picture.includes('file_id')) {
        const fileUrl = await this.bot.telegram.getFileLink(picture);
        const response = await fetch(fileUrl.href);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        const mimeType = response.headers.get('content-type') || 'image/jpeg';
        imageDataUrl = `data:${mimeType};base64,${base64}`;
      }

      return `<div class="simple-picture"><img src="${imageDataUrl}" alt="Quest image" class="simple-quest-image" /></div>`;
    } catch (error) {
      console.log('Failed to convert simple quest image:', error);
      return '';
    }
  }

  // Ultra-fast simplified quest image for immediate updates
  async getSimplifiedQuestImage(quest, chatID, isHologram = false) {
    const statusIcon = quest.status === 'completed' ? '✅' : 
                       quest.status === 'stopped' ? '🛑' : 
                       quest.status === 'scheduled' ? '📅' : '🔄';
    
    const typeIcon = quest.type === 'task' ? '📋' : 
                     quest.type === 'event' ? '📅' : '⚔️';
    
    // Minimal HTML for maximum speed
    const element = `
      <div class="simple-quest-card">
        <div class="simple-header">
          <span class="simple-type">${typeIcon}</span>
          <span class="simple-status">${statusIcon}</span>
        </div>
        <div class="simple-title">${quest.title}</div>
        ${quest.picture ? await this.getSimplePictureHtml(quest.picture) : ''}
        <div class="simple-footer">
          <span class="simple-participants">🙋‍♂ ${quest.participants?.length || 0}</span>
          <span class="simple-appreciation">👍 ${quest.appreciation?.length || 0}</span>
          ${quest.dependencies?.length > 0 ? `<span class="simple-dependencies">🔗 ${quest.dependencies.length}</span>` : ''}
        </div>
      </div>
    `;

    // Include source chat/holon ID and hologram status in filename for unique identification
    const sourceIdentifier = chatID ? chatID.toString() : 'unknown';
    const hologramSuffix = isHologram ? '_hologram' : '';
    const path = `./images/quest_simple_${quest.id}_from_${sourceIdentifier}${hologramSuffix}.png`;
    
    // Use minimal CSS for speed
    const simpleCss = `
      .simple-quest-card {
        width: 300px;
        padding: 20px;
        background: #2c3e50;
        border-radius: 10px;
        color: white;
        font-family: Arial, sans-serif;
      }
      .simple-header {
        display: flex;
        justify-content: space-between;
        font-size: 24px;
        margin-bottom: 10px;
      }
      .simple-title {
        font-size: 18px;
        font-weight: bold;
        margin-bottom: 15px;
        color: #ecf0f1;
      }
      .simple-picture {
        margin: 10px 0;
        text-align: center;
      }
      .simple-quest-image {
        max-width: 100%;
        max-height: 200px;
        border-radius: 8px;
        object-fit: cover;
      }
      .simple-footer {
        display: flex;
        justify-content: space-between;
        font-size: 14px;
        color: #95a5a6;
      }
    `;
    
    const html = await this.generateHtml(element, simpleCss);
    await this.screenshotHtml(html, path, '.simple-quest-card');
    return path;
  }

  async getBulletinTable(users, quests, chatID) {
    const language = await this.settings.getLanguage(chatID);
    const rows = [];

    // Get quest-based offers and requests
    const questOffers = quests.filter(quest => quest.type === 'offer' && quest.status !== 'completed');
    const questRequests = quests.filter(quest => quest.type === 'request' && quest.status !== 'completed');

    // Create a map to combine user profile data with quest data
    const userMap = new Map();

    // First, add users from user profiles
    for (let user of users) {
      const userId = user.id;
      userMap.set(userId, {
        user: user,
        profileWants: user.wants || [],
        profileOffers: user.offers || [],
        questRequests: [],
        questOffers: []
      });
    }

    // Then, add quest-based offers and requests
    for (let quest of questOffers) {
      if (quest.initiator && quest.initiator.id) {
        const userId = quest.initiator.id;
        if (!userMap.has(userId)) {
          userMap.set(userId, {
            user: quest.initiator,
            profileWants: [],
            profileOffers: [],
            questRequests: [],
            questOffers: []
          });
        }
        userMap.get(userId).questOffers.push(quest.title);
      }
    }

    for (let quest of questRequests) {
      if (quest.initiator && quest.initiator.id) {
        const userId = quest.initiator.id;
        if (!userMap.has(userId)) {
          userMap.set(userId, {
            user: quest.initiator,
            profileWants: [],
            profileOffers: [],
            questRequests: [],
            questOffers: []
          });
        }
        userMap.get(userId).questRequests.push(quest.title);
      }
    }

    // Generate rows for users who have any wants or offers
    for (let [userId, userData] of userMap) {
      const totalWants = userData.profileWants.length + userData.questRequests.length;
      const totalOffers = userData.profileOffers.length + userData.questOffers.length;

      if (totalWants > 0 || totalOffers > 0) {
        // Combine profile wants and quest requests
        const allWants = [...userData.profileWants, ...userData.questRequests];
        const wantsList = allWants.length > 0 ? 
          allWants.map(want => `<span class="item-text" style="font-size: 18px;">${want}</span>`).join('<br/>') : 
          '<span class="no-items" style="font-size: 18px;">-</span>';
        
        // Combine profile offers and quest offers
        const allOffers = [...userData.profileOffers, ...userData.questOffers];
        const offersList = allOffers.length > 0 ? 
          allOffers.map(offer => `<span class="item-text" style="font-size: 18px;">${offer}</span>`).join('<br/>') : 
          '<span class="no-items" style="font-size: 18px;">-</span>';

        const row = `<tr class="bulletin-row">
          <td class="name-cell-compact">
            <div class="user-info-compact" style="font-size: 18px;">
              <div class="user-name-compact" style="font-size: 20px; font-weight: bold;">${getDisplayName(userData.user)}</div>
            </div>
          </td>
          <td class="wants-cell-expanded">
            <div class="items-container-expanded" style="font-size: 18px;">
              ${wantsList}
            </div>
          </td>
          <td class="offers-cell-expanded">
            <div class="items-container-expanded" style="font-size: 18px;">
              ${offersList}
            </div>
          </td>
        </tr>`;
        
        rows.push(row);
      }
    }

    // Handle empty case
    if (rows.length === 0) {
      rows.push(`<tr class="empty-row">
        <td colspan="3" class="empty-cell">
          <div class="empty-message">No offers or requests found. Create some with /offer [description] or /request [description]</div>
        </td>
      </tr>`);
    }

    const element = `<div class="status-table-container" style="font-size: 18px;">
      <div class="table-wrapper">
        <table class="status-table bulletin-table" style="font-size: 18px;">
          <colgroup>
            <col style="width: 12%;">
            <col style="width: 44%;">
            <col style="width: 44%;">
          </colgroup>
          <thead>
            <tr>
              <th class="name-header-compact" style="font-size: 20px; font-weight: bold; text-align: center;">${i18next.t('name', { lng: language })}</th>
              <th class="wants-header-expanded" style="font-size: 20px; font-weight: bold; text-align: center;">${i18next.t('Wants', { lng: language })}</th>
              <th class="offers-header-expanded" style="font-size: 20px; font-weight: bold; text-align: center;">${i18next.t('Offers', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/offersneeds' + chatID + '.png';
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID));
    await this.screenshotHtml(html, path, '.status-table-container');
    return path;
  }

  async getCreditTable(creditMatrix, userArray, chatID) {
    const language = await this.settings.getLanguage(chatID);
    const rows = [];
    userArray.forEach((user, index) => {
      const credits = creditMatrix[index].map((credit, creditIndex) => {
        const color = credit > 0 ? 'color: #28a745;' : credit < 0 ? 'color: #dc3545;' : '';
        return `<td style="text-align: center; white-space: normal; word-wrap: break-word; ${color}">${credit.toFixed(2)}</td>`;
      }).join('');
      const total = creditMatrix[index].reduce((a, b) => a + b, 0);
      const totalColor = total > 0 ? 'color: #28a745;' : total < 0 ? 'color: #dc3545;' : '';
      const row = `<tr>
          <td style="text-align: center; white-space: normal; word-wrap: break-word;">${user}</td>
          ${credits}
          <td style="text-align: center; white-space: normal; word-wrap: break-word; ${totalColor}">${total.toFixed(2)}</td>
        </tr>`;
      rows.push(row);
    });
  
    const headers = userArray.map((user, index) => `<th scope="col" style="writing-mode: vertical-rl; text-orientation: mixed; text-align: center; white-space: normal; word-wrap: break-word;">${user}</th>`).join('');
    const element = `<div class="status-table-container">
      <div class="table-wrapper">
        <table class="status-table">
          <thead>
            <tr>
              <th scope="col" style="text-align: center; white-space: normal; word-wrap: break-word;">${i18next.t('User', { lng: language })}</th>
              ${headers}
              <th scope="col" style="text-align: center; white-space: normal; word-wrap: break-word;">${i18next.t('Total', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;
  
    const path = './images/creditMatrix' + chatID + '.png';
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID));
    await this.screenshotHtml(html, path, '.status-table-container');
    return path;
  }

  async getQuestsTable(quests, chatID, ctx) {
    const language = await this.settings.getLanguage(chatID);
    const rows = [];
    for (const quest of quests) {
      let provenanceText = '';
      let provenanceIcon = '🏠';
      let isHologram = false;
      
      if (quest._meta && quest._meta.origin_chat_name) {
        provenanceText = quest._meta.origin_chat_name;
        provenanceIcon = '🌐';
        isHologram = true;
      } else if (quest.chat && quest.chat.toString() !== chatID.toString()) {
        try {
          const nameFromUtil = await utils.getHolonName(this.db, quest.chat, ctx);
          if (nameFromUtil && nameFromUtil.trim() !== '') { // Use if non-empty
            provenanceText = nameFromUtil;
            provenanceIcon = '🔗';
            isHologram = true;
          } else { // Fallback if util function gives empty/null/undefined
            provenanceText = `${i18next.t('holon_prefix', {lng: language, defaultValue: 'Holon'})} ${quest.chat}`;
            provenanceIcon = '🔗';
            isHologram = true;
          }
        } catch (e) {
          console.warn(`Could not get holon name for chat ${quest.chat}:`, e);
          provenanceText = `${i18next.t('holon_prefix', {lng: language, defaultValue: 'Holon'})} ${quest.chat}`; // Fallback on error
          provenanceIcon = '🔗';
          isHologram = true;
        }
      } else {
        provenanceText = i18next.t('local_provenance', { lng: language, defaultValue: 'Local' });
        provenanceIcon = '🏠';
        isHologram = false;
      }

      const statusIcon = quest.status === 'completed' ? '✅' : quest.status === 'ongoing' ? '🔄' : '📅';
      const participantCount = quest.participants ? quest.participants.length : 0;
      const appreciationCount = quest.appreciation ? quest.appreciation.length : 0;
      
      // Add hologram class if this is a hologram
      const hologramClass = isHologram ? ' hologram' : '';
      const hologramBadge = isHologram ? `<div class="hologram-badge">📡 ${provenanceText}</div>` : '';

      const row = `<tr class="quest-row">
          <td class="quest-card-row" colspan="4">
            <div class="quest-card-item${hologramClass}" style="font-size: 18px;">
              ${hologramBadge}
              <div class="quest-header-row">
                <div class="quest-status-badge ${quest.status}" style="font-size: 20px;">${statusIcon}</div>
                <div class="quest-title-main" style="font-size: 22px; font-weight: bold;">${quest.title}</div>
                <div class="quest-stats-mini" style="font-size: 16px;">
                  <span class="stat-item">${participantCount}</span>
                  <span class="stat-item">${appreciationCount}</span>
            </div>
            </div>
              <div class="quest-meta-row" style="font-size: 16px;">
                <span class="quest-initiator">by ${getDisplayName(quest.initiator)}</span>
                <span class="quest-id-small">#${quest.id}</span>
              </div>
            </div>
          </td>
        </tr>`;
      rows.push(row);
    }

    const element = `<div class="quest-list-container" style="font-size: 18px;">
      <div class="quest-list-header">
        <div class="header-title" style="font-size: 24px; font-weight: bold;">${i18next.t('Quests', { lng: language })}</div>
        <div class="header-stats" style="font-size: 16px;">🙋‍♂ ${i18next.t('People', { lng: language })} | 👏 ${i18next.t('Appreciation', { lng: language })}</div>
      </div>
      <div class="quest-list-wrapper">
        <table class="quest-list-table" style="font-size: 18px;">
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/quests' + chatID + '.png';
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID));
    await this.screenshotHtml(html, path, '.quest-list-container');
    return path;
  }

  async getRolesTable(roles, chatID) {
    const language = await this.settings.getLanguage(chatID);
    const rows = [];
    
    if (roles.length === 0) {
      // Handle empty case
      rows.push(`<tr class="empty-row">
        <td colspan="2" class="empty-cell">
          <div class="empty-message" style="font-size: 18px; text-align: center;">No roles found. Create one with /addrole [role name]</div>
        </td>
      </tr>`);
    } else {
      for (let i = 0; i < roles.length; i++) {
        const role = roles[i];
        const participantsList = role.participants && role.participants.length > 0 ? 
          role.participants.map(participant => `<span class="participant-name" style="font-size: 18px;">${getDisplayName(participant)}</span>`).join(' ') : 
          '<span class="no-participants" style="font-size: 18px;">-</span>';
        
        const row = `<tr class="role-row">
            <td class="role-cell">
              <div class="role-info" style="font-size: 18px; text-align: center;">
                <span class="role-title" style="font-size: 22px; font-weight: bold;">${role.title}</span>
                ${role.description ? `<div class="role-description" style="font-size: 16px;">${role.description}</div>` : ''}
              </div>
            </td>
            <td class="participants-cell">
              <div class="participants-info" style="font-size: 18px; text-align: center;">
                ${participantsList}
              </div>
            </td>
          </tr>`;

        rows.push(row);
      }
    }

    const element = `<div class="status-table-container" style="font-size: 18px; background: transparent !important; border: none !important; box-shadow: none !important;">
      <div class="table-wrapper">
        <table class="status-table" style="font-size: 18px; background: transparent !important; border: none !important;">
          <thead>
            <tr>
              <th class="role-header" style="font-size: 20px; font-weight: bold; text-align: center;">${i18next.t('Roles', { lng: language })}</th>
              <th class="participants-header" style="font-size: 20px; font-weight: bold; text-align: center;">${i18next.t('People', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/roles' + chatID + '.png';
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID));
    await this.screenshotHtml(html, path, '.status-table-container');
    return path;
  }


  async getRequestsTable(requests, chatID) {
    const language = await this.settings.getLanguage(chatID);

    const rows = [];
    
    if (requests.length === 0) {
      // Handle empty case
      rows.push(`<tr class="empty-row">
        <td colspan="2" class="empty-cell">
          <div class="empty-message">No requests found. Create one with /request [description]</div>
        </td>
      </tr>`);
    } else {
      for (let i = 0; i < requests.length; i++) {
        const request = requests[i];
        const row = `<tr class="request-row">
            <td class="name-cell">
              <div class="user-info">
                <div class="user-details">
                  <span class="user-name">${getDisplayName(request.initiator)}</span>
                  ${request.initiator && request.initiator.username ? `<span class="user-handle">@${request.initiator.username}</span>` : ''}
                </div>
              </div>
            </td>
            <td class="request-cell">
              <div class="request-info">
                <span class="request-title">${request.title}</span>
              </div>
            </td>
          </tr>`;

        rows.push(row);
      }
    }

    const element = `<div class="status-table-container">
      <div class="table-wrapper">
        <table class="status-table">
          <thead>
            <tr>
              <th class="name-header" style="text-align: center;">${i18next.t('Person', { lng: language })}</th>
              <th class="request-header" style="text-align: center;">${i18next.t('Request', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/requests' + chatID + '.png';
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID));
    await this.screenshotHtml(html, path, '.status-table-container');
    return path;
  }

  async getOffersTable(offers, chatID) {
    const language = await this.settings.getLanguage(chatID);

    const rows = [];
    
    if (offers.length === 0) {
      // Handle empty case
      rows.push(`<tr class="empty-row">
        <td colspan="2" class="empty-cell">
          <div class="empty-message">No offers found. Create one with /offer [description]</div>
        </td>
      </tr>`);
    } else {
      for (let i = 0; i < offers.length; i++) {
        const offer = offers[i];
        const row = `<tr class="offer-row">
            <td class="name-cell">
              <div class="user-info">
                <div class="user-details">
                  <span class="user-name">${getDisplayName(offer.initiator)}</span>
                  ${offer.initiator && offer.initiator.username ? `<span class="user-handle">@${offer.initiator.username}</span>` : ''}
                </div>
              </div>
            </td>
            <td class="offer-cell">
              <div class="offer-info">
                <span class="offer-title">${offer.title}</span>
              </div>
            </td>
          </tr>`;

        rows.push(row);
      }
    }

    const element = `<div class="status-table-container">
      <div class="table-wrapper">
        <table class="status-table">
          <thead>
            <tr>
              <th class="name-header" style="text-align: center;">${i18next.t('Person', { lng: language })}</th>
              <th class="offer-header" style="text-align: center;">${i18next.t('Offer', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/offers' + chatID + '.png';
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID));
    await this.screenshotHtml(html, path, '.status-table-container');
    return path;
  }

  async generateHtml(element, theme) {
    return `<!DOCTYPE html>
      <html>
      <head>
      <style>`
      + theme +
      `</style>
      </head>
      <body>`
      + element.toString() +
      `</body>
      </html>`
  }

  async screenshotHtml(html, pathToSave, onElement) {
    let page = null;
    try {
      // Ensure browser is available with optimized pool
      if (!browser || !browser.connected) {
        console.log('Launching optimized browser instance...');
        browser = await puppetteer.launch(this.getPuppeteerLaunchOptions());
      }

      page = await browser.newPage();
      
      // DYNAMIC VIEWPORT: Use high DPI for better image quality
      let initialViewport = { width: 1200, height: 800, deviceScaleFactor: 2 };

      // For table containers and quest lists, use even larger viewport to prevent clipping
      if (onElement.includes('table-container') ||
          onElement.includes('quest-list') ||
          onElement.includes('status-table') ||
          onElement === 'table' ||
          onElement.includes('modern-table')) {
        initialViewport = { width: 1400, height: 1200, deviceScaleFactor: 2 };
      }

      // For quest cards with images, ensure high quality
      if (onElement.includes('quest-card')) {
        initialViewport = { width: 1200, height: 800, deviceScaleFactor: 2 };
      }

      await page.setDefaultTimeout(5000); // Increased timeout for larger content
      await page.setViewport(initialViewport);
      
      // SKIP FONT LOADING for speed - use system fonts only
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      
      // Wait for element and get its actual dimensions
      try {
        await page.waitForSelector(onElement, { timeout: 2000 });
      } catch (timeoutError) {
        console.warn('Element wait timeout, proceeding anyway');
      }
      
      // OPTIMIZED SCREENSHOT: Take screenshot with high quality settings
      const screenshotOptions = {
        path: pathToSave,
        type: 'png',
        omitBackground: false,
        captureBeyondViewport: false
      };

      // Try to get element dimensions and adjust viewport if needed
      try {
        const elementInfo = await page.evaluate((selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            x: Math.max(0, rect.left),
            y: Math.max(0, rect.top), 
            width: rect.width,
            height: rect.height,
            scrollWidth: element.scrollWidth || rect.width,
            scrollHeight: element.scrollHeight || rect.height
          };
        }, onElement);
        
        if (elementInfo && elementInfo.width > 0 && elementInfo.height > 0) {
          // For tables and lists, ensure we capture the full content without artificial constraints
          const shouldResize = elementInfo.scrollHeight > initialViewport.height || 
                              elementInfo.scrollWidth > initialViewport.width;
          
          if (shouldResize) {
            const newViewport = {
              width: Math.max(initialViewport.width, Math.ceil(elementInfo.scrollWidth + 100)),
              height: Math.max(initialViewport.height, Math.ceil(elementInfo.scrollHeight + 100))
            };

            // Check if viewport would exceed Telegram's photo dimension limits
            const MAX_VIEWPORT_HEIGHT = 5000;
            const MAX_VIEWPORT_WIDTH = 5000;

            if (newViewport.height > MAX_VIEWPORT_HEIGHT || newViewport.width > MAX_VIEWPORT_WIDTH) {
              console.log(`Viewport too large (${newViewport.width}x${newViewport.height}), skipping image generation`);
              await page.close();
              return null; // Return null to trigger fallback to buttons-only
            }

            console.log(`Resizing viewport for ${onElement}: ${newViewport.width}x${newViewport.height}`);
            await page.setViewport(newViewport);

            // Wait a moment for reflow
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Re-evaluate element position after resize
            const updatedElementInfo = await page.evaluate((selector) => {
              const element = document.querySelector(selector);
              if (!element) return null;
              const rect = element.getBoundingClientRect();
              return {
                x: Math.max(0, rect.left),
                y: Math.max(0, rect.top), 
                width: rect.width,
                height: rect.height
              };
            }, onElement);
            
            if (updatedElementInfo) {
              screenshotOptions.clip = {
                x: updatedElementInfo.x,
                y: updatedElementInfo.y,
                width: updatedElementInfo.width,
                height: updatedElementInfo.height
              };
            }
          } else {
            // Use element clipping for smaller content
            screenshotOptions.clip = {
              x: elementInfo.x,
              y: elementInfo.y,
              width: elementInfo.width,
              height: elementInfo.height
            };
          }
        }
      } catch (clipError) {
        // Skip clipping and take full page screenshot as fallback
        console.warn('Element clipping failed, using full page screenshot:', clipError.message);
      }
      
      await page.screenshot(screenshotOptions);
      
    } catch (error) {
      console.error('Screenshot error:', error);
      
      // Quick browser restart on critical errors
      if (error.message.includes('Protocol error') || error.message.includes('Connection closed')) {
        console.log('Browser connection lost, attempting quick restart...');
        try {
          if (browser) {
            await browser.close().catch(() => {});
          }
          browser = null;
        } catch (closeError) {
          console.error('Error closing browser:', closeError);
        }
      }
      
      throw error;
    } finally {
      // Quick page cleanup
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          console.error('Error closing page:', closeError);
        }
      }
    }
  }

  async getZoneDistributionChart(a, b, c, nzones = 6, chatID) {
    const language = await this.settings.getLanguage(chatID);
    
    // Calculate zone weights and percentages
    let totalWeight = 0;
    const zoneData = [];
    let maxWeight = 0;
    
    for (let zone = 0; zone < nzones; zone++) {
      const weight = Math.max(0, a * zone * zone + b * zone + c);
      totalWeight += weight;
      maxWeight = Math.max(maxWeight, weight);
      zoneData.push({ zone, weight });
    }
    
    // Generate SVG chart
    const chartWidth = 1200;
    const chartHeight = 500;
    const padding = 80;
    const barWidth = (chartWidth - 2 * padding) / nzones * 0.8;
    const maxBarHeight = chartHeight - 2 * padding;
    
    // Generate bars and function curve
    const bars = [];
    const curvePoints = [];
    const labels = [];
    
    for (let i = 0; i < zoneData.length; i++) {
      const zoneInfo = zoneData[i];
      const percentage = totalWeight > 0 ? ((zoneInfo.weight / totalWeight) * 100).toFixed(1) : '0.0';
      const barHeight = maxWeight > 0 ? (zoneInfo.weight / maxWeight) * maxBarHeight : 0;
      const x = padding + i * (chartWidth - 2 * padding) / nzones + (chartWidth - 2 * padding) / nzones / 2;
      const y = chartHeight - padding - barHeight;
      
      // Generate gradient colors
      const hue = 240 + (i / nzones) * 120; // Blue to cyan spectrum
      const saturation = 70 + (zoneInfo.weight / maxWeight) * 30;
      const lightness = 50 + (zoneInfo.weight / maxWeight) * 20;
      
      bars.push(`
        <rect x="${x - barWidth/2}" y="${y}" width="${barWidth}" height="${barHeight}" 
              fill="hsl(${hue}, ${saturation}%, ${lightness}%)" 
              stroke="rgba(255,255,255,0.3)" stroke-width="1"
              rx="4" ry="4" class="bar-rect"/>
      `);
      
      // Function curve points
      const curveY = maxWeight > 0 ? chartHeight - padding - (zoneInfo.weight / maxWeight) * maxBarHeight : chartHeight - padding;
      curvePoints.push(`${x},${curveY}`);
      
      // Labels
      labels.push(`
        <text x="${x}" y="${chartHeight - padding + 25}" text-anchor="middle" 
              fill="#e0e0e0" font-size="14" font-weight="bold">Zone ${zoneInfo.zone}</text>
        <text x="${x}" y="${chartHeight - padding + 45}" text-anchor="middle" 
              fill="#a0a0a0" font-size="12">${percentage}%</text>
      `);
    }
    
    // Generate smooth curve path
    const curvePath = `M ${curvePoints.join(' L ')}`;
    
    // Generate grid lines
    const gridLines = [];
    for (let i = 0; i <= 5; i++) {
      const y = padding + (maxBarHeight / 5) * i;
      const percentage = ((5 - i) / 5 * 100).toFixed(0);
      gridLines.push(`
        <line x1="${padding}" y1="${y}" x2="${chartWidth - padding}" y2="${y}" 
              stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="5,5"/>
        <text x="${padding - 10}" y="${y + 4}" text-anchor="end" fill="#808080" font-size="12">${percentage}%</text>
      `);
    }
    
    const formulaDisplay = `f(x) = ${a}x² + ${b}x + ${c}`;
    
    const element = `
      <div class="chart-container">
        <div class="header">
          <div class="formula">📐 ${formulaDisplay}</div>
        </div>
        
        <svg width="${chartWidth}" height="${chartHeight}" class="main-chart">
          <defs>
            <linearGradient id="curveGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:0.8" />
              <stop offset="50%" style="stop-color:#4ecdc4;stop-opacity:0.8" />
              <stop offset="100%" style="stop-color:#45b7d1;stop-opacity:0.8" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge> 
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          <!-- Grid -->
          ${gridLines.join('')}
          
          <!-- Bars -->
          ${bars.join('')}
          
          <!-- Function curve -->
          <path d="${curvePath}" fill="none" stroke="url(#curveGradient)" 
                stroke-width="4" filter="url(#glow)"/>
          
          <!-- Curve points -->
          ${curvePoints.map((point, i) => {
            const [x, y] = point.split(',');
            return `<circle cx="${x}" cy="${y}" r="6" fill="#ffffff" stroke="url(#curveGradient)" 
                           stroke-width="3"/>`;
          }).join('')}
          
          <!-- Labels -->
          ${labels.join('')}
          
          <!-- Axis labels -->
          <text x="${chartWidth/2}" y="${chartHeight - 15}" text-anchor="middle" 
                fill="#ffffff" font-size="16" font-weight="bold">Zone Index</text>
          <text x="25" y="${chartHeight/2}" text-anchor="middle" 
                fill="#ffffff" font-size="16" font-weight="bold" transform="rotate(-90, 25, ${chartHeight/2})">Reward Weight</text>
        </svg>
        
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${totalWeight}</div>
            <div class="stat-label">Total Weight</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${nzones}</div>
            <div class="stat-label">Zone Count</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${maxWeight}</div>
            <div class="stat-label">Max Weight</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${totalWeight > 0 ? (maxWeight / totalWeight * 100).toFixed(1) : 0}%</div>
            <div class="stat-label">Peak Share</div>
          </div>
        </div>
      </div>
    `;

    const chartTheme = `
      body {
        margin: 0;
        padding: 20px;
        background: linear-gradient(135deg, #0c0c0c 0%, #1a1a1a 50%, #2d2d2d 100%);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif;
      }
      
      .chart-container {
        max-width: 1300px;
        margin: 0 auto;
        padding: 30px;
        background: linear-gradient(145deg, #1e1e1e, #2a2a2a);
        border-radius: 20px;
        color: white;
        box-shadow: 
          0 20px 40px rgba(0,0,0,0.4),
          inset 0 1px 0 rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.1);
      }
      
      .header {
        text-align: center;
        margin-bottom: 20px;
      }
      
      .formula {
        font-size: 20px;
        font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
        padding: 15px 25px;
        background: linear-gradient(135deg, rgba(255,107,107,0.1), rgba(78,205,196,0.1));
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 12px;
        font-weight: 600;
        letter-spacing: 0.5px;
        display: inline-block;
      }
      
      .main-chart {
        display: block;
        margin: 20px auto;
        background: rgba(0,0,0,0.3);
        border-radius: 15px;
        padding: 10px;
        border: 1px solid rgba(255,255,255,0.1);
      }
      
             .stats-grid {
         display: grid;
         grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
         gap: 20px;
         margin-top: 30px;
       }
       
       .stat-card {
         background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
         border: 1px solid rgba(255,255,255,0.2);
         border-radius: 15px;
         padding: 20px;
         text-align: center;
         backdrop-filter: blur(10px);
       }
      
      .stat-value {
        font-size: 24px;
        font-weight: 700;
        color: #4ecdc4;
        margin-bottom: 8px;
      }
      
      .stat-label {
        font-size: 14px;
        color: #a0a0a0;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      
    `;

    const path = `./images/zone_distribution_${chatID}.png`;
    const html = await this.generateHtml(element, chartTheme);
    
    // Retry logic for screenshot generation
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.screenshotHtml(html, path, '.chart-container');
        return path;
      } catch (error) {
        lastError = error;
        console.error(`Screenshot attempt ${attempt}/${maxRetries} failed:`, error.message);
        
        if (attempt < maxRetries) {
          console.log(`Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    throw new Error(`Failed to generate chart after ${maxRetries} attempts: ${lastError.message}`);
  }
}

export default UI;