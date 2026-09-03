/**
 * Process-level error handlers so an unhandled rejection in a holosphere
 * callback or a Discord interaction handler doesn't crash the whole bot.
 */
import { log } from './logger.js';

/** Extract a printable message from an unknown caught value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function setupGlobalErrorHandlers(): void {
  process.on('unhandledRejection', (reason: unknown) => {
    log.error('Unhandled promise rejection', {
      error: errorMessage(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on('uncaughtException', (error: Error) => {
    log.error('Uncaught exception', {
      error: error.message,
      stack: error.stack,
    });
  });
}
