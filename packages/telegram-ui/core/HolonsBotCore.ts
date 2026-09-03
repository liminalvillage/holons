import fs from 'fs';
import type { Telegraf, Context } from 'telegraf';
import ServiceContainer, { errorMessage } from './ServiceContainer.js';
import { serviceDefinitions, postInitHooks } from './ServiceDefinitions.js';
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

/** Shape of an entry in {@link serviceDefinitions}. */
interface ServiceDefinitionEntry {
  factory: (deps: Record<string, unknown>, container: ServiceContainer) => unknown | Promise<unknown>;
  singleton?: boolean;
  dependencies?: string[];
}

/** Map of service name -> definition (mirrors `ServiceDefinitions.js`). */
type ServiceMap = Record<string, ServiceDefinitionEntry>;

/** Map of service name -> post-init hook (mirrors `ServiceDefinitions.js`). */
type PostInitHookMap = Record<
  string,
  (service: unknown, container: ServiceContainer) => unknown | Promise<unknown>
>;

/** Minimal shape used when interacting with the Telegram bot service in this module. */
type TelebotLike = Telegraf<Context> & {
  stop?: () => Promise<unknown> | unknown;
};

/** Minimal shape used when interacting with the database service in this module. */
interface DatabaseLike {
  appname?: string;
  ready?: () => Promise<unknown>;
}

/** The slice of the Library service that this module touches. */
interface LibraryLike {
  isWaitingForPhoto(chatId: number | string): boolean;
  handlePhotoUpload(ctx: Context): Promise<boolean> | boolean;
}

/** The slice of the Quests service that this module touches. */
interface QuestsLike {
  quest(command: string, ctx: Context): unknown;
}

/** The slice of the Expenses service that this module touches. */
interface ExpensesLike {
  spent(ctx: Context): unknown;
}

/**
 * Core HolonsBot application class that manages the lifecycle of a Telegram bot
 * using dependency injection for service management.
 *
 * @example
 * const bot = new HolonsBot();
 * await bot.init('MyApp', 'telegram-token');
 * // Bot is now running
 * await bot.shutdown();
 */
class HolonsBot {
  /** The dependency injection container managing all services. */
  public container: ServiceContainer;
  /** Whether the bot has completed initialization. */
  public isInitialized: boolean;
  /** Whether the bot is currently shutting down. */
  public isShuttingDown: boolean;

  constructor() {
    this.container = new ServiceContainer();
    this.isInitialized = false;
    this.isShuttingDown = false;
  }

