/**
 * @fileoverview Error handling utilities for HolonsBot.
 * @module utils/errorHandler
 */
import { log } from './logger.js';

/**
 * Base application error class for operational errors.
 *
 * @class AppError
 * @extends Error
 * @description Custom error class for categorizing application errors with status codes.
 *
 * @property {string} name - Error class name
 * @property {number} statusCode - HTTP-like status code
 * @property {boolean} isOperational - Whether error is expected (operational) vs unexpected
 *
 * @example
 * throw new AppError('Something went wrong', 500);
 */
export class AppError extends Error {
  /**
   * Creates a new AppError instance.
   * @constructor
   * @param {string} message - Error message
   * @param {number} [statusCode=500] - HTTP-like status code
   * @param {boolean} [isOperational=true] - Whether error is operational
   */
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error (400 Bad Request).
 * @class ValidationError
 * @extends AppError
 */
export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

/**
 * Authentication error (401 Unauthorized).
 * @class AuthenticationError
 * @extends AppError
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error (403 Forbidden).
 * @class AuthorizationError
 * @extends AppError
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
    this.name = 'AuthorizationError';
  }
}

/**
 * Not found error (404 Not Found).
 * @class NotFoundError
 * @extends AppError
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Database error (500 Internal Server Error).
 * @class DatabaseError
 * @extends AppError
 */
export class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super(message, 500);
    this.name = 'DatabaseError';
  }
}

/**
 * External service error (502 Bad Gateway).
 * @class ExternalServiceError
 * @extends AppError
 * @property {string} service - Name of the failing external service
 */
export class ExternalServiceError extends AppError {
  constructor(message = 'External service error', service) {
    super(message, 502);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

/**
 * Centralized error handler for managing operational and unexpected errors.
 *
 * @class ErrorHandler
 * @description Provides static methods for handling different types of errors,
 * including Telegram-specific errors and async error wrapping.
 */
export class ErrorHandler {
  /**
   * Handle operational errors (expected errors)
   */
  static handleOperationalError(error, context = {}) {
    log.error('Operational Error', {
      error: error.message,
      stack: error.stack,
      statusCode: error.statusCode,
      ...context,
    });

    // Return user-friendly error message
    return {
      success: false,
      error: error.message,
      code: error.statusCode || 500,
    };
  }

  /**
   * Handle programming errors (unexpected errors)
   */
  static handleProgrammingError(error, context = {}) {
    log.error('Programming Error', {
      error: error.message,
      stack: error.stack,
      ...context,
    });

    // Don't expose internal error details to users
    return {
      success: false,
      error: 'An unexpected error occurred. Please try again later.',
      code: 500,
    };
  }

  /**
   * Determine if error is operational or programming error
   */
  static isOperationalError(error) {
    if (error instanceof AppError) {
      return error.isOperational;
    }
    return false;
  }

  /**
   * Main error handling function
   */
  static handle(error, context = {}) {
    if (this.isOperationalError(error)) {
      return this.handleOperationalError(error, context);
    } else {
      return this.handleProgrammingError(error, context);
    }
  }

  /**
   * Telegram-specific error handler
   */
  static handleTelegramError(error, ctx) {
    const context = {
      userId: ctx?.from?.id,
      holonId: ctx?.chat?.id,
      messageId: ctx?.message?.message_id,
      command: ctx?.message?.text?.split(' ')[0],
    };

    const result = this.handle(error, context);

    // Send user-friendly message to Telegram
    if (ctx && ctx.reply) {
      const userMessage = this.getUserFriendlyMessage(error);
      ctx.reply(userMessage).catch(replyError => {
        log.error('Failed to send error message to user', {
          originalError: error.message,
          replyError: replyError.message,
          ...context,
        });
      });
    }

    return result;
  }

  /**
   * Discord-specific error handler
   */
  static handleDiscordError(error, interaction) {
    const context = {
      userId: interaction?.user?.id,
      guildId: interaction?.guildId,
      channelId: interaction?.channelId,
      command: interaction?.commandName,
    };

    const result = this.handle(error, context);

    // Send user-friendly message to Discord
    if (interaction && interaction.reply) {
      const userMessage = this.getUserFriendlyMessage(error);
      interaction
        .reply({ content: userMessage, ephemeral: true })
        .catch(replyError => {
          log.error('Failed to send error message to user', {
            originalError: error.message,
            replyError: replyError.message,
            ...context,
          });
        });
    }

    return result;
  }

  /**
   * Express middleware error handler
   */
  static expressErrorHandler(error, req, res, next) {
    const context = {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    };

    const result = this.handle(error, context);

    res.status(result.code).json(result);
  }

  /**
   * Get user-friendly error message
   */
  static getUserFriendlyMessage(error) {
    if (error instanceof ValidationError) {
      return `❌ Invalid input: ${error.message}`;
    }

    if (error instanceof AuthenticationError) {
      return '🔒 Authentication required. Please try again.';
    }

    if (error instanceof AuthorizationError) {
      return "⛔ You don't have permission to perform this action.";
    }

    if (error instanceof NotFoundError) {
      return '❓ The requested resource was not found.';
    }

    if (error instanceof DatabaseError) {
      return '💾 Database error. Please try again later.';
    }

    if (error instanceof ExternalServiceError) {
      return `🌐 External service error${error.service ? ` (${error.service})` : ''}. Please try again later.`;
    }

    // Default message for unknown errors
    return '⚠️ An unexpected error occurred. Please try again later.';
  }

  /**
   * Create async error wrapper for functions
   */
  static asyncWrapper(fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        return this.handle(error);
      }
    };
  }

  /**
   * Create async error wrapper for Telegram handlers
   */
  static telegramAsyncWrapper(fn) {
    return async (ctx, next) => {
      try {
        return await fn(ctx, next);
      } catch (error) {
        return this.handleTelegramError(error, ctx);
      }
    };
  }

  /**
   * Create async error wrapper for Discord handlers
   */
  static discordAsyncWrapper(fn) {
    return async interaction => {
      try {
        return await fn(interaction);
      } catch (error) {
        return this.handleDiscordError(error, interaction);
      }
    };
  }
}

/**
 * Global error handlers for uncaught exceptions
 */
export function setupGlobalErrorHandlers() {
  process.on('uncaughtException', error => {
    log.error('Uncaught Exception - Bot will continue running', {
      error: error.message,
      stack: error.stack,
    });

    // DO NOT exit - let the bot continue running
    // Only exit for truly fatal errors
    if (isFatalError(error)) {
      log.error('Fatal error detected, shutting down');
      process.exit(1);
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Promise Rejection - Bot will continue running', {
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise: promise.toString(),
    });

    // DO NOT exit - log and continue
  });

  process.on('SIGTERM', () => {
    log.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log.info('SIGINT received, shutting down gracefully');
    process.exit(0);
  });
}

/**
 * Determine if an error is truly fatal and requires shutdown
 */
function isFatalError(error) {
  // Only exit for critical system-level errors
  const fatalPatterns = [
    'EADDRINUSE', // Port already in use
    'MODULE_NOT_FOUND', // Critical module missing (only at startup)
    'EACCES', // Permission denied for critical resources
    'ENOSPC', // No space left on device
  ];

  const errorMessage = error.message || '';
  const errorCode = error.code || '';

  return fatalPatterns.some(
    pattern => errorMessage.includes(pattern) || errorCode === pattern
  );
}

export default ErrorHandler;
