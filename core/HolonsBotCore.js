import fs from 'fs';
import ServiceContainer from './ServiceContainer.js';
import { serviceDefinitions, postInitHooks } from './ServiceDefinitions.js';
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

/**
 * Core HolonsBot application class that manages the lifecycle of a Telegram bot
 * using dependency injection for service management.
 *
 * @class HolonsBot
 * @module core/HolonsBotCore
 * @description Main entry point for the HolonsBot application. Handles initialization,
 * service registration, command setup, and graceful shutdown of the bot and all its dependencies.
 *
 * @property {ServiceContainer} container - The dependency injection container managing all services
 * @property {boolean} isInitialized - Whether the bot has completed initialization
 * @property {boolean} isShuttingDown - Whether the bot is currently shutting down
 *
 * @example
 * const bot = new HolonsBot();
 * await bot.init('MyApp', 'telegram-token');
 * // Bot is now running
 * await bot.shutdown();
 */
class HolonsBot {
  /**
   * Creates a new HolonsBot instance.
   * @constructor
   */
  constructor() {
    this.container = new ServiceContainer();
    this.isInitialized = false;
    this.isShuttingDown = false;
  }

  /**
   * Initializes the bot with all its dependencies and starts the Telegram bot.
   * @async
   * @param {string} [appname='Holons'] - The application name for logging and identification
   * @param {string|null} [telegramToken=null] - Override Telegram bot token (uses env if null)
   * @param {string|null} [discordToken=null] - Override Discord bot token (uses env if null)
   * @returns {Promise<void>}
   * @throws {Error} If initialization fails
   */
  async init(appname = 'Holons', telegramToken = null, discordToken = null) {
    if (this.isInitialized) {
      log.warn('Bot already initialized');
      return;
    }

    try {
      log.info('Starting HolonsBot initialization', { appname });
      const startTime = Date.now();

      // Clean up any lock files
      this.cleanupLockFiles();

      // Override config if tokens provided
      if (telegramToken) {
        process.env.BOT_TOKEN = telegramToken;
      }
      if (discordToken) {
        process.env.DISCORD_TOKEN = discordToken;
      }

      // Register all services
      this.registerServices();

      // Validate dependencies before initialization
      this.container.validateDependencies();

      // Initialize all services
      await this.container.initializeAll();

      // Run post-initialization hooks
      await this.runPostInitHooks();

      // Setup command handlers (after all services are ready)
      await this.setupHandlers();

      // Setup process event handlers
      this.setupProcessHandlers();

      // Warm up GunDB cache — subscribe to known data so peer sync starts early
      try {
        const db = await this.container.get('database');
        const gun = db.gun || db.getGun?.();
        if (gun) {
          // Touch the top-level app node to trigger sync from peers
          gun.get(db.appname || 'Holons').once(() => {});
          log.info('GunDB warmup: subscribed to peer data');
        }
      } catch (e) {
        log.warn('GunDB warmup failed (non-fatal)', { error: e.message });
      }

      // Launch the Telegram bot now that everything is initialized
      await this.launchBot();

      const duration = Date.now() - startTime;
      this.isInitialized = true;

      log.info('HolonsBot initialization completed', { 
        duration, 
        servicesCount: this.container.getServiceNames().length 
      });

    } catch (error) {
      log.error('Failed to initialize HolonsBot', { error: error.message, stack: error.stack });
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Registers all service definitions from ServiceDefinitions with the DI container.
   * @private
   * @returns {void}
   */
  registerServices() {
    log.debug('Registering services');

    for (const [name, definition] of Object.entries(serviceDefinitions)) {
      this.container.register(name, definition.factory, {
        singleton: definition.singleton,
        dependencies: definition.dependencies,
      });
    }

    log.debug('All services registered', { count: Object.keys(serviceDefinitions).length });
  }

  /**
   * Launches the Telegram bot after all services are initialized.
   * @async
   * @private
   * @returns {Promise<void>}
   * @throws {Error} If bot launch fails
   */
  async launchBot() {
    try {
      const telebot = await this.container.get('telebot');
      await telebot.launch({ handlerTimeout: Infinity });
      log.info('Telegram bot launched successfully');

      // Set the bot menu button to open dashboard webapp
      await this.setupMenuButton(telebot);
    } catch (error) {
      log.error('Failed to launch Telegram bot', { error: error.message });
      throw error;
    }
  }

  /**
   * Sets up the bot menu button to open the dashboard webapp.
   * @async
   * @private
   * @param {Telegraf} telebot - The Telegraf bot instance
   * @returns {Promise<void>}
   */
  async setupMenuButton(telebot) {
    try {
      const dashboardUrl = config.dashboardAddress;
      await telebot.telegram.setChatMenuButton({
        menu_button: {
          type: 'web_app',
          text: 'Dashboard',
          web_app: { url: dashboardUrl }
        }
      });
      log.info('Bot menu button configured for dashboard webapp');
    } catch (error) {
      log.warn('Failed to set menu button (non-critical)', { error: error.message });
    }
  }

  /**
   * Runs post-initialization hooks for services that require additional setup.
   * @async
   * @private
   * @returns {Promise<void>}
   */
  async runPostInitHooks() {
    log.debug('Running post-initialization hooks');

    for (const [serviceName, hook] of Object.entries(postInitHooks)) {
      try {
        const service = await this.container.get(serviceName);
        await hook(service, this.container);
      } catch (error) {
        log.error('Post-init hook failed', { 
          service: serviceName, 
          error: error.message 
        });
        // Don't fail the entire initialization for hook errors
      }
    }
  }

  /**
   * Sets up Telegram command and event handlers.
   * @async
   * @private
   * @returns {Promise<void>}
   * @throws {Error} If handler setup fails
   */
  async setupHandlers() {
    try {
      // Get the main services that handle commands
      const telebot = await this.container.get('telebot');
      
      // Setup command handlers - this would be moved to individual services
      // For now, we'll keep the existing pattern but make it more organized
      await this.setupTelegramCommands();
      await this.setupTelegramHandlers();

      log.debug('All handlers setup completed');
    } catch (error) {
      log.error('Failed to setup handlers', { error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves a service from the dependency injection container.
   * @async
   * @param {string} name - The name of the service to retrieve
   * @returns {Promise<*>} The requested service instance
   * @throws {Error} If bot is not initialized or service not found
   */
  async getService(name) {
    if (!this.isInitialized) {
      throw new Error('Bot not initialized. Call init() first.');
    }
    return this.container.get(name);
  }

  /**
   * Retrieves multiple services from the container at once.
   * @async
   * @param {...string} names - The names of the services to retrieve
   * @returns {Promise<Object.<string, *>>} Object mapping service names to instances
   */
  async getServices(...names) {
    const services = {};
    for (const name of names) {
      services[name] = await this.getService(name);
    }
    return services;
  }

  /**
   * Checks if the bot is fully initialized and ready to handle requests.
   * @returns {boolean} True if initialized and not shutting down
   */
  isReady() {
    return this.isInitialized && !this.isShuttingDown;
  }

  /**
   * Gets the service dependency graph for debugging purposes.
   * @returns {Object} The dependency graph from the container
   */
  getDependencyGraph() {
    return this.container.getDependencyGraph();
  }

  /**
   * Performs a graceful shutdown of the bot and all services.
   * @async
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this.isShuttingDown) {
      log.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    log.info('Starting graceful shutdown');

    try {
      // Stop accepting new requests
      const telebot = await this.container.get('telebot').catch(() => null);
      if (telebot && telebot.stop) {
        await telebot.stop();
      }

      // Shutdown all services
      await this.container.shutdown();

      this.isInitialized = false;
      log.info('Graceful shutdown completed');

    } catch (error) {
      log.error('Error during shutdown', { error: error.message });
    } finally {
      this.isShuttingDown = false;
    }
  }

  /**
   * Cleans up any stale lock files from previous runs.
   * @private
   * @returns {void}
   */
  cleanupLockFiles() {
    try {
      if (fs.existsSync('./orbitdb/repo.lock')) {
        fs.rmSync('./orbitdb/repo.lock', { recursive: true, force: true });
        log.debug('Cleaned up OrbitDB lock file');
      }
    } catch (error) {
      log.warn('Failed to clean up lock files', { error: error.message });
    }
  }

  /**
   * Sets up process event handlers for graceful shutdown on signals.
   * @private
   * @returns {void}
   */
  setupProcessHandlers() {
    const handleShutdown = (signal) => {
      log.info(`Received ${signal}, starting graceful shutdown`);
      this.shutdown().then(() => {
        process.exit(0);
      }).catch((error) => {
        log.error('Error during shutdown', { error: error.message });
        process.exit(1);
      });
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    
    process.on('uncaughtException', (error) => {
      log.error('Uncaught exception', { error: error.message, stack: error.stack });
      this.shutdown().then(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      log.error('Unhandled promise rejection', { 
        reason: reason?.message || reason, 
        stack: reason?.stack 
      });
    });
  }

  /**
   * Sets up Telegram bot commands.
   * @async
   * @private
   * @returns {Promise<void>}
   * @todo Move this logic to individual service modules
   */
  async setupTelegramCommands() {
    // This would be implemented by calling setup methods on individual services
    log.debug('Setting up Telegram commands');
    // Implementation would go here...
  }

  /**
   * Sets up Telegram event handlers including photo processing.
   * @async
   * @private
   * @returns {Promise<void>}
   * @todo Move this logic to individual service modules
   */
  async setupTelegramHandlers() {
    // This would be implemented by calling setup methods on individual services
    // For now, we maintain compatibility with the existing structure
    log.debug('Setting up Telegram handlers');

    try {
      const telebot = await this.container.get('telebot');
      const quests = await this.container.get('quests');
      const expenses = await this.container.get('expenses');
      const library = await this.container.get('library');

      // Debug: Log all messages to see what's coming through
      telebot.on('message', (ctx, next) => {
        console.log('[HolonsBotCore] Message received, type:', ctx.message.photo ? 'photo' : ctx.message.text ? 'text' : 'other');
        return next();
      });

      // Setup photo handler
      telebot.on('photo', async (ctx) => {
        console.log('[HolonsBotCore] Photo handler triggered, chat:', ctx.chat.id);

        // Check if library is waiting for a photo first
        if (library) {
          const isWaiting = library.isWaitingForPhoto(ctx.chat.id);
          console.log('[HolonsBotCore] Library waiting for photo:', isWaiting);

          if (isWaiting) {
            try {
              console.log('[HolonsBotCore] Calling library.handlePhotoUpload');
              const handled = await library.handlePhotoUpload(ctx);
              console.log('[HolonsBotCore] Photo handled by library:', handled);
              if (handled) return;
            } catch (error) {
              console.error('[HolonsBotCore] Error in library.handlePhotoUpload:', error);
            }
          }
        } else {
          console.log('[HolonsBotCore] Library not available');
        }

        if (ctx.message.caption) {
          const command = ctx.message.caption.split(' ')[0];
          console.log('Photo caption command:', command, 'Full caption:', ctx.message.caption);

          if (['/task', '/quest', '/todo', '/offer', '/request', '/compito', '/missione'].includes(command)) {
            console.log('Creating quest from photo caption:', command);
            // Ensure ctx.message.text is set for quest creation
            ctx.message.text = ctx.message.caption;
            quests.quest(command.slice(1), ctx);
            return; // Exit early to avoid QR processing
          } else if (['/spent', '/expense', '/speso'].includes(command)) {
            ctx.message.text = ctx.message.caption;
            expenses.spent(ctx);
            return; // Exit early to avoid QR processing
          }
        }

        // Handle QR code processing here if needed
        try {
          // QR code processing logic would go here
        } catch (error) {
          console.log('QR processing error:', error.message);
        }
      });

      console.log('[HolonsBotCore] Photo handler setup completed');
    } catch (error) {
      log.error('Failed to setup photo handlers', { error: error.message });
    }
  }

  /**
   * Gets the Telegraf bot instance.
   * @type {Promise<Telegraf>|null}
   * @readonly
   */
  get telebot() {
    if (!this.isInitialized) return null;
    return this.container.get('telebot').catch(() => null);
  }

  /**
   * Gets the database service instance.
   * @type {Promise<DB>|null}
   * @readonly
   */
  get db() {
    if (!this.isInitialized) return null;
    return this.container.get('database').catch(() => null);
  }

  /**
   * Gets the settings service instance.
   * @type {Promise<Settings>|null}
   * @readonly
   */
  get settings() {
    if (!this.isInitialized) return null;
    return this.container.get('settings').catch(() => null);
  }
}

export default HolonsBot;