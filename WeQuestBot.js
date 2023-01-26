"use strict"
import { Telegraf, Markup } from 'telegraf';
const bot = new Telegraf("5965742096:AAGm8_2mq8lST8goLhMKvq57HUaWf5-0LF4");

import fs from 'fs';
import * as ui from './interface.cjs';

import { create } from 'ipfs'
import OrbitDB from 'orbit-db'

var orbitdb

var requestsDB

var valuesDB 

async function init() {

  // const ipfs = await create({ address:"127.0.0.1", port: 5002, source: 'js-ipfs', repo: 'ipfs-' + Math.random()})
  const ipfs = await create()
  orbitdb = await OrbitDB.createInstance(ipfs)
  requestsDB = await orbitdb.docs('WeQuest.requests')
  valuesDB = await orbitdb.docs('WeQuest.values')
  await requestsDB.load()
  await valuesDB.load()

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

  await ui.init();

  //bot.use(Telegraf.log())
  bot.start((ctx) => ctx.reply('Hello!'))
  bot.help((ctx) => ctx.reply('WeQuest can help your communities organize around quests and to exchange goods and services with each other! click on the menu to see the available options.'))
  bot.launch();
}

init();

// HANDLES REQUESTS ====================================================

bot.command('request', (ctx) => {
  // Extract request from command argument
  const request = ctx.message.text.split(' ').slice(1).join(' ');
  // Add request to map and set status to unclaimed
  requestsDB.put(request, 'unclaimed');
  // Respond to user
  ctx.reply(`${ctx.from.username} request for "${request}" has been added to the list.`);
});

// bot.command('claim', (ctx) => {
//   // Extract request from command argument
//   const request = ctx.message.text.split(' ').slice(1).join(' ');
//   // Check if request exists and is unclaimed
//   if (requests.has(request) && requests.get(request) === 'unclaimed') {
//     // Set request status to claimed
//     requests.set(request, 'claimed');
//     // Get user id of participant who claimed the request
//     const participantId = ctx.message.from.id;
//     // Check if participant is already in the map
//     if (!participants.has(participantId)) {
//       // Add participant to the map with a balance of 0 community tokens
//       participants.set(participantId, 0);
//     }
//     // Increase participant's community token balance by 1
//     participants.set(participantId, participants.get(participantId) + 1);
//     // Respond to user
//     ctx.reply(`Request "${request}" has been claimed by you. Your current community token balance is ${participants.get(participantId)}.`);
//   } else {
//     // Respond to user if request doesn't exist or has already been claimed
//     ctx.reply(`Request "${request}" does not exist or has already been claimed.`);
//   }
// });

bot.command('requests', (ctx) => {
  // Print list of unfulfilled requests
  ctx.reply(`Here is a list of unfulfilled requests: ${[...requests.entries()].filter(([request, status]) => status === 'unclaimed').map(([request]) => request).join(', ')}`);
});

//====================================================


// Create an inline keyboard with a button to reset the counter
const markup = Markup.inlineKeyboard([[
  Markup.button.callback('❤️ Join', 'join_quest'),
  Markup.button.callback('👍 Appreciate', 'appreciate_quest')
], [
  Markup.button.callback('❌ Cancel', 'cancel_quest'),
  Markup.button.callback('✔️ Complete', 'complete_quest')
]]
)

// ACTIONS ====================================================
bot.action('join_quest', async ctx => {
  console.log("JOIN ACTION");
  // Get the index from the callback data
  var chatID = ctx.callbackQuery.message.chat.id;
  var messageID = ctx.callbackQuery.message.message_id;

  var questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  await questsDB.load()

  var quest = await questsDB.get(messageID.toString())[0]

  if (!quest || quest == '') { console.log('Quest IS NOT FOUND'); return }

  if (quest.status == 'completed') {
    ctx.reply(`Quest "${quest.quest}" has already been completed`);
    return;
  }

  // Get the user who reacted
  const sender = ctx.from;

  // Check if the user has already joined the quest
  if (quest.users.find(user => user.id === sender.id)) {
    ctx.reply(`${sender.first_name}, you have already joined the quest "${quest.quest}"`);
    return;
  }
  // Add the user to the quest
  quest.users.push(sender);

  // Update the message 
  updatequestMessage(ctx, quest);

  // Update the db
  questsDB.put(quest);

  // Send a message to confirm that the user joined the quest
  ctx.reply(`${sender.first_name} has joined the quest "${quest.quest}"`);


});

