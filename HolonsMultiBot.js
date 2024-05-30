"use strict";

import 'dotenv/config';
import qrReader from 'qrcode-reader';
import Jimp from 'jimp';
import axios from 'axios';
import sharp from 'sharp';
import fs from 'fs';
import { Telegraf, Markup } from 'telegraf';
import { Client, GatewayIntentBits } from 'discord.js';
import  MattermostClient from 'mattermost-client';
import * as utils from './utilities.js';
import DB from "./DB.js";
import UI from './UI.js';
import * as AI from './AI.js';
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

// Delete lock file if it exists
if (fs.existsSync('./orbitdb/repo.lock')) {
  fs.rmdirSync('./orbitdb/repo.lock');
}

class HolonsBot {
  constructor() {
    this.db = null;
    this.telegramBot = null;
    this.discordBot = null;
    this.mattermostClient = null;
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
  }

  async init(appname = 'WeQuest', telegramToken = null, discordToken = null, mattermostToken = null) {
    try {
      this.telegramBot = new Telegraf(telegramToken || process.env.TELEGRAM);
      this.telegramBot.launch({ handlerTimeout: Infinity });

      this.discordBot = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      this.mattermostClient = new MattermostClient({
        url: process.env.MATTERMOST_URL,
        token: mattermostToken || process.env.MATTERMOST_TOKEN,
      });

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
      this.setupDiscordCommands();
      this.setupMattermostCommands();

      this.handleProcessEvents();
    } catch (error) {
      console.error('Error initializing WeQuest:', error);
    }
  }

  async initializeModules() {
    this.settings = new Settings(this.telegramBot, this.db);
    await this.settings.init();

    this.ui = new UI(this.telegramBot, this.db, this.settings);
    await this.ui.init();

    this.lunation = new Lunation(this.telegramBot);
    this.shopping = new Shopping(this.telegramBot, this.db, this.settings);
    this.quests = new Quests(this.telegramBot, this.db, this.settings);
    this.bigtalk = new Bigtalk(this.telegramBot);
    this.library = new Library(this.telegramBot, this.db);
    this.users = new Users(this.telegramBot, this.db);
    this.expenses = new Expenses(this.telegramBot, this.db, this.ui, this.settings);
    this.onboarding = new Onboarding(this.telegramBot, this.db);
    this.holons = new Holons(this.telegramBot, this.db, this.settings);
    this.h3 = new H3(this.telegramBot, this.db);
    this.tags = new Tags(this.telegramBot, this.db);
    this.participation = new Participation(this.telegramBot, this.db);
    this.council = new Council(this.telegramBot, this.db);
    this.roles = new Roles(this.telegramBot, this.db);
  }

  setupTelegramCommands() {
    if (process.env.MODE === 'development') {
      this.telegramBot.command('start', async (ctx) => {
        this.onboarding.start(ctx);
      });

      this.telegramBot.command('help', async (ctx) => {
        ctx.reply('Just type / for a list of commands. For instance \n /task \n /request \n /offer /status /bulletin');
      });

      this.telegramBot.on('inline_query', async (ctx) => {
        await this.handleInlineQuery(ctx, 'telegram');
      });

      this.telegramBot.on('chosen_inline_result', (ctx) => {
        console.log(`Chosen product: ${ctx.chosenInlineResult.result_id}`);
      });
    }

    this.telegramBot.command('fullrequest', async (ctx) => request.request('fullrequest', ctx, this.db));
    this.telegramBot.command(['appreciate', 'praise', 'kudo', 'apprezza', 'apprezziamo', 'fiorino'], async (ctx) => this.quests.sendAppreciation(ctx));
    this.telegramBot.command('maslow', (ctx) => this.ui.showMaslow(2));
  }

  setupDiscordCommands() {
    this.discordBot.on('ready', () => {
      console.log(`Discord BOT started with ${this.discordBot.users.cache.size} users, in ${this.discordBot.channels.cache.size} channels of ${this.discordBot.guilds.cache.size} guilds.`);
      this.discordBot.user.setActivity(`Serving ${this.discordBot.guilds.cache.size} servers`);
    });

    this.discordBot.on('messageCreate', (msg) => {
      this.handleMessage(msg, 'discord');
    });

    this.discordBot.login(process.env.DISCORD);
  }

  setupMattermostCommands() {
    this.mattermostClient.on('message', (msg) => {
      this.handleMessage(msg, 'mattermost');
    });

    this.mattermostClient.login();
  }

  async handleInlineQuery(ctx, platform) {
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

  async handlePhoto(ctx, platform) {
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

  async handleMessage(msg, platform) {
    const ctx = this.convertToContext(msg, platform);

    if (ctx.text.startsWith('/')) {
      const command = ctx.text.split(' ')[0].substring(1);
      const args = ctx.text.split(' ').slice(1);

      switch (command) {
        case 'task':
        case 'quest':
        case 'todo':
        case 'offer':
        case 'request':
          this.quests.quest(command, ctx);
          break;
        case 'spent':
        case 'expense':
        case 'speso':
          this.expenses.spent(ctx);
          break;
        case 'start':
          if (platform === 'telegram') this.onboarding.start(ctx);
          break;
        case 'help':
          ctx.reply('Just type / for a list of commands. For instance \n /task \n /request \n /offer /status /bulletin');
          break;
        case 'fullrequest':
          request.request('fullrequest', ctx, this.db);
          break;
        case 'appreciate':
        case 'praise':
        case 'kudo':
        case 'apprezza':
        case 'apprezziamo':
        case 'fiorino':
          this.quests.sendAppreciation(ctx);
          break;
        case 'maslow':
          this.ui.showMaslow(2);
          break;
        default:
          ctx.reply('Unknown command');
      }
    }
  }

  convertToContext(msg, platform) {
    let ctx = { platform };
    if (platform === 'discord') {
      ctx.message = {
        message_id: msg.id,
        from: { id: msg.author.id, first_name: msg.author.username },
        chat: { id: msg.channel.id },
        text: msg.content,
      };
      ctx.reply = (text) => msg.channel.send(text);
    } else if (platform === 'mattermost') {
      ctx.message = {
        message_id: msg.id,
        from: { id: msg.user_id, first_name: msg.user_id },
        chat: { id: msg.channel_id },
        text: msg.text,
      };
      ctx.reply = (text) => this.mattermostClient.postMessage({
        channel_id: msg.channel_id,
        message: text,
      });
    } else {
      ctx = msg;
    }
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

const holons = new HolonsBot();
await holons.init(process.argv[2], process.argv[3], process.argv[4]);
