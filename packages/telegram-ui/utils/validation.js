import { log } from './logger.js';

/**
 * Input validation utilities
 * Provides comprehensive validation and sanitization functions
 */

/**
 * Sanitize string input by removing potentially harmful characters
 */
export function sanitizeString(input, options = {}) {
  if (typeof input !== 'string') {
    return '';
  }

  let sanitized = input;

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Remove or escape HTML if specified
  if (options.escapeHtml) {
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  // Trim whitespace
  if (options.trim !== false) {
    sanitized = sanitized.trim();
  }

  // Limit length
  if (options.maxLength) {
    sanitized = sanitized.slice(0, options.maxLength);
  }

  return sanitized;
}

/**
 * Validate and sanitize Telegram user input
 */
export function validateTelegramInput(text, options = {}) {
  const defaultOptions = {
    maxLength: 4096, // Telegram message limit
    trim: true,
    allowEmpty: false,
  };

  const opts = { ...defaultOptions, ...options };

  if (!text || typeof text !== 'string') {
    if (!opts.allowEmpty) {
      throw new Error('Input is required and must be a string');
    }
    return '';
  }

  const sanitized = sanitizeString(text, opts);

  if (!opts.allowEmpty && sanitized.length === 0) {
    throw new Error('Input cannot be empty after sanitization');
  }

  return sanitized;
}

/**
 * Validate user ID (should be a number)
 */
export function validateUserId(userId) {
  const id = parseInt(userId, 10);
  if (isNaN(id) || id <= 0) {
    throw new Error('Invalid user ID');
  }
  return id;
}

/**
 * Validate holon ID (can be negative for groups)
 */
export function validateholonId(holonId) {
  const id = parseInt(holonId, 10);
  if (isNaN(id)) {
    throw new Error('Invalid holon ID');
  }
  return id;
}

/**
 * Validate URL input
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL is required and must be a string');
  }

  try {
    const urlObj = new URL(url);
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are allowed');
    }
    return urlObj.toString();
  } catch (error) {
    throw new Error('Invalid URL format');
  }
}

/**
 * Validate email address
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required and must be a string');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  return email.toLowerCase().trim();
}

/**
 * Validate file path to prevent directory traversal
 */
export function validateFilePath(filePath, allowedExtensions = []) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required and must be a string');
  }

  // Check for directory traversal attempts
  if (filePath.includes('..') || filePath.includes('~')) {
    throw new Error('Invalid file path: directory traversal not allowed');
  }

  // Check for absolute paths (in most cases we want relative paths)
  if (filePath.startsWith('/')) {
    throw new Error('Absolute file paths not allowed');
  }

  // Validate file extension if specified
  if (allowedExtensions.length > 0) {
    const extension = filePath.split('.').pop().toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      throw new Error(`File extension not allowed. Allowed: ${allowedExtensions.join(', ')}`);
    }
  }

  return sanitizeString(filePath, { trim: true });
}

/**
 * Validate and parse JSON input
 */
export function validateJSON(jsonString) {
  if (!jsonString || typeof jsonString !== 'string') {
    throw new Error('JSON string is required');
  }

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error('Invalid JSON format');
  }
}

/**
 * Validate numeric input with optional range
 */
export function validateNumber(value, options = {}) {
  const num = parseFloat(value);
  
  if (isNaN(num)) {
    throw new Error('Value must be a valid number');
  }

  if (options.min !== undefined && num < options.min) {
    throw new Error(`Value must be at least ${options.min}`);
  }

  if (options.max !== undefined && num > options.max) {
    throw new Error(`Value must be at most ${options.max}`);
  }

  if (options.integer && !Number.isInteger(num)) {
    throw new Error('Value must be an integer');
  }

  return num;
}

/**
 * Validate command input (for bot commands)
 */
export function validateCommand(command) {
  if (!command || typeof command !== 'string') {
    throw new Error('Command is required and must be a string');
  }

  const sanitized = command.trim().toLowerCase();

  // Commands should start with / or be alphanumeric
  if (!sanitized.match(/^[a-zA-Z0-9_/]+$/)) {
    throw new Error('Invalid command format');
  }

  return sanitized;
}

/**
 * Validate date input
 */
export function validateDate(dateInput) {
  if (!dateInput) {
    throw new Error('Date is required');
  }

  const date = new Date(dateInput);
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date format');
  }

  return date;
}

/**
 * Validation middleware for common patterns
 */
export const validators = {
  telegramMessage: (text) => validateTelegramInput(text),
  userId: (id) => validateUserId(id),
  holonId: (id) => validateholonId(id),
  url: (url) => validateUrl(url),
  email: (email) => validateEmail(email),
  filePath: (path, extensions) => validateFilePath(path, extensions),
  json: (str) => validateJSON(str),
  number: (val, opts) => validateNumber(val, opts),
  command: (cmd) => validateCommand(cmd),
  date: (date) => validateDate(date),
};

/**
 * Create a validation wrapper that logs validation errors
 */
export function createValidationWrapper(validatorFn, context = '') {
  return function(input, ...args) {
    try {
      return validatorFn(input, ...args);
    } catch (error) {
      log.warn('Validation failed', {
        context,
        error: error.message,
        input: typeof input === 'string' ? input.substring(0, 100) : input,
      });
      throw error;
    }
  };
}