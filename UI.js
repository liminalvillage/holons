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
    //=========== UI COMMANDS ===============

    //Set up a command to display the appreciation score for each user
    this.bot.command(['leaderboard', 'appreciation', 'credits', 'scores', 'score', 'points', 'rank', 'status'], async (ctx) => this.leaderboard(ctx))
    this.bot.command(['fiorini','apprezzamento', 'crediti', 'punti', 'punteggio', 'punteggi', 'classifica', 'stato'], async (ctx) => this.leaderboard(ctx))

    // Set up a command to display the quests
    this.bot.command(['tasks', 'quests', 'todos', 'proposals'],  (ctx) =>  this.questboard(ctx))
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
  }

  async init() {

  }

  async getFederatedUsers(chatID) {
    // get all users from the chat
    let users = await this.db.getAll(chatID + '/users')

    // get all users from the federation
    let federation = await this.settings.getFederation(chatID)
    if (federation)
    for (let i = 0; i < federation.length; i++) {

      let federatedusers = await this.db.getAll(federation[i] + '/users')
      //check if the user is already in the list
      for (let j = 0; j < federatedusers.length; j++) {
        let user = federatedusers[j]
        let found = false
        for (let k = 0; k < users.length; k++) {
          if (users[k].username === user.username) {
            found = true
            users[k].received += user.received
            users[k].sent += user.sent
            users[k].hours += user.hours
            users[k].money += user.money
            users[k].voice += user.voice
            users[k].initiated = users[k].initiated.concat(user.initiated);
            users[k].wants = users[k].wants.concat(user.wants);
            users[k].offers = users[k].offers.concat(user.offers);
            users[k].values = users[k].values.concat(user.values);
            users[k].appreciated = users[k].appreciated.concat(user.appreciated);
            users[k].completed = users[k].completed.concat(user.completed);
            users[k].collaboration = users[k].collaboration.concat(user.collaboration);
          }
        }
        if (!found) {
          users.push(user)
        }
      }
    }
    return users
  }

  async getFederatedQuests(chatID) {
    let federation = await this.settings.getFederation(chatID)
    let quests = await this.db.holosphere.getAll(chatID, 'quests')//.filter(quest => quest.status === 'ongoing')
    for (let i = 0; i < federation.length; i++) {
      let federatedquests = await this.db.getAll(federation[i] + '/quests')
      quests = quests.concat(federatedquests)
    }
    return quests
  }

  async getFederatedValues(chatID) {
    let users = await this.getFederatedUsers(chatID)
    let values
    for (let i = 0; i < users.length; i++) {
      values = values.concat(users.values)
    }
    return values
  }


  async leaderboard(ctx) {
    let chatID = ctx.message.chat.id
    const federation = await this.settings.getFederation(chatID)
    const valueEquation = await this.settings.getValueEquation(chatID)
    let users = await this.getFederatedUsers(chatID)
    const language = await this.settings.getLanguage(chatID)

    // Create a table header
    this.getRankTable(users, valueEquation, chatID).then((path) => {
      ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        Markup.inlineKeyboard([
          Markup.button.url(i18next.t('Open Dashboard', { lng: language }), 
            `https://dashboard.holons.io/${chatID}/status`)
        ])
      )
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

    let quests = await this.getFederatedQuests(chatID)
     quests = quests.filter(quest => quest.type == 'task' && (quest.status === 'ongoing' || quest.status === 'scheduled')) //TODO:Reenable this filter
    // Create a table header
    this.getQuestsTable(quests, chatID).then((path) => {
      //send the image
      ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        Markup.inlineKeyboard([
          Markup.button.url(i18next.t('Open Dashboard', { lng: language }), 
            `https://dashboard.holons.io/${chatID}/tasks`)
        ])
      )
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
      <tr><th>${i18next.t('Quest', { lng: language })}:</th><td>${quest.title}</td></tr>
      <tr><th>${i18next.t('Initiator', { lng: language })}:</th><td>${getDisplayName(quest.initiator)}</td></tr>
      <tr><th>${i18next.t('Joined by', { lng: language })}:</th><td>${[...quest.participants].slice(1).map(u => getDisplayName(u)).join(', ')}</td></tr>
      <tr><th>${i18next.t('Appreciated by', { lng: language })}:</th><td>${[...quest.appreciation].slice(1).map(u => getDisplayName(u)).join(', ')}</td></tr>
    <table>`
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID))
    const path = './images/quest' + quest.id + '.png'
    await screenshotHtml(html, path, 'table')
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

  async getQuestsTable(quests, chatID) {
    const language = await this.settings.getLanguage(chatID)
    const rows = []
    for (let i = 0; i < quests.length; i++) {
      const quest = quests[i]
      const row = `<tr>
          <th scope="row">${quest.id}</th>
          <th>${quest.title}</th>
          <th>${getDisplayName(quest.initiator)}</th>
          <th>${quest.participants ? quest.participants.length : quest.users.length}</th>
          <th>${quest.appreciation.length}</th>
        </tr>`
      rows.push(row)
    }

    const element = `<table>
    <caption>${i18next.t('Active Quests', { lng: language })}</caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('ID', { lng: language })}</th>
            <th scope="col">${i18next.t('Quest', { lng: language })}</th>
            <th scope="col">${i18next.t('Initiator', { lng: language })}</th>
            <th scope="col">${i18next.t('People', { lng: language })}</th>
            <th scope="col">${i18next.t('Appreciators', { lng: language })}</th>
        </tr>
    </thead>
    <tbody>
        ${rows.join('\n')}
    </tbody>
  </table>`

    const path = './images/quests' + chatID + '.png'
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID))
    await this.screenshotHtml(html, path, 'table')
    return path
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


  async getRankTable(users, equation, chatID) {
    const language = await this.settings.getLanguage(chatID)
    const rows = []
    const sortedUsers = Object.keys(users).sort((a, b) => {
      return (users[b].initiated.length * equation.initiated + users[b].completed.length * equation.completed + 
        users[b].sent * equation.sent + users[b].received * equation.received + users[b].hours * equation.hours + 
        users[b].collaboration * equation.collaboration + users[b].wants.length * equation.wants + 
        users[b].offers.length * equation.offers ) -
        (users[a].initiated.length * equation.initiated + users[a].completed.length * equation.completed + 
        users[a].sent * equation.sent + users[a].received * equation.received + users[a].hours * equation.hours + 
        users[a].collaboration * equation.collaboration + users[a].wants.length * equation.wants + 
        users[a].offers.length * equation.offers )
    });

    for (let i = 0; i < sortedUsers.length; i++) {
      const user = users[sortedUsers[i]]
      const score = user.initiated.length * equation.initiated +
        user.completed.length * equation.completed +
        user.sent * equation.sent +
        user.received * equation.received +
        user.hours * equation.hours +
        user.collaboration * equation.collaboration +
        user.wants.length * equation.wants +
        user.offers.length * equation.offers
      const row = `<tr>
        <th scope="row">${i + 1}</th>
        <th>${getDisplayName(user)}</th>
        <th>${user.initiated.length}</th>
        <th>${user.completed.length}</th>
        <th>${user.sent}</th>
        <th>${user.received}</th>
        <th>${score}</th>
      </tr>`

      rows.push(row)
    }

    const element = `<table>
    <caption>${i18next.t('Rank', { lng: language })}</caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('rank', { lng: language })}</th>
            <th scope="col">${i18next.t('name', { lng: language })}</th>
            <th scope="col">${i18next.t('tasksinitiated', { lng: language })}</th>
            <th scope="col">${i18next.t('taskscompleted', { lng: language })}</th>
            <th scope="col">${i18next.t('sent', { lng: language })}</th>
            <th scope="col">${i18next.t('received', { lng: language })}</th>
            <th scope="col">${i18next.t('score', { lng: language })}</th>
        </tr>
    </thead>
    <tbody>
        ${rows.join('\n')}
    </tbody>
  </table>`

    const path = './images/rank' + chatID + '.png'
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID))
    await this.screenshotHtml(html, path, 'table')
    return path
  }



  async getAppreciationTable(appreciation, chatID) {
    
    const rows = []
    const sortedUsers = Object.keys(appreciation).sort((a, b) => {
      return appreciation[b].received - appreciation[b].sent - (appreciation[a].received - appreciation[a].sent);
      return
    });

    for (let i = 0; i < sortedUsers.length; i++) {
      const score = appreciation[sortedUsers[i]]
      const row = `<tr>
        <th scope="row">${i + 1}</th>
        <th>${getDisplayName(score)}</th>
        <th>${score.sent}</th>
        <th>${score.received}</th>
      </tr>`

      rows.push(row)
    }
    let language = await this.settings.getLanguage(chatID);
    let element = `<table>
    <caption> ${i18next.t('Appreciation', { lng: language })} </caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('rank', { lng: language })}</th>
            <th scope="col">${i18next.t('name', { lng: language })}</th>
            <th scope="col">${i18next.t('sent', { lng: language })}</th>
            <th scope="col">${i18next.t('received', { lng: language })}</th>
        </tr>
    </thead>
    <tbody>
        ${rows.join('\n')}
    </tbody>
  </table>`

    const path = './images/appreciation' + chatID + '.png'
    const theme = await this.settings.getTheme(chatID)
    const html = await this.generateHtml(element, theme)
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