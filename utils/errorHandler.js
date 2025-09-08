import { log } from './logger.js';

/**
 * Custom error classes for better error categorization
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super(message, 500);
    this.name = 'DatabaseError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(message = 'External service error', service) {
    super(message, 502);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

/**
 * Centralized error handler
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
      chatId: ctx?.chat?.id,
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
      interaction.reply({ content: userMessage, ephemeral: true }).catch(replyError => {
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
      return '⛔ You don\'t have permission to perform this action.';
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
    return async (interaction) => {
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
  process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
    });
    
    // Graceful shutdown
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Promise Rejection', {
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise: promise.toString(),
    });
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

export default ErrorHandler;