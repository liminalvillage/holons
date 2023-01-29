import { Markup } from 'telegraf';
import ngeohash from 'ngeohash'

// HANDLES REQUESTS ====================================================

export function request (ctx) {
    // Extract request from command argument
    var request = {
      title: ctx.message.text.split(' ').slice(1).join(' '),
      requester: ctx.message.sender,
      geohash: ngeohash.encode(ctx.location.latitude, ctx.location.longitude),
      status: 'requested'
    } 
    // Add request to map and set status to unclaimed
    requestsDB.put(request);
    // Respond to user
    ctx.reply(`${ctx.from.username} request for "${request}" has been added to the list.`);
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
  
export function requests(ctx) {
    // Print list of unfulfilled requests
    requestsDB.query()
    ctx.reply(`Here is a list of unfulfilled requests: ${[...requests.entries()].filter(([request, status]) => status === 'unclaimed').map(([request]) => request).join(', ')}`);
  }
  
const requestmarkup = Markup.inlineKeyboard([[
    Markup.button.locationRequest('Geolocate Request')
  ], [
    Markup.button.callback('❌ Cancel', 'cancel_request'),
    Markup.button.callback('✔️ Complete', 'complete_request')
  ]]
  )

  
  //====================================================