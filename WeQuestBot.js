"use strict"

import config from "./config.json" assert { type: "json" };


import qrReader from 'qrcode-reader';
import Jimp from 'jimp';
import axios from 'axios';
import sharp from 'sharp';

import * as utils from './utilities.js'
import lunation from "./lunation.js";

// -------------------------check if lockfile exists and delete i
import fs from 'fs';

if (fs.existsSync('./orbitdb/repo.lock')) {
  fs.rmdirSync('./orbitdb/repo.lock');
}
// --------------------------------------------------------

// ------------------------------------ Import the telegraf module
import { Telegraf, Markup } from 'telegraf';
import {Client, GatewayIntentBits} from 'discord.js';

import UI from './UI.js';
import * as AI from './AI.js';
import * as WEB3 from './WEB3.js';

import { create } from 'ipfs'
import OrbitDB from 'orbit-db'

//import WeQuest Modules
import Quests from './quests.js'
import * as values from './values.js'
import * as request from './requests.js'
import * as settings from './settings.js'
import { t } from "i18next";

//Initialize modules

let orbitdb
let telebot
let discordbot
let quests
let moon
let ui

async function init() {
  let ipfs
  if (config.mode === 'production')
  {
    console.log('production mode')
    ipfs = await create({ address: "127.0.0.1", port: 5001, source: 'js-ipfs', repo: 'orbitdb' })
  }
  else
  {
    console.log('development mode')
    ipfs = await create()
  }
  orbitdb = await OrbitDB.createInstance(ipfs)
  await settings.init(orbitdb)

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
  telebot = new Telegraf(config.telegram);
  //telebot.use(Telegraf.log())
  moon = new lunation(telebot)
  quests = new Quests(telebot, orbitdb)
  ui = new UI (telebot, orbitdb)
  await ui.init()

  telebot.launch();
  //telebot.telegram.setMyCommands([ { command: 'start', description: 'Start the bot' }, { command: 'help', description: 'Help' }, { command: 'task', description: 'Task' }, { command: 'quest', description: 'Quest' }, { command: 'setLanguage', description: 'Set language' }, { command: 'setTheme', description: 'Set theme' }, { command: 'setLevel', description: 'Set level' }, { command: 'setAdmin', description: 'Set admin' }, { command: 'getLanguage', description: 'Get language' }, { command: 'getTheme', description: 'Get theme' }, { command: 'getLevel', description: 'Get level' }, { command: 'getAdmin', description: 'Get admin' }, { command: 'getAddress', description: 'Get address' }, { command: 'getBalance', description: 'Get balance' }, { command: 'getQuests', description: 'Get quests' }, { command: 'getTasks', description: 'Get tasks' }, { command: 'getQuest', description: 'Get quest' }, { command: 'getTask', description: 'Get task' }, { command: 'getSettings', description: 'Get settings' }, { command: 'getValues', description: 'Get values' }, { command: 'getInfo', description: 'Get info' }, { command: 'getHelp', description: 'Get help' } ]);

  discordbot = new Client({ intents: [GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent] });
  discordbot.on("ready", () => {
    // This event will run if the bot starts, and logs in, successfully.
    console.log(`Discrord BOT has started, with ${discordbot.users.cache.size} users, in ${discordbot.channels.cache.size} channels of ${discordbot.guilds.cache.size} guilds.`);
    // Example of changing the bot's playing game to something useful. `discordbot.user` is what the
    // docs refer to as the "ClientUser".
    discordbot.user.setActivity(`Serving ${discordbot.guilds.cache.size} servers`);
  });

  discordbot.on('messageCreate', msg => {
    console.log("DISCORD MESSAGE: "+msg.content)
    if (msg.content.charAt(0) === config.prefix) {
      msg.react('👀')
        .catch(log => {
          console.log(error);
        });
    };
    const commandBody = msg.content.substring(config.prefix.length).split(' ');
    console.log(commandBody);
    const command = commandBody[0];
    const args = commandBody.slice(1);
    if (command === 'quest') {
      quests.quest('quest',discord2telegram(msg), orbitdb);
    }
    if (command === 'task') {
      console.log('task')
    }
  }
  )
  
  discordbot.login(config.discord);
}

await init();

// discordbot.on('message', msg => {
//   console.log("DISCORD MESSAGE: "+msg.content)
//   if (msg.content === 'quest') {quests.quest('quest',discord2telegram(msg), orbitdb);
//     msg.reply('Pong!');
//   }
// });

