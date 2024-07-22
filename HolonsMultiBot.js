
import qrReader from 'qrcode-reader';
import Jimp from 'jimp';
import axios from 'axios';
import sharp from 'sharp';
import fs from 'fs';
import MultiBot from './MultiBot.js';
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

// Delete lock file if it exists
if (fs.existsSync('./orbitdb/repo.lock')) {
  fs.rmdirSync('./orbitdb/repo.lock');
}

class HolonsBot {
  constructor() {
    this.db = null;
    this.bot = null;
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
      this.bot = new MultiBot(telegramToken, discordToken, mattermostToken);

      if (process.env.MODE === 'development') {
        console.log('Development Mode');
        this.db = new DB(`${appname}Debug`);
      } else {
        console.log('Production Mode');
        this.db = new DB(appname);
      }

      await this.db.init();

      await this.initializeModules();

      this.bot.start();

      this.handleProcessEvents();
    } catch (error) {
      console.error('Error initializing WeQuest:', error);
    }
  }

  async initializeModules() {
    this.settings = new Settings(this.bot, this.db);
    await this.settings.init();

    this.ui = new UI(this.bot, this.db, this.settings);
    await this.ui.init();

    this.lunation = new Lunation(this.bot);
    this.shopping = new Shopping(this.bot, this.db, this.settings);
    this.quests = new Quests(this.bot, this.db, this.settings);
    this.bigtalk = new Bigtalk(this.bot);
    this.library = new Library(this.bot, this.db);
    this.users = new Users(this.bot, this.db);
    this.expenses = new Expenses(this.bot, this.db, this.ui, this.settings);
    this.onboarding = new Onboarding(this.bot, this.db);
    this.holons = new Holons(this.bot, this.db, this.settings);
    this.h3 = new H3(this.bot, this.db);
    this.tags = new Tags(this.bot, this.db);
    this.participation = new Participation(this.bot, this.db);
    this.council = new Council(this.bot, this.db);
    this.roles = new Roles(this.bot, this.db);
  }

  async handleMessage(msg, platform) {
    let ctx;
    if (platform == 'discord')
        ctx = this.discord2telegram(msg, platform);
    else
        ctx = msg

    if (ctx.message.text.startsWith(process.env.PREFIX)) {
        const command = ctx.message.text.split(' ')[0].substring(1);
        const args = ctx.message.text.split(' ').slice(1);

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
            default:
                ctx.reply('Unknown command');
        }
    }
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
