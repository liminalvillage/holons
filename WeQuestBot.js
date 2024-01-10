"use strict"

import 'dotenv/config'

import qrReader from 'qrcode-reader';
import Jimp from 'jimp';
import axios from 'axios';
import sharp from 'sharp';

import * as utils from './utilities.js'

// -------------------------check if lockfile exists and delete i
import fs from 'fs';

if (fs.existsSync('./orbitdb/repo.lock')) {
  fs.rmdirSync('./orbitdb/repo.lock');
}
// --------------------------------------------------------

// ------------------------------------ Import the telegraf module
import { Telegraf, Markup } from 'telegraf';
import { Client, GatewayIntentBits } from 'discord.js';

import DB from "./DB.js";
import UI from './UI.js';
import * as AI from './AI.js';


//import WeQuest Modules
import Holons from './Holons.js';
import Quests from './Quests.js'
import Shopping from './Shopping.js'
import Lunation from "./Lunation.js"
import Onboarding from "./Onboarding.js"
import Expenses from "./Expenses.js"
import Settings from './Settings.js'
import Bigtalk from './Bigtalk.js'
import Library from './Library.js'
import Users from './Users.js'

import * as request from './Requests.js'


class WeQuest {
  constructor() {
    this.db = null;
    this.telebot = null;
    this.settings = null;
    this.ui = null;
    this.lunation = null;
    this.shopping = null;
    this.quests = null;
    this.bigtalk = null;
    this.library = null;
    this.users = null;
    this.expenses = null;
    this.onboarding = null;
    this.holons = null;
  }

