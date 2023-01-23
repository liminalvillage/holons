import { Telegraf, Markup } from 'telegraf';
const bot = new Telegraf("5575748116:AAHvq0C0f3AmSKXmd-7AbUF9ZUjnIrFK-0k");

import fs from 'fs';
import * as ui from './interface.cjs';

import { create } from 'ipfs'
import OrbitDB from 'orbit-db'
import { ConsoleMessage } from 'puppeteer-core';

bot.use(Telegraf.log())

var orbitdb
var tasksdb
var usersdb

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

  tasksdb = await orbitdb.keyvalue('WeQuest.tasks', options)
  usersdb = await orbitdb.keyvalue('WeQuest.users', options)
  await tasksdb.load()
  await usersdb.load()
  console.log('TASKSDATABASE ADDRESS:' + tasksdb.address.toString())
  console.log('USERSDATABASE ADDRESS:' + usersdb.address.toString())

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
  Markup.button.callback('👍 Approve', 'approve_task')
], [
  Markup.button.callback('❌ Cancel', 'cancel_task'),
  Markup.button.callback('✔️ Complete', 'complete_task')
]]
)

// ACTIONS ====================================================
bot.action('join_task', ctx => {
  console.log("JOIN ACTION");
  // Get the task index from the callback data
  // const taskIndex = taskmap.get(ctx.callbackQuery.message.message_id);
  // // Get the task object
  // const task = tasks[taskIndex];
  const ID = ctx.callbackQuery.message.id;
  var task = tasksdb.get(ID)
  if (!task) return;

  // Get the user who reacted
  const user = ctx.from;

  // Check if the user has already joined the task
  if (task.users.find(user => user.id === ctx.from.id)) {
    ctx.reply(`${user.first_name}, you have already joined the task "${task.task}"`);
    return;
  }
  // Add the user to the task
  task.users.push(user);

  // Update the message 
  updateTaskMessage(ctx, task);

  // Update the db
  tasksdb.set(ID, task);

  // Send a message to confirm that the user joined the task
  ctx.reply(`${user.first_name} has joined the task "${task.task}"`);


});

bot.action('approve_task', async (ctx) => {
  console.log("APPROVE ACTION");
  // Get the task  from the callback data
  const ID = ctx.callbackQuery.message.message_id
  var task = tasksdb.get(ID)
  if (!task) return;

  // Get the user who sent the credit
  const sender = ctx.from;
  // Check if the user has already approved the task
  if (task.approved.find(user => user.id === sender.id)) {
    ctx.reply(`${sender.first_name}, you have already approved the task "${task.task}"`);
    return;
  }
  // Check if the user is the task submitter
  // if (user.id === task.users[0].id) {
  //   ctx.reply(`${user.first_name}, you cannot approve your own tasks! "${task.task}"`);
  //   return;
  // }
  // Add the user to the task
  task.approved.push(sender);

  // Update the db
  tasksdb.set(ID, task);


  // Set up a function to handle the send credit action
  // Initialize the user's points if they do not exist yet
  var sendercredits = await usersdb.get(sender.id)
  // Initialize the user's points if they do not exist yet
  if (!sendercredits) {
    sendercredits = {
      username: sender.username,
      received: 0,
      sent: 0,
      credits: 0,
    }
  }
  // Update the sent credits of the sender
  usersdb.set(sender.id, {
    username: sendercredits.username,
    received: sendercredits.received,
    sent: (sendercredits.sent + 1),
    credits: 0,
  })

  // // Check if the user has enough credits to send
  // if (points[user.id].credits < 1) {
  //   ctx.reply('You do not have enough credits to send');
  //   return;
  // }

  // Calculate the number of credits to send to each user
  const creditsPerUser = 1 / task.users.length;

  for (let i = 0; i < task.users.length; i++) {
    // Get the recipient
    const recipient = task.users[i];
    // // Check if the recipient is the sender
    // if (recipient.id === sender.id ) {
    //   continue;
    // }
    // Send the credits to each user
    var recipientcredits = await usersdb.get(recipient.id)
      // Initialize the receiver's points if they do not exist yet
      if (!recipientcredits) {
        recipientcredits = {
          username: recipient.username,
          received: 0,
          sent: 0,
          credits: 0
        }
      }
     
      // Add the received credits to the recipient
      usersdb.set(recipient.id, {
        username: recipientcredits.username,
        received: (recipientcredits.received + creditsPerUser),
        sent: recipientcredits.sent ,
        credits: recipientcredits.credits 
      })
  }
  
  var chatID = await ctx.callbackQuery.message.chat.id;
  var userlist = await usersdb.get(chatID)
  if (!userlist) {
    userlist = []
  }
  if (!userlist.includes(sender.id)) {
    userlist.push(sender.id)
  }
 
  usersdb.set(chatID, userlist)

  // Update the message 
  updateTaskMessage(ctx, task);
  // Send a message to confirm that the credits were sent
  ctx.reply(`${sender.first_name} has sent ${creditsPerUser} credits to each user participating the task "${task.task}"`);
});

