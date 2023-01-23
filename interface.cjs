const puppetteer = require('puppeteer-core');
const { executablePath } = require('puppeteer');

async function init() {
  browser = await puppetteer.launch({
    args: ['--no-sandbox',],
    ignoreHTTPSErrors: true,
    executablePath: executablePath(),
  });
}

async function generateTaskHtml(rows) {
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
    <caption>Current tasks</caption>
    <thead>
        <tr>
            <th scope="col">ID</th>
            <th scope="col">Task</th>
            <th scope="col">Creator</th>
            <th scope="col">Joined</th>
            <th scope="col">Approved</th>
        </tr>
    </thead>
    <tbody>
        ${rows}
    </tbody>
</table>
    </body>
    </html>`
}

async function generateCreditsHtml(rows) {
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
  <caption>Current Rank and Credits</caption>
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

async function generateTaskTable(tasks) {
  const rows = []
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    const row = `<tr>
        <th scope="row">${i + 1}</th>
        <th>${task.task}</th>
        <th>${task.users[0].first_name}</th>
        <th>${task.users.length}</th>
        <th>${task.approved.length}</th>
      </tr>`

    rows.push(row)
  }

  const path = './images/tasks.png'
  const html = await generateTaskHtml(rows.join('\n'))
  await screenshotHtml(html, path, 'table')
  return path
}

  async function generateCreditsTable(credits) {
  const rows = []
  const sortedUsers = Object.keys(credits).sort((a, b) => {
    return credits[b].received - credits[b].sent - (credits[a].received - credits[a].sent);
  });

  for (let i = 0; i < sortedUsers.length; i++) {
    const credit = credits[sortedUsers[i]]
    const row = `<tr>
      <th scope="row">${i + 1}</th>
      <th>${credit.username}</th>
      <th>${credit.sent}</th>
      <th>${credit.received}</th>
      <th>${credit.received - credit.sent}</th>
    </tr>`

    rows.push(row)
  }

  const path = './images/credits.png'
  const html = await generateCreditsHtml(rows.join('\n'))
  await screenshotHtml(html, path, 'table')
  return path
}

async function screenshotHtml(html, pathToSave, onElement) {

  const page = await browser.newPage();
  await page.setContent(html)
  const element = await page.$(onElement)
  console.log(await element.screenshot({ path: pathToSave }))
  await page.close()
}



module.exports = { generateCreditsTable: generateCreditsTable, generateTaskTable: generateTaskTable, init: init}