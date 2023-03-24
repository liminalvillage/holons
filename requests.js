import { Markup } from 'telegraf';
import ngeohash from 'ngeohash'

import Validator from 'jsonschema';
import schema from './schemas/offers_wants_prototype-v0.0.2.json' assert { type: "json" };
var v = new Validator.Validator();

// Address, to be embedded on Person
var addressSchema = {
  "id": "/SimpleAddress",
  "type": "object",
  "properties": {
    "lines": {
      "type": "array",
      "items": {"type": "string"}
    },
    "zip": {"type": "string"},
    "city": {"type": "string"},
    "country": {"type": "string"}
  },
  "required": ["country"]
};

// Person
// var schema = {
//   "id": "/SimplePerson",
//   "type": "object",
//   "properties": {
//     "name": {"type": "string"},
//     "address": {"$ref": "/SimpleAddress"},
//     "votes": {"type": "integer", "minimum": 1}
//   }
// };

// var p = {
//   "name": "Barack Obama",
//   "address": {
//     "lines": [ "1600 Pennsylvania Avenue Northwest" ],
//     "zip": "DC 20500",
//     "city": "Washington",
//     "country": "USA"
//   },
//   "votes": "lots"
// };

var p = {"linked_schemas":["offers_wants_prototype-v0.0.2"],"profile_url":"https:\/\/hamlets.communityforge.net\/ad\/150\/murmurations.json","primary_url":"https:\/\/hamlets.communityforge.net","geolocation":{"lat":46.8145624,"lon":8.239973599999999},"country":"CH","title":"A traditional stress-tested dolly from the orient.","description":"\u003Cp\u003E\u003Cstrong\u003EDolus euismod \u003C\/strong\u003Ehos luptatum olim paratus similis. Bene gravis in letalis nisl odio pagus qui saluto validus. Abdo antehabeo consectetuer esse exputo os similis voco. Causa ea iaceo incassum macto minim nibh ratis sed. Humo macto nutus populus tum utrum velit vero vulputate zelus.\u003C\/p\u003E\r\n\r\n\u003Cp\u003EBlandit feugiat macto quibus. Elit macto mauris nobis nostrud patria secundum te venio. Commoveo interdico mos neque pagus paulatim scisco. Aliquam diam esse iriure jus magna quibus utrum vindico. Abbas adipiscing at distineo iustum olim velit.\u003C\/p\u003E","exchange_type":"want","item_type":"service","transaction_type":["receive-donate","borrow-lend"],"geographic_scope":"local","expires_at":1702422000,"tags":["Business Services \u0026 Clerical"],"contact_details":{"contact_form":"https:\/\/hamlets.communityforge.net\/user\/28\/contact"}}

//v.addSchema(addressSchema, '/SimpleAddress');
console.log(v.validate(p, schema));

// HANDLES REQUESTS ====================================================

export async function request(type, ctx, orbitdb) {
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
        type: type,
        //geohash: ngeohash.encode(ctx.location.latitude, ctx.location.longitude),
        status: 'requested'
    }
    ctx.reply(`${ctx.from.username}'s ${type} for "${request.title}" has been added to the list.`) 

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

    ctx.reply(createMessage(request), createProperties()).then((ctx) => {
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
]
]
)


  //====================================================


  // Function to create the message for a quest TODO 
function createMessage(request) {
    let message = `Request: ${request.title}\n`;
    message += `by: ${request.requester.first_name}\n`;
    message += `Status: ${request.status}\n`;
    return message;
}

// create buttons for each field of the schema
function createProperties( ){
    let buttons = []
    Object.keys(schema.properties).forEach((key) => {
        buttons.push([Markup.button.callback(key, 'https://t.me/Bot?quests='+key), Markup.button.callback("Claim", 'claim_' + key)])
    })
    return Markup.inlineKeyboard(buttons)
}
    


    