bot.action('appreciate_quest', async (ctx) => {
  console.log("APPRECIATE ACTION");
  // Get the quest  from the callback data
  var chatID = ctx.callbackQuery.message.chat.id;
  var messageID = ctx.callbackQuery.message.message_id;

  var questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  await questsDB.load()

  var quest = await questsDB.get(messageID.toString())[0]

  if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

  // Get the user who sent the credit
  const sender = ctx.callbackQuery.from;
  // Check if the user has already appreciated the quest
  if (quest.appreciated.find(user => user.id === sender.id)) {
    ctx.reply(`${sender.first_name}, you have already appreciated the quest "${quest.quest}"`);
    return;
  }
  // Check if the user is the quest submitter
  // if (sender.id === quest.users[0].id) {
  //   ctx.reply(`${user.first_name}, you cannot validate your own quests! "${quest.quest}"`);
  //   return;
  // }
  // Add the user to the quest
  quest.appreciated.push(sender);

  // Update the db to indicate who appreciated the quest
  await questsDB.put(quest);
  // ================================ APPRECIATION ========================== 
  var appreciationDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.appreciation')
  await appreciationDB.load()
  var senderappreciation = await appreciationDB.get(sender.id)[0]
  if (!senderappreciation || senderappreciation == '') {

      // Initialize the sender's points if they do not exist yet
      senderappreciation = {
        _id: sender.id,
        username: sender.first_name,
        received: 0,
        sent: 0,
        appreciation: 0,
      
    }
  }

  // Update the sent appreciation of the sender
  senderappreciation.sent += 1;
  // Update the db
  await appreciationDB.put(senderappreciation)

  // Calculate the number of appreciation to send to each user
  const appreciationPerUser = 1  // / quest.users.length;

  // Send the appreciation to each user
  for (let i = 0; i < quest.users.length; i++) {
    // Get the recipient
    const recipient = quest.users[i]
    // // Check if the recipient is the sender
    // if (recipient.id === sender.id ) {
    //   continue;
    // }
    // Send the appreciation to each user
    var recipientappreciation = await appreciationDB.get(recipient.id)[0]
    // Initialize the receiver's points if they do not exist yet
    if (!recipientappreciation || recipientappreciation == '') {
      recipientappreciation = {
        _id: recipient.id,
        username: recipient.first_name,
        received: 0,
        sent: 0,
        appreciation: 0
      }
    }
    recipientappreciation.received += appreciationPerUser;
    // Add the received appreciation to the recipient
    appreciationDB.put(recipientappreciation)
  }
  // ================================ APPRECIATION ==========================
  // Update the message 
  updatequestMessage(ctx, quest);
  // Send a message to confirm that the appreciation were sent
  ctx.reply(`${sender.first_name} has sent ${appreciationPerUser} appreciation to each user participating the quest "${quest.quest}"`);
});

bot.action('cancel_quest', async (ctx) => {
  console.log("CANCEL ACTION");

  var chatID = ctx.callbackQuery.message.chat.id;
  var messageID = ctx.callbackQuery.message.message_id;

  var questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  await questsDB.load()

  var quest = await questsDB.get(messageID.toString())[0]

  if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

  // Handle the reaction to the quest
  if (quest.users[0].id === ctx.from.id) {
    quest.status = "cancelled";
    // Update the message 
    updatequestMessage(ctx, quest);
    //delete the db entry
    questsDB.del(messageID.toString())
    //delete the telegram message
    ctx.deleteMessage(messageID.toString())


  } else {
    ctx.reply(`Only the creator of the quest can cancel the quest.`);
  }
});


bot.action('complete_quest', async (ctx) => {
  console.log("COMPLETE ACTION");

  var chatID = ctx.callbackQuery.message.chat.id;
  var messageID = ctx.callbackQuery.message.message_id;

  var questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  await questsDB.load()

  var quest = await questsDB.get(messageID.toString())[0]

  if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

  // Handle the reaction to the quest
  if (quest.users[0].id === ctx.from.id) {
    quest.status = "completed";
    // Update the message 
    updatequestMessage(ctx, quest);

    // Update the db
    questsDB.put(quest);

  } else {
    ctx.reply(`Only the creator of the quest can mark it as completed.`);
  }
});

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

