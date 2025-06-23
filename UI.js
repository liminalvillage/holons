import puppetteer from 'puppeteer';
import i18next from 'i18next';
import * as utils from './utilities.js'
import fs from 'fs';
import { Markup } from 'telegraf'; 
import { getDisplayName, getAvatarUrl } from './utilities.js';

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
      ctx.reply('Holonic Dashboard', Markup.inlineKeyboard([
        Markup.button.url(i18next.t('Open Dashboard', { lng: language }), 
          `https://dashboard.holons.io/${chatID}/`)
      ]))
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

  async getFederatedUsers(chatID) {
    // Get all users from the chat
    let users = await this.db.getAll(chatID + '/users');
    
    try {
      // Get users from federated spaces using holosphere's federated functionality
      const federatedUsers = await this.db.holosphere.getFederated(chatID, 'users', {
        aggregate: true,
        idField: 'username',
        sumFields: ['received', 'sent'],
        includeFederated: true,
        includeLocal: false
      });
      
      // Combine local and federated users
      if (federatedUsers && federatedUsers.length > 0) {
        for (const fedUser of federatedUsers) {
          let found = false;
          for (let i = 0; i < users.length; i++) {
            if (users[i].username === fedUser.username) {
              // Merge user data
              users[i].received = (users[i].received || 0) + (fedUser.received || 0);
              users[i].sent = (users[i].sent || 0) + (fedUser.sent || 0);
              found = true;
              break;
            }
          }
          
          if (!found) {
            // Add new federated user
            users.push(fedUser);
          }
        }
      }
    } catch (error) {
      console.error('Error getting federated users:', error);
    }
    
    return users;
  }

  async getFederatedQuests(chatID) {
    try {
      // Get local quests using getAll and wait for results
      const localQuests = await this.db.getAll(chatID + '/quests') || [];

      // Get federated quests (if available) and wait for results
      let federatedQuests = [];
      if (this.db.holosphere && typeof this.db.holosphere.getFederated === 'function') {
        federatedQuests = await this.db.holosphere.getFederated(chatID, 'quests', {
          includeFederated: true,
          includeLocal: false
        }) || [];
      }

      // Ensure both arrays are valid before merging
      const validLocalQuests = Array.isArray(localQuests) ? localQuests : [];
      const validFederatedQuests = Array.isArray(federatedQuests) ? federatedQuests : [];

      // Merge and deduplicate by quest id (if needed)
      const allQuests = [...validLocalQuests, ...validFederatedQuests];
      
      // Deduplicate by id if federated and local overlap
      const uniqueQuests = Array.from(new Map(allQuests.map(q => [q.id, q])).values());

      return uniqueQuests;
    } catch (error) {
      console.error('Error getting federated quests:', error);
      return [];
    }
  }

  async getFederatedValues(chatID) {
    try {
      // First get all users with their values from both local and federated spaces
      let users = await this.getFederatedUsers(chatID);
      
      // Extract and combine all values
      let allValues = [];
      for (let i = 0; i < users.length; i++) {
        if (users[i].values && Array.isArray(users[i].values)) {
          allValues = allValues.concat(users[i].values);
        }
      }
      
      // Remove duplicates
      const uniqueValues = [...new Set(allValues)];
      return uniqueValues;
    } catch (error) {
      console.error('Error getting federated values:', error);
      return [];
    }
  }


  async leaderboard(ctx) {
    let chatID = ctx.message.chat.id
    const currentSettings = await this.settings.getSettings(chatID) // Get all settings
    const valueEquation = currentSettings.valueEquation
    const currencies = currentSettings.currencies || []
    let users = await this.getFederatedUsers(chatID)
    const language = await this.settings.getLanguage(chatID)

    // Assuming Expenses class instance is available via this.bot.expenses
    // If not, this needs to be instantiated or passed to UI class constructor
    const expensesInstance = this.expensesInstance;
    if (!expensesInstance) {
        console.error('Expenses instance not available in UI.js for leaderboard calculation.');
        ctx.reply('Error calculating leaderboard: Expenses module not accessible.');
        return;
    }

    // Create a table header
    this.getRankTable(users, valueEquation, currencies, chatID, expensesInstance).then((path) => {
      if (path) {
        ctx.replyWithPhoto(
          { source: fs.createReadStream(path) },
          Markup.inlineKeyboard([
            Markup.button.url(i18next.t('Open Dashboard', { lng: language }), 
              `https://dashboard.holons.io/${chatID}/status`)
          ])
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

  async getRankTable(users, equation, currencies, chatID, expensesInstance) {
    const language = await this.settings.getLanguage(chatID)
    const rows = []

    // Calculate scores first, then sort
    const userScores = [];
    for (const userId in users) {
        const user = users[userId];
        if (!user || user.id === undefined) continue; // Skip if user or user.id is undefined

        let score = (user.initiated && user.initiated.length * equation.initiated || 0) +
            (user.completed && user.completed.length * equation.completed || 0) +
            (user.sent * equation.sent || 0) +
            (user.received * equation.received || 0) +
            (user.hours * equation.hours || 0) +
            (user.collaboration * equation.collaboration || 0) +
            (user.wants && user.wants.length * equation.wants || 0) +
            (user.offers && user.offers.length * equation.offers || 0);

        let currencyScoreContribution = 0;
        if (currencies && currencies.length > 0 && expensesInstance) {
            for (const currencyName of currencies) {
                const currencyKey = currencyName.toLowerCase().replace(/[^a-z0-9_]/g, '');
                if (currencyKey && equation[currencyKey] !== undefined) {
                    try {
                        const balance = await expensesInstance.getUserCurrencyBalance(chatID, user.id, currencyKey);
                        const weight = equation[currencyKey] || 0;
                        currencyScoreContribution += balance * weight;
                    } catch (e) {
                        console.error(`Error getting balance for ${currencyKey} for user ${user.id}:`, e);
                    }
                }
            }
        }
        score += currencyScoreContribution;
        userScores.push({ ...user, score });
    }

    const sortedUsers = userScores.sort((a, b) => b.score - a.score);

    for (let i = 0; i < sortedUsers.length; i++) {
      const user = sortedUsers[i]
      const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      const scoreClass = i < 3 ? 'top-performer' : '';
      
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
          <span class="stat-value">${user.sent || 0}</span>
        </td>
        <td class="stat-cell">
          <span class="stat-value">${user.received || 0}</span>
        </td>
        <td class="score-cell">
          <span class="score-value">${user.score.toFixed(1)}</span>
        </td>
      </tr>`

      rows.push(row)
    }

    const element = `<div class="status-table-container">
      <div class="table-wrapper">
        <table class="status-table">
          <thead>
            <tr>
              <th class="rank-header">${i18next.t('rank', { lng: language })}</th>
              <th class="name-header">${i18next.t('name', { lng: language })}</th>
              <th class="stat-header">${i18next.t('tasksinitiated', { lng: language })}</th>
              <th class="stat-header">${i18next.t('taskscompleted', { lng: language })}</th>
              <th class="stat-header">${i18next.t('sent', { lng: language })}</th>
              <th class="stat-header">${i18next.t('received', { lng: language })}</th>
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
    
      // Wait for users and quests to be retrieved using getAll
    let users = await this.getFederatedUsers(chatID)
    let quests = await this.getFederatedQuests(chatID)
    
      // Wait for the table image to be generated
      const path = await this.getBulletinTable(users, quests, chatID);
      
      if (!path) {
        ctx.reply(i18next.t('bulletinboardgenerror', {lng: language}) || 'Could not generate bulletin board image.');
        return;
      }
      
      // Send the image
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        Markup.inlineKeyboard([
          Markup.button.url(i18next.t('Open in Holons', { lng: language }), 
            `https://dashboard.holons.io/${chatID}/offers`)
        ])
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
      Markup.inlineKeyboard([
        Markup.button.url(i18next.t('Open Dashboard', { lng: language }), 
          `https://dashboard.holons.io/${chatID}/values/`)
      ])
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
      Markup.inlineKeyboard([
        Markup.button.url(i18next.t('Open Dashboard', { lng: language }), 
          `https://dashboard.holons.io/${chatID}/needs/`)
      ])
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

      // Wait for all quests to be retrieved using getAll (via getFederatedQuests)
    let quests = await this.getFederatedQuests(chatID)
    
      // Ensure we have a valid array before filtering
      if (!Array.isArray(quests)) {
        quests = [];
      }
      
      // Initial filter for type and status - include tasks, holograms, and recurring tasks
      quests = quests.filter(quest => 
        (quest.type === 'task' || quest.type === 'hologram' || quest.type === 'recurring') && 
        (quest.status === 'ongoing' || quest.status === 'scheduled')
      )

    // If in a topic, filter further by message_thread_id
    if (isTopic && threadId) {
      quests = quests.filter(quest => quest.message_thread_id === threadId);
    }

      // Wait for the table image to be generated
      const path = await this.getQuestsTable(quests, chatID, ctx);
      
      if (!path) {
        ctx.reply(i18next.t('questboardgenerror', {lng: language}) || 'Could not generate quest board image.');
        return;
      }

      // Create inline keyboard buttons
      const inline_keyboard_buttons = quests.map(quest => {
        const title = typeof quest.title === 'string' ? quest.title.substring(0, 50) : 'Untitled Quest';
        // Assuming quest.chat and quest.id are available and correct for the callback
        return [Markup.button.callback(title, 'view_original_quest_' + quest.chat + '_' + quest.id)];
      });

      inline_keyboard_buttons.push([
        Markup.button.url(i18next.t('Open Dashboard', { lng: language }),
          `https://dashboard.holons.io/${chatID}/tasks`)
      ]);

      // Send the photo with buttons
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        Markup.inlineKeyboard(inline_keyboard_buttons)
      );
      
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

      // Get requests from quests collection using getAll and wait for results
    let allQuests = await this.db.getAll(chatID + '/quests') || []
    let requests = allQuests.filter(quest => quest.type === 'request')

      // Wait for the table image to be generated
      const path = await this.getRequestsTable(requests, chatID);
      
      if (!path) {
        ctx.reply(i18next.t('requestsboardgenerror', {lng: language}) || 'Could not generate requests board image.');
        return;
      }
      
      // Send the image
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        Markup.inlineKeyboard([
          Markup.button.url(i18next.t('Open Dashboard', { lng: language }), 
            `https://dashboard.holons.io/${chatID}/offers`)
        ])
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

      // Get offers from quests collection using getAll and wait for results
    let allQuests = await this.db.getAll(chatID + '/quests') || []
    let offers = allQuests.filter(quest => quest.type === 'offer')

      // Wait for the table image to be generated
      const path = await this.getOffersTable(offers, chatID);
      
      if (!path) {
        ctx.reply(i18next.t('offersboardgenerror', {lng: language}) || 'Could not generate offers board image.');
        return;
      }
      
      // Send the image
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        Markup.inlineKeyboard([
          Markup.button.url(i18next.t('Open Dashboard', { lng: language }), 
            `https://dashboard.holons.io/${chatID}/offers/`)
        ])
      );
      
    } catch (err) {
      console.error('Error in offersboard:', err);
      const language = await this.settings.getLanguage(ctx.message.chat.id).catch(() => 'en');
      ctx.reply(i18next.t('offersboardgenerror', {lng: language}) || 'Could not generate offers board image.');
    }
  }

  async getQuestImage(quest, chatID, isHologram = false) {
    const language = await this.settings.getLanguage(chatID);
    
    // Check if this is a hologram by examining the quest's origin
    if (!isHologram && quest.chat && quest.chat.toString() !== chatID.toString()) {
      isHologram = true;
    }
    // Also check for meta information indicating it's from another chat
    if (!isHologram && quest._meta && quest._meta.origin_chat_name) {
      isHologram = true;
    }
    
    // Helper function to format date
    const formatDate = async (timestamp) => {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      let chatTimezone = 'UTC'; // Default fallback
      
      try {
        // Get timezone setting if available
        if (this.settings && this.settings.getTimezone) {
          chatTimezone = await this.settings.getTimezone(chatID) || 'UTC';
          if (chatTimezone === 'Not set') chatTimezone = 'UTC';
        }
        
        return date.toLocaleDateString(language, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: chatTimezone,
          timeZoneName: 'short'
        });
      } catch (e) {
        // Fallback to simple format if timezone handling fails
        return date.toLocaleDateString(language);
      }
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

    // Build the HTML structure
    let infoRows = '';

    // Header with type, status badges, and initiator
    infoRows += `
      <div class="quest-header">
        <span class="quest-type">${typeIcon} ${quest.type.charAt(0).toUpperCase() + quest.type.slice(1)}</span>
        <span class="quest-initiator-name">by ${getDisplayName(quest.initiator)}</span>
        <span class="quest-status">${statusIcon} ${quest.status}</span>
      </div>
    `;

    // Prominent title section
    infoRows += `
      <div class="quest-title">${quest.title}</div>
    `;

    // Description if available
    if (quest.description) {
      infoRows += `
        <div class="quest-section">
          <div class="section-label">📝</div>
          <div class="section-content">${quest.description}</div>
        </div>
      `;
    }

    // Recurring info
    if (quest.frequency !== null && quest.frequency !== undefined) {
      infoRows += `
        <div class="quest-section">
          <div class="section-label">🔄</div>
          <div class="section-content">${i18next.t(quest.frequency, { lng: language, defaultValue: quest.frequency })}</div>
        </div>
      `;
    }

    // Category if available
    if (quest.category) {
      infoRows += `
        <div class="quest-section">
          <div class="section-label">📑</div>
          <div class="section-content">${quest.category}</div>
        </div>
      `;
    }

    // Dependencies if available
    if (quest.dependencies && quest.dependencies.length > 0) {
      let depTitles = [];
      for (const depId of quest.dependencies) {
        try {
          const depQuest = await this.db.get(quest.chat + '/quests', depId.toString());
          if (depQuest) {
            depTitles.push(depQuest.title);
          }
        } catch (error) {
          console.error(`Error getting dependency ${depId}:`, error);
        }
      }
      if (depTitles.length > 0) {
        infoRows += `
          <div class="quest-section">
            <div class="section-label">🔗</div>
            <div class="section-content">${depTitles.join(', ')}</div>
          </div>
        `;
      }
    }

    // Checklist progress if available
    if (quest.checklistId && this.checklistsInstance) {
      try {
        const checklist = await this.db.get(quest.chat + '/checklists', quest.checklistId);
        if (checklist && checklist.items.length > 0) {
          const completed = checklist.items.filter(item => item.checked).length;
          infoRows += `
            <div class="quest-section">
              <div class="section-label">📋</div>
              <div class="section-content">${completed}/${checklist.items.length} completed</div>
            </div>
          `;
        }
      } catch (error) {
        console.error('Error getting checklist:', error);
      }
    }

    // Participants
    if (quest.participants && quest.participants.length > 0) {
      const participantBadges = quest.participants.map(u => 
        `<span class="participant-name">${getDisplayName(u)}</span>`
      ).join(' ');
      infoRows += `
        <div class="quest-section">
          <div class="section-label">👥</div>
          <div class="section-content participants">${participantBadges}</div>
        </div>
      `;
    }

    // Time tracking if available
    if (quest.timeTracking && Object.keys(quest.timeTracking).length > 0) {
      let timeEntries = [];
      for (const [userId, hours] of Object.entries(quest.timeTracking)) {
        if (hours > 0) {
          const user = quest.participants.find(p => p.id === parseInt(userId)) || quest.initiator;
          timeEntries.push(`${getDisplayName(user)}: ${hours.toFixed(2)}h`);
        }
      }
      if (timeEntries.length > 0) {
        infoRows += `
          <div class="quest-section">
            <div class="section-label">⏰</div>
            <div class="section-content">${timeEntries.join('<br/>')}</div>
          </div>
        `;
      }
    }

    // Appreciation
    if (quest.appreciation && quest.appreciation.length > 0) {
      const appreciationBadges = quest.appreciation.map(u => 
        `<span class="participant-name">${getDisplayName(u)}</span>`
      ).join(' ');
      infoRows += `
        <div class="quest-section">
          <div class="section-label">👍</div>
          <div class="section-content">${appreciationBadges}</div>
        </div>
      `;
    }

    // Timing information
    if (quest.when) {
      infoRows += `
        <div class="quest-section">
          <div class="section-label">📅</div>
          <div class="section-content">${await formatDate(quest.when)}</div>
        </div>
      `;
    }

    if (quest.until) {
      infoRows += `
        <div class="quest-section">
          <div class="section-label">🔚</div>
          <div class="section-content">${await formatDate(quest.until)}</div>
        </div>
      `;
    }

    // Location if available
    if (quest.where && quest.where.lat) {
      infoRows += `
        <div class="quest-section">
          <div class="section-label">📍</div>
          <div class="section-content">${quest.where.lat}, ${quest.where.lon}</div>
        </div>
      `;
    }

    // Stoppers if quest is stopped
    if (quest.status === "stopped" && quest.stoppers && quest.stoppers.length > 0) {
      const stopperNames = quest.stoppers.map(u => getDisplayName(u)).join(', ');
      infoRows += `
        <div class="quest-section alert">
          <div class="section-label">🛑</div>
          <div class="section-content">${stopperNames}</div>
        </div>
      `;
    }

    // Publication status
    if (quest.published || quest.broadcasted) {
      let pubStatus = [];
      if (quest.published) pubStatus.push(`📢 ${i18next.t('published', { lng: language, defaultValue: 'Published' })}`);
      if (quest.broadcasted) pubStatus.push(`🎭 ${i18next.t('broadcasted', { lng: language, defaultValue: 'Broadcasted' })}`);
      
      infoRows += `
        <div class="quest-section">
          <div class="section-label">📡</div>
          <div class="section-content">${pubStatus.join(', ')}</div>
        </div>
      `;
    }

    // Determine CSS classes based on quest status and participation
    let containerClasses = 'quest-card-container';
    
    // Add status class
    containerClasses += ` ${quest.status}`;
    
    // Add participants class if quest has participants
    if (quest.participants && quest.participants.length > 0) {
      containerClasses += ' has-participants';
    }
    
    // Add hologram class if this is a hologram quest or explicitly marked as hologram
    if (quest.type === 'hologram' || isHologram) {
      containerClasses += ' hologram';
    }

    // Get hologram source name if it's a hologram
    let hologramBadge = '';
    if (isHologram) {
      let hologramSource = '';
      if (quest._meta && quest._meta.origin_chat_name) {
        hologramSource = quest._meta.origin_chat_name;
      } else if (quest.chat && quest.chat.toString() !== chatID.toString()) {
        try {
          const nameFromUtil = await utils.getHolonName(this.db, quest.chat, null);
          hologramSource = nameFromUtil && nameFromUtil.trim() !== '' ? nameFromUtil : `Holon ${quest.chat}`;
        } catch (e) {
          hologramSource = `Holon ${quest.chat}`;
        }
      }
      if (hologramSource) {
        hologramBadge = `<div class="hologram-badge">📡 ${hologramSource}</div>`;
      }
    }

    const element = `
      <div class="${containerClasses}">
        <div class="quest-card">
          ${hologramBadge}
          ${infoRows}
          <div class="quest-footer">
            <div class="quest-id">ID: #${quest.id}</div>
            <div class="quest-date">Created: ${await formatDate(quest.date)}</div>
          </div>
        </div>
      </div>
    `;

    const path = './images/quest' + quest.id + '.png';
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID));
    await this.screenshotHtml(html, path, '.quest-card-container');
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
          allWants.map(want => `<span class="item-text">${want}</span>`).join('<br/>') : 
          '<span class="no-items">-</span>';
        
        // Combine profile offers and quest offers
        const allOffers = [...userData.profileOffers, ...userData.questOffers];
        const offersList = allOffers.length > 0 ? 
          allOffers.map(offer => `<span class="item-text">${offer}</span>`).join('<br/>') : 
          '<span class="no-items">-</span>';

        const row = `<tr class="bulletin-row">
          <td class="name-cell-compact">
            <div class="user-info-compact">
              <div class="user-name-compact">${getDisplayName(userData.user)}</div>
              ${userData.user.username ? `<div class="user-handle-compact">@${userData.user.username}</div>` : ''}
            </div>
          </td>
          <td class="wants-cell-expanded">
            <div class="items-container-expanded">
              ${wantsList}
            </div>
          </td>
          <td class="offers-cell-expanded">
            <div class="items-container-expanded">
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

    const element = `<div class="status-table-container">
      <div class="table-wrapper">
        <table class="status-table bulletin-table">
          <colgroup>
            <col style="width: 15%;">
            <col style="width: 42.5%;">
            <col style="width: 42.5%;">
          </colgroup>
          <thead>
            <tr>
              <th class="name-header-compact">${i18next.t('name', { lng: language })}</th>
              <th class="wants-header-expanded">${i18next.t('Wants', { lng: language })}</th>
              <th class="offers-header-expanded">${i18next.t('Offers', { lng: language })}</th>
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
      const credits = creditMatrix[index].map((credit, creditIndex) => `<td >${credit.toFixed(2)}</td>`).join('');
      const total = creditMatrix[index].reduce((a, b) => a + b, 0).toFixed(2);
      const row = `<tr>
          <td>${user}</td>
          ${credits}
          <td>${total}</td>
        </tr>`;
      rows.push(row);
    });
  
    const headers = userArray.map((user, index) => `<th scope="col" style = "writing-mode: vertical-rl;
    text-orientation: mixed;">${user}</th>`).join('');
    const element = `<table>
    <caption>${i18next.t('Credit Matrix', { lng: language })}</caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('User', { lng: language })}</th>
            ${headers}
            <th scope="col">${i18next.t('Total', { lng: language })}</th>
        </tr>
    </thead>
    <tbody>
        ${rows.join('\n')}
    </tbody>
  </table>`;
  
    const path = './images/creditMatrix' + chatID + '.png';
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID));
    await this.screenshotHtml(html, path, 'table');
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
            <div class="quest-card-item${hologramClass}">
              ${hologramBadge}
              <div class="quest-header-row">
                <div class="quest-status-badge ${quest.status}">${statusIcon}</div>
                <div class="quest-title-main">${quest.title}</div>
                <div class="quest-stats-mini">
                  <span class="stat-item">${participantCount}</span>
                  <span class="stat-item">${appreciationCount}</span>
            </div>
            </div>
              <div class="quest-meta-row">
                <span class="quest-initiator">by ${getDisplayName(quest.initiator)}</span>
                <span class="quest-id-small">#${quest.id}</span>
              </div>
            </div>
          </td>
        </tr>`;
      rows.push(row);
    }

    const element = `<div class="quest-list-container">
      <div class="quest-list-header">
        <div class="header-title">${i18next.t('Quests', { lng: language })}</div>
        <div class="header-stats">👥 ${i18next.t('People', { lng: language })} | 👏 ${i18next.t('Appreciation', { lng: language })}</div>
      </div>
      <div class="quest-list-wrapper">
        <table class="quest-list-table">
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
    const language = await this.settings.getLanguage(chatID)
    const rows = []
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i]
      const row = `<tr>
          <th scope="row">${role.title}</th>
          <th>${role.participants ? role.participants.join(","):''}</th>
        </tr>`
      rows.push(row)
    }

    const element = `<table>
    <caption>${i18next.t('Roles', { lng: language })}</caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('Roles', { lng: language })}</th>
            <th scope="col">${i18next.t('People', { lng: language })}</th>
        </tr>
    </thead>
    <tbody>
        ${rows.join('\n')}
    </tbody>
  </table>`

    const path = './images/roles' + chatID + '.png'
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID))
    await this.screenshotHtml(html, path, 'table')
    return path
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
              <th class="name-header">${i18next.t('Person', { lng: language })}</th>
              <th class="request-header">${i18next.t('Request', { lng: language })}</th>
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
              <th class="name-header">${i18next.t('Person', { lng: language })}</th>
              <th class="offer-header">${i18next.t('Offer', { lng: language })}</th>
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
      // Ensure browser is available
      if (!browser || !browser.connected) {
        console.log('Launching new browser instance...');
        browser = await puppetteer.launch(this.getPuppeteerLaunchOptions());
      }

      page = await browser.newPage();
      
      // Set fast timeouts and viewport
      await page.setDefaultTimeout(8000); // Fast timeout - 8 seconds
      await page.setViewport({ width: 1400, height: 1000 });
      
      // Add emoji font support CSS
      await page.addStyleTag({
        content: `
          @import url('https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap');
          
          * {
            font-family: 'Segoe UI', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Android Emoji', 'EmojiSymbols', sans-serif !important;
          }
          
          /* Ensure emoji are rendered with proper color fonts */
          .emoji, [data-emoji], *:contains('🌟'), *:contains('👍'), *:contains('❤️'), *:contains('💡'), *:contains('🎯'), *:contains('👥'), *:contains('🌐'), *:contains('🔗'), *:contains('📊'), *:contains('🎨'), *:contains('📐'), *:contains('🤝') {
            font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', 'Android Emoji', 'EmojiSymbols' !important;
            font-feature-settings: 'liga' 1, 'kern' 1;
            font-variant-emoji: emoji;
          }
        `
      });
      
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      
      // Simple wait for DOM to be ready
      await page.waitForSelector(onElement, { timeout: 5000 });
      
      // Take screenshot directly without complex element handling
      await page.screenshot({ 
        path: pathToSave, 
        type: 'png',
        clip: await page.evaluate((selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          };
        }, onElement)
      });
      
    } catch (error) {
      console.error('Screenshot error:', error);
      
      // Try to reconnect browser on connection errors
      if (error.message.includes('Protocol error') || error.message.includes('Connection closed')) {
        console.log('Browser connection lost, attempting to restart...');
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
      // Always close the page if it was created
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