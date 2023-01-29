// import puppetteer  from 'puppeteer-core';
// import { executablePath } from 'puppeteer';

// var browser

export async function init() {
}

async function generateQuestHtml(rows) {
  return `<!DOCTYPE html>
    <html>
    <head>
    <style>
    thead,
tfoot {
    background-color: #3f87a6;
    color: #fff;
}

tbody {
    background-color: #e4f0f5;
}

caption {
    padding: 10px;
    caption-side: bottom;
}

table {
    border-collapse: collapse;
    border: 2px solid rgb(200, 200, 200);
    letter-spacing: 1px;
    font-family: sans-serif;
    font-size: .8rem;
}

td,
th {
    border: 1px solid rgb(190, 190, 190);
    padding: 5px 10px;
}

td {
    text-align: center;
}

    </style>
    </head>
    <body>
    <table>
    <caption>Active Quests</caption>
    <thead>
        <tr>
            <th scope="col">ID</th>
            <th scope="col">Quest</th>
            <th scope="col">Focalizer</th>
            <th scope="col">Joined</th>
            <th scope="col">Appreciated</th>
        </tr>
    </thead>
    <tbody>
        ${rows}
    </tbody>
</table>
    </body>
    </html>`
}

async function generateAppreciationHtml(rows) {
  return `<!DOCTYPE html>
  <html>
  <head>
  <style>
  thead,
tfoot {
  background-color: #3f87a6;
  color: #fff;
}

tbody {
  background-color: #e4f0f5;
}

caption {
  padding: 10px;
  caption-side: bottom;
}

table {
  border-collapse: collapse;
  border: 2px solid rgb(200, 200, 200);
  letter-spacing: 1px;
  font-family: sans-serif;
  font-size: .8rem;
}

td,
th {
  border: 1px solid rgb(190, 190, 190);
  padding: 5px 10px;
}

td {
  text-align: center;
}

  </style>
  </head>
  <body>
  <table>
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
      ${rows}
  </tbody>
</table>
  </body>
  </html>`
}

export async function getQuestImage(quest) {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
  <style>
  thead,
  tfoot {
    background-color: #3f87a6;
    color: #fff;
  }

  tbody {
    background-color: #e4f0f5;
  }

  caption {
    padding: 10px;
    caption-side: bottom;
  }

  table {
    border-collapse: collapse;
    border: 2px solid rgb(200, 200, 200);
    letter-spacing: 1px;
    font-family: sans-serif;
    font-size: .8rem;
  }

  td
  {
    border: 0px solid rgb(190, 190, 190);
    padding: 5px 10px;
    text-align: left;
  }

  th {
    text-align: right;
  }

    </style>
    </head>
    <body>

    <span>
    <table>
          <tr><th>Task:</th><td>${quest.task}</td></tr>
          <tr><th>Creator:</th><td>${quest.users[0].first_name}</td></tr>
          <tr><th>Joined by:</th><td>${[...quest.users].slice(1).map(u => u.username).join(', ')}</td></tr>
          <tr><th>Validated by:</th><td>${[...quest.appreciated].slice(1).map(u => u.username).join(', ')}</td></tr>
    <table>
    </span>
    </body>
  </html>`
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
        <th>${quest.users[0].first_name}</th>
        <th>${quest.users.length}</th>
        <th>${quest.appreciated.length}</th>
      </tr>`

    rows.push(row)
  }

  const path = './images/quests' + chatID + '.png'
  const html = await generateQuestHtml(rows.join('\n'))
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

  const path = './images/appreciation' + chatID + '.png'
  const html = await generateAppreciationHtml(rows.join('\n'))
  await screenshotHtml(html, path, 'table')
  return path
}

async function screenshotHtml(html, pathToSave, onElement) {

 
}

