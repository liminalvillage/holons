import puppetteer  from 'puppeteer-core';
import { executablePath } from 'puppeteer';
import fs from 'fs';
import { request } from 'http';

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
    <tr><th>Quest:</th><td>${quest.quest}</td></tr>
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
        <th>${quest.quest}</th>
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

export async function getRequestsTable(requests,offers, chatID) {
  
  const rows = []
  for (let i = 0; i < requests.length; i++) {
    const request = requests[i]
    const row = `<tr>
        <th scope="row">${i + 1}</th>
        <th>${request.initiator.firstname}</th>
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

  const path = './images/requests' + chatID + '.png'
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
  const page = await browser.newPage();
  await page.setContent(html)
  const element = await page.$(onElement)
  await element.screenshot({ path: pathToSave })
  await page.close()
}

