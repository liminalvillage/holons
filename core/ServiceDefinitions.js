import 'dotenv/config';
import fs from 'fs';
import { Telegraf, Scenes, session } from 'telegraf';
import { Client, GatewayIntentBits } from 'discord.js';
import i18next from 'i18next';

// Import all modules
import Server from '../src/Server.js';
import DB from '../src/DB.js';
import UI from '../src/UI.js';
import H3 from '../src/H3.js';
import Holons from '../src/Holons.js';
import Quests from '../src/Quests.js';
import Shopping from '../src/Shopping.js';
import Lunation from '../src/Lunation.js';
import Onboarding from '../src/Onboarding.js';
import Expenses from '../src/Expenses.js';
import Settings from '../src/Settings.js';
import Bigtalk from '../src/Bigtalk.js';
import Library from '../src/Library.js';
import Users from '../src/Users.js';
import Tags from '../src/Tags.js';
import Participation from '../src/RSVP.js';
import Council from '../src/Council.js';
import Roles from '../src/Roles.js';
import OneOnOne from '../src/OneOnOne.js';
import Announcements from '../src/Announcements.js';
import Checklists from '../src/Checklists.js';
import Scheduler from '../src/Scheduler.js';
import CapitalGame from '../src/CapitalGame.js';
import Events from '../src/Events.js';
import SignalManager, { REQUIRED_SIGNALS } from './SignalManager.js';

import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { setupGlobalErrorHandlers } from '../utils/errorHandler.js';
import InputScene from '../utils/InputScene.js';

/**
 * Service factory definitions for the dependency injection container
 */
export const serviceDefinitions = {
  // Core services
  signalManager: {
    factory: ({ telebot }) => {
      const signalManager = new SignalManager(telebot);
      log.info('SignalManager initialized');
      return signalManager;
    },
    singleton: true,
    dependencies: ['telebot'],
  },

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
        debug: process.env.LOG_LEVEL === 'debug' && process.env.I18N_DEBUG === 'true',
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
    factory: ({ telebot, database, signalManager }) => {
      const settings = new Settings(telebot, database);
      // Register with signal manager for debugging
      if (signalManager && process.env.SIGNAL_DEBUG === 'true') {
        log.debug('Settings module registered with SignalManager');
      }
      return settings;
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'signalManager'],
  },

  // UI (needs to be initialized early for other services)
  ui: {
    factory: async ({ telebot, database, settings, signalManager }) => {
      const ui = new UI(telebot, database, settings);
      await ui.init();
      // Register with signal manager for debugging
      if (signalManager && process.env.SIGNAL_DEBUG === 'true') {
        log.debug('UI module registered with SignalManager');
      }
      return ui;
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'settings', 'signalManager'],
  },

  // Users service
  users: {
    factory: ({ telebot, database }) => {
      const users = new Users(telebot, database);

      // Add middleware to track user interactions (skip bots)
      telebot.use((ctx, next) => {
        if (ctx.callbackQuery && !ctx.callbackQuery.from?.is_bot) {
          users.getUserInfo(ctx.callbackQuery.from, ctx.callbackQuery.message?.chat?.id);
        }
        if (ctx.message && !ctx.message.from?.is_bot) {
          users.getUserInfo(ctx.message.from, ctx.message.chat.id);
        }
        return next();
      });

      return users;
    },
    singleton: true,
    dependencies: ['telebot', 'database'],
  },

  // InputScene - Utility scene for collecting user input
  inputScene: {
    factory: ({ telebot }) => {
      const inputScene = new InputScene(telebot);
      log.info('InputScene utility initialized and registered');
      return inputScene;
    },
    singleton: true,
    dependencies: ['telebot'],
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
    factory: ({ telebot, database, users, settings, checklists, ui, expenses, signalManager }) => {
      const quests = new Quests(telebot, database, users, settings);

      // Set cross-references
      quests.setChecklists(checklists);
      checklists.setQuestInstance(quests);
      quests.expenses = expenses;
      quests.checklists = checklists;

      // Allow Settings to invalidate Quests language cache
      if (typeof settings.setQuestsInstance === 'function') {
        settings.setQuestsInstance(quests);
      }

      if (typeof quests.setUIInstance === 'function') {
        quests.setUIInstance(ui);
        log.debug('UI instance passed to Quests');
      }

      // Register with signal manager for debugging
      if (signalManager && process.env.SIGNAL_DEBUG === 'true') {
        log.debug('Quests module registered with SignalManager');
      }

      return quests;
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'users', 'settings', 'checklists', 'ui', 'expenses', 'signalManager'],
  },

  // Events
  events: {
    factory: ({ telebot, database, users, settings, ui }) => {
      const events = new Events(telebot, database, users, settings);
      events.setUIInstance(ui);
      return events;
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'users', 'settings', 'ui'],
  },

  // Scheduler
  scheduler: {
    factory: ({ telebot, database, quests, events, settings }) => {
      const scheduler = new Scheduler(telebot, database, quests, settings);
      quests.setScheduler(scheduler);
      events.setScheduler(scheduler);
      scheduler.setEvents(events);
      return scheduler;
    },
    singleton: true,
    dependencies: ['telebot', 'database', 'quests', 'events', 'settings'],
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
    factory: ({ telebot }) => {
      return new Server(telebot);
    },
    singleton: true,
    dependencies: ['telebot'],
  },
};

/**
 * Post-initialization hooks for cross-service setup
 */
export const postInitHooks = {
  // Validate signals after all modules are loaded
  signalManager: ({ signalManager }) => {
    if (signalManager) {
      // Validate that required signals are registered
      const validation = signalManager.validateSignals(REQUIRED_SIGNALS);
      
      if (!validation.valid) {
        log.warn('Signal validation failed:', validation);
      }
      
      // Log diagnostics if in debug mode
      if (process.env.SIGNAL_DEBUG === 'true') {
        const diagnostics = signalManager.getDiagnostics();
        log.info('Signal Manager Diagnostics:', {
          totalSignals: diagnostics.totalSignals,
          moduleCount: Object.keys(diagnostics.byModule).length,
          conflictCount: diagnostics.conflicts.length
        });
        
        if (diagnostics.conflicts.length > 0) {
          log.warn('Signal conflicts detected:', diagnostics.conflicts);
        }
      }
    }
  },

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