// =========================== bot commands ===========================
telebot.command('start', async (ctx) => {
  ctx.reply("Welcome to WeQuest, a bot developed by Liminal Village. Our quest is to revolutionize community dynamics through AI and blockchain. WeQuest uses gamification to facilitate decision-making, collaboration, and task management, while also recognizing and incentivizing active involvement. Our goal is to foster trust, build strong communities, and accelerate our evolution as social organisms. ")
});
telebot.command('help', async (ctx) => {
  ctx.reply("you can use the following commands: \n /task \n /quest \n /setLanguage \n /setTheme \n /setLevel \n /setAdmin \n /getLanguage \n /getTheme \n /getLevel \n /getAdmin \n /getAddress \n /getBalance \n /getQuests \n /getTasks \n /getQuest \n /getTask \n /getSettings \n /getValues \n /getInfo \n /getHelp")
})
telebot.on('photo', async (ctx) => {
  if (ctx.message.caption) {
    const command = ctx.message.caption.split(' ')[0];
    if (command == '/task')
    quests.quest('task',ctx, orbitdb)
  }
  try {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });

    const rawImageBuffer = await sharp(response.data).toBuffer();
    const jimpImage = await Jimp.read(rawImageBuffer);
    const qr = new qrReader();
    qr.callback = (err, value) => {
      if (err) {
        return;
      }

      if (value) {
        ctx.reply(`${value.result.split('/').slice(value.result.split('/').length - 1 )}`,Markup.inlineKeyboard([Markup.button.webApp('Open', `${value.result}`)]));
      } 
    };
    qr.decode(jimpImage.bitmap);
  } catch (error) {
    console.error(error);
    //ctx.reply('An error occurred while processing the QR code. Please try again.');
  }
});

telebot.on('inline_query', async (ctx) => {
  // This is a simplified example. In a real-world application, you'd fetch this
  // data from a database or API.

  const products = [
    { id: '1', title: 'Pizza', description: 'Delicious pizza', price: '$10' },
    { id: '2', title: 'Burger', description: 'Tasty burger', price: '$8' },
    { id: '3', title: 'huh', description: 'Delicious pizza', price: '$10' },
    { id: '4', title: 'Bbbuburger', description: 'Tasty burger', price: '$8' },
    { id: '5', title: 'jjPizza', description: 'Delicious pizza', price: '$10' },
    { id: '6', title: 'jjuiBurger', description: 'Tasty burger', price: '$8' },
  ];

  const results = products.map((product) =>   ({
    type: 'article',
    id: product.id,
    title: product.title,
    description: product.description,
    input_message_content: {
      message_text: `${product.title}: ${product.description} - ${product.price}`
  },
  }));

  await ctx.answerInlineQuery(results);
});

telebot.on('chosen_inline_result', (ctx) => {
  console.log(`Chosen product: ${ctx.chosenInlineResult.result_id}`);
  // Handle the product selection here. For example, you could send a confirmation
  // message to the user, or add the product to a shopping cart.
});


//----------------------------- APPRECIATION -----------------------------
telebot.command('fullrequest', async (ctx) => request.request('fullrequest', ctx, orbitdb))
telebot.command(['appreciate','apprezza','apprezziamo'], async (ctx) => quests.sendAppreciation(ctx, orbitdb))
telebot.command('maslow', (ctx) => UI.showMaslow(2))
telebot.command('assignRoles', async (ctx) => ctx.reply(await AI.assignRoles(await quests.listUsersActions(ctx, orbitdb), await settings.getRoles(utils.getChatId(ctx)) )))
telebot.command('setRoles', async (ctx) => ctx.reply(await settings.setRoles(utils.getChatId(ctx), utils.getParameters(ctx))))
telebot.command('getRoles', async (ctx) => {let roles = await settings.getRoles(utils.getChatId(ctx)); ctx.reply(roles?roles:'No roles founds')})
telebot.command('actions',async (ctx) => {let actions = await quests.listUsersActions(ctx, orbitdb); ctx.reply(actions?actions:'No actions found')})


//----------------------------- VALUES -----------------------------
telebot.command('values', async (ctx) => values.values(ctx, orbitdb))
telebot.command('valuesSelect', async (ctx) => values.valuesSelect(ctx, orbitdb))
telebot.command('valuesAdd', async (ctx) => values.valuesAdd(ctx, orbitdb))
telebot.command('valuesRemove', async (ctx) => values.valuesRemove(ctx, orbitdb))

