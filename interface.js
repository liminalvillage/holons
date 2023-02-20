import puppetteer  from 'puppeteer-core';
import { executablePath } from 'puppeteer';
import fs from 'fs';
import JSDOM  from 'jsdom';


let theme

fs.readFile('theme.css', 'utf8', (err, data) => {theme = data});

const browser  = await puppetteer.launch({
  args: ['--no-sandbox',],
  ignoreHTTPSErrors: true,
  executablePath: executablePath(),
});


export async function getQuestImage(quest) {
  const element = `
  <table>
    <tr><th>Quest:</th><td>${quest.title}</td></tr>
    <tr><th>Initiator:</th><td>${quest.initiator.first_name}</td></tr>
    <tr><th>Joined by:</th><td>${[...quest.users].slice(1).map(u => u.username).join(', ')}</td></tr>
    <tr><th>Appreciated by:</th><td>${[...quest.appreciation].slice(1).map(u => u.username).join(', ')}</td></tr>
  <table>`
  const html = await generateHtml(element)
  const path = './images/quest' + quest._id + '.png'
  await screenshotHtml(html, path, 'table')
  return path
}


export async function getQuestsTable(quests, chatID) {

  
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
  <caption>Active Quests</caption>
  <thead>
      <tr>
          <th scope="col">ID</th>
          <th scope="col">Quest</th>
          <th scope="col">Initiator</th>
          <th scope="col">People</th>
          <th scope="col">Appreciators</th>
      </tr>
  </thead>
  <tbody>
      ${rows.join('\n')}
  </tbody>
</table>`

  const path = './images/quests' + chatID + '.png'
  const html = await generateHtml(element)
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
  <caption>Active Requests</caption>
  <thead>
      <tr>
          <th scope="col">Person</th>
          <th scope="col">Request</th>
      </tr>
  </thead>
  <tbody>
      ${rows.join('\n')}
  </tbody>
</table>`

  const path = './images/requests' + chatID + '.png'
  const html = await generateHtml(element)
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
  <caption>Active Offers</caption>
  <thead>
      <tr>
          <th scope="col">Person</th>
          <th scope="col">Offer</th>
      </tr>
  </thead>
  <tbody>
      ${rows.join('\n')}
  </tbody>
</table>`

  const path = './images/offers' + chatID + '.png'
  const html = await generateHtml(element)
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

  let element  = `<table>
  <caption> Appreciation </caption>
  <thead>
      <tr>
          <th scope="col">Rank</th>
          <th scope="col">Name</th>
          <th scope="col">Sent</th>
          <th scope="col">Recieved</th>
          <th scope="col">Balance</th>
      </tr>
  </thead>
  <tbody>
      ${rows.join('\n')}
  </tbody>
</table>`

  const path = './images/appreciation' + chatID + '.png'
  const html = await generateHtml(element)
  await screenshotHtml(html, path, 'table')
  return path
}

async function generateHtml(element) {
  return `<!DOCTYPE html>
    <html>
    <head>
    <style>`
    + theme.toString() +
    `</style>
    </head>
    <body>`
    + element.toString() +
    `</body>
    </html>`
}

async function screenshotHtml(html, pathToSave, onElement) {
  console.log(html)
  const page = await browser.newPage();
  await page.setContent(html)
  const element = await page.$(onElement)
  await element.screenshot({ path: pathToSave })
  await page.close()
}



export async function showMaslow(layer){
const path = './images/maslow.png'
const element = drawMaslow(layer)
const html = await generateHtml(element)
await screenshotHtml(html, path, 'svg')
return path
}

function drawMaslow(layer) {
  let dom = new JSDOM.JSDOM();
  let document = dom.window.document;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("width", "100");
  svg.setAttribute("height", "100");

  const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bgRect.setAttribute("x", "0");
  bgRect.setAttribute("y", "0");
  bgRect.setAttribute("width", "100");
  bgRect.setAttribute("height", "100");
  bgRect.setAttribute("fill", "black");
  svg.appendChild(bgRect);

  const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line1.setAttribute("x1", "0");
  line1.setAttribute("y1", "20");
  line1.setAttribute("x2", "100");
  line1.setAttribute("y2", "20");
  line1.setAttribute("stroke", layer === 1 ? "white" : "gray");
  svg.appendChild(line1);

  const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line2.setAttribute("x1", "0");
  line2.setAttribute("y1", "40");
  line2.setAttribute("x2", "100");
  line2.setAttribute("y2", "40");
  line2.setAttribute("stroke", layer === 2 ? "white" : "gray");
  svg.appendChild(line2);

  const line3 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line3.setAttribute("x1", "0");
  line3.setAttribute("y1", "60");
  line3.setAttribute("x2", "100");
  line3.setAttribute("y2", "60");
  line3.setAttribute("stroke", layer === 3 ? "white" : "gray");
  svg.appendChild(line3);

  const line4 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line4.setAttribute("x1", "0");
  line4.setAttribute("y1", "80");
  line4.setAttribute("x2", "100");
  line4.setAttribute("y2", "80");
  line4.setAttribute("stroke", layer === 4 ? "white" : "gray");
  svg.appendChild(line4);

  const line5 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line5.setAttribute("x1", "0");
  line5.setAttribute("y1", "100");
  line5.setAttribute("x2", "100");
  line5.setAttribute("y2", "100");
  line5.setAttribute("stroke", layer === 5 ? "white" : "gray");
  svg.appendChild(line5);
  console.log(svg.textContent)
  return svg
}