  /**
   * Initializes the bot with all its dependencies and starts the Telegram bot.
   *
   * @param appname Application name for logging and identification.
   * @param telegramToken Override Telegram bot token (uses env if `null`).
   * @param discordToken Override Discord bot token (uses env if `null`).
   */
  async init(
    appname: string = 'Holons',
    telegramToken: string | null = null,
    discordToken: string | null = null
  ): Promise<void> {
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

      // Wait for the local store to open and the relay transport to come up
      // so the first Telegram update reads a hydrated store, not an empty one.
      try {
        const db = await this.container.get<DatabaseLike>('database');
        await db.ready?.();
        log.info('Holosphere ready: local store open, relay sync up');
      } catch (e) {
        log.warn('Holosphere warmup failed (non-fatal)', { error: errorMessage(e) });
      }

      // Launch the Telegram bot now that everything is initialized
      await this.launchBot();

      const duration = Date.now() - startTime;
      this.isInitialized = true;

      log.info('HolonsBot initialization completed', {
        duration,
        servicesCount: this.container.getServiceNames().length,
      });
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      log.error('Failed to initialize HolonsBot', { error: errorMessage(error), stack });
      await this.shutdown();
      throw error;
    }
  }

  /** Registers all service definitions from ServiceDefinitions with the DI container. */
  private registerServices(): void {
    log.debug('Registering services');

    // The JS-side service definitions describe each factory's dependency shape
    // with concrete types (e.g. `({ telebot })`). The container resolves
    // dependencies dynamically, so we erase those signatures via `unknown`.
    const definitions = serviceDefinitions as unknown as ServiceMap;
    for (const [name, definition] of Object.entries(definitions)) {
      this.container.register(name, definition.factory, {
        singleton: definition.singleton,
        dependencies: definition.dependencies,
      });
    }

    log.debug('All services registered', { count: Object.keys(definitions).length });
  }

  /** Launches the Telegram bot after all services are initialized. */
  private async launchBot(): Promise<void> {
    try {
      const telebot = await this.container.get<TelebotLike>('telebot');
      // `handlerTimeout` is a runtime option supported by Telegraf but absent
      // from the public LaunchOptions type — preserve the original behavior.
      await telebot.launch({ handlerTimeout: Infinity } as Parameters<typeof telebot.launch>[0]);
      log.info('Telegram bot launched successfully');

      // Set the bot menu button to open dashboard webapp
      await this.setupMenuButton(telebot);
    } catch (error) {
      log.error('Failed to launch Telegram bot', { error: errorMessage(error) });
      throw error;
    }
  }

  /** Sets up the bot menu button to open the dashboard webapp. */
  private async setupMenuButton(telebot: TelebotLike): Promise<void> {
    try {
      const dashboardUrl = config.dashboardAddress;
      // Telegraf accepts the underlying Bot API shape (snake_case `menu_button`).
      // Preserve the exact payload used by the original JS module.
      await telebot.telegram.setChatMenuButton({
        menu_button: {
          type: 'web_app',
          text: 'Dashboard',
          web_app: { url: dashboardUrl },
        },
      } as unknown as Parameters<typeof telebot.telegram.setChatMenuButton>[0]);
      log.info('Bot menu button configured for dashboard webapp');
    } catch (error) {
      log.warn('Failed to set menu button (non-critical)', { error: errorMessage(error) });
    }
  }

  /** Runs post-initialization hooks for services that require additional setup. */
  private async runPostInitHooks(): Promise<void> {
    log.debug('Running post-initialization hooks');

    const hooks = postInitHooks as PostInitHookMap;
    for (const [serviceName, hook] of Object.entries(hooks)) {
      try {
        const service = await this.container.get(serviceName);
        await hook(service, this.container);
      } catch (error) {
        log.error('Post-init hook failed', {
          service: serviceName,
          error: errorMessage(error),
        });
        // Don't fail the entire initialization for hook errors
      }
    }
  }

  /** Sets up Telegram command and event handlers. */
  private async setupHandlers(): Promise<void> {
    try {
      // Get the main services that handle commands
      await this.container.get<TelebotLike>('telebot');

      // Setup command handlers - this would be moved to individual services
      // For now, we'll keep the existing pattern but make it more organized
      await this.setupTelegramCommands();
      await this.setupTelegramHandlers();

      log.debug('All handlers setup completed');
    } catch (error) {
      log.error('Failed to setup handlers', { error: errorMessage(error) });
      throw error;
    }
  }

  /** Retrieves a service from the dependency injection container. */
  async getService<T = unknown>(name: string): Promise<T> {
    if (!this.isInitialized) {
      throw new Error('Bot not initialized. Call init() first.');
    }
    return this.container.get<T>(name);
  }

  /** Retrieves multiple services from the container at once. */
  async getServices(...names: string[]): Promise<Record<string, unknown>> {
    const services: Record<string, unknown> = {};
    for (const name of names) {
      services[name] = await this.getService(name);
    }
    return services;
  }

  /** Checks if the bot is fully initialized and ready to handle requests. */
  isReady(): boolean {
    return this.isInitialized && !this.isShuttingDown;
  }

  /** Gets the service dependency graph for debugging purposes. */
  getDependencyGraph(): ReturnType<ServiceContainer['getDependencyGraph']> {
    return this.container.getDependencyGraph();
  }

  /** Performs a graceful shutdown of the bot and all services. */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      log.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    log.info('Starting graceful shutdown');

    try {
      // Stop accepting new requests
      const telebot = await this.container.get<TelebotLike>('telebot').catch(() => null);
      if (telebot && telebot.stop) {
        await telebot.stop();
      }

      // Shutdown all services
      await this.container.shutdown();

      this.isInitialized = false;
      log.info('Graceful shutdown completed');
    } catch (error) {
      log.error('Error during shutdown', { error: errorMessage(error) });
    } finally {
      this.isShuttingDown = false;
    }
  }

  /** Cleans up any stale lock files from previous runs. */
  private cleanupLockFiles(): void {
    try {
      if (fs.existsSync('./orbitdb/repo.lock')) {
        fs.rmSync('./orbitdb/repo.lock', { recursive: true, force: true });
        log.debug('Cleaned up OrbitDB lock file');
      }
    } catch (error) {
      log.warn('Failed to clean up lock files', { error: errorMessage(error) });
    }
  }

  /** Sets up process event handlers for graceful shutdown on signals. */
  private setupProcessHandlers(): void {
    const handleShutdown = (signal: string): void => {
      log.info(`Received ${signal}, starting graceful shutdown`);
      this.shutdown()
        .then(() => {
          process.exit(0);
        })
        .catch((error: unknown) => {
          log.error('Error during shutdown', { error: errorMessage(error) });
          process.exit(1);
        });
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));

    process.on('uncaughtException', (error: Error) => {
      log.error('Uncaught exception', { error: error.message, stack: error.stack });
      this.shutdown().then(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason: unknown) => {
      const err = reason instanceof Error ? reason : null;
      log.error('Unhandled promise rejection', {
        reason: err ? err.message : reason,
        stack: err ? err.stack : undefined,
      });
    });
  }

  /**
   * Sets up Telegram bot commands.
   * @todo Move this logic to individual service modules.
   */
  private async setupTelegramCommands(): Promise<void> {
    // This would be implemented by calling setup methods on individual services
    log.debug('Setting up Telegram commands');
    // Implementation would go here...
  }

  /**
   * Sets up Telegram event handlers including photo processing.
   * @todo Move this logic to individual service modules.
   */
  private async setupTelegramHandlers(): Promise<void> {
    // This would be implemented by calling setup methods on individual services
    // For now, we maintain compatibility with the existing structure
    log.debug('Setting up Telegram handlers');

    try {
      const telebot = await this.container.get<TelebotLike>('telebot');
      const quests = await this.container.get<QuestsLike>('quests');
      const expenses = await this.container.get<ExpensesLike>('expenses');
      const library = await this.container.get<LibraryLike | null>('library');

      // Debug: Log all messages to see what's coming through
      telebot.on('message', (ctx, next) => {
        const msg = ctx.message as { photo?: unknown; text?: unknown } | undefined;
        const type = msg?.photo ? 'photo' : msg?.text ? 'text' : 'other';
        console.log('[HolonsBotCore] Message received, type:', type);
        return next();
      });

      // Setup photo handler
      telebot.on('photo', async (ctx) => {
        console.log('[HolonsBotCore] Photo handler triggered, chat:', ctx.chat?.id);

        // Check if library is waiting for a photo first
        if (library) {
          const isWaiting = library.isWaitingForPhoto(ctx.chat!.id);
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

        const message = ctx.message as { caption?: string; text?: string } | undefined;
        if (message?.caption) {
          const command = message.caption.split(' ')[0];
          console.log('Photo caption command:', command, 'Full caption:', message.caption);

          if (['/task', '/quest', '/todo', '/offer', '/request', '/compito', '/missione'].includes(command)) {
            console.log('Creating quest from photo caption:', command);
            // Ensure ctx.message.text is set for quest creation
            message.text = message.caption;
            quests.quest(command.slice(1), ctx);
            return; // Exit early to avoid QR processing
          } else if (['/spent', '/expense', '/speso'].includes(command)) {
            message.text = message.caption;
            expenses.spent(ctx);
            return; // Exit early to avoid QR processing
          }
        }

        // Handle QR code processing here if needed
        try {
          // QR code processing logic would go here
        } catch (error) {
          console.log('QR processing error:', errorMessage(error));
        }
      });

      console.log('[HolonsBotCore] Photo handler setup completed');
    } catch (error) {
      log.error('Failed to setup photo handlers', { error: errorMessage(error) });
    }
  }

  /** Gets the Telegraf bot instance, or `null` if not initialized. */
  get telebot(): Promise<TelebotLike | null> | null {
    if (!this.isInitialized) return null;
    return this.container.get<TelebotLike>('telebot').catch(() => null);
  }

  /** Gets the database service instance, or `null` if not initialized. */
  get db(): Promise<DatabaseLike | null> | null {
    if (!this.isInitialized) return null;
    return this.container.get<DatabaseLike>('database').catch(() => null);
  }

  /** Gets the settings service instance, or `null` if not initialized. */
  get settings(): Promise<unknown | null> | null {
    if (!this.isInitialized) return null;
    return this.container.get('settings').catch(() => null);
  }
}

export default HolonsBot;