// ================= questS ===========================
bot.command('reset', async (ctx) => {
  //TODO; check if the user is an admin
  var chatID = ctx.message.chat.id;
  var questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  var appreciationDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.appreciation')
  await questsDB.drop()
  await appreciationDB.drop()
  ctx.reply('Bot resetted')
})

// Create a new quest
bot.command('quest', async (ctx) => {
  // Get the message text and sender from the context

  var chatID = ctx.message.chat.id;
  var messageID = ctx.message.message_id;
  const text = ctx.message.text;
  const sender = ctx.from;

  var questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  await questsDB.load()

  const quest = text.split(' ').slice(1).join(' ');

  if (!quest) {
    ctx.reply('Please enter a quest as part of the command. Example: /quest Do the dishes');
    return;
  }

  // Create a quest object

  var questObj = {
    _id: '',
    quest: quest,
    date: new Date().getTime(),
    users: [],
    appreciated: [],
    status: 'ongoing'
  }
  // // Add the sender to the list of users
  questObj.users.push(sender);

  // var path = await ui.questImage(questObj)
  // ctx.replyWithPhoto({ source: fs.createReadStream(path) },markup).then((ctx) => {
  //     // Add the message id to the quest
  //     questObj._id = ctx.message_id;
  
  //     questsDB.put(questObj)
  
  //   }); 
  
  ctx.reply(createQuestMessage(questObj), markup).then((ctx) => {
    // Add the message id to the quest
    questObj._id = ctx.message_id;

    questsDB.put(questObj)

  });
});

// Function to create the message for a quest TODO 
function createQuestMessage(quest) {
  let message = `Quest: ${quest.quest}\n`;
  message += `Focalizer: ${quest.users[0].first_name}\n`;
  message += `Joined by: ${[...quest.users].slice(1).map(u => u.first_name).join(', ')}\n`;
  message += `Appreciated by: ${[...quest.appreciated].map(u => u.first_name).join(', ')}\n`;
  message += `Status: ${quest.status}\n`;
  return message;
}
// Function to update messages for a quest
async function updatequestMessage(ctx, quest) {
  try {
    // Update the message 
    await ctx.telegram.editMessageText(
      ctx.update.callback_query.message.chat.id,
      ctx.update.callback_query.message.message_id,
      null,
      createQuestMessage(quest),
      markup
    );
  } catch (e) {
    console.log(e);
  }
}

// Function to update messages for a quest
async function updateQuestImage(ctx, quest) {
  try {
    // update the image
    var path = await ui.getQuestImage(quest)
    await ctx.telegram.editMessageMedia(
      ctx.update.callback_query.message.chat.id,
      ctx.update.callback_query.message.message_id,
      null,
      { source: fs.createReadStream
        (path) },
    );
  } catch (e) {
    console.log(e);
  }
}

//=========== LIST COMMANDS ===============

//Set up a command to display the appreciation score for each user
bot.command('leaderboard', async ctx => {

  var chatID = ctx.message.chat.id
  // loop through the userlist and get the quests
  var appreciationDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.appreciation')
  await appreciationDB.load()

  var appreciation = await appreciationDB.get('')//.filter(quest => quest.status === 'ongoing')

  // Create a table header
  ui.getAppreciationTable(appreciation,chatID).then((path) => {
    //send the image
    ctx.replyWithPhoto({ source: fs.createReadStream(path) })
  });
  return;
})

// Set up a command to display the quests
bot.command('quests', async (ctx) => {
  // Get a list of incomplete quests
  var chatID = ctx.message.chat.id

  var questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
  await questsDB.load()

  var quests = await questsDB.get('').filter(quest => quest.status === 'ongoing')

  // Create a table header
  ui.getQuestsTable(quests,chatID).then((path) => {
    //send the image
    ctx.replyWithPhoto({ source: fs.createReadStream(path) });
  });
  return;
});

