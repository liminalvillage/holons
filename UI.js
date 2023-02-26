import puppetteer  from 'puppeteer-core';
import { executablePath } from 'puppeteer';
import i18next from 'i18next';
import { getLanguage, getTheme } from './settings.js';




const browser  = await puppetteer.launch({
  args: ['--no-sandbox',],
  ignoreHTTPSErrors: true,
  executablePath: executablePath(),
});


export async function getQuestImage(quest) {
  const element = `
  <table>
    <tr><th>${i18next.t('Quest')}:</th><td>${quest.title}</td></tr>
    <tr><th>${i18next.t('Initiator')}:</th><td>${quest.initiator.first_name}</td></tr>
    <tr><th>${i18next.t('Joined by')}:</th><td>${[...quest.users].slice(1).map(u => u.username).join(', ')}</td></tr>
    <tr><th>${i18next.t('Appreciated by')}:</th><td>${[...quest.appreciation].slice(1).map(u => u.username).join(', ')}</td></tr>
  <table>`
  const html = await generateHtml(element, await getTheme(chatID))
  const path = './images/quest' + quest._id + '.png'
  await screenshotHtml(html, path, 'table')
  return path
}


export async function getQuestsTable(quests, chatID) {

  const lang = await getLanguage(chatID)
  const rows = []
  for (let i = 0; i < quests.length; i++) {
    const quest = quests[i]
    const row = `<tr>
        <th scope="row">${i + 1}</th>
        <th>${quest.title}</th>
        <th>${quest.initiator.first_name}</th>
        <th>${quest.users.length}</th>
        <th>${quest.appreciation.length}</th>
      </tr>`
    rows.push(row)
  }

  const element = `<table>
  <caption>${i18next.t('Active Quests',{lng:lang})}</caption>
  <thead>
      <tr>
          <th scope="col">${i18next.t('ID',{lng:lang})}</th>
          <th scope="col">${i18next.t('Quest',{lng:lang})}</th>
          <th scope="col">${i18next.t('Initiator',{lng:lang})}</th>
          <th scope="col">${i18next.t('People',{lng:lang})}</th>
          <th scope="col">${i18next.t('Appreciators',{lng:lang})}</th>
      </tr>
  </thead>
  <tbody>
      ${rows.join('\n')}
  </tbody>
</table>`

  const path = './images/quests' + chatID + '.png'
  const html = await generateHtml(element, await getTheme(chatID))
  await screenshotHtml(html, path, 'table')
  return path
}

export async function getRequestsTable(requests, chatID) {
  
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
  <caption>${i18next.t('Active Requests',{lng:lang})}</caption>
  <thead>
      <tr>
          <th scope="col">${i18next.t('Person',{lng:lang})}</th>
          <th scope="col">${i18next.t('Request',{lng:lang})}</th>
      </tr>
  </thead>
  <tbody>
      ${rows.join('\n')}
  </tbody>
</table>`

  const path = './images/requests' + chatID + '.png'
  const html = await generateHtml(element, await getTheme(chatID))
  await screenshotHtml(html, path, 'table')
  return path
}

export async function getOffersTable(requests, chatID) {
  

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
  <caption>${i18next.t('Active Offers',{lng:lang})}</caption>
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
  const html = await generateHtml(element, await getTheme(chatID))
  await screenshotHtml(html, path, 'table')
  return path
}


export async function getAppreciationTable(appreciation, chatID) {
  const rows = []
  const sortedUsers = Object.keys(appreciation).sort((a, b) => {
    return appreciation[b].received - appreciation[b].sent - (appreciation[a].received - appreciation[a].sent);
  });

  for (let i = 0; i < sortedUsers.length; i++) {
    const score = appreciation[sortedUsers[i]]
    const row = `<tr>
      <th scope="row">${i + 1}</th>
      <th>${score.username}</th>
      <th>${score.sent}</th>
      <th>${score.received}</th>
      <th>${score.received - score.sent}</th>
    </tr>`

    rows.push(row)
  }
  let language = await getLanguage(chatID);
  console.log( language)
  let element  = `<table>
  <caption> ${i18next.t('Appreciation', {lng:language})} </caption>
  <thead>
      <tr>
          <th scope="col">${i18next.t('rank', {lng:language} )}</th>
          <th scope="col">${i18next.t('name', {lng:language} )}</th>
          <th scope="col">${i18next.t('sent', {lng:language} )}</th>
          <th scope="col">${i18next.t('received', {lng:language} )}</th>
          <th scope="col">${i18next.t('balance', {lng:language} )}</th>
      </tr>
  </thead>
  <tbody>
      ${rows.join('\n')}
  </tbody>
</table>`

  const path = './images/appreciation' + chatID + '.png'
  const theme =  await getTheme(chatID)
  console.log(theme)
  const html = await generateHtml(element, theme)
  
  await screenshotHtml(html, path, 'table')
  return path
}

async function generateHtml(element, theme) {
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

async function screenshotHtml(html, pathToSave, onElement) {
  const page = await browser.newPage();
  await page.setContent(html)
  const element = await page.$(onElement)
  await element.screenshot({ path: pathToSave })
  await page.close()
}



export async function showMaslow(layer, chatID){
const path = './images/maslow.png'
const element = drawMaslow(layer)
const html = await generateHtml(element, await getTheme(chatID))
await screenshotHtml(html, path, 'svg')
return path
}

function drawMaslow(layer) {
  const svg  = `
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