"use strict";

import 'dotenv/config';
import qrReader from 'qrcode-reader';
import Jimp from 'jimp';
import axios from 'axios';
import sharp from 'sharp';
import fs from 'fs';
import { Telegraf, Markup } from 'telegraf';
import { Client, GatewayIntentBits } from 'discord.js';
import DB from "./DB.js";
import UI from './UI.js';
import H3 from './H3.js';
import Holons from './Holons.js';
import Quests from './Quests.js';
import Shopping from './Shopping.js';
import Lunation from "./Lunation.js";
import Onboarding from "./Onboarding.js";
import Expenses from "./Expenses.js";
import Settings from './Settings.js';
import Bigtalk from './Bigtalk.js';
import Library from './Library.js';
import Users from './Users.js';
import Tags from './Tags.js';
import Participation from './RSVP.js';
import Council from './Council.js';
import Roles from './Roles.js';
import * as request from './Requests.js';
import OneOnOne from './OneOnOne.js';

// Delete lock file if it exists
if (fs.existsSync('./orbitdb/repo.lock')) {
  fs.rmdirSync('./orbitdb/repo.lock');
}

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
    this.h3 = null;
    this.tags = null;
    this.participation = null;
    this.council = null;
    this.roles = null;
    this.rounds = null;
  }

  async init(appname = 'WeQuest', telegramtoken = null, discordtoken = null) {
    try {
      this.telebot = new Telegraf(telegramtoken || process.env.TELEGRAM);
      this.telebot.launch({ handlerTimeout: Infinity });

      if (process.env.MODE === 'development') {
        console.log('Development Mode');
        this.db = new DB(`${appname}Debug`);
      } else {
        console.log('Production Mode');
        this.db = new DB(appname);
      }

      await this.db.init();

      await this.initializeModules();

      this.setupTelegramCommands();
      this.setupTelegramHandlers();
      this.setupDiscordBot(discordtoken);

      this.handleProcessEvents();
    } catch (error) {
      console.error('Error initializing WeQuest:', error);
    }
  }

  async initializeModules() {
    this.settings = new Settings(this.telebot, this.db);
    await this.settings.init();

    this.ui = new UI(this.telebot, this.db, this.settings);
    await this.ui.init();

    this.lunation = new Lunation(this.telebot);
    this.shopping = new Shopping(this.telebot, this.db, this.settings);
    this.quests = new Quests(this.telebot, this.db, this.settings);
    this.bigtalk = new Bigtalk(this.telebot);
    this.library = new Library(this.telebot, this.db);
    this.users = new Users(this.telebot, this.db);
    this.expenses = new Expenses(this.telebot, this.db, this.ui, this.settings);
    this.onboarding = new Onboarding(this.telebot, this.db);
    this.holons = new Holons(this.telebot, this.db, this.settings);
    this.h3 = new H3(this.telebot, this.db);
    this.tags = new Tags(this.telebot, this.db);
    this.participation = new Participation(this.telebot, this.db);
    this.council = new Council(this.telebot, this.db);
    this.roles = new Roles(this.telebot, this.db, this.ui, this.settings);
    this.rounds = new OneOnOne(this.telebot, this.db, this.settings);
  }

  setupTelegramCommands() {
    if (process.env.MODE === 'development') {
      this.telebot.command('start', async (ctx) => {
        onboarding.start(ctx);
      });

      this.telebot.command('help', async (ctx) => {
        ctx.reply('Just type / for a list of commands. For instance \n /task \n /request \n /offer /status /bulletin');
      });

      this.telebot.on('inline_query', async (ctx) => {
        await this.handleInlineQuery(ctx);
      });

      this.telebot.on('chosen_inline_result', (ctx) => {
        console.log(`Chosen product: ${ctx.chosenInlineResult.result_id}`);
      });
    }

    this.telebot.command('fullrequest', async (ctx) => request.request('fullrequest', ctx, this.db));
    this.telebot.command(['appreciate', 'praise', 'kudo', 'apprezza', 'apprezziamo', 'fiorino'], async (ctx) => this.quests.sendAppreciation(ctx));
  
  }

  setupTelegramHandlers() {
    this.telebot.on('photo', async (ctx) => {
      await this.handlePhoto(ctx);
    });

    this.telebot.on('callback_query', async (ctx) => {
      await this.handleCallbackQuery(ctx);
    });
  }

  async handleInlineQuery(ctx) {
    let offers = [];
    let chats = await this.settings.getChats(ctx);
    let k = 0;

    for (const chatID of chats) {
      let users = await this.ui.getFederatedUsers(chatID);
      for (const user of users) {
        for (let j = 0; j < user.offers.length; j++) {
          offers.push({ id: k++, title: user.offers[j], description: user.username, price: '$10' });
        }
      }
    }

    const results = offers.map((offer) => ({
      type: 'article',
      id: offer.id,
      title: offer.title,
      description: offer.description,
      thumb_url: 'https://picsum.photos/200/300',
      input_message_content: {
        message_text: `${offer.title}: ${offer.description} - ${offer.price}`
      },
    }));

    await ctx.answerInlineQuery(results);
  }

  async handlePhoto(ctx) {
    if (ctx.message.caption) {
      const command = ctx.message.caption.split(' ')[0];
      if (['/task', '/quest', '/todo', '/offer', '/request'].includes(command)) {
        this.quests.quest(command.slice(1), ctx);
      } else if (['/spent', '/expense', '/speso'].includes(command)) {
        ctx.message.text = ctx.message.caption;
        this.expenses.spent(ctx);
      }
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
          ctx.reply(`${value.result.split('/').slice(value.result.split('/').length - 1)}`, Markup.inlineKeyboard([Markup.button.webApp('Open', `${value.result}`)]));
        }
      };

      qr.decode(jimpImage.bitmap);
    } catch (error) {
      console.error('Error processing QR code:', error);
    }
  }

  async handleCallbackQuery(ctx) {
    const callbackData = ctx.callbackQuery.data;
    const chatID = ctx.update.callback_query.message.chat.id;
    const messageID = ctx.update.callback_query.message.message_id;

    if (callbackData.startsWith('removekeyboard')) {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    }

    if (messageID === this.quests.calendar.chats.get(chatID)) {
      const when = this.quests.calendar.clickButtonCalendar(ctx);
      if (when !== -1) {
        const quest = await this.db.get(chatID + '/quests', messageID);

        if (!quest) {
          console.log('Quest not found');
          return;
        }

        quest.status = 'scheduled';
        quest.when = when;

        setTimeout(() => {
          this.quests.remind(ctx, quest);
        }, new Date(when).getTime() - Date.now());

        this.quests.updateMessage(ctx, quest);
        this.db.put(chatID + '/quests', quest);
      }
    }
  }

  setupDiscordBot(discordtoken) {
    if (!discordtoken) return;

    const discordbot = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    discordbot.on('ready', () => {
      console.log(`Discord BOT started with ${discordbot.users.cache.size} users, in ${discordbot.channels.cache.size} channels of ${discordbot.guilds.cache.size} guilds.`);
      discordbot.user.setActivity(`Serving ${discordbot.guilds.cache.size} servers`);
    });

    discordbot.on('messageCreate', (msg) => {
      console.log("DISCORD MESSAGE:", msg.content);
      if (msg.content.charAt(0) === process.env.PREFIX) {
        msg.react('👀').catch(console.error);
      }
      const commandBody = msg.content.substring(process.env.PREFIX.length).split(' ');
      const command = commandBody[0];
      const args = commandBody.slice(1);

      if (command === 'quest') {
        this.quests.quest('quest', this.discord2telegram(msg), this.db);
      }
      if (command === 'task') {
        console.log('task');
      }
    });

    discordbot.login(discordtoken || process.env.DISCORD);
  }

  discord2telegram(message) {
    const ctx = message;
    ctx.deleteMessage = () => message.delete();
    ctx.updateType = "message";
    ctx.message = {
      message_id: message.id,
      from: {
        id: message.author.id,
        first_name: message.author.username,
      },
      chat: {
        id: message.channel.id,
      },
      text: message.content,
    };

    return ctx;
  }

  handleProcessEvents() {
    process.on('SIGINT', async () => {
      console.log('Gracefully shutting down...');
      if (this.db.type === 'orbitdb') {
        await ipfs.stop();
      }
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('Gracefully shutting down...');
      await ipfs.stop();
      process.exit(0);
    });
  }
}

console.log(process.argv[2], process.argv[3]);

const wequest = new WeQuest();
await wequest.init(process.argv[2], process.argv[3], process.argv[4]);
