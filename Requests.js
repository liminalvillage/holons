import { Markup } from 'telegraf';

import Validator from 'jsonschema';
import schema from './schemas/offers_wants_prototype-v0.0.2.json' with { type: "json" };
var v = new Validator.Validator();

var p = {"linked_schemas":["offers_wants_prototype-v0.0.2"],"profile_url":"https:\/\/hamlets.communityforge.net\/ad\/150\/murmurations.json","primary_url":"https:\/\/hamlets.communityforge.net","geolocation":{"lat":46.8145624,"lon":8.239973599999999},"country":"CH","title":"A traditional stress-tested dolly from the orient.","description":"\u003Cp\u003E\u003Cstrong\u003EDolus euismod \u003C\/strong\u003Ehos luptatum olim paratus similis. Bene gravis in letalis nisl odio pagus qui saluto validus. Abdo antehabeo consectetuer esse exputo os similis voco. Causa ea iaceo incassum macto minim nibh ratis sed. Humo macto nutus populus tum utrum velit vero vulputate zelus.\u003C\/p\u003E\r\n\r\n\u003Cp\u003EBlandit feugiat macto quibus. Elit macto mauris nobis nostrud patria secundum te venio. Commoveo interdico mos neque pagus paulatim scisco. Aliquam diam esse iriure jus magna quibus utrum vindico. Abbas adipiscing at distineo iustum olim velit.\u003C\/p\u003E","exchange_type":"want","item_type":"service","transaction_type":["receive-donate","borrow-lend"],"geographic_scope":"local","expires_at":1702422000,"tags":["Business Services \u0026 Clerical"],"contact_details":{"contact_form":"https:\/\/hamlets.communityforge.net\/user\/28\/contact"}}

//V ALIDATION ==========================================================
//console.log(v.validate(p, schema));

// HANDLES REQUESTS ====================================================

class Request {
    constructor(bot, db){
        this.bot = bot;
        this.db = db;
        
        bot.action('OFFER', async (ctx) => {
          let holonId = ctx.message.chat.id;
          let offer = await this.db.get(holonId + '/offers', ctx.message.message_id)
          offer['exchange_type'] = 'offer';
          await this.db.put(holonId + '/offers', offer)
          ctx.editMessageText('You chose: Offer. What\'s next?', getKeyboard(offer));
        });
        
        bot.action('WANT', (ctx) => {
          offer['exchange_type'] = 'want';
          ctx.editMessageText('You chose: Want. What\'s next?', getKeyboard(offer));
        });
        
        bot.action('GOOD', (ctx) => {
          offer['item_type'] = 'good';
          ctx.editMessageText('You chose: Good. What\'s next?', getKeyboard(offer));
        });
        
        bot.action('SERVICE', (ctx) => {
          offer['item_type'] = 'service';
          ctx.editMessageText('You chose: Service. What\'s next?', getKeyboard(offer));
        });
        

    bot.action('BORROW_LEND', (ctx) => {
        offer['transaction_type'] = 'borrow-lend';
        ctx.editMessageText('You chose: Borrow/Lend. What\'s next?', getKeyboard(offer));
      });
      
      bot.action('RENT_LEASE', (ctx) => {
        offer['transaction_type'] = 'rent-lease';
        ctx.editMessageText('You chose: Rent/Lease. What\'s next?', getKeyboard(offer));
      });
      
      bot.action('BUY_SELL', (ctx) => {
        offer['transaction_type'] = 'buy-sell';
        ctx.editMessageText('You chose: Buy/Sell. What\'s next?', getKeyboard(offer));
      });
      
      bot.action('RECEIVE_DONATE', (ctx) => {
        offer['transaction_type'] = 'receive-donate';
        ctx.editMessageText('You chose: Receive/Donate. What\'s next?', getKeyboard(offer));
      });
      
      bot.action('LOCAL', (ctx) => {
        offer['geographic_scope'] = 'local';
        ctx.editMessageText('You chose: Local. What\'s next?', getKeyboard(offer));
      });
      
      bot.action('REGIONAL', (ctx) => {
        
        offer['geographic_scope'] = 'regional';
        ctx.editMessageText('You chose: Regional. What\'s next?', getKeyboard(offer));
      });
      
      bot.action('NATIONAL', (ctx) => {
        offer['geographic_scope'] = 'national';
        ctx.editMessageText('You chose: National. What\'s next?', getKeyboard(offer));
      });
      
      bot.action('INTERNATIONAL', (ctx) => {
        offer['geographic_scope'] = 'international';
        ctx.editMessageText('You chose: International. What\'s next?', getKeyboard(offer));
      });

    }

