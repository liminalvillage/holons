"use strict"

import config from  "./config.json" assert { type: "json" };

//  ------------------------------------ Import the discord.js module
// import * as Discord from 'discord.js';
// const discord = new Discord.Client({intents: [Discord.GatewayIntentBits.GUILD_MESSAGES]});
// discord.login(config.discord);

//import {i18n} from 'i18next'

// ------------------------------------ Import the telegraf module
import { Telegraf } from 'telegraf';
const bot = new Telegraf(config.telegram);
//bot.use(Telegraf.log())
bot.start((ctx) => ctx.reply('Welcome to WeQuest!'))
bot.help((ctx) => ctx.reply('WeQuest can help your communities organize around quests and to exchange goods and services with each other! click on the menu to see the available options.'))
bot.launch();

import fs from 'fs';
import * as ui from './interface.js';

import { create } from 'ipfs'
import OrbitDB from 'orbit-db'

import * as requests from './requests.js'
import * as quests from './quests.js'
import * as values from './values.js'

let orbitdb

let requestsDB

let valuesDB

let settingsDB

async function init() {
  // const ipfs = await create({ address:"127.0.0.1", port: 5001, source: 'js-ipfs', repo: 'ipfs-' + Math.random()})
  
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
}

init();

// discord.on('message', msg => {
//   if (msg.content === 'quest') {quests.quest('quest',discord2telegram(msg), orbitdb);
//     msg.reply('Pong!');
//   }
// });


// Create a new quest
bot.command('quest', async (ctx) => quests.quest('quest',ctx, orbitdb))
bot.command('task', async (ctx) => quests.quest('task',ctx, orbitdb))
bot.command('proposal', async (ctx) => quests.quest('proposal',ctx, orbitdb))
bot.command('propose', async (ctx) => quests.quest('proposal',ctx, orbitdb))
bot.command('todo', async (ctx) => quests.quest('todo',ctx, orbitdb))

//create new request
bot.command('need', async (ctx) => quests.quest('request', ctx, orbitdb))
bot.command('request', async (ctx) => quests.quest('request',ctx, orbitdb))
bot.command('want', async (ctx) => quests.quest('request',ctx, orbitdb))
bot.command('wish', async (ctx) => quests.quest('request',ctx, orbitdb))
//create new offer
bot.command('offer', async (ctx) => quests.quest('offer',ctx, orbitdb))
bot.command('give', async (ctx) => quests.quest('offer',ctx, orbitdb))
bot.command('have', async (ctx) => quests.quest('offer',ctx, orbitdb))
bot.command('gift', async (ctx) => quests.quest('offer',ctx, orbitdb))
// list requests

bot.command('values', async (ctx) => values.values(ctx, orbitdb))
bot.command('valuesSelect', async (ctx) => values.valuesSelect(ctx, orbitdb))
bot.command('valuesAdd', async (ctx) => values.valuesAdd(ctx, orbitdb))
bot.command('valuesRemove', async (ctx) => values.valuesRemove(ctx, orbitdb))


// QUEST ACTIONS ====================================================

bot.action('join_quest', (ctx) => quests.join(ctx, orbitdb));
bot.action('appreciate_quest', (ctx) => quests.appreciate(ctx, orbitdb))
bot.action('cancel_quest', (ctx) => quests.cancel(ctx, orbitdb));
bot.action('complete_quest', (ctx) => quests.complete(ctx, orbitdb));
bot.action('stop_quest', (ctx) => quests.stop(ctx, orbitdb));

// bot.action('popup', async (ctx) => {ctx.AnswerCallbackQueryAsync(ctx.CallbackQuery.id, "Notification already enabled", true)});



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
  let requestsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.requests')
  await questsDB.drop()
  await appreciationDB.drop()
  await requestsDB.drop()
  ctx.reply('Bot resetted')
})

//=========== LIST COMMANDS ===============

//Set up a command to display the appreciation score for each user
bot.command('leaderboard', (ctx) => leaderboard (ctx))
bot.command('appreciation', (ctx) => leaderboard(ctx))
bot.command('credits', (ctx) => leaderboard(ctx))
bot.command('scores', (ctx) => leaderboard(ctx))
bot.command('score', (ctx) => leaderboard(ctx))
bot.command('points', (ctx) => leaderboard(ctx))

// Set up a command to display the quests
bot.command('tasks', (ctx) => handlequests(ctx))
bot.command('quests', (ctx) => handlequests(ctx))
bot.command('todos', (ctx) => handlequests(ctx))
bot.command('proposals', (ctx) => handlequests(ctx))

// Set up a command to display the requests
async function leaderboard (ctx) {

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
}


// Set up a command to display the quests
async function handlequests (ctx) {
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
}

// Set up a command to display the quests
bot.command('requests', async (ctx) => {
  // Get a list of incomplete quests
  let chatID = ctx.message.chat.id

  let requestsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  await requestsDB.load()

  let requests = await requestsDB.get('')

  // Create a table header
  ui.getRequestsTable(requests, chatID).then((path) => {
    //send the image
    ctx.replyWithPhoto({ source: fs.createReadStream(path) });
  });
  return;
});

// Set up a command to display the quests
bot.command('offers', async (ctx) => {
  // Get a list of incomplete quests
  let chatID = ctx.message.chat.id

  let requestsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  await requestsDB.load()

  let requests = await requestsDB.get('')

  // Create a table header
  ui.getOffersTable(requests, chatID).then((path) => {
    //send the image
    ctx.replyWithPhoto({ source: fs.createReadStream(path) });
  });
  return;
});



bot.on("callback_query", (ctx) => {
  // ctx.AnswerCallbackQueryAsync(ctx.CallbackQuery.id, "Notification already enabled", true)
  // if (ctx.update.callback_query.data === "List") {
  // listCommand(ctx);
  // }
  // if (ctx.update.callback_query.data === "Win") {
  // ctx.reply("https://google.com");
  // } else if (ctx.update.callback_query.data === "gold") {
  // ctx.reply("https://google.com");
  // }
});




function discord2telegram(message) {
  const ctx = {};

  // Map properties from discord.js message to telegraf context
  ctx.updateType = "message";
  ctx.message = {
    message_id: message.id,
    from: {
      id: message.author.id,
      first_name: message.author.username
    },
    chat: {
      id: message.channel.id
    },
    text: message.content
  };

  return ctx;
}