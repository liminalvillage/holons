import puppetteer from 'puppeteer-core';
import { executablePath } from 'puppeteer';
import i18next from 'i18next';
import * as utils from './utilities.js'
import fs from 'fs';


const browser = await puppetteer.launch({
  args: ['--no-sandbox',],
  ignoreHTTPSErrors: true,
  headless: "new",
  executablePath: executablePath(),
});

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
    this.bot.command(['tasks', 'quests', 'todos', 'proposals'], (ctx) => this.questboard(ctx))
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
    let quests = await this.db.getAll(chatID + '/quests')//.filter(quest => quest.status === 'ongoing')
    console.log("All Quests:", quests)
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

    // Create a table header
    this.getRankTable(users, valueEquation, chatID).then((path) => {
      //this.getAppreciationTable(users, chatID).then((path) => {
      //send the image
      ctx.replyWithPhoto({ source: fs.createReadStream(path) })
    });
    return;
  }

  async bulletinboard(ctx) {
    if (!this.db) return
    let chatID = ctx.message.chat.id
    // loop through the userlist and get the quests
    let users = await this.getFederatedUsers(chatID)
    // Create a table header
    this.getBulletinTable(users, chatID).then((path) => {
      //this.getAppreciationTable(users, chatID).then((path) => {
      //send the image
      ctx.replyWithPhoto({ source: fs.createReadStream(path) })
    });
    return;
  }

  async valuescloud(ctx) {
    let values = [] // = this.getFederatedValues(chatID)
    const chatID = ctx.message.chat.id;
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
    await ctx.replyWithPhoto({ source: fs.createReadStream(path) })
  }
  async needscloud(ctx) {
    let needs = [] // = this.getFederatedValues(chatID)
    const chatID = ctx.message.chat.id;
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
    await ctx.replyWithPhoto({ source: fs.createReadStream(path) })
  }


  // Set up a command to display the quests
  async questboard(ctx) {
    if (!this.db) return
    // Get a list of incomplete quests
    let chatID = ctx.message.chat.id

    let quests = await this.getFederatedQuests(chatID)
     quests = quests.filter(quest => quest.type == 'task' && (quest.status === 'ongoing' || quest.status === 'scheduled')) //TODO:Reenable this filter
    // Create a table header
    this.getQuestsTable(quests, chatID).then((path) => {
      //send the image
      ctx.replyWithPhoto({ source: fs.createReadStream(path) });
      // ctx.replyWithPhoto({ source: fs.createReadStream(path) }, Markup.inlineKeyboard([
      //   //  Markup.button.url('Go to message '+ chatID, 'https://t.me/'+chatID + '/'+quests[0].id.toString()),
      // ])).then((ctx) => { this.bot.telegram.pinChatMessage(chatID, ctx.message_id) });
    });
    return;
  }

  async requestsboard(ctx) {
    if (!this.db) return
    // Get a list of incomplete quests
    let chatID = ctx.message.chat.id

    let requests = await this.db.getAll(chatID + '/offers')

    // Create a table header
    this.getRequestsTable(requests, chatID).then((path) => {
      //send the image
      ctx.replyWithPhoto({ source: fs.createReadStream(path) });
    });
    return;
  }

  async offersboard(ctx) {
    if (!this.db) return
    // Get a list of incomplete quests
    let chatID = ctx.message.chat.id

    let requests = await this.db.getAll(chatID + '/offers')

    // Create a table header
    this.getOffersTable(requests, chatID).then((path) => {
      //send the image
      ctx.replyWithPhoto({ source: fs.createReadStream(path) });
    });
    return;

  }

  async getQuestImage(quest, chatID) {
    const lang = await this.settings.getLanguage(chatID)
    const element = `
    <table>
      <tr><th>${i18next.t('Quest')}:</th><td>${quest.title}</td></tr>
      <tr><th>${i18next.t('Initiator')}:</th><td>${quest.initiator.first_name}</td></tr>
      <tr><th>${i18next.t('Joined by')}:</th><td>${[...quest.participants].slice(1).map(u => u.username).join(', ')}</td></tr>
      <tr><th>${i18next.t('Appreciated by')}:</th><td>${[...quest.appreciation].slice(1).map(u => u.username).join(', ')}</td></tr>
    <table>`
    const html = await this.generateHtml(element, await this.settings.getTheme(chatID))
    const path = './images/quest' + quest.id + '.png'
    await screenshotHtml(html, path, 'table')
    return path
  }

  async getBulletinTable(users, chatID) {
    const lang = await this.settings.getLanguage(chatID)
    let table = `<table><tr><th>${i18next.t('Username',{ lng: lang })}</th><th>${i18next.t('Wants',{ lng: lang })}</th><th>${i18next.t('Offers',{ lng: lang })}</th></tr>`;

    for (let user of users) {
      table += '<tr><td>' + user.username + '</td>';

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
    const lang = await this.settings.getLanguage(chatID);
    const rows = [];
    userArray.forEach((user, index) => {
      const credits = creditMatrix[index].map((credit, creditIndex) => `<td >${credit}</td>`).join('');
      const row = `<tr>
          <td>${user}</td>
          ${credits}
        </tr>`;
      rows.push(row);
    });
  
    const headers = userArray.map((user, index) => `<th scope="col" style = "writing-mode: vertical-rl;
    text-orientation: mixed;">${user}</th>`).join('');
    const element = `<table>
    <caption>${i18next.t('Credit Matrix', { lng: lang })}</caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('User', { lng: lang })}</th>
            ${headers}
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

    const lang = await this.settings.getLanguage(chatID)
    const rows = []
    for (let i = 0; i < quests.length; i++) {
      const quest = quests[i]
      const row = `<tr>
          <th scope="row">${quest.id}</th>
          <th>${quest.title}</th>
          <th>${quest.initiator.first_name}</th>
          <th>${quest.participants ? quest.participants.length : quest.users.length}</th>
          <th>${quest.appreciation.length}</th>
        </tr>`
      rows.push(row)
    }

    const element = `<table>
    <caption>${i18next.t('Active Quests', { lng: lang })}</caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('ID', { lng: lang })}</th>
            <th scope="col">${i18next.t('Quest', { lng: lang })}</th>
            <th scope="col">${i18next.t('Initiator', { lng: lang })}</th>
            <th scope="col">${i18next.t('People', { lng: lang })}</th>
            <th scope="col">${i18next.t('Appreciators', { lng: lang })}</th>
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

  async getRequestsTable(requests, chatID) {

    const lang = await this.settings.getLanguage(chatID)
    const needs = requests.filter(request => request.type == 'request')
    const offers = requests.filter(request => request.type == 'offer')

    const rows = []
    for (let i = 0; i < needs.length; i++) {
      const request = needs[i]
      const row = `<tr>
          <th>${request.initiator.first_name}</th>
          <th>${request.title}</th>
        </tr>`

      rows.push(row)
    }

    const element = `<table>
    <caption>${i18next.t('Active Requests', { lng: lang })}</caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('Person', { lng: lang })}</th>
            <th scope="col">${i18next.t('Request', { lng: lang })}</th>
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

    const lang = await this.settings.getLanguage(chatID)
    const offers = requests.filter(request => request.type == 'offer')

    const rows = []
    for (let i = 0; i < offers.length; i++) {
      const offer = offers[i]
      const row = `<tr>
          <th>${offer.initiator.first_name}</th>
          <th>${offer.title}</th>
        </tr>`

      rows.push(row)
    }

    const element = `<table>
    <caption>${i18next.t('Active Offers', { lng: lang })}</caption>
    <thead>
        <tr>
            <th scope="col">${i18next.t('Person')}</th>
            <th scope="col">${i18next.t('Offer')}</th>
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
    // initiated, completed, ccredits sent, credits received, hours, groupsize?, requested, offered, money
    const rows = []
    const sortedUsers = Object.keys(users).sort((a, b) => {
      return (users[b].initiated.length * equation.initiated + users[b].completed.length * equation.completed + users[b].sent * equation.sent + users[b].received * equation.received + users[b].hours * equation.hours + users[b].collaboration * equation.collaboration + users[b].wants.length * equation.wants + users[b].offers.length * equation.offers ) -
        (users[a].initiated.length * equation.initiated + users[a].completed.length * equation.completed + users[a].sent * equation.sent + users[a].received * equation.received + users[a].hours * equation.hours + users[a].collaboration * equation.collaboration + users[a].wants.length * equation.wants + users[a].offers.length * equation.offers )
      //return users[b].score - users[a].score
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
        user.offers.length * equation.offers// +
        //user.money * equation.money
      const row = `<tr>
        <th scope="row">${i + 1}</th>
        <th>${user.username}</th>
        <th>${user.initiated.length}</th>
        <th>${user.completed.length}</th>
        <th>${user.sent}</th>
        <th>${user.received}</th>
        <th>${score}</th>
      </tr>`

      rows.push(row)
    }
    let language = await this.settings.getLanguage(chatID);
    let element = `<table>
    <caption> ${i18next.t('Rank', { lng: language })} </caption>
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
    const theme = await this.settings.getTheme(chatID)
    const html = await this.generateHtml(element, theme)
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
        <th>${score.username}</th>
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
    const page = await browser.newPage();
    await page.setContent(html)
    const element = await page.$(onElement)
    await element.screenshot({ path: pathToSave })
    await page.close()
  }

}

export default UI;



function drawMaslow(layer) {
  const svg = `
  <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
   width="1270.000000pt" height="1044.000000pt" viewBox="0 0 1270.000000 1044.000000"
   preserveAspectRatio="xMidYMid meet">
  <g transform="translate(0.000000,1044.000000) scale(0.100000,-0.100000)"
  fill="#000000" >
  <path id="element1" fill="#DDDDDD" d="M6408 4578 c17 -19 195 -322 310 -528 14 -25 45 -78 69 -118 24 -41 43
  -75 43 -77 0 -2 21 -39 46 -82 26 -43 90 -152 142 -243 52 -91 110 -190 127
  -220 18 -30 69 -120 115 -198 97 -169 109 -215 65 -250 l-28 -22 -934 0 c-929
  0 -935 0 -964 21 -21 15 -29 29 -29 50 0 40 7 54 227 432 18 31 48 83 66 115
  86 146 188 324 205 354 11 18 63 110 117 203 54 94 109 190 123 215 14 25 45
  78 69 118 24 41 43 76 43 79 0 10 94 149 109 160 25 19 55 15 79 -9z"/>
  <path id="element2" fill="#FFFFFF" d="M278
  -1928 l801 0 33 -22 c22 -15 58 -67 108 -153 100 -173 258 -449 289 -504 14
  -24 61 -104 104 -178 43 -75 79 -136 79 -138 0 -1 52 -91 115 -199 63 -108
  126 -218 141 -244 14 -26 53 -92 85 -148 32 -55 59 -104 59 -107 0 -4 -957 -7
  -2126 -7 l-2126 0 6 28 c12 49 101 224 193 377 49 83 121 204 158 270 37 66
  76 134 85 150 28 50 127 221 220 380 48 83 116 202 151 265 92 166 136 209
  232 230 23 5 166 7 317 5 151 -3 635 -5 1076 -5z"/>

  <path id="element3" d="m1913 -1912 c44 -23 68 -58
  205 -301 13 -23 57 -101 99 -174 42 -72 85 -147 96 -165 10 -18 34 -60 53 -93
  19 -33 78 -134 130 -225 52 -91 120 -208 150 -260 158 -273 213 -369 235 -405
  12 -22 23 -43 23 -47 0 -5 -1453 -8 -3230 -8 -1776 0 -3230 2 -3230 5 0 4 66
  120 165 290 29 50 62 106 73 125 10 19 52 91 92 160 40 69 133 231 208 360 74
  129 160 278 190 330 30 52 64 111 74 130 62 109 133 227 147 244 9 10 34 27
  56 37 38 18 126 19 2230 19 l2191 0 43 -22z"/>

  <path id="element4" d="m1016 -1882 c119 -31 139 -54 302
  -346 66 -118 129 -231 140 -250 11 -19 47 -82 80 -140 118 -207 256 -446 280
  -483 13 -21 32 -53 42 -70 10 -18 50 -85 90 -149 83 -137 103 -194 78 -231 -9
  -13 -30 -27 -48 -31 -56 -11 -8420 -7 -8461 4 -70 20 -63 45 69 275 42 71 115
  198 163 280 351 607 386 669 495 864 113 203 155 246 265 277 69 19 6434 19
  6505 0z"/>

  <path id="element5" d="m1173 -1909 c19 -10 49 -43 69 -75 143 -232 326 -551 386 -672 39 -80
  129 -237 200 -349 71 -112 152 -251 179 -310 28 -58 76 -139 107 -180 48 -63
  56 -80 56 -117 0 -30 -6 -50 -20 -64 l-21 -20 -5194 2 c-2857 1 -5281 3 -5386
  3 -174 0 -194 2 -213 19 -29 26 -26 56 10 105 16 23 38 57 48 74 10 18 69 122
  131 232 62 110 121 214 130 230 79 140 196 346 210 370 23 41 53 94 155 275
  48 85 99 175 113 200 14 25 36 63 49 85 12 22 37 66 55 99 34 61 82 101 134
  109 16 2 1996 4 4399 3 4200 -1 4371 -2 4403 -19z"/>
  </g>
  </svg>
  `

  return svg
}