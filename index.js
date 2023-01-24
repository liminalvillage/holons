import { Telegraf, Markup } from 'telegraf';
const bot = new Telegraf("5575748116:AAHvq0C0f3AmSKXmd-7AbUF9ZUjnIrFK-0k");

import fs from 'fs';
import * as ui from './interface.cjs';

import { create } from 'ipfs'
import OrbitDB from 'orbit-db'

bot.use(Telegraf.log())

var orbitdb

async function init() {

  // const ipfs = await create({ address:"127.0.0.1", port: 5002, source: 'js-ipfs', repo: 'ipfs-' + Math.random()})
  const ipfs = await create()
  orbitdb = await OrbitDB.createInstance(ipfs)
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

  bot.start((ctx) => ctx.reply('Hello!'))
  bot.help((ctx) => ctx.reply('WeQuest can help your communities organize around tasks and to exchange goods and services with each other! click on the menu to see the available options.'))
  bot.launch();
}

init();

// HANDLES REQUESTS ====================================================

bot.command('request', (ctx) => {
  // Extract request from command argument
  const request = ctx.message.text.split(' ').slice(1).join(' ');
  // Add request to map and set status to unclaimed
  requests.set(request, 'unclaimed');
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
  Markup.button.callback('❤️ Join', 'join_task'),
  Markup.button.callback('👍 Validate', 'validate_task')
], [
  Markup.button.callback('❌ Cancel', 'cancel_task'),
  Markup.button.callback('✔️ Complete', 'complete_task')
]]
)

// ACTIONS ====================================================
bot.action('join_task', async ctx => {
  console.log("JOIN ACTION");
  // Get the index from the callback data
  var chatID = ctx.callbackQuery.message.chat.id;
  var messageID = ctx.callbackQuery.message.message_id;

  var tasksDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.tasks')
  await tasksDB.load()

  var task = await tasksDB.get(messageID.toString())[0]

  if (!task || task == '') { console.log('TASK IS NOT FOUND'); return }

  if (task.status == 'completed') {
    ctx.reply(`Task "${task.task}" has already been completed`);
    return;
  }

  // Get the user who reacted
  const sender = ctx.from;

  // Check if the user has already joined the task
  if (task.users.find(user => user.id === sender.id)) {
    ctx.reply(`${sender.first_name}, you have already joined the task "${task.task}"`);
    return;
  }
  // Add the user to the task
  task.users.push(sender);

  // Update the message 
  updateTaskMessage(ctx, task);

  // Update the db
  tasksDB.put(task);

  // Send a message to confirm that the user joined the task
  ctx.reply(`${sender.first_name} has joined the task "${task.task}"`);


});

bot.action('validate_task', async (ctx) => {
  console.log("validate ACTION");
  // Get the task  from the callback data
  var chatID = ctx.callbackQuery.message.chat.id;
  var messageID = ctx.callbackQuery.message.message_id;

  var tasksDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.tasks')
  await tasksDB.load()

  var task = await tasksDB.get(messageID.toString())[0]

  if (!task || task == '') { console.log('TASK IS NOT FOUND'); return }

  // Get the user who sent the credit
  const sender = ctx.from;
  // Check if the user has already validated the task
  if (task.validated.find(user => user.id === sender.id)) {
    ctx.reply(`${sender.first_name}, you have already validated the task "${task.task}"`);
    return;
  }
  // Check if the user is the task submitter
  // if (sender.id === task.users[0].id) {
  //   ctx.reply(`${user.first_name}, you cannot validate your own tasks! "${task.task}"`);
  //   return;
  // }
  // Add the user to the task
  task.validated.push(sender);

  // Update the db to indicate who validated the task
  tasksDB.put(task);
  // ================================ CREDITS ========================== 
  var creditsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.credits')
  await creditsDB.load()
  var sendercredits = await creditsDB.get(sender.id)[0]
  if (!sendercredits) {
    if (!sendercredits) {
      // Initialize the sender's points if they do not exist yet
      sendercredits = {
        _id: sender.id,
        username: sender.username,
        received: 0,
        sent: 0,
        credits: 0,
      }
    }
  }

  // Update the sent credits of the sender
  sendercredits.sent += 1;
  await creditsDB.put(sendercredits)


  // Calculate the number of credits to send to each user
  const creditsPerUser = 1  // / task.users.length;

  // Send the credits to each user
  for (let i = 0; i < task.users.length; i++) {
    // Get the recipient
    const recipient = task.users[i]
    // // Check if the recipient is the sender
    // if (recipient.id === sender.id ) {
    //   continue;
    // }
    // Send the credits to each user
    var recipientcredits = await creditsDB.get(recipient.id)[0]
    // Initialize the receiver's points if they do not exist yet
    if (!recipientcredits) {
      recipientcredits = {
        _id: recipient.id,
        username: recipient.username,
        received: 0,
        sent: 0,
        credits: 0
      }
    }
    recipientcredits.received += creditsPerUser;
    // Add the received credits to the recipient
    creditsDB.put(recipientcredits)
  }
  // ================================ CREDITS ==========================
  // Update the message 
  updateTaskMessage(ctx, task);
  // Send a message to confirm that the credits were sent
  ctx.reply(`${sender.first_name} has sent ${creditsPerUser} credits to each user participating the task "${task.task}"`);
});

