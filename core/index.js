/**
 * Core module barrel exports
 * Provides organized access to core functionality
 */

// Main bot class
export { default as HolonsBot } from './HolonsBotRefactored.js';

// Service container
export { default as ServiceContainer } from './ServiceContainer.js';

// Service definitions
export { serviceDefinitions, postInitHooks } from './ServiceDefinitions.js';

/**
 * Factory function to create a properly configured bot instance
 */
export const createHolonsBot = () => {
  return new HolonsBot();
};

/**
 * Quick start function for development
 */
export const quickStart = async (options = {}) => {
  const bot = createHolonsBot();
  
  await bot.init(
    options.appname || 'Holons',
    options.telegramToken || process.env.BOT_TOKEN,
    options.discordToken || process.env.DISCORD_TOKEN
  );
  
  return bot;
};