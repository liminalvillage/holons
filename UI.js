import puppetteer from 'puppeteer';
import i18next from 'i18next';
import * as utils from './utilities.js'
import fs from 'fs';
import { Markup } from 'telegraf'; 
import { getDisplayName } from './utilities.js';

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

  async init() {
    // Initialize browser on startup
    try {
      if (!browser || !browser.connected) {
        console.log('Initializing Puppeteer browser...');
        browser = await puppetteer.launch({
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run'
          ]
        });
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
      // Get local quests
      const localQuests = await this.db.getAll(chatID + '/quests') || [];

      // Get federated quests (if available)
      let federatedQuests = [];
      if (this.db.holosphere && typeof this.db.holosphere.getFederated === 'function') {
        federatedQuests = await this.db.holosphere.getFederated(chatID, 'quests', {
          includeFederated: true,
          includeLocal: false
        }) || [];
      }

      // Merge and deduplicate by quest id (if needed)
      const allQuests = [...localQuests, ...federatedQuests];
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
            <span class="user-name">${getDisplayName(user)}</span>
          </div>
        </td>
        <td class="stat-cell">
          <div class="stat-container">
            <span class="stat-number">${user.initiated && user.initiated.length || 0}</span>
            <span class="stat-label">tasks</span>
          </div>
        </td>
        <td class="stat-cell">
          <div class="stat-container">
            <span class="stat-number">${user.completed && user.completed.length || 0}</span>
            <span class="stat-label">done</span>
          </div>
        </td>
        <td class="stat-cell">
          <div class="stat-container">
            <span class="stat-number">${user.sent || 0}</span>
            <span class="stat-label">sent</span>
          </div>
        </td>
        <td class="stat-cell">
          <div class="stat-container">
            <span class="stat-number">${user.received || 0}</span>
            <span class="stat-label">received</span>
          </div>
        </td>
        <td class="score-cell">
          <div class="score-container">
            <span class="score-number">${user.score.toFixed(2)}</span>
            <span class="score-label">pts</span>
          </div>
        </td>
      </tr>`

      rows.push(row)
    }

    const element = `<div class="modern-table-container">
      <div class="table-header">
        <h2 class="table-title">🏆 ${i18next.t('Rank', { lng: language })}</h2>
        <div class="table-subtitle">${sortedUsers.length} ${i18next.t('participants', { lng: language, defaultValue: 'participants' })}</div>
      </div>
      <div class="table-wrapper">
        <table class="modern-table">
          <thead>
            <tr>
              <th class="rank-header">${i18next.t('rank', { lng: language })}</th>
              <th class="name-header">${i18next.t('name', { lng: language })}</th>
              <th class="stat-header">📝 ${i18next.t('tasksinitiated', { lng: language })}</th>
              <th class="stat-header">✅ ${i18next.t('taskscompleted', { lng: language })}</th>
              <th class="stat-header">📤 ${i18next.t('sent', { lng: language })}</th>
              <th class="stat-header">📥 ${i18next.t('received', { lng: language })}</th>
              <th class="score-header">⭐ ${i18next.t('score', { lng: language })}</th>
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
    await this.screenshotHtml(html, path, '.modern-table-container')
    return path
  }
  async bulletinboard(ctx) {
    if (!this.db) return
    let chatID = ctx.message.chat.id
    let language = await this.settings.getLanguage(chatID)
    // loop through the userlist and get the quests
    let users = await this.getFederatedUsers(chatID)
    // Create a table header
    this.getBulletinTable(users, chatID).then((path) => {
      //this.getAppreciationTable(users, chatID).then((path) => {
      //send the image
      ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        Markup.inlineKeyboard([
          Markup.button.url(i18next.t('Open in Holons', { lng: language }), 
            `https://dashboard.holons.io/${chatID}/offers`)
        ])
      )
    });
    return;
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
    // Get a list of incomplete quests
    let chatID = ctx.message.chat.id
    const language = await this.settings.getLanguage(chatID)
    const isTopic = ctx.message.is_topic_message;
    const threadId = isTopic ? ctx.message.message_thread_id : null;

    let quests = await this.getFederatedQuests(chatID)
    // Initial filter for type and status
    quests = quests.filter(quest => quest.type == 'task' && (quest.status === 'ongoing' || quest.status === 'scheduled'))

    // If in a topic, filter further by message_thread_id
    if (isTopic && threadId) {
      quests = quests.filter(quest => quest.message_thread_id === threadId);
    }

    // Create a table header
    this.getQuestsTable(quests, chatID, ctx).then((path) => {
      //send the image
      const inline_keyboard_buttons = quests.map(quest => {
        const title = typeof quest.title === 'string' ? quest.title.substring(0, 50) : 'Untitled Quest';
        // Assuming quest.chat and quest.id are available and correct for the callback
        return [Markup.button.callback(title, 'view_original_quest_' + quest.chat + '_' + quest.id)];
      });

      inline_keyboard_buttons.push([
        Markup.button.url(i18next.t('Open Dashboard', { lng: language }),
          `https://dashboard.holons.io/${chatID}/tasks`)
      ]);

      ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        Markup.inlineKeyboard(inline_keyboard_buttons)
      ).catch(err => console.error('Error sending questboard photo with buttons:', err));
    }).catch(err => {
      console.error('Error in getQuestsTable promise chain for questboard:', err);
      ctx.reply(i18next.t('questboardgenerror', {lng: language}) || 'Could not generate quest board image.');
    });
  }

  async requestsboard(ctx) {
    if (!this.db) return
    // Get a list of incomplete quests
    let chatID = ctx.message.chat.id
    const language = await this.settings.getLanguage(chatID)

    let requests = await this.db.getAll(chatID + '/offers')

    // Create a table header
    this.getRequestsTable(requests, chatID).then((path) => {
      //send the image
      ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        Markup.inlineKeyboard([
          Markup.button.url(i18next.t('Open Dashboard', { lng: language }), 
            `https://dashboard.holons.io/${chatID}/offers`)
        ])
      )
    });
    return;
  }

  async offersboard(ctx) {
    if (!this.db) return
    // Get a list of incomplete quests
    let chatID = ctx.message.chat.id
    const language = await this.settings.getLanguage(chatID)

    let requests = await this.db.getAll(chatID + '/offers')

    // Create a table header
    this.getOffersTable(requests, chatID).then((path) => {
      //send the image
      ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        Markup.inlineKeyboard([
          Markup.button.url(i18next.t('Open Dashboard', { lng: language }), 
            `https://dashboard.holons.io/${chatID}/offers/`)
        ])
      )
    });
    return;

  }

  async getQuestImage(quest, chatID) {
    const language = await this.settings.getLanguage(chatID)
    const element = `
    <table>
      <tr><th>${i18next.t('quest_image_quest_header', { lng: language, defaultValue: 'Quest:' })}:</th><td>${quest.title}</td></tr>
      <tr><th>${i18next.t('quest_image_initiator_header', { lng: language, defaultValue: 'Initiator:' })}:</th><td>${getDisplayName(quest.initiator)}</td></tr>
      <tr><th>${i18next.t('quest_image_joined_by_header', { lng: language, defaultValue: 'Joined by:' })}:</th><td>${[...quest.participants].slice(1).map(u => getDisplayName(u)).join(', ')}</td></tr>
      <tr><th>${i18next.t('quest_image_appreciated_by_header', { lng: language, defaultValue: 'Appreciated by:' })}:</th><td>${[...quest.appreciation].slice(1).map(u => getDisplayName(u)).join(', ')}</td></tr>
    <table>`
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID))
    const path = './images/quest' + quest.id + '.png'
    await this.screenshotHtml(html, path, 'table')
    return path
  }

  async getBulletinTable(users, chatID) {
    const language = await this.settings.getLanguage(chatID)
    let table = `<table><tr>
      <th>${i18next.t('Username', { lng: language })}</th>
      <th>${i18next.t('Wants', { lng: language })}</th>
      <th>${i18next.t('Offers', { lng: language })}</th>
    </tr>`;

    for (let user of users) {
      table += '<tr><td>' + getDisplayName(user) + '</td>';

      table += '<td><ul>';
      for (let want of user.wants) {
        table += '<li>' + want + '</li>';
      }
      table += '</ul></td>';

      table += '<td><ul>';
      for (let offer of user.offers) {
        table += '<li>' + offer + '</li>';
      }
      table += '</ul></td></tr>';
    }

    table += '</table>';
    const path = './images/offersneeds' + chatID + '.png'
    const html = await this.generateHtml(table, await this.settings.getTheme(chatID))
    await this.screenshotHtml(html, path, 'table')
    return path
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
      
      if (quest._meta && quest._meta.origin_chat_name) {
        provenanceText = quest._meta.origin_chat_name;
        provenanceIcon = '🌐';
      } else if (quest.chat && quest.chat.toString() !== chatID.toString()) {
        try {
          const nameFromUtil = await utils.getHolonName(this.db, quest.chat, ctx);
          if (nameFromUtil && nameFromUtil.trim() !== '') { // Use if non-empty
            provenanceText = nameFromUtil;
            provenanceIcon = '🔗';
          } else { // Fallback if util function gives empty/null/undefined
            provenanceText = `${i18next.t('holon_prefix', {lng: language, defaultValue: 'Holon'})} ${quest.chat}`;
            provenanceIcon = '🔗';
          }
        } catch (e) {
          console.warn(`Could not get holon name for chat ${quest.chat}:`, e);
          provenanceText = `${i18next.t('holon_prefix', {lng: language, defaultValue: 'Holon'})} ${quest.chat}`; // Fallback on error
          provenanceIcon = '🔗';
        }
      } else {
        provenanceText = i18next.t('local_provenance', { lng: language, defaultValue: 'Local' });
        provenanceIcon = '🏠';
      }

      const statusIcon = quest.status === 'completed' ? '✅' : quest.status === 'ongoing' ? '🔄' : '📅';
      const participantCount = quest.participants ? quest.participants.length : 0;
      const appreciationCount = quest.appreciation ? quest.appreciation.length : 0;

      const row = `<tr class="quest-row">
          <td class="quest-id-cell">
            <div class="quest-id-container">
              <span class="status-icon">${statusIcon}</span>
              <span class="quest-id">#${quest.id}</span>
            </div>
          </td>
          <td class="quest-title-cell">
            <div class="quest-title-container">
              <span class="quest-title">${quest.title}</span>
            </div>
          </td>
          <td class="initiator-cell">
            <div class="initiator-info">
              <span class="initiator-name">${getDisplayName(quest.initiator)}</span>
            </div>
          </td>
          <td class="provenance-cell">
            <div class="provenance-info">
              <span class="provenance-icon">${provenanceIcon}</span>
              <span class="provenance-text">${provenanceText}</span>
            </div>
          </td>
          <td class="stat-cell">
            <div class="participant-info">
              <span class="participant-icon">👥</span>
              <span class="participant-count">${participantCount}</span>
            </div>
          </td>
          <td class="stat-cell">
            <div class="appreciation-info">
              <span class="appreciation-icon">👏</span>
              <span class="appreciation-count">${appreciationCount}</span>
            </div>
          </td>
        </tr>`;
      rows.push(row);
    }

    const element = `<div class="modern-table-container">
      <div class="table-header">
        <h2 class="table-title">🎯 ${i18next.t('Active Quests', { lng: language })}</h2>
        <div class="table-subtitle">${quests.length} ${i18next.t('active_quests', { lng: language, defaultValue: 'active quests' })}</div>
      </div>
      <div class="table-wrapper">
        <table class="modern-table quests-table">
          <thead>
            <tr>
              <th class="id-header">${i18next.t('ID', { lng: language })}</th>
              <th class="quest-header">${i18next.t('Quest', { lng: language })}</th>
              <th class="initiator-header">👤 ${i18next.t('Initiator', { lng: language })}</th>
              <th class="provenance-header">🌍 ${i18next.t('provenance', { lng: language })}</th>
              <th class="people-header">👥 ${i18next.t('People', { lng: language })}</th>
              <th class="appreciation-header">👏 ${i18next.t('Appreciators', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/quests' + chatID + '.png';
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID));
    await this.screenshotHtml(html, path, '.modern-table-container');
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
    const language = await this.settings.getLanguage(chatID)
    const needs = requests.filter(request => request.type == 'request')

    const rows = []
    for (let i = 0; i < needs.length; i++) {
      const request = needs[i]
      const row = `<tr class="request-row">
          <td class="person-cell">
            <div class="person-info">
              <span class="person-icon">🙋‍♂️</span>
              <span class="person-name">${getDisplayName(request.initiator)}</span>
            </div>
          </td>
          <td class="request-cell">
            <div class="request-info">
              <span class="request-title">${request.title}</span>
            </div>
          </td>
        </tr>`

      rows.push(row)
    }

    const element = `<div class="modern-table-container">
      <div class="table-header">
        <h2 class="table-title">🙏 ${i18next.t('Active Requests', { lng: language })}</h2>
        <div class="table-subtitle">${needs.length} ${i18next.t('open_requests', { lng: language, defaultValue: 'open requests' })}</div>
      </div>
      <div class="table-wrapper">
        <table class="modern-table requests-table">
          <thead>
            <tr>
              <th class="person-header">👤 ${i18next.t('Person', { lng: language })}</th>
              <th class="request-header">📝 ${i18next.t('Request', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`

    const path = './images/requests' + chatID + '.png'
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID))
    await this.screenshotHtml(html, path, '.modern-table-container')
    return path
  }

  async getOffersTable(requests, chatID) {
    const language = await this.settings.getLanguage(chatID)
    const offers = requests.filter(request => request.type == 'offer')

    const rows = []
    for (let i = 0; i < offers.length; i++) {
      const offer = offers[i]
      const row = `<tr class="offer-row">
          <td class="person-cell">
            <div class="person-info">
              <span class="person-icon">🤝</span>
              <span class="person-name">${getDisplayName(offer.initiator)}</span>
            </div>
          </td>
          <td class="offer-cell">
            <div class="offer-info">
              <span class="offer-title">${offer.title}</span>
            </div>
          </td>
        </tr>`

      rows.push(row)
    }

    const element = `<div class="modern-table-container">
      <div class="table-header">
        <h2 class="table-title">🎁 ${i18next.t('Active Offers', { lng: language })}</h2>
        <div class="table-subtitle">${offers.length} ${i18next.t('available_offers', { lng: language, defaultValue: 'available offers' })}</div>
      </div>
      <div class="table-wrapper">
        <table class="modern-table offers-table">
          <thead>
            <tr>
              <th class="person-header">👤 ${i18next.t('Person', { lng: language })}</th>
              <th class="offer-header">🎁 ${i18next.t('Offer', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`

    const path = './images/offers' + chatID + '.png'
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID))
    await this.screenshotHtml(html, path, '.modern-table-container')
    return path
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
        browser = await puppetteer.launch({
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run'
          ]
        });
      }

      page = await browser.newPage();
      
      // Set reasonable timeouts and viewport
      await page.setDefaultTimeout(30000);
      await page.setViewport({ width: 1400, height: 1000 });
      
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const element = await page.$(onElement);
      if (!element) {
        throw new Error(`Element "${onElement}" not found in HTML`);
      }
      
      await element.screenshot({ 
        path: pathToSave, 
        type: 'png'
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