/**
 * @fileoverview Main HolonsBot application with multi-platform support.
 * @module src/HolonsMultiBot
 */

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

/**
 * Main HolonsBot application orchestrating all modules.
 *
 * @class HolonsBot
 * @description Central application class that initializes and wires together
 * all HolonsBot modules including database, UI, quests, expenses, settings,
 * and more. Supports multi-platform deployment via MultiBot.
 *
 * @property {DB} db - Database instance
 * @property {MultiBot} bot - Multi-platform bot instance
 * @property {Settings} settings - Settings manager
 * @property {UI} ui - UI generator
 * @property {Quests} quests - Quest management
 * @property {Expenses} expenses - Expense tracking
 * @property {Users} users - User management
 * @property {Holons} holons - Blockchain integration
 * @property {Library} library - Library system
 * @property {Roles} roles - Role management
 *
 * @example
 * const holons = new HolonsBot();
 * await holons.init('MyApp', telegramToken, discordToken);
 */
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

  async init(appname = 'Holons', telegramToken = null, discordToken = null, mattermostToken = null) {
    try {
      
      this.bot = new MultiBot(telegramToken || process.env.TELEGRAM, discordToken|| process.env.DISCORD, mattermostToken || process.env.MATTERMOST);

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
      console.error('Error initializing:', error);
    }
  }

  async initializeModules() {
    this.settings = new Settings(this.bot, this.db);
    await this.settings.init();

    this.ui = new UI(this.bot, this.db, this.settings);
    await this.ui.init();

    this.lunation = new Lunation(this.bot);
    this.shopping = new Shopping(this.bot, this.db, this.settings);
  
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
    this.roles = new Roles(this.bot, this.db, this.ui, this.settings);
    this.quests = new Quests(this.bot, this.db, this.users, this.settings);
    this.settings.setQuestsInstance(this.quests);

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
