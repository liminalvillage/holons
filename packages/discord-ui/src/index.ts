#!/usr/bin/env node
/**
 * Entry point for the Holons Discord bot.
 */
import './utils/config.js'; // load .env before anything reads process.env
import { DiscordBot } from './core/DiscordBot.js';
import { setupGlobalErrorHandlers } from './utils/errorHandler.js';
import { log } from './utils/logger.js';

async function start(): Promise<void> {
  setupGlobalErrorHandlers();
  log.info('Starting Holons Discord bot');

  const bot = new DiscordBot();
  await bot.init();

  const shutdown = async (signal: string): Promise<void> => {
    log.info(`Received ${signal}, shutting down gracefully`);
    await bot.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch(err => {
  log.error('Failed to start Discord bot', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