//----------------------------- QUESTS -----------------------------
telebot.command('quest', async (ctx) => quests.quest('quest', ctx, orbitdb))
telebot.command('mission', async (ctx) => quests.quest('quest', ctx, orbitdb))
telebot.command('task', async (ctx) => quests.quest('task', ctx, orbitdb))
telebot.command('proposal', async (ctx) => quests.quest('proposal', ctx, orbitdb))
telebot.command('propose', async (ctx) => quests.quest('proposal', ctx, orbitdb))
telebot.command('todo', async (ctx) => quests.quest('todo', ctx, orbitdb))
telebot.command('actions', async (ctx) => quests.listUsersActions())

telebot.command(['need','request','want','wish'], async (ctx) => quests.quest('request', ctx, orbitdb))
telebot.command(['offer','give','have','gift'], async (ctx) => quests.quest('offer', ctx, orbitdb))

// ITALIAN
telebot.command('missione', async (ctx) => quests.quest('quest', ctx, orbitdb))
telebot.command('compito', async (ctx) => quests.quest('task', ctx, orbitdb))
telebot.command('proposta', async (ctx) => quests.quest('proposal', ctx, orbitdb))
telebot.command('propongo', async (ctx) => quests.quest('proposal', ctx, orbitdb))
telebot.command('fare', async (ctx) => quests.quest('todo', ctx, orbitdb))

//create new request/offer
telebot.command(['richiedo','bisogno','vorrei','sogno','richiesta','chiedo'], async (ctx) => quests.quest('request', ctx, orbitdb))
telebot.command(['offro','dono','regalo','chiedetemi','ho','offerta'], async (ctx) => quests.quest('offer', ctx, orbitdb))

// QUEST ACTIONS ====================================================

telebot.action('join_quest', (ctx) => quests.join(ctx, orbitdb));
telebot.action('appreciate_quest', (ctx) => quests.appreciate(ctx, orbitdb))
telebot.action('schedule_quest', (ctx) => quests.schedule(ctx, orbitdb));
telebot.action('cancel_quest', (ctx) => quests.cancel(ctx, orbitdb));
telebot.action('complete_quest', (ctx) => quests.complete(ctx, orbitdb));
telebot.action('stop_quest', (ctx) => quests.stop(ctx, orbitdb));


// bot.action('popup', async (ctx) => {ctx.AnswerCallbackQueryAsync(ctx.CallbackQuery.id, "Notification already enabled", true)});

//----------------------------------------------------

//=========== UI COMMANDS ===============

//Set up a command to display the appreciation score for each user
telebot.command(['leaderboard','appreciation','credits','scores','score','points','rank','status'], async (ctx) => ui.leaderboard(ctx, await settings.getValueEquation(utils.getChatId(ctx))))
telebot.command(['apprezzamento','crediti','punti','punteggio','punteggi','classifica'], (ctx) => ui.leaderboard(ctx))

// Set up a command to display the quests
telebot.command(['tasks','quests','todos','proposals'], (ctx) => ui.questboard(ctx))
telebot.command(['compiti','missioni','proposte'], (ctx) => ui.questboard(ctx))

// Set up a command to display the requests
telebot.command(['requests','wishes','needs'], (ctx) => ui.requestsboard(ctx))
telebot.command('offers', (ctx) => ui.offersboard(ctx))

telebot.command(['richieste','sogni','bisogni'], (ctx) => ui.requestsboard(ctx))
telebot.command('offerte', (ctx) => ui.offersboard(ctx))

telebot.command('bulletin', (ctx) => ui.bulletinboard(ctx))

// ================= ADMIN ===========================
telebot.command('reset', async (ctx) => {
  if (!orbitdb) return

  //TODO; check if the user is an admin
  let chatID = ctx.message.chat.id;
  // try{
  //  await ctx.getChatAdministrators(chatID).then((admins) => {console.log(admins)}) //TODO: check if the user is an admin (crashes in private chats)
  // }catch(e){ console.log(e)}
  let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  let offersDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.offers')
  let usersDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
  let settingsDB = await orbitdb.docs('WeQuest.settings')
  await questsDB.drop()
  await offersDB.drop()
  await usersDB.drop()
  await settingsDB.drop()
  ctx.reply('Bot resetted')
})

