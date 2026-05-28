/**
 * @fileoverview Main HolonsBot application with multi-platform support.
 * @module src/HolonsMultiBot
 */

import fs from 'fs';
import MultiBot from './MultiBot.js';
import createHoloSphere from "./createHoloSphere.js";
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
import Roles from './Roles.js';

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
    this.roles = null;
  }

  async init(appname = 'Holons', telegramToken = null, discordToken = null, mattermostToken = null) {
    try {

      this.bot = new MultiBot(telegramToken || process.env.TELEGRAM, discordToken|| process.env.DISCORD, mattermostToken || process.env.MATTERMOST);

      const holosphereName = process.env.MODE === 'development' ? `${appname}Debug` : appname;
      console.log(process.env.MODE === 'development' ? 'Development Mode' : 'Production Mode');

      const holosphere = createHoloSphere(holosphereName);

      // Add self-reference for backward compatibility with code using db.holosphere
      holosphere.holosphere = holosphere;

      this.db = holosphere;

      // Setup photo handler BEFORE modules so Library can use it
      this.setupPhotoHandler();

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
    this.roles = new Roles(this.bot, this.db, this.ui, this.settings);
    this.quests = new Quests(this.bot, this.db, this.users, this.settings);
    this.settings.setQuestsInstance(this.quests);
  }

  setupPhotoHandler() {
    console.log('[HolonsMultiBot] Setting up photo handler');

    // Store reference to this for the closure
    const self = this;

    // Debug: Log ALL callback queries at the top level
    this.bot.on('callback_query', (ctx, next) => {
      console.log('[HolonsMultiBot] CALLBACK received:', ctx.callbackQuery?.data);
      return next();
    });

    // Debug: Log all messages to see what's coming through
    this.bot.on('message', (ctx, next) => {
      console.log('[HolonsMultiBot] Message received, type:', ctx.message.photo ? 'photo' : ctx.message.text ? 'text' : 'other');
      return next();
    });

    this.bot.on('photo', async (ctx) => {
      console.log('[HolonsMultiBot] Photo received in chat:', ctx.chat.id);

      // Check if library is waiting for a photo first (library may not be initialized yet)
      if (self.library) {
        const isWaiting = self.library.isWaitingForPhoto(ctx.chat.id);
        console.log('[HolonsMultiBot] Library waiting for photo:', isWaiting);

        if (isWaiting) {
          console.log('[HolonsMultiBot] Calling library.handlePhotoUpload');
          try {
            const handled = await self.library.handlePhotoUpload(ctx);
            console.log('[HolonsMultiBot] Photo handled by library:', handled);
            if (handled) return;
          } catch (error) {
            console.error('[HolonsMultiBot] Error in library.handlePhotoUpload:', error);
          }
        }
      } else {
        console.log('[HolonsMultiBot] Library not initialized yet');
      }

      // Handle photo captions for other modules
      if (ctx.message.caption) {
        const command = ctx.message.caption.split(' ')[0];
        console.log('[HolonsMultiBot] Photo has caption, command:', command);

        if (['/task', '/quest', '/todo', '/offer', '/request', '/compito', '/missione'].includes(command)) {
          ctx.message.text = ctx.message.caption;
          if (self.quests) self.quests.quest(command.slice(1), ctx);
          return;
        } else if (['/spent', '/expense', '/speso'].includes(command)) {
          ctx.message.text = ctx.message.caption;
          if (self.expenses) self.expenses.spent(ctx);
          return;
        }
      }
    });
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
