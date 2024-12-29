import h3 from 'h3-js';
import './node_modules/gun/lib/then.js';
import offerschema from './schemas/offers_wants_schema-v0.0.2.json' assert { type: "json" };
import holonsschema from './schemas/holons_schema-v0.0.1.json' assert { type: "json" };
import { createHash } from "crypto";
import { markAsUntransferable } from 'worker_threads';
import { parse } from 'path';


var p = { "linked_schemas": ["offers_wants-v0.0.2"], "profile_url": "https:\/\/hamlets.communityforge.net\/ad\/150\/murmurations.json", "primary_url": "https:\/\/hamlets.communityforge.net", "geolocation": { "lat": 46.8145624, "lon": 8.239973599999999 }, "country": "CH", "title": "A traditional stress-tested dolly from the orient.", "description": "\u003Cp\u003E\u003Cstrong\u003EDolus euismod \u003C\/strong\u003Ehos luptatum olim paratus similis. Bene gravis in letalis nisl odio pagus qui saluto validus. Abdo antehabeo consectetuer esse exputo os similis voco. Causa ea iaceo incassum macto minim nibh ratis sed. Humo macto nutus populus tum utrum velit vero vulputate zelus.\u003C\/p\u003E\r\n\r\n\u003Cp\u003EBlandit feugiat macto quibus. Elit macto mauris nobis nostrud patria secundum te venio. Commoveo interdico mos neque pagus paulatim scisco. Aliquam diam esse iriure jus magna quibus utrum vindico. Abbas adipiscing at distineo iustum olim velit.\u003C\/p\u003E", "exchange_type": "want", "item_type": "service", "transaction_type": ["receive-donate", "borrow-lend"], "geographic_scope": "local", "expires_at": 1702422000, "tags": ["Business Services \u0026 Clerical"], "contact_details": { "contact_form": "https:\/\/hamlets.communityforge.net\/user\/28\/contact" } }
var holon = {
    "linked_schemas": ["holons_schema-v0.0.1"],
    "version": "0.1",
    "name": "Crypto Commons 2",
    "primary_url": "https://www.crypto-commons.org/",
    "image": "https://raw.githubusercontent.com/CryptoCommons/holons/main/ccg.png",
    "eth-address": "",
    "xdai-address": "",
    "paypal-address": "",
    "keywords": "",
    "geolocation": { "lat": 47.7062234, "lon": 15.8101491 },
    "holons":
        [
            { "id": "gatherings", "label": "Gatherings" },
            { "id": "projects", "label": "Projects" },
            { "id": "people", "label": "People" },
            { "id": "locations", "label": "Locations" },
            { "id": "values", "label": "Values" }
        ],
    "offers":
        [
            { "id": "research", "label": "Research positions", "value": "3" }
        ],
    "wants":
        [
            { "id": "zucchini", "label": "Zucchini", "value": "5" }
        ]
}
// WRAPPER CLASS FOR HOLOSPHERE
class H3 {
    constructor(bot, db, settings) {
        this.db = db
        this.holosphere = db.holosphere
        this.settings = settings
        this.bot = bot

        this.bot.command('get', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const tag = ctx.message.text.split(' ')[1];
            if (!tag) {
                return ctx.reply('Please specify a tag.');
            }
            let hex = (await this.settings.getSettings(chatID)).hex

            let data = await this.holosphere.get(hex, tag)
            ctx.reply(JSON.stringify(data, null, 2))

        })

        this.bot.command('compute', async (ctx) => {
            const chatID = ctx.message.chat.id;
            let operation = ctx.message.text.split(' ')[1];
            if (operation != 'sum') {
                ctx.reply('Operation not implemented')
                return
            }
            let lense = ctx.message.text.split(' ')[2]
            if (!lense) {
                ctx.reply('Please specify a lense where to perform the operation ')
                return
            }
            let hex = (await this.settings.getSettings(chatID)).hex
            await this.holosphere.compute(hex, lense, operation)
        })

        this.bot.command('cast', async (ctx) => {
            if (!ctx.message.reply_to_message) {
                return ctx.reply('Please reply to a message you want to cast.');
            }
            const tags = ctx.message.text.split(' ').slice(1);
            if (tags.length === 0) {
                return ctx.reply('Please provide at least one tag.');
            }

            const messageID = ctx.message.reply_to_message.message_id;
            const chatID = ctx.message.chat.id;
            const messageContent = ctx.message.reply_to_message.text;
            let settings = await this.settings.getSettings(chatID)
            let id = settings.hex ? settings.hex : 'Hex not set, use /setHex'
            // fetch the stored node

            let node = await this.holosphere.getNode(chatID, 'quests', messageID)
            console.log(node)

            // if (!node) {
            //     node = await this.holosphere.gun.get(chatID + '/' + messageID).put({ id: chatID + '/' + messageID, content: messageContent })
            // }

            //for (let tag of tags) {

            this.holosphere.upcast(id, 'quests', node)
            //}
        })

