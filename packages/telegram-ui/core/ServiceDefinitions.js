import 'dotenv/config';
import fs from 'fs';
import { Telegraf, Scenes, session } from 'telegraf';
import i18next from 'i18next';

// Import all modules
import Server from '../src/Server.js';
// HoloSphere comes from src/createHoloSphere.js (env-driven: backend/relays/projections)
import UI from '../src/UI.js';
import H3 from '../src/H3.js';
import Holons from '../src/Holons.js';
import Quests from '../src/Quests.js';
import Shopping from '../src/Shopping.js';
import Lunation from '../src/Lunation.js';
import Onboarding from '../src/Onboarding.js';
import BookingSystem from '../src/BookingSystem.js';
import Expenses from '../src/Expenses.js';
import Settings from '../src/Settings.js';
import Bigtalk from '../src/Bigtalk.js';
import Library from '../src/Library.js';
import Users from '../src/Users.js';
import Tags from '../src/Tags.js';
import Participation from '../src/RSVP.js';
import Shifts from '../src/Shifts.js';
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
      log.debug('SignalManager initialized');
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
              path: filePath,
            });
          }
        } catch (error) {
          log.error('Error loading locale file', {
            language: lang,
            path: filePath,
            error: error.message,
          });
          resources[lang] = { translation: {} };
        }
      }

      await i18next.init({
        resources,
        fallbackLng: 'en',
        debug:
          process.env.LOG_LEVEL === 'debug' &&
          process.env.I18N_DEBUG === 'true',
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

  // KeyManager - stub for compatibility (no per-holon keys, just returns master).
  // Federation methods delegate straight to holosphere using chat IDs as the
  // identity — no nostr keys, no capability tokens. Kept lightweight so the
  // bot's chat-ID-keyed data layout doesn't require a pubkey-based migration.
  keyManager: {
    factory: async ({ config }) => {
      // HOLONS_APP comes from the monorepo root .env (single source of truth).
      // Falls back to env-mode branching only if the var is unset.
      const appname =
        process.env.HOLONS_APP ||
        (config.isDevelopment ? 'HolonsDebug' : 'Holons');
      // Env-driven factory (src/createHoloSphere.js): HOLOSPHERE_RELAYS is
      // the wire, HOLOSPHERE_STORE_DIR the warm local store,
      // HOLOSPHERE_PROJECTIONS(+_SYNC) standard-kind projections + reverse
      // sync (both on by default).
      const { default: createHoloSphere } =
        await import('../src/createHoloSphere.js');
      const holosphere = createHoloSphere(appname);
      // Inspect the local store at startup so we can see what survived.
      const storeDir = process.env.HOLOSPHERE_STORE_DIR || './holosphere-store';
      let storeFiles = [];
      try {
        const fs = await import('fs');
        const path = await import('path');
        const dir = path.resolve(process.cwd(), storeDir);
        storeFiles = fs.readdirSync(dir).map(name => {
          try {
            const st = fs.statSync(path.join(dir, name));
            return { name, size: st.size, mtime: st.mtime.toISOString() };
          } catch {
            return { name, error: 'stat-failed' };
          }
        });
      } catch {
        storeFiles = [{ missing: true }];
      }
      console.log('[QUEST_PERSIST_DEBUG] BOOT', {
        appname,
        isDevelopment: config.isDevelopment,
        cwd: process.cwd(),
        storeDir,
        storeFiles,
        pid: process.pid,
      });

      const keyManager = {
        masterHolosphere: holosphere,
        getHolosphere: async () => holosphere,
        appName: appname,

        // Identity passthrough: the chat ID *is* the public identity in stub
        // mode. This keeps callers that round-trip through getPublicKey/
        // getTelegramId working without a real keypair.
        getPublicKey: async holonId => String(holonId),
        getTelegramId: async pubkey => String(pubkey),

        async setupFederation(sourceHolonId, targetHolonId, options = {}) {
          const {
            lensConfig = { inbound: [], outbound: [] },
            partnerName = null,
          } = options;
          const source = String(sourceHolonId);
          const target = String(targetHolonId);
          if (source === target)
            throw new Error('Cannot federate a holon with itself');

          const success = await holosphere.federate(
            source,
            target,
            null,
            null,
            true,
            {
              inbound: Array.isArray(lensConfig.inbound)
                ? lensConfig.inbound
                : [],
              outbound: Array.isArray(lensConfig.outbound)
                ? lensConfig.outbound
                : [],
            }
          );

          if (success && partnerName) {
            try {
              const fedInfo = await holosphere.getGlobal('federation', source);
              if (fedInfo) {
                if (!fedInfo.partnerNames) fedInfo.partnerNames = {};
                fedInfo.partnerNames[target] = partnerName;
                await holosphere.putGlobal('federation', fedInfo);
              }
            } catch (e) {
              log.warn('[setupFederation] Failed to store partner name', {
                error: e.message,
              });
            }
          }

          holosphere.clearCache?.('federation');
          const federationData = await holosphere.getGlobal(
            'federation',
            source
          );
          return { success, federationData };
        },

        async teardownFederation(sourceHolonId, targetHolonId) {
          const source = String(sourceHolonId);
          const target = String(targetHolonId);
          if (source === target) return true;
          const success = await holosphere.unfederate(
            source,
            target,
            null,
            null
          );
          holosphere.clearCache?.('federation');
          return success;
        },

        // Older API kept for compatibility — sets up a single-lens federation.
        async federateHolons(
          sourceHolonId,
          targetHolonId,
          lensName,
          options = {}
        ) {
          const direction = options.direction || 'outbound';
          const lensConfig =
            direction === 'inbound'
              ? { inbound: [lensName], outbound: [] }
              : { outbound: [lensName], inbound: [] };
          return this.setupFederation(sourceHolonId, targetHolonId, {
            ...options,
            lensConfig,
          });
        },
      };

      log.debug('Database initialized (GunDB via HoloSphere 1.3)', { appname });
      return keyManager;
    },
    singleton: true,
    dependencies: ['config', 'logger'],
  },

  // Database (HoloSphere instance for GunDB access)
  database: {
    factory: async ({ keyManager }) => {
      const holosphere = keyManager.masterHolosphere;
      holosphere.keyManager = keyManager;
      holosphere.holosphere = holosphere; // self-reference for compat

      // forHolon just returns the same instance (no per-holon keys)
      holosphere.forHolon = async () => holosphere;

      log.debug('Database service initialized (HoloSphere 1.3 + GunDB)');
      return holosphere;
    },
    singleton: true,
    dependencies: ['keyManager'],
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
        if (
          ctx.callbackQuery &&
          !ctx.callbackQuery.from?.is_bot &&
          ctx.callbackQuery.message?.chat?.id
        ) {
          users.getUserInfo(
            ctx.callbackQuery.from,
            ctx.callbackQuery.message.chat.id
          );
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
      log.debug('InputScene utility initialized and registered');
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
    factory: ({
      telebot,
      database,
      users,
      settings,
      checklists,
      ui,
      expenses,
      signalManager,
    }) => {
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
    dependencies: [
      'telebot',
      'database',
      'users',
      'settings',
      'checklists',
      'ui',
      'expenses',
      'signalManager',
    ],
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
    factory: ({ telebot, database, settings }) =>
      new Shopping(telebot, database, settings),
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
    factory: ({ telebot, database, settings }) =>
      new H3(telebot, database, settings),
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

  shifts: {
    factory: ({ telebot, database }) => new Shifts(telebot, database),
    singleton: true,
    dependencies: ['telebot', 'database'],
  },

  rounds: {
    factory: ({ telebot, database, settings }) =>
      new OneOnOne(telebot, database, settings),
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

  bookingSystem: {
    factory: ({ telebot, database }) =>
      new BookingSystem(telebot, database, './data/booking.json'),
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
    factory: ({ telebot, quests, expenses, events, database, settings }) => {
      return new Server(telebot, {
        quests,
        expenses,
        events,
        database,
        settings,
      });
    },
    singleton: true,
    dependencies: [
      'telebot',
      'quests',
      'expenses',
      'events',
      'database',
      'settings',
    ],
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
        log.debug('Signal Manager Diagnostics:', {
          totalSignals: diagnostics.totalSignals,
          moduleCount: Object.keys(diagnostics.byModule).length,
          conflictCount: diagnostics.conflicts.length,
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
