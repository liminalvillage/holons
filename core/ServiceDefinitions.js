import 'dotenv/config';
import fs from 'fs';
import { Telegraf, Scenes, session } from 'telegraf';
import { Client, GatewayIntentBits } from 'discord.js';
import i18next from 'i18next';

// Import all modules
import Server from '../Server.js';
import DB from '../DB.js';
import UI from '../UI.js';
import H3 from '../H3.js';
import Holons from '../Holons.js';
import Quests from '../Quests.js';
import Shopping from '../Shopping.js';
import Lunation from '../Lunation.js';
import Onboarding from '../Onboarding.js';
import Expenses from '../Expenses.js';
import Settings from '../Settings.js';
import Bigtalk from '../Bigtalk.js';
import Library from '../Library.js';
import Users from '../Users.js';
import Tags from '../Tags.js';
import Participation from '../RSVP.js';
import Council from '../Council.js';
import Roles from '../Roles.js';
import OneOnOne from '../OneOnOne.js';
import Announcements from '../Announcements.js';
import Checklists from '../Checklists.js';
import Scheduler from '../Scheduler.js';
import CapitalGame from '../CapitalGame.js';

import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { setupGlobalErrorHandlers } from '../utils/errorHandler.js';

/**
 * Service factory definitions for the dependency injection container
 */