     getKeyboard = (offer) => {
        return Markup.inlineKeyboard([
          [
            Markup.callbackButton(offer['exchange_type'] === 'offer' ? '(selected) Offer' : 'Offer', 'OFFER'),
            Markup.callbackButton(offer['exchange_type'] === 'want' ? '(selected) Want' : 'Want', 'WANT')
          ],
          [
            Markup.callbackButton(offer['item_type'] === 'good' ? '(selected) Good' : 'Good', 'GOOD'),
            Markup.callbackButton(offer['item_type'] === 'service' ? '(selected) Service' : 'Service', 'SERVICE')
          ],
          [
            Markup.callbackButton(offer['transaction_type'] === 'borrow-lend' ? '(selected) Borrow/Lend' : 'Borrow/Lend', 'BORROW_LEND'),
            Markup.callbackButton(offer['transaction_type'] === 'rent-lease' ? '(selected) Rent/Lease' : 'Rent/Lease', 'RENT_LEASE'),
            Markup.callbackButton(offer['transaction_type'] === 'buy-sell' ? '(selected) Buy/Sell' : 'Buy/Sell', 'BUY_SELL'),
            Markup.callbackButton(offer['transaction_type'] === 'receive-donate' ? '(selected) Receive/Donate' : 'Receive/Donate', 'RECEIVE_DONATE')
          ],
          [
            Markup.callbackButton(offer['geographic_scope'] === 'local' ? '(selected) Local' : 'Local', 'LOCAL'),
            Markup.callbackButton(offer['geographic_scope'] === 'regional' ? '(selected) Regional' : 'Regional', 'REGIONAL'),
            Markup.callbackButton(offer['geographic_scope'] === 'national' ? '(selected) National' : 'National', 'NATIONAL'),
            Markup.callbackButton(offer['geographic_scope'] === 'international' ? '(selected) International' : 'International', 'INTERNATIONAL')
          ]
        ]).extra();
      };
}


export async function request(type, ctx, db) {
    // Extract request from command argument
  
    let holonId = ctx.message.chat.id;
    let messageID = ctx.message.message_id;
    const text = ctx.message.text;
    const sender = ctx.from;

    // Respond to user
    let request = {
        id: ctx.message.message_id,
        title: ctx.message.text.split(' ').slice(1).join(' '),
        requester: sender,
        type: type,
        //geohash: ngeohash.encode(ctx.location.latitude, ctx.location.longitude),
        status: 'requested'
    }
    ctx.reply(`${ctx.from.username}'s ${type} for "${request.title}" has been added to the list.`) 

    ctx.reply(createMessage(request), markup).then((ctx) => {
        // Add the message id to the quest
        request.id = ctx.message_id;
        this.db.put(holonId + '/offers',request)
    });
}

export async function offer(ctx, db) {
    // Extract request from command argument
  
    let holonId = ctx.message.chat.id;
    let messageID = ctx.message.message_id;
    const text = ctx.message.text;
    const sender = ctx.from;

  // Respond to user
    let request = {
        id: ctx.message.message_id,
        title: ctx.message.text.split(' ').slice(1).join(' '),
        requester: sender,
        geohash: ngeohash.encode(ctx.location.latitude, ctx.location.longitude),
        status: 'offered'
    }
    ctx.reply(`${ctx.from.username}'s request for "${request.title}" has been added to the list.`) 

    ctx.reply(createMessage(request), createProperties()).then((ctx) => {
        // Add the message id to the quest
        request.id = ctx.message_id;
        this.db.put(holonId + '/offers',request)
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

export async function requests(ctx, db) {
    let holonId = ctx.message.chat.id;
    let messageID = ctx.message.message_id;
    // Print list of unfulfilled requests
    let requests = this.db.getAll(holonId + '/offers')
    let message = 'Here are the currently open requests:\n';
    ctx.reply(message, createButtons(requests));
}

function createButtons(requests){
    let buttons = []
    requests.forEach((request) => {
        buttons.push([Markup.button.callback(request.title, 'https://t.me/Bot?quests='+request.id), Markup.button.callback("Claim", 'claim_' + request.id)])
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
    


    