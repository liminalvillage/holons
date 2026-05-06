#!/usr/bin/env node

/**
 * HolonsBot - Main Entry Point
 *
 * Uses the refactored dependency-injected core implementation.
 */

import 'dotenv/config';
import { log } from '../utils/logger.js';

async function startBot() {
  log.info('Starting HolonsBot');

  try {
    const { default: HolonsBot } = await import('../core/HolonsBotCore.js');
    const { setupGlobalErrorHandlers } = await import('../utils/errorHandler.js');

    // Setup global error handlers to prevent crashes
    setupGlobalErrorHandlers();

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
    log.error('Failed to start HolonsBot - Will retry in 10 seconds', { error: error.message, stack: error.stack });

    // Instead of exiting, retry after delay
    setTimeout(() => {
      log.info('Retrying bot startup...');
      startBot();
    }, 10000);
  }
}

// Start the bot
startBot().catch(error => {
  console.error('Failed to start HolonsBot:', error);
  // Retry instead of exiting
  setTimeout(() => {
    console.log('Retrying bot startup...');
    startBot();
  }, 10000);
});
