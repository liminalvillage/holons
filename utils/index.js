/**
 * Central utilities export file
 * Provides organized access to all utility modules
 */

// Core utilities
export { log } from './logger.js';
export { config } from './config.js';
export * as validation from './validation.js';
export { default as ErrorHandler } from './errorHandler.js';
export { default as SecurityMiddleware } from './security.js';

// Domain-specific utilities
export * as telegram from './telegram.js';
export * as holon from './holon.js';
export * as fileOps from './fileOperations.js';

// Re-export commonly used functions at the top level
export { getUserId, getChatId, getUserName } from './telegram.js';
export { normalizeHolonId, getHolonName } from './holon.js';
export { safeReadFile, safeWriteFile, fileExists } from './fileOperations.js';

// String utilities (extracted from original utilities.js)
export const capitalize = (string) => {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

/**
 * Generate avatar URL for a user
 * Optimized for fast rendering by using default avatar
 */
export const getAvatarUrl = (user) => {
  // For screenshot performance, just use default avatar for now
  // This avoids file system checks and loading delays
  return `file://${process.cwd()}/public/default-avatar.png`;
  
  // TODO: Implement base64 encoding or caching for better performance
};

// Compatibility exports (for gradual migration)
export { 
  getUserId as getUser,  // Note: original getUser returned object, this returns ID
  getChatId,
  getUserName,
  getAvatarUrl,
  capitalize,
} from './telegram.js';

export {
  normalizeHolonId,
  getHolonName,
} from './holon.js';

// Common patterns and helpers
export const createAsyncHandler = (handler) => {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return ErrorHandler.handle(error);
    }
  };
};

export const createTelegramHandler = (handler) => {
  return ErrorHandler.telegramAsyncWrapper(handler);
};

export const createDiscordHandler = (handler) => {
  return ErrorHandler.discordAsyncWrapper(handler);
};

// Performance utilities
export const measureExecutionTime = async (fn, label = 'Operation') => {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    log.performance(label, duration);
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    log.error(`${label} failed after ${duration}ms`, { error: error.message });
    throw error;
  }
};

// Cache utilities (simple in-memory cache)
const cache = new Map();
const cacheTimestamps = new Map();

export const memoize = (fn, ttlMs = 60000) => {
  return async (...args) => {
    const key = JSON.stringify(args);
    const now = Date.now();
    
    if (cache.has(key)) {
      const timestamp = cacheTimestamps.get(key);
      if (now - timestamp < ttlMs) {
        return cache.get(key);
      }
    }
    
    const result = await fn(...args);
    cache.set(key, result);
    cacheTimestamps.set(key, now);
    
    return result;
  };
};

export const clearCache = () => {
  cache.clear();
  cacheTimestamps.clear();
  log.debug('Cache cleared');
};