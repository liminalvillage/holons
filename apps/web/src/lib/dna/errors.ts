// Error handling utilities for Holon DNA Editor
// Feature: 001-holon-dna-editor

export enum DNAErrorType {
  VALIDATION_ERROR = 'validation_error',
  NOT_FOUND = 'not_found',
  PERMISSION_DENIED = 'permission_denied',
  NETWORK_ERROR = 'network_error',
  CONFLICT = 'conflict',
  UNKNOWN = 'unknown'
}

export interface DNAError {
  type: DNAErrorType;
  message: string;
  details?: any;
  timestamp?: number;
}

/**
 * Create a DNA error object
 */
export function createError(
  type: DNAErrorType,
  message: string,
  details?: any
): DNAError {
  return {
    type,
    message,
    details,
    timestamp: Date.now()
  };
}

/**
 * Create a validation error
 */
export function createValidationError(message: string, errors: string[]): DNAError {
  return createError(DNAErrorType.VALIDATION_ERROR, message, { errors });
}

/**
 * Create a permission denied error
 */
export function createPermissionError(message: string): DNAError {
  return createError(DNAErrorType.PERMISSION_DENIED, message);
}

/**
 * Create a network error
 */
export function createNetworkError(message: string, queued: boolean = false): DNAError {
  return createError(DNAErrorType.NETWORK_ERROR, message, { queued });
}

/**
 * Create a not found error
 */
export function createNotFoundError(resource: string, id: string): DNAError {
  return createError(
    DNAErrorType.NOT_FOUND,
    `${resource} not found: ${id}`,
    { resource, id }
  );
}

/**
 * Create a conflict error
 */
export function createConflictError(message: string, currentVersion?: number): DNAError {
  return createError(DNAErrorType.CONFLICT, message, { currentVersion });
}

/**
 * Handle a DNA error and return a user-friendly message
 */
export function handleError(error: DNAError | Error): string {
  if (error instanceof Error) {
    return error.message;
  }

  switch (error.type) {
    case DNAErrorType.VALIDATION_ERROR:
      return `Validation failed: ${error.details?.errors?.join(', ') || error.message}`;

    case DNAErrorType.NOT_FOUND:
      return `Resource not found: ${error.message}`;

    case DNAErrorType.PERMISSION_DENIED:
      return `Permission denied: ${error.message}`;

    case DNAErrorType.NETWORK_ERROR:
      if (error.details?.queued) {
        return `Offline - changes will be saved when connection is restored`;
      }
      return `Network error: ${error.message}`;

    case DNAErrorType.CONFLICT:
      return `Conflict detected: ${error.message}. Your changes may have been overwritten.`;

    case DNAErrorType.UNKNOWN:
    default:
      return `An error occurred: ${error.message}`;
  }
}

/**
 * Check if an error is recoverable
 */
export function isRecoverableError(error: DNAError): boolean {
  return error.type === DNAErrorType.NETWORK_ERROR;
}

/**
 * Check if an error should trigger a retry
 */
export function shouldRetry(error: DNAError): boolean {
  return error.type === DNAErrorType.NETWORK_ERROR && !error.details?.queued;
}

/**
 * Format error for logging
 */
export function formatErrorForLogging(error: DNAError): string {
  return JSON.stringify({
    type: error.type,
    message: error.message,
    details: error.details,
    timestamp: error.timestamp
  }, null, 2);
}

/**
 * Error notification handler (for UI toast/alert systems)
 */
export type ErrorHandler = (error: DNAError) => void;

let globalErrorHandler: ErrorHandler | null = null;

/**
 * Set a global error handler for DNA errors
 */
export function setGlobalErrorHandler(handler: ErrorHandler) {
  globalErrorHandler = handler;
}

/**
 * Emit an error to the global error handler
 */
export function emitError(error: DNAError) {
  if (globalErrorHandler) {
    globalErrorHandler(error);
  } else {
    // Fallback to console
    console.error('[DNA Editor Error]', formatErrorForLogging(error));
  }
}

/**
 * Wrap an async function with error handling
 */
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  errorType: DNAErrorType = DNAErrorType.UNKNOWN
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (err) {
      const error = err instanceof Error
        ? createError(errorType, err.message)
        : createError(errorType, 'An unknown error occurred', err);

      emitError(error);
      throw error;
    }
  };
}