  async init() {
    this.telebot = new Telegraf(process.env.TELEGRAM);
    this.telebot.launch({
      handlerTimeout: Infinity
    });
    //this.telebot.use(Telegraf.log())

    this.db = new DB('WeQuest')
    await this.db.init()

    this.settings = new Settings(this.telebot, this.db)
    await this.settings.init()

    this.ui = new UI(this.telebot, this.db, this.settings)
    await this.ui.init()

    this.lunation = new Lunation(this.telebot)
    this.shopping = new Shopping(this.telebot, this.db)
    this.quests = new Quests(this.telebot, this.db, this.settings)
    this.bigtalk = new Bigtalk(this.telebot)
    this.library = new Library(this.telebot, this.db)
    this.users = new Users(this.telebot, this.db)
    this.expenses = new Expenses(this.telebot, this.db)
    this.onboarding = new Onboarding(this.telebot, this.db)
    this.holons = new Holons(this.telebot, this.db, this.settings)


    // ========================== DISCORD =============================
    // discordbot = new Client({
    //   intents: [GatewayIntentBits.Guilds,
    //   GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    // });
    // discordbot.on("ready", () => {
    //   // This event will run if the bot starts, and logs in, successfully.
    //   console.log(`Discrord BOT has started, with ${discordbot.users.cache.size} users, in ${discordbot.channels.cache.size} channels of ${discordbot.guilds.cache.size} guilds.`);
    //   // Example of changing the bot's playing game to something useful. `discordbot.user` is what the
    //   // docs refer to as the "ClientUser".
    //   discordbot.user.setActivity(`Serving ${discordbot.guilds.cache.size} servers`);
    // });

    // discordbot.on('messageCreate', msg => {
    //   console.log("DISCORD MESSAGE: " + msg.content)
    //   if (msg.content.charAt(0) === process.env.PREFIX) {
    //     msg.react('👀')
    //       .catch(log => {
    //         console.log(error);
    //       });
    //   };
    //   const commandBody = msg.content.substring(process.env.PREFIX.length).split(' ');
    //   console.log(commandBody);
    //   const command = commandBody[0];
    //   const args = commandBody.slice(1);
    //   if (command === 'quest') {
    //     quests.quest('quest', discord2telegram(msg), orbitdb);
    //   }
    //   if (command === 'task') {
    //     console.log('task')
    //   }
    // }
    // )

    // discordbot.login(process.env.DISCORD);
    // =========================== bot commands ===========================
    this.telebot.command('start', async (ctx) => {

      onboarding.start(ctx)

      // Markup.keyboard([
      //   Markup.button.webApp(
      //     "Open Holon",
      //     "https://app.holons.io/?id=" + utils.getChatId(ctx)
      //   ),
      // ])
      //)
    });

    this.telebot.command('help', async (ctx) => {
      ctx.reply("`Just type / for a list of commands. For instance \n /task \n /request \n /offer /status /bulletin")
    })

    this.telebot.command("register", (ctx) => {
      return ctx.reply(
        "open webapp",
        Markup.inlineKeyboard([
          Markup.button.webApp(
            "Open",
            "https://robertovalenti.github.io/webapp/index.html"
          ),
        ])
      );
    });

    this.telebot.command("holons", (ctx) => {
      return ctx.reply(
        "open webapp",
        Markup.keyboard([
          Markup.button.webApp(
            "Open Holon",
            "https://app.holons.io/?id=" + utils.getChatId(ctx)
          ),
        ])
      );
    });

    this.telebot.command("hexamap", (ctx) => {
      return ctx.reply(
        "open webapp",
        Markup.keyboard([
          Markup.button.webApp(
            "Open Hexamap",
            "https://hexamap.holons.io/?id=" + utils.getChatId(ctx)
          ),
        ])
      );
    });

    this.telebot.on('photo', async (ctx) => {
      if (ctx.message.caption) {
        const command = ctx.message.caption.split(' ')[0]; // TODO: ADD MORE Picture- based commands eg /spent
        if (command == '/task' || command == '/quest' || command == '/todo' || command == '/offer' || command == '/request')
          this.quests.quest(command.slice(1), ctx, this.db)
        if (command == '/spent')
          this.shopping.spent(ctx)
      }
      //Scan QR code
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
            ctx.reply(`${value.result.split('/').slice(value.result.split('/').length - 1)}`, Markup.inlineKeyboard([Markup.button.webApp('Open', `${value.result}`)]));
          }
        };
        qr.decode(jimpImage.bitmap);
      } catch (error) {
        console.error(error);
        //ctx.reply('An error occurred while processing the QR code. Please try again.');
      }
    });


    // this.telebot.on('inline_query', async (ctx) => {
    //   const chatID = utils.getChatId(ctx)
    //   let questsDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
    //   await questsDB.load()
    //   const recipes = await questsDB.get('').filter(({ type }) => type == 'offer')
    //     // @ts-ignore
    //     .filter(({ thumbnail }) => thumbnail)
    //     // @ts-ignore
    //     .map(({ title, href, thumbnail }) => ({
    //       type: 'article',
    //       id: thumbnail,
    //       title: title,
    //       description: title,
    //       thumb_url: thumbnail,
    //       input_message_content: {
    //         message_text: title
    //       },
    //       reply_markup: Markup.inlineKeyboard([
    //         Markup.button.url('Go to recipe', href)
    //       ])
    //     }))
    //   return await ctx.answerInlineQuery(recipes)
    // })


    this.telebot.on('inline_query', async (ctx) => {
      // This is a simplified example. In a real-world application, you'd fetch this
      // data from a database or API.
      ///let chatID = utils.getChatId(ctx)
      let offers = []
      let chats = await this.settings.getChats(ctx)
      console.log("chats: ", chats)
      for (const chatID in chats) {
        let users = await this.ui.getFederatedUsers(chatID)

        for (let i = 0; i < users.length; i++) {
          let user = users[i]
          for (let j = 0; j < user.offers.length; j++) {
            offers.push({ id: i, title: user.offers[j], description: user.username, price: '$10' })
          }
        }
      }
      console.log("offers: ", offers)
      const results = offers.map((offer) => ({
        type: 'article',
        id: offer.id,
        title: offer.title,
        description: offer.description,
        input_message_content: {
          message_text: `${offer.title}: ${offer.description} - ${offer.price}`
        },
      }));

      await ctx.answerInlineQuery(results);
    });

    this.telebot.on('chosen_inline_result', (ctx) => {
      console.log(`Chosen product: ${ctx.chosenInlineResult.result_id}`);
      // Handle the product selection here. For example, you could send a confirmation
      // message to the user, or add the product to a shopping cart.
    });


    //----------------------------- APPRECIATION -----------------------------
    this.telebot.command('fullrequest', async (ctx) => request.request('fullrequest', ctx, orbitdb))
    this.telebot.command(['appreciate', 'praise', 'kudo', 'apprezza', 'apprezziamo'], async (ctx) => this.quests.sendAppreciation(ctx))
    this.telebot.command('maslow', (ctx) => this.UI.showMaslow(2))

    //-----------------------------AI -----------------------------
    this.telebot.command('today', async (ctx) => ctx.reply(await AI.getPrompt(await this.settings.getValues, this.lunation.progress(), await AI.getActions(await this.users.listUsersActions(ctx))).catch(err => console.log(err))))
    this.telebot.command('assignroles', async (ctx) => {
      let actions = await this.users.listUsersActions(ctx)
      if (!actions) { ctx.reply("No actions found, please complete tasks before calling this function"); return }
      let roles = await this.settings.getRoles(utils.getChatId(ctx));
      if (!roles) {
        ctx.reply("No roles found, create them using /setroles");
        return
      }
      actions = await AI.getActions(actions);

      ctx.reply(await AI.assignRoles(actions, roles));
    })

    this.telebot.command('actions', async (ctx) => {
      let actions = await this.users.listUsersActions(ctx)
      if (actions)
        actions = await AI.getActions(actions);
      ctx.reply(actions ? actions : 'No actions founds')
    })


    this.telebot.command('facilitate', async (ctx) => {
      let prompt = ctx.message.text.split(' ').slice(1).join(' ');
      if (prompt)
        ctx.reply(await AI.facilitate(prompt))
      else
        ctx.reply("Please specify your issue, eg: /facilitate I am having an issue with Josh, he never shuts up")
    })

    //testing
    this.telebot.command('assignRolesTest', async (ctx) => ctx.reply(await AI.assignRoles("RobertoValenti:put down irrigation end zone 2, fix ventilator camper, find electric cable (adapter) camper, take a demo picture for gen. \n" +
      "alis0r: put down irrigation end zone 2, select bulbs for bedside tables in upper house bedrooms with double beds, mosquito net in the caravan, rubbish collecting an throwing, clean tiny house, food to cats outside, flower organization to avoid it to become rotten + present for Diana preparation, clean the pool, tracking the lines for the workers tomorrow to start up new syntropic lines, watering the trees in the upper area and learn more about the irrigation system, write with the permanent marker indications on the water irrigation tubes. Cook - Bring pots and pans from lower house to upper house" +
      "lauritavw: select bulbs for bedside tables in upper house bedrooms with double beds. empty the caravan from useless staff. ", await this.settings.getRoles(utils.getChatId(ctx)),)).catch(err => console.log(err)))
    this.telebot.command('getActionsTest', async (ctx) => ctx.reply(await AI.getActions("RobertoValenti: put down irrigation end zone 2, fix ventilator camper, find electric cable (adapter) camper, take a demo picture for gen. \n" +
      "alis0r: put down irrigation end zone 2, select bulbs for bedside tables in upper house bedrooms with double beds, mosquito net in the caravan, rubbish collecting an throwing, clean tiny house, food to cats outside, flower organization to avoid it to become rotten + present for Diana preparation, clean the pool, tracking the lines for the workers tomorrow to start up new syntropic lines, watering the trees in the upper area and learn more about the irrigation system, write with the permanent marker indications on the water irrigation tubes, Bring pots and pans from lower house to upper house" +
      "lauritavw: select bulbs for bedside tables in upper house bedrooms with double beds, Empty the caravan from useless staff. ")).catch(err => console.log(err)))


    this.telebot.on('callback_query', async (ctx) => {
      const callbackData = ctx.callbackQuery.data;
      // let chatID = ctx.callbackQuery.message.chat.id;
      // let messageID = ctx.callbackQuery.message.message_id;

      let chatID = ctx.update.callback_query.message.chat.id
      let messageID = ctx.update.callback_query.message.message_id

      if (callbackData.startsWith('removekeyboard')) {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      }

      if (messageID == this.quests.calendar.chats.get(chatID)) {
        var when;
        when = this.quests.calendar.clickButtonCalendar(ctx);
        if (when !== -1) {
          //let caller = chatID// this.quests.calendar.chats.get(chatID*100)  //*100 is a hack to get the originating quest message id

          let questsDB = await this.db.docs('WeQuest.' + chatID.toString() + '.quests')
          await questsDB.load()

          let quest = await questsDB.get(messageID)[0]

          if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }
          quest.status = "scheduled";
          quest.when = when;
          //let callerctx = ctx;
          // callerctx.update.callback_query.message.message_id = caller; //adjust message id for the updateMessage function

          setTimeout(() => {
            this.quests.remind(ctx, quest)
          }, (new Date(when)).getTime() - Date.now())

          // Update the message
          this.quests.updateMessage(ctx, quest);

          // Update the db
          questsDB.put(quest);
        }
      }

    });

    // Content tagging

    this.telebot.command('tag', (ctx) => {
      if (!ctx.message.reply_to_message) {
        return ctx.reply('Please reply to a message you want to tag.');
      }

      const tags = ctx.message.text.split(' ').slice(1);
      if (tags.length === 0) {
        return ctx.reply('Please provide at least one tag.');
      }

      const messageId = ctx.message.reply_to_message.message_id;
      const chatId = ctx.message.chat.id;
      const messageContent = ctx.message.reply_to_message.text;

      tags.forEach(tag => {
        if (!this.db[tag]) {
          this.db[tag] = [];
        }
        this.db[tag].push({ chatId, messageId, messageContent });
      });

      //saveDb();
      ctx.reply('Message tagged successfully.');
    });

    // Query tagged messages
    this.telebot.command('gettag', (ctx) => {
      const tag = ctx.message.text.split(' ')[1];
      if (!tag) {
        return ctx.reply('Please specify a tag.');
      }

      if (!this.db[tag] || this.db[tag].length === 0) {
        return ctx.reply('No messages found for this tag.');
      }

      const response = this.db[tag].map(entry => entry.messageLink).join('\n');
      ctx.reply(response);
    });

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


    this.telebot.on('web_app_data', (ctx) => {
      var [timespamp, timezoneOffset] = ctx.message.web_app_data.data.split('_')
      timespamp = parseInt(timespamp)

      var clientOffset = parseInt(timezoneOffset) * 60 * 1000
      var serverOffset = (new Date()).getTimezoneOffset() * 60 * 1000
      var offset = serverOffset - clientOffset

      var print = 'in user timezone: ' + (new Date(timespamp + offset)).toLocaleString() + '\n'
      print += 'in server timezone: ' + (new Date(timespamp)).toLocaleString()

      ctx.reply(print)
    })



  }
  discord2telegram(message) {
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
}

let wequest = new WeQuest()
await wequest.init();

// discordbot.on('message', msg => {
//   console.log("DISCORD MESSAGE: "+msg.content)
//   if (msg.content === 'quest') {quests.quest('quest',discord2telegram(msg), orbitdb);
//     msg.reply('Pong!');
//   }
// });






