#!/usr/bin/env node

/**
 * HolonsBot - Migration Entry Point
 * 
 * This file provides a toggle between legacy and refactored architectures
 * Set USE_REFACTORED_ARCHITECTURE=true to use the new dependency injection system
 */

import 'dotenv/config';
import { log } from './utils/logger.js';

async function startBot() {
  const useRefactored = process.env.USE_REFACTORED_ARCHITECTURE === 'true';
  
  if (useRefactored) {
    log.info('Starting HolonsBot with REFACTORED architecture');
    
    try {
      const { default: HolonsBotRefactored } = await import('./core/HolonsBotRefactored.js');
      const bot = new HolonsBotRefactored();
      await bot.init();
      
      log.info('HolonsBot (Refactored) started successfully');
      
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
      log.error('Failed to start HolonsBot (Refactored)', { error: error.message, stack: error.stack });
      log.info('Falling back to legacy architecture...');
      
      // Fallback to legacy if refactored fails
      const { default: HolonsBotLegacy } = await import('./HolonsBotLegacy.js');
      const legacyBot = new HolonsBotLegacy();
      await legacyBot.init();
    }
    
  } else {
    log.info('Starting HolonsBot with LEGACY architecture');
    
    // Import and run legacy version
    const HolonsBotLegacyModule = await import('./HolonsBotLegacy.js');
    const HolonsBotLegacy = HolonsBotLegacyModule.default || HolonsBotLegacyModule.HolonsBot;
    
    if (HolonsBotLegacy) {
      const bot = new HolonsBotLegacy();
      await bot.init();
      log.info('HolonsBot (Legacy) started successfully');
    } else {
      log.error('Could not find HolonsBotLegacy export');
      process.exit(1);
    }
  }
}

// Start the bot
startBot().catch(error => {
  console.error('Failed to start HolonsBot:', error);
  process.exit(1);
});