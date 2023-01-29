"use strict"
import { Telegraf } from 'telegraf';

const bot = new Telegraf("5965742096:AAGm8_2mq8lST8goLhMKvq57HUaWf5-0LF4");

import fs from 'fs';
import * as ui from './interface.js';

import { create } from 'ipfs'
import OrbitDB from 'orbit-db'

import * as requests from './requests.js'
import * as quests from './quests.js'

let orbitdb

let requestsDB

let valuesDB

let settingsDB

async function init() {
  // const ipfs = await create({ address:"127.0.0.1", port: 5002, source: 'js-ipfs', repo: 'ipfs-' + Math.random()})
  const ipfs = await create()
  orbitdb = await OrbitDB.createInstance(ipfs)
  requestsDB = await orbitdb.docs('WeQuest.requests')
  valuesDB = await orbitdb.docs('WeQuest.values')
  settingsDB = await orbitdb.docs('WeQuest.settings')
  await requestsDB.load()
  await valuesDB.load()
  await settingsDB.load()

  const options = {
    // Setup write access
    accessController: {
      write: [
        // Give access to ourselves
        orbitdb.identity.id,
        // Give access to the second peer
        //'042c07044e7e51a489c02854db5e09f0191690dc59db0afd95328c9db614a2976e088cab7c86d7e48183191258fc59dc699653508ce25bf0369d67f33d5d77839',
      ]
    }
  }

  // await ui.init();


}

init();

// Create a new quest
bot.command('quest', async (ctx) => quests.quest(ctx, orbitdb))
bot.command('task', async (ctx) => quests.quest(ctx, orbitdb))
bot.command('propose', async (ctx) => quests.quest(ctx, orbitdb))
bot.command('todo', async (ctx) => quests.quest(ctx, orbitdb))
// list quests

//create new request
bot.command('need', async (ctx) => requests.request(ctx, orbitdb))
bot.command('request', async (ctx) => requests.request(ctx, orbitdb))
bot.command('want', async (ctx) => requests.request(ctx, orbitdb))

//

// ACTIONS ====================================================

bot.action('join_quest', (ctx) => quests.join(ctx, orbitdb));

bot.action('appreciate_quest', (ctx) => quests.appreciate(ctx, orbitdb))

bot.action('cancel_quest', (ctx) => quests.cancel(ctx, orbitdb));

bot.action('complete_quest', (ctx) => quests.complete(ctx, orbitdb));

//----------------------------------------------------

// bot.on('message', (ctx) => {
//   // check if the message contains an emoji reaction
//   if (ctx.message.reactions) {
//     // iterate through the reactions
//     for (let i = 0; i < ctx.message.reactions.length; i++) {
//       let reaction = ctx.message.reactions[i];
//       let users = reaction.users;
//       let user_list = users.map(user => user.first_name).join(', ');
//       reactions.set(reaction.emoji, user_list);
//     }
//   }
// });

// bot.command('list', (ctx) => {
//   for (let [emoji, users] of reactions) {
//     ctx.reply(`Emoji: ${emoji} Users: ${users.join(', ')}`);
//   }
// });

// ================= ADMIN ===========================
bot.command('reset', async (ctx) => {
  //TODO; check if the user is an admin
  let chatID = ctx.message.chat.id;
  let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  let appreciationDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.appreciation')
  await questsDB.drop()
  await appreciationDB.drop()
  ctx.reply('Bot resetted')
})

//=========== LIST COMMANDS ===============

//Set up a command to display the appreciation score for each user
bot.command('leaderboard', async ctx => {

  let chatID = ctx.message.chat.id
  // loop through the userlist and get the quests
  let appreciationDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.appreciation')
  await appreciationDB.load()

  let appreciation = await appreciationDB.get('')//.filter(quest => quest.status === 'ongoing')

  // Create a table header
  ui.getAppreciationTable(appreciation, chatID).then((path) => {
    //send the image
    ctx.replyWithPhoto({ source: fs.createReadStream(path) })
  });
  return;
})

// Set up a command to display the quests
bot.command('quests', async (ctx) => {
  // Get a list of incomplete quests
  let chatID = ctx.message.chat.id

  let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  await questsDB.load()

  let quests = await questsDB.get('').filter(quest => quest.status === 'ongoing')

  // Create a table header
  ui.getQuestsTable(quests, chatID).then((path) => {
    //send the image
    ctx.replyWithPhoto({ source: fs.createReadStream(path) });
  });
  return;
});

//bot.use(Telegraf.log())
bot.start((ctx) => ctx.reply('Welcome to WeQuest!'))
bot.help((ctx) => ctx.reply('WeQuest can help your communities organize around quests and to exchange goods and services with each other! click on the menu to see the available options.'))
bot.launch();