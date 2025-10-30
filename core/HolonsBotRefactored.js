import fs from 'fs';
import ServiceContainer from './ServiceContainer.js';
import { serviceDefinitions, postInitHooks } from './ServiceDefinitions.js';
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

/**
 * HolonsBot using Dependency Injection
 * This implementation uses proper service management and dependency injection
 */
class HolonsBot {
  constructor() {
    this.container = new ServiceContainer();
    this.isInitialized = false;
    this.isShuttingDown = false;
  }

  /**
   * Initialize the bot with all its dependencies
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
   * Register all service definitions with the container
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
   * Launch the Telegram bot after all services are initialized
   */
  async launchBot() {
    try {
      const telebot = await this.container.get('telebot');
      await telebot.launch({ handlerTimeout: Infinity });
      log.info('Telegram bot launched successfully');
    } catch (error) {
      log.error('Failed to launch Telegram bot', { error: error.message });
      throw error;
    }
  }

  /**
   * Run post-initialization hooks
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
   * Setup command and event handlers
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
   * Get a service from the container
   */
  async getService(name) {
    if (!this.isInitialized) {
      throw new Error('Bot not initialized. Call init() first.');
    }
    return this.container.get(name);
  }

  /**
   * Get multiple services at once
   */
  async getServices(...names) {
    const services = {};
    for (const name of names) {
      services[name] = await this.getService(name);
    }
    return services;
  }

  /**
   * Check if the bot is ready
   */
  isReady() {
    return this.isInitialized && !this.isShuttingDown;
  }

  /**
   * Get service dependency graph for debugging
   */
  getDependencyGraph() {
    return this.container.getDependencyGraph();
  }

  /**
   * Graceful shutdown
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
   * Clean up lock files
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
   * Setup process event handlers
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
   * Setup Telegram commands
   * TODO: Move this logic to individual service modules
   */
  async setupTelegramCommands() {
    // This would be implemented by calling setup methods on individual services
    // For now, we maintain compatibility with the existing structure
    log.debug('Setting up Telegram commands');
    // Implementation would go here...
  }

  /**
   * Setup Telegram handlers
   * TODO: Move this logic to individual service modules
   */
  async setupTelegramHandlers() {
    // This would be implemented by calling setup methods on individual services
    // For now, we maintain compatibility with the existing structure
    log.debug('Setting up Telegram handlers');

    try {
      const telebot = await this.container.get('telebot');
      const quests = await this.container.get('quests');
      const expenses = await this.container.get('expenses');

      // Setup photo handler
      telebot.on('photo', async (ctx) => {
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

      log.debug('Photo handler setup completed');
    } catch (error) {
      log.error('Failed to setup photo handlers', { error: error.message });
    }
  }

  /**
   * Direct property access for convenience
   * Provides easy access to commonly used services
   */
  get telebot() {
    if (!this.isInitialized) return null;
    return this.container.get('telebot').catch(() => null);
  }

  get db() {
    if (!this.isInitialized) return null;
    return this.container.get('database').catch(() => null);
  }

  get settings() {
    if (!this.isInitialized) return null;
    return this.container.get('settings').catch(() => null);
  }

  // Add other property getters as needed...
}

export default HolonsBot;