        this.bot.command('publish', async (ctx) => {
            if (!ctx.message.reply_to_message) {
                return ctx.reply('Please reply to a message you want to tag.');
            }
            const tags = ctx.message.text.split(' ').slice(1);
            if (tags.length === 0) {
                return ctx.reply('Please provide at least one tag.');
            }

            const messageID = ctx.message.reply_to_message.message_id;
            const chatID = ctx.message.chat.id;

            let node = this.holosphere.getNode(chatID, 'quests', messageID) //TODO: change to any lens type
            let soul = this.findSoul(node)
            console.log('node soul: ', soul)

            let settings = await this.settings.getSettings(chatID)
            let hex = settings.hex

            await this.holosphere.putNode(hex, "quests", messageID, soul)

            // for (let tag of tags) {
            //     await this.holosphere.putNode(hex, tag, messageID, node )
            // }
            let refetched = await this.holosphere.get(hex, 'quests', this.findSoul(node))
            console.log('refteched attempt: ', refetched)

            ctx.reply('Tag published to hex ' + hex);
        });

    }

    findSoul(gunRef) {

        // Method 1: Direct soul
        if (gunRef._ && gunRef._['#']) {
            return gunRef._['#']
        }

        // Method 2: Back reference
        if (gunRef._.back && gunRef._.back.link) {
            return gunRef._.back.link;
        }

        // Method 4: Check back chain
        let back = gunRef._.back;
        let backChain = [];
        while (back) {
            if (back.get) backChain.push(back.get);
            if (back.link) backChain.push(back.link);
            back = back.back;
        }
        if (backChain.length > 0) {
            //reverse the backchain
            backChain = backChain.reverse()
            //chain the backchain into a string
            let soul = backChain.join('/')
            soul += '/' + gunRef._.get
            return soul
        }
        else return null

    }

}

export default H3;

// let db = new DB('WeQuestDebug')
// await db.init()

// let hexamap = new H3(new Telegraf(process.env.TELEGRAM), db);
// //let base = '801ffffffffffff'// await hexamap.getHex(40.689167, -74.044444,14); europe
// let base = '891e850d50fffff' // liminal
// // console.log('Base:',base)
// //hexamap.upcast('8c1e8509911e3ff', 'test', 'this is a test')

// // hexamap.get(null,'801ffffffffffff', 'test')
// //await hexamap.cleartag('801ffffffffffff', 'offer')
// //db.gun.get('message').get('schema').put(JSON.stringify({ type: 'object', properties: { content: { type: 'string' } }, required: ['content'] }))
// //db.gun.get('offer').get('schema').put(JSON.stringify(offerschema), async ack => {
// //await hexamap.put('801ffffffffffff', 'message', { content: 'this is a put test2' })
// //console.log(await hexamap.get('801ffffffffffff', 'message'))
// //})
// // await hexamap.setSchema('holons', holonsschema)
// // await hexamap.setSchema('offers', offerschema)
// // await hexamap.put(base, 'holons', holon)
// // console.log(await hexamap.get(base, 'holons'))
// // db.gun.get('settings').put({ hex: base })
// // db.gun.get('settings').once(console.log)
// // await hexamap.put(base, 'message', { content: 'hello world' })
// // console.log(await hexamap.get(base, 'message'))
// hexamap.upcast(base, 'message',  { content: 'hello world wise web' })
// let scalespace = hexamap.getHexScalespace(base)
// for (let i = 0; i < scalespace.length; i++) {
//     console.log(await hexamap.get(scalespace[i], 'message'))
// }

// //hexamap.compute('sum', 'test', '801ffffffffffff')

// //  //await hexamap.put (base, "link", "https://www.youtube.com/watch?v=Qq2XsYX6k3I")
// //  console.log(await hexamap.get(base, "gibberish"))

// //hexamap.upcast(base, "thoughts", "i am thinking about climate change")

// //hexamap.updateParent(base, "i am thinking about climate change")
// //hexamap.getChildSummary(base)
// //hexamap.askQuestion("What is the meaning of life?", "802bfffffffffff");
// //console.log(hexamap.getScalespace(40.689167, -74.044444));