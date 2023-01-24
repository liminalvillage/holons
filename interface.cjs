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

async function generateTaskImage(task) {
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
          <tr><th>Task:</th><td>${task.task}</td></tr>
          <tr><th>Creator:</th><td>${task.users[0].first_name}</td></tr>
          <tr><th>Joined by:</th><td>${[...task.users].slice(1).map(u => u.username).join(', ')}</td></tr>
          <tr><th>Approved by:</th><td>${[...task.approved].slice(1).map(u => u.username).join(', ')}</td></tr>
    <table>
    </span>
    </body>
  </html>`
  const path = './images/task' + task._id + '.png'
  await screenshotHtml(html, path, 'table')
  return path
}


async function generateTaskTable(tasks, chatID) {
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

  const path = './images/tasks' + chatID + '.png'
  const html = await generateTaskHtml(rows.join('\n'))
  await screenshotHtml(html, path, 'table')
  return path
}

async function generateCreditsTable(credits, chatID) {
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

  const path = './images/credits' + chatID + '.png'
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



module.exports = { generateTaskImage: generateTaskImage, generateCreditsTable: generateCreditsTable, generateTaskTable: generateTaskTable, init: init }