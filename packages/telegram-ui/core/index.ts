/**
 * Core module barrel exports.
 * Provides organized access to core functionality.
 */

// Main bot class
import HolonsBot from './HolonsBotCore.js';
export { default as HolonsBot } from './HolonsBotCore.js';

// Service container
export { default as ServiceContainer } from './ServiceContainer.js';
export type {
  ServiceFactory,
  ServiceRegistrationOptions,
  Shutdownable,
  DependencyGraph,
} from './ServiceContainer.js';

// Service definitions (still JS during incremental migration)
export { serviceDefinitions, postInitHooks } from './ServiceDefinitions.js';

/** Options accepted by {@link quickStart}. */
export interface QuickStartOptions {
  appname?: string;
  telegramToken?: string | null;
  discordToken?: string | null;
}

/** Factory function to create a properly configured bot instance. */
export const createHolonsBot = (): HolonsBot => {
  return new HolonsBot();
};

/** Quick start function for development. */
export const quickStart = async (options: QuickStartOptions = {}): Promise<HolonsBot> => {
  const bot = createHolonsBot();

  await bot.init(
    options.appname || 'Holons',
    options.telegramToken || process.env.BOT_TOKEN || null,
    options.discordToken || process.env.DISCORD_TOKEN || null
  );

  return bot;
};