bot.action('cancel_task', async (ctx) => {
  console.log("CANCEL ACTION");

  var chatID = ctx.callbackQuery.message.chat.id;
  var messageID = ctx.callbackQuery.message.message_id;

  var tasksDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.tasks')
  await tasksDB.load()

  var task = await tasksDB.get(messageID.toString())[0]

  if (!task || task == '') { console.log('TASK IS NOT FOUND'); return }

  // Handle the reaction to the task
  if (task.users[0].id === ctx.from.id) {
    task.status = "cancelled";
    // Update the message 
    updateTaskMessage(ctx, task);
    //delete the db entry
    tasksDB.del(messageID.toString())
    //delete the telegram message
    ctx.deleteMessage(messageID.toString())


  } else {
    ctx.reply(`Only the creator of the task can cancel the task.`);
  }
});


bot.action('complete_task', async (ctx) => {
  console.log("COMPLETE ACTION");

  var chatID = ctx.callbackQuery.message.chat.id;
  var messageID = ctx.callbackQuery.message.message_id;

  var tasksDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.tasks')
  await tasksDB.load()

  var task = await tasksDB.get(messageID.toString())[0]

  if (!task || task == '') { console.log('TASK IS NOT FOUND'); return }

  // Handle the reaction to the task
  if (task.users[0].id === ctx.from.id) {
    task.status = "completed";
    // Update the message 
    updateTaskMessage(ctx, task);

    // Update the db
    tasksDB.put(task);

  } else {
    ctx.reply(`Only the creator of the task can mark it as completed.`);
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

// ================= TASKS ===========================
bot.command('reset', async (ctx) => {
  //TODO; check if the user is an admin
  var chatID = ctx.message.chat.id;
  var tasksDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.tasks')
  var creditsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.credits')
  await tasksDB.drop()
  await creditsDB.drop()
  ctx.reply('Bot resetted')
})

// Create a new task
bot.command('task', async (ctx) => {
  // Get the message text and sender from the context

  var chatID = ctx.message.chat.id;
  var messageID = ctx.message.message_id;
  const text = ctx.message.text;
  const sender = ctx.from;

  var tasksDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.tasks')
  await tasksDB.load()

  const task = text.split(' ').slice(1).join(' ');

  if (!task) {
    ctx.reply('Please enter a task as part of the command. Example: /task Do the dishes');
    return;
  }

  // Create a task object

  var taskObj = {
    _id: '',
    task: task,
    date: new Date().getTime(),
    users: [],
    validated: [],
    status: 'ongoing'
  }
  // // Add the sender to the list of users
  taskObj.users.push(sender);

  // var path = await ui.generateTaskImage(taskObj)
  // ctx.replyWithPhoto({ source: fs.createReadStream(path) },markup).then((ctx) => {
  //     // Add the message id to the task
  //     taskObj._id = ctx.message_id;
  
  //     tasksDB.put(taskObj)
  
  //   }); 
  
  ctx.reply(createTaskMessage(taskObj), markup).then((ctx) => {
    // Add the message id to the task
    taskObj._id = ctx.message_id;

    tasksDB.put(taskObj)

  });
});

// Function to create the message for a task TODO 
function createTaskMessage(task) {
  let message = `Task: ${task.task}\n`;
  message += `Created by: ${task.users[0].first_name}\n`;
  message += `Joined by: ${[...task.users].slice(1).map(u => u.first_name).join(', ')}\n`;
  message += `validated by: ${[...task.validated].map(u => u.first_name).join(', ')}\n`;
  message += `Status: ${task.status}\n`;
  return message;
}
// Function to update messages for a task
async function updateTaskMessage(ctx, task) {
  try {
    // Update the message 
    await ctx.telegram.editMessageText(
      ctx.update.callback_query.message.chat.id,
      ctx.update.callback_query.message.message_id,
      null,
      createTaskMessage(task),
      markup
    );
  } catch (e) {
    console.log(e);
  }
}

// Function to update messages for a task
async function updateTaskImage(ctx, task) {
  try {
    // update the image
    var path = await ui.generateTaskImage(task)
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

//Set up a command to display the credits for each user
bot.command('credits', async ctx => {

  var chatID = ctx.message.chat.id
  // loop through the userlist and get the tasks
  var creditsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.credits')
  await creditsDB.load()

  var credits = await creditsDB.get('')//.filter(task => task.status === 'ongoing')

  // Create a table header
  ui.generateCreditsTable(credits,chatID).then((path) => {
    //send the image
    ctx.replyWithPhoto({ source: fs.createReadStream(path) })
  });
  return;
})

// Set up a command to display the tasks
bot.command('tasks', async (ctx) => {
  // Get a list of incomplete tasks
  var chatID = ctx.message.chat.id

  var tasksDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.tasks')
  await tasksDB.load()

  var tasks = await tasksDB.get('').filter(task => task.status === 'ongoing')

  // Create a table header
  ui.generateTaskTable(tasks,chatID).then((path) => {
    //send the image
    ctx.replyWithPhoto({ source: fs.createReadStream(path) });
  });
  return;
});