export const serviceDefinitions = {
  // Core services
  config: {
    factory: () => config,
    singleton: true,
    dependencies: [],
  },

  logger: {
    factory: () => {
      setupGlobalErrorHandlers();
      return log;
    },
    singleton: true,
    dependencies: [],
  },

  i18n: {
    factory: async () => {
      const resources = {};
      const knownLanguages = ['en', 'it', 'es', 'fr', 'ru', 'de'];

      // Load language files asynchronously
      for (const lang of knownLanguages) {
        const filePath = `./data/locales/${lang}.json`;
        try {
          if (fs.existsSync(filePath)) {
            const data = await fs.promises.readFile(filePath, 'utf8');
            resources[lang] = JSON.parse(data);
            log.debug('Loaded locale file', { language: lang });
          } else {
            resources[lang] = { translation: {} };
            log.warn('Locale file not found, using empty translations', { 
              language: lang, 
              path: filePath 
            });
          }
        } catch (error) {
          log.error('Error loading locale file', { 
            language: lang, 
            path: filePath, 
            error: error.message 
          });
          resources[lang] = { translation: {} };
        }
      }

      await i18next.init({
        resources,
        fallbackLng: 'en',
        debug: config.isDevelopment,
        interpolation: {
          escapeValue: false,
        },
      });

      return i18next;
    },
    singleton: true,
    dependencies: ['logger', 'config'],
  },

  // Telegram Bot
  telebot: {
    factory: async ({ config, logger }) => {
      const telebot = new Telegraf(config.botToken);

      // Initialize stage
      telebot.stage = new Scenes.Stage([]);

      // Add session and stage middleware
      telebot.use(session());
      telebot.use(telebot.stage.middleware());

      // Don't launch immediately - let the bot launch later
      // await telebot.launch({ handlerTimeout: Infinity });

      logger.info('Telegram bot initialized (not yet launched)');
      return telebot;
    },
    singleton: true,
    dependencies: ['config', 'logger'],
  },

  // Database
  database: {
    factory: async ({ config, logger }) => {
      const appname = config.isDevelopment ? 'HolonsDebug' : 'Holons';
      const db = new DB(appname);
      await db.init();
      
      log.info('Database initialized', { appname });
      return db;
    },
    singleton: true,
    dependencies: ['config', 'logger'],
  },

  // Settings (must be initialized early as many services depend on it)
  settings: {
    factory: ({ telebot, database }) => {
      return new Settings(telebot, database);
    },
    singleton: true,
    dependencies: ['telebot', 'database'],
  },

  // UI (needs to be initialized early for other services)
  ui: {
    factory: async ({ telebot, database, settings }) => {
      const ui = new UI(telebot, database, settings);
      await ui.init();
      return ui;
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'settings'],
  },

  // Users service
  users: {
    factory: ({ telebot, database }) => {
      const users = new Users(telebot, database);
      
      // Add middleware to track user interactions
      telebot.use((ctx, next) => {
        if (ctx.callbackQuery) {
          users.getUserInfo(ctx.callbackQuery.from, ctx.callbackQuery.message?.chat?.id);
        }
        if (ctx.message) {
          users.getUserInfo(ctx.message.from, ctx.message.chat.id);
        }
        return next();
      });

      return users;
    },
    singleton: true,
    dependencies: ['telebot', 'database'],
  },

  // Expenses
  expenses: {
    factory: ({ telebot, database, ui, settings }) => {
      return new Expenses(telebot, database, ui, settings);
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'ui', 'settings'],
  },

  // Holons
  holons: {
    factory: ({ telebot, database, settings, expenses, ui }) => {
      const holons = new Holons(telebot, database, settings);
      
      // Set cross-references
      holons.setExpensesInstance(expenses);
      if (typeof holons.setUIInstance === 'function') {
        holons.setUIInstance(ui);
        log.debug('UI instance passed to Holons');
      }

      return holons;
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'settings', 'expenses', 'ui'],
  },

  // Checklists
  checklists: {
    factory: ({ telebot, database }) => {
      return new Checklists(telebot, database);
    },
    singleton: true,
    dependencies: ['telebot', 'database'],
  },

  // Roles
  roles: {
    factory: ({ telebot, database, ui, settings, checklists }) => {
      const roles = new Roles(telebot, database, ui, settings);
      
      // Set cross-references
      roles.setChecklists(checklists);
      checklists.setRolesInstance(roles);

      return roles;
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'ui', 'settings', 'checklists'],
  },

  // Quests (depends on many services)
  quests: {
    factory: ({ telebot, database, users, settings, checklists, ui, expenses }) => {
      const quests = new Quests(telebot, database, users, settings);
      
      // Set cross-references
      quests.setChecklists(checklists);
      checklists.setQuestInstance(quests);
      quests.expenses = expenses;
      quests.checklists = checklists;
      
      if (typeof quests.setUIInstance === 'function') {
        quests.setUIInstance(ui);
        log.debug('UI instance passed to Quests');
      }

      return quests;
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'users', 'settings', 'checklists', 'ui', 'expenses'],
  },

  // Scheduler
  scheduler: {
    factory: ({ telebot, database, quests, settings }) => {
      const scheduler = new Scheduler(telebot, database, quests, settings);
      quests.setScheduler(scheduler);
      return scheduler;
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'quests', 'settings'],
  },

  // Other services (simpler dependencies)
  lunation: {
    factory: ({ telebot }) => new Lunation(telebot),
    singleton: true,
    dependencies: ['telebot'],
  },

  shopping: {
    factory: ({ telebot, database, settings }) => new Shopping(telebot, database, settings),
    singleton: true,
    dependencies: ['telebot', 'database', 'settings'],
  },

  bigtalk: {
    factory: ({ telebot, settings }) => new Bigtalk(telebot, settings),
    singleton: true,
    dependencies: ['telebot', 'settings'],
  },

  library: {
    factory: ({ telebot, database }) => new Library(telebot, database),
    singleton: true,
    dependencies: ['telebot', 'database'],
  },

  h3: {
    factory: ({ telebot, database, settings }) => new H3(telebot, database, settings),
    singleton: true,
    dependencies: ['telebot', 'database', 'settings'],
  },

  tags: {
    factory: ({ telebot, database }) => new Tags(telebot, database),
    singleton: true,
    dependencies: ['telebot', 'database'],
  },

  participation: {
    factory: ({ telebot, database }) => new Participation(telebot, database),
    singleton: true,
    dependencies: ['telebot', 'database'],
  },

  council: {
    factory: ({ telebot, database }) => new Council(telebot, database),
    singleton: true,
    dependencies: ['telebot', 'database'],
  },

  rounds: {
    factory: ({ telebot, database, settings }) => new OneOnOne(telebot, database, settings),
    singleton: true,
    dependencies: ['telebot', 'database', 'settings'],
  },

  announcements: {
    factory: ({ telebot, database, settings, users }) => {
      return new Announcements(telebot, database, settings, users);
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'settings', 'users'],
  },

  onboarding: {
    factory: ({ telebot, database }) => new Onboarding(telebot, database),
    singleton: true,
    dependencies: ['telebot', 'database'],
  },

  capitalGame: {
    factory: ({ telebot, settings }) => new CapitalGame(telebot, settings),
    singleton: true,
    dependencies: ['telebot', 'settings'],
  },

  // Web Server (should be last to avoid port conflicts during development)
  server: {
    factory: ({ telebot, database }) => {
      return new Server(telebot, database.holosphere.gun);
    },
    singleton: true,
    dependencies: ['telebot', 'database'],
  },
};

/**
 * Post-initialization hooks for cross-service setup
 */
export const postInitHooks = {
  // Setup UI cross-references
  ui: async (ui, container) => {
    const expenses = await container.get('expenses');
    ui.setExpensesInstance(expenses);
    log.debug('Expenses instance passed to UI');
  },

  // Setup Settings cross-references
  settings: async (settings, container) => {
    if (typeof settings.setHolonsInstance === 'function') {
      const holons = await container.get('holons');
      settings.setHolonsInstance(holons);
      log.debug('Holons instance passed to Settings');
    }
  },
};