telebot.command('setLanguage', async (ctx) => {
  //TODO; check if the user is an admin
  await settings.setLanguage(ctx)
})

telebot.command('setTheme', async (ctx) => {
  //TODO; check if the user is an admin
  await settings.setTheme(ctx)
})

telebot.command('setAdmin', async (ctx) => {
  //TODO; check if the user is an admin
  await settings.setAdmin(ctx)
})

telebot.command('setValueEquation', async (ctx) => {
  //TODO; check if the user is an admin
  let weights = await settings.getValueEquation(utils.getChatId(ctx))
  ctx.reply('Update weights:', equationInlineKeyboard(weights));
})

telebot.command('getValueEquation', async (ctx) => {
  //TODO; check if the user is an admin
  ctx.reply('Value Equation:',await settings.getValueEquation(utils.getChatId(ctx)))
})


telebot.on('callback_query', async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  let chatID = utils.getChatId(ctx)

  // initiated, completed, credits sent, credits received, hours, collaboration, wants, offers, money
  let weights = await settings.getValueEquation(chatID)
  // Fetch the current weights from your database

  if (callbackData.startsWith('increment_')) {
      const weightName = callbackData.substring(10);
      weights[weightName] = parseInt(weights[weightName]) + 1;
  } else if (callbackData.startsWith('decrement_')) {
      const weightName = callbackData.substring(10);
      weights[weightName] = parseInt(weights[weightName]) - 1;
  }

  // Save the updated weights back to your database
  await settings.setValueEquation(chatID, weights);

  // Update the message with the new inline keyboard
  await ctx.editMessageText('Update weights:', equationInlineKeyboard(weights));

});

  // ... update the inline keyboard ...
  const equationInlineKeyboard = (weights) => {return Markup.inlineKeyboard([
    [
      Markup.button.callback('Initiated:', 'null'),
      Markup.button.callback('<', 'decrement_initiated'),
      Markup.button.callback(weights.initiated, 'null'),
      Markup.button.callback('>', 'increment_initiated')
    ],
    [
      Markup.button.callback('Completed:', 'null'),
      Markup.button.callback('<', 'decrement_completed'),
      Markup.button.callback(weights.completed, 'null'),
      Markup.button.callback('>', 'increment_completed')
    ],
    [
      Markup.button.callback('Sent:', 'null'),
      Markup.button.callback('<', 'decrement_send'),
      Markup.button.callback(weights.sent, 'null'),
      Markup.button.callback('>', 'increment_send')
    ],
    [
      Markup.button.callback('Received:', 'null'),
      Markup.button.callback('<', 'decrement_received'),
      Markup.button.callback(weights.received, 'null'),
      Markup.button.callback('>', 'increment_received')
    ]
]);
}


// bot.on("callback_query", (ctx) => {
//   // ctx.AnswerCallbackQueryAsync(ctx.CallbackQuery.id, "Notification already enabled", true)
//   // if (ctx.update.callback_query.data === "List") {
//   // listCommand(ctx);
//   // }
//   // if (ctx.update.callback_query.data === "Win") {
//   // ctx.reply("https://google.com");
//   // } else if (ctx.update.callback_query.data === "gold") {
//   // ctx.reply("https://google.com");
//   // }
// });


// // Handle uncaught exceptions
// process.on('uncaughtException', async (err) => {
//   console.error('Uncaught exception:', err);
//   await ipfs.stop();
//   process.exit(1);
// });

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Gracefully shutting down...');
  await ipfs.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Gracefully shutting down...');
  await ipfs.stop();
  process.exit(0);
});

telebot.on('web_app_data', (ctx) => {
	var [ timespamp, timezoneOffset ] = ctx.message.web_app_data.data.split('_')
	timespamp = parseInt(timespamp)

	var clientOffset = parseInt(timezoneOffset) * 60 * 1000
	var serverOffset = (new Date()).getTimezoneOffset() * 60 * 1000
	var offset = serverOffset - clientOffset

	var print = 'in user timezone: ' + (new Date(timespamp + offset)).toLocaleString() + '\n'
	print += 'in server timezone: ' + (new Date(timespamp)).toLocaleString()

	ctx.reply(print)
})




function discord2telegram(message) {
  const ctx = message;
  ctx.deleteMessage = () => message.delete();
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
