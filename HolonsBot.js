#!/usr/bin/env node

/**
 * HolonsBot - Main Entry Point
 *
 * Uses the refactored dependency-injected core implementation.
 */

import 'dotenv/config';
import { log } from './utils/logger.js';

async function startBot() {
  log.info('Starting HolonsBot');

  try {
    const { default: HolonsBot } = await import('./core/HolonsBotCore.js');
    const bot = new HolonsBot();
    await bot.init();

    log.info('HolonsBot started successfully');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      log.info('Received SIGINT, shutting down gracefully...');
      await bot.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      log.info('Received SIGTERM, shutting down gracefully...');
      await bot.shutdown();
      process.exit(0);
    });
  } catch (error) {
    log.error('Failed to start HolonsBot', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Start the bot
startBot().catch(error => {
  console.error('Failed to start HolonsBot:', error);
  process.exit(1);
});
