import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Create winston logger
const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    winston.format.errors({ stack: true }),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      if (stack) {
        return `${timestamp} [${level}]: ${message} - ${stack}`;
      }
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [
    // Console transport
    new winston.transports.Console({
      level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
    }),
    // File transport for errors
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/error.log'),
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/combined.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
});

// Create logs directory if it doesn't exist
import fs from 'fs';
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Helper functions for structured logging
export const log = {
  error: (message, meta = {}) => {
    logger.error(message, { ...meta, timestamp: new Date().toISOString() });
  },
  
  warn: (message, meta = {}) => {
    logger.warn(message, { ...meta, timestamp: new Date().toISOString() });
  },
  
  info: (message, meta = {}) => {
    logger.info(message, { ...meta, timestamp: new Date().toISOString() });
  },
  
  debug: (message, meta = {}) => {
    logger.debug(message, { ...meta, timestamp: new Date().toISOString() });
  },

  // Specialized logging functions
  telegramEvent: (event, userId, chatId, meta = {}) => {
    logger.info('Telegram Event', {
      event,
      userId,
      chatId,
      ...meta,
      timestamp: new Date().toISOString(),
    });
  },

  dbOperation: (operation, collection, meta = {}) => {
    logger.debug('Database Operation', {
      operation,
      collection,
      ...meta,
      timestamp: new Date().toISOString(),
    });
  },

  questAction: (action, questId, userId, meta = {}) => {
    logger.info('Quest Action', {
      action,
      questId,
      userId,
      ...meta,
      timestamp: new Date().toISOString(),
    });
  },

  security: (event, userId, ip, meta = {}) => {
    logger.warn('Security Event', {
      event,
      userId,
      ip,
      ...meta,
      timestamp: new Date().toISOString(),
    });
  },

  performance: (operation, duration, meta = {}) => {
    logger.debug('Performance Metric', {
      operation,
      duration,
      ...meta,
      timestamp: new Date().toISOString(),
    });
  },
};

export default logger;