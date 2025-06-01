import puppetteer from 'puppeteer';
import i18next from 'i18next';
import * as utils from './utilities.js'
import fs from 'fs';
import { Markup } from 'telegraf'; 
import { getDisplayName } from './utilities.js';


const browser = await puppetteer.launch(
  { 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
)

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

  }

  setExpensesInstance(expensesInstance) {
    this.expensesInstance = expensesInstance;
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
    // Fetches only local quests for now to ensure message_thread_id is present for filtering.
    // Federation logic was removed for simplification during topic filter debugging.
    try {
      const localQuests = await this.db.getAll(chatID + '/quests') || [];
      // console.log(`[UI.js] Fetched ${localQuests.length} local quests directly.`); // Keep log commented unless debugging
      return localQuests;
    } catch (error) {
      console.error('Error getting local quests in getFederatedQuests:', error);
      return []; // Return empty array on error
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
      if (quest._meta && quest._meta.origin_chat_name) {
        provenanceText = quest._meta.origin_chat_name;
      } else if (quest.chat && quest.chat.toString() !== chatID.toString()) {
        try {
          const nameFromUtil = await utils.getHolonName(this.db, quest.chat, ctx);
          if (nameFromUtil && nameFromUtil.trim() !== '') { // Use if non-empty
            provenanceText = nameFromUtil;
          } else { // Fallback if util function gives empty/null/undefined
            provenanceText = `${i18next.t('holon_prefix', {lng: language, defaultValue: 'Holon'})} ${quest.chat}`;
          }
        } catch (e) {
          console.warn(`Could not get holon name for chat ${quest.chat}:`, e);
          provenanceText = `${i18next.t('holon_prefix', {lng: language, defaultValue: 'Holon'})} ${quest.chat}`; // Fallback on error
        }
      } else {
        provenanceText = i18next.t('local_provenance', { lng: language, defaultValue: 'Local' });
      }

      const row = `<tr>
          <th scope="row">${quest.id}</th>
          <th>${quest.title}</th>
          <th>${getDisplayName(quest.initiator)}</th>
          <th>${provenanceText}</th>
          <th>${quest.participants ? quest.participants.length : 0}</th>
          <th>${quest.appreciation.length}</th>
        </tr>`;
      rows.push(row);
    }

    const element = `<table>
    <caption>${i18next.t('Active Quests', { lng: language })}</caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('ID', { lng: language })}</th>
            <th scope="col">${i18next.t('Quest', { lng: language })}</th>
            <th scope="col">${i18next.t('Initiator', { lng: language })}</th>
            <th scope="col">${i18next.t('provenance', { lng: language })}</th>
            <th scope="col">${i18next.t('People', { lng: language })}</th>
            <th scope="col">${i18next.t('Appreciators', { lng: language })}</th>
        </tr>
    </thead>
    <tbody>
        ${rows.join('\n')}
    </tbody>
  </table>`;

    const path = './images/quests' + chatID + '.png';
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID));
    await this.screenshotHtml(html, path, 'table');
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
      const row = `<tr>
          <th>${getDisplayName(request.initiator)}</th>
          <th>${request.title}</th>
        </tr>`

      rows.push(row)
    }

    const element = `<table>
    <caption>${i18next.t('Active Requests', { lng: language })}</caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('Person', { lng: language })}</th>
            <th scope="col">${i18next.t('Request', { lng: language })}</th>
        </tr>
    </thead>
    <tbody>
        ${rows.join('\n')}
    </tbody>
  </table>`

    const path = './images/requests' + chatID + '.png'
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID))
    await this.screenshotHtml(html, path, 'table')
    return path
  }

  async getOffersTable(requests, chatID) {
    const language = await this.settings.getLanguage(chatID)
    const offers = requests.filter(request => request.type == 'offer')

    const rows = []
    for (let i = 0; i < offers.length; i++) {
      const offer = offers[i]
      const row = `<tr>
          <th>${getDisplayName(offer.initiator)}</th>
          <th>${offer.title}</th>
        </tr>`

      rows.push(row)
    }

    const element = `<table>
    <caption>${i18next.t('Active Offers', { lng: language })}</caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('Person', { lng: language })}</th>
            <th scope="col">${i18next.t('Offer', { lng: language })}</th>
        </tr>
    </thead>
    <tbody>
        ${rows.join('\n')}
    </tbody>
  </table>`

    const path = './images/offers' + chatID + '.png'
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID))
    await this.screenshotHtml(html, path, 'table')
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
    const page = await browser.newPage()
    await page.setContent(html)
    const element = await page.$(onElement)
    await element.screenshot({ path: pathToSave })
    page.close()
  }
}

export default UI;