bot.action('cancel_task', ctx => {
  console.log("CANCEL ACTION");
  // // Get the task index from the callback data
  // const taskIndex = taskmap.get(ctx.callbackQuery.message.message_id);
  // // Get the task object
  // const task = tasks[taskIndex];
  const ID = ctx.callbackQuery.message.message_id;
  var task = tasksdb.get(ID)
  if (!task) return;

  if (task.users[0].id === ctx.from.id) {
    task.status = "cancelled";
    // Update the message 
    updateTaskMessage(ctx, task);

    // Update the db
    tasksdb.set(ID, task);

  } else {
    ctx.reply(`Only the creator of the task can cancel it.`);
  }
});

bot.action('complete_task', async (ctx) => {
  console.log("COMPLETE ACTION");
  // // Get the task index from the callback data
  // console.log(ctx)
  // const taskIndex = taskmap.get(ctx.callbackQuery.message.message_id);
  // // Get the task object
  // const task = tasks[taskIndex];
  var chatID =  ctx.callbackQuery.message.chat.id;
  var messageID = ctx.callbackQuery.message.message_id;

  var tasksdb = await orbitdb.docs(chatID.toString(),{ indexBy: '_id' })
  await tasksdb.load()

  //var task = await tasksdb.query(task => task._id == messageID)
  var task = await tasksdb.get(messageID)
  console.log('=============s' +chatID + ' ' + messageID+ ' ' + task)
  if (!task || task =='') return;

 

  // Handle the reaction to the task
  if (task.users[0].id === ctx.from.id) {
    task.status = "completed";
    // Update the message 
    updateTaskMessage(ctx, task);

    // Update the db
    tasksdb.put(task);

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
  var chatID =  ctx.message.chat.id;
  tasksdb.set(chatID, [])
  usersdb.set(chatID, [])
  usersdb.set(ctx.from.id, '')
  tasksdb.set(ctx.from.id, '')
  ctx.reply('Bot resetted')
})

// Create a new task
bot.command('task', async (ctx) => {
  // Get the message text and sender from the context

  var chatID =  ctx.message.chat.id;
  var messageID = ctx.message.message_id;
  const text = ctx.message.text;
  const sender = ctx.from;

  var tasksdb = await orbitdb.docs(chatID.toString(), { indexBy: '_id' })
  await tasksdb.load()

  const task = text.split(' ').slice(1).join(' ');

  if (!task) {
    ctx.reply('Please enter a task as part of the command. Example: /task Do the dishes');
    return;
  }

  // Create a task object
  var taskObj = {
    _id : messageID.toString(),
    task: task,
    date: new Date().getTime(),
    users: [],
    approved: [],
    status: 'ongoing'
  }
  taskObj.users.push(sender);

  // Add the task to the list of tasks
   tasksdb.put(taskObj);


  // // Add the sender to the list of users
  // tasks[tasks.length - 1].users.push(sender);

  ctx.reply(createTaskMessage(taskObj), markup).then((msg) => {
    //taskmap.set(msg.message_id, tasks.length - 1);
    //tasksdb.set(msg.message_id, taskObj)
    //tasksdb.set(ctx.chat.id, msg.message_id)
  });
});

// Function to create the message for a task TODO 
function createTaskMessage(task) {
  let message = `Task: ${task.task}\n`;
  message += `Created by: ${task.users[0].username}\n`;
  message += `Joined by: ${[...task.users].slice(1).map(u => u.username).join(', ')}\n`;
  message += `Approved by: ${[...task.approved].map(u => u.username).join(', ')}\n`;
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

//=========== LIST COMMANDS ===============

//Set up a command to display the credits for each user
bot.command('credits', ctx => {
  var chatID =  ctx.message.chat.id;
  console.log('CID' + chatID)
  var userlist =  usersdb.get(chatID)
  // loop through the userlist and get the tasks
  var credits = []
  if(userlist) {
  for (let i = 0; i < userlist.length; i++) {
     credits.push( usersdb.get(userlist[i]))
  }
  }
  // Create a table header
  ui.generateCreditsTable(credits).then((path) => {
    //send the image
    ctx.replyWithPhoto({ source: fs.createReadStream(path) });
  });
  return;
})

// Set up a command to display the tasks
bot.command('tasks', async (ctx) => {
  // Get a list of incomplete tasks
  var chatID =  ctx.message.chat.id;
  console.log('CID' + chatID)
  // loop through the userlist and get the tasks
  var tasksdb = await orbitdb.docs(chatID.toString(), { indexBy: '_id' })
  await tasksdb.load()

  var tasks = await tasksdb.get('').filter(task => task.status === 'ongoing')
    
  console.log ('tasks:'+ JSON.stringify(tasks[0])) // if(userlist) {
  // for (let i = 0; i < userlist.length; i++) {
 
  //tasks = tasks.filter(task => task.status === 'ongoing')
  
  //tasks = tasks.filter(task => task.status === 'ongoing')
  // }

  //tasks = tasksdb.get(ctx.chat.id).filter(task => task.status === 'ongoing')
  // Create a table header
  ui.generateTaskTable(tasks).then((path) => {
    //send the image
    ctx.replyWithPhoto({ source: fs.createReadStream(path) });
  });
  return;
});

