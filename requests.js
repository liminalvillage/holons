import { Markup } from 'telegraf';
import ngeohash from 'ngeohash'

// HANDLES REQUESTS ====================================================

export async function request(ctx, orbitdb) {
    // Extract request from command argument
  
    let chatID = ctx.message.chat.id;
    let messageID = ctx.message.message_id;
    const text = ctx.message.text;
    const sender = ctx.from;

    let requestsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.requests')
    await requestsDB.load()

    // Respond to user
    let request = {
        _id: ctx.message.message_id,
        title: ctx.message.text.split(' ').slice(1).join(' '),
        requester: sender,
        geohash: ngeohash.encode(ctx.location.latitude, ctx.location.longitude),
        status: 'requested'
    }
    ctx.reply(`${ctx.from.username}'s request for "${request.title}" has been added to the list.`) 

    ctx.reply(createMessage(request), markup).then((ctx) => {
        // Add the message id to the quest
        request._id = ctx.message_id;
        requestsDB.put(request)
    });
}
export async function offer(ctx, orbitdb) {
    // Extract request from command argument
  
    let chatID = ctx.message.chat.id;
    let messageID = ctx.message.message_id;
    const text = ctx.message.text;
    const sender = ctx.from;

    let requestsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.requests')
    await requestsDB.load()

    // Respond to user
    let request = {
        _id: ctx.message.message_id,
        title: ctx.message.text.split(' ').slice(1).join(' '),
        requester: sender,
        geohash: ngeohash.encode(ctx.location.latitude, ctx.location.longitude),
        status: 'offered'
    }
    ctx.reply(`${ctx.from.username}'s request for "${request.title}" has been added to the list.`) 

    ctx.reply(createMessage(request), markup).then((ctx) => {
        // Add the message id to the quest
        request._id = ctx.message_id;
        requestsDB.put(request)
    });
   

}

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

export async function requests(ctx, orbitdb) {
    let chatID = ctx.message.chat.id;
    let messageID = ctx.message.message_id;
    // Print list of unfulfilled requests
    const requestsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.requests')
    await requestsDB.load()
    let requests = requestsDB.get('')
    console.log(requests)
    let message = 'Here are the currently open requests:\n';
    ctx.reply(message, createButtons(requests));
}

function createButtons(requests){
    let buttons = []
    requests.forEach((request) => {
        buttons.push([Markup.button.callback(request.title, 'https://t.me/Bot?quests='+request._id), Markup.button.callback("Claim", 'claim_' + request._id)])
    })
    return Markup.inlineKeyboard(buttons)
}

const markup = Markup.inlineKeyboard([[
    Markup.button.locationRequest('Geolocate Request', {requestLocation: true})
], [
    Markup.button.callback('❌ Cancel', 'cancel_request'),
    Markup.button.callback('✔️ Complete', 'complete_request')
]]
)


  //====================================================


  // Function to create the message for a quest TODO 
function createMessage(request) {
    let message = `Request: ${request.title}\n`;
    message += `by: ${request.requester.first_name}\n`;
    message += `Status: ${request.status}\n`;
    return message;
}



    