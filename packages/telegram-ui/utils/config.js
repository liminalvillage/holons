/**
 * @fileoverview Configuration management for HolonsBot.
 * @module utils/config
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { log } from './logger.js';

// Load the monorepo root .env first (single source of truth shared with web + mcp-ui),
// then fall through to a local .env if any package-specific overrides exist.
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config();

/**
 * Configuration management class providing type-safe access to environment variables.
 *
 * @class Config
 * @description Provides methods for retrieving string, number, and boolean environment
 * variables with defaults and validation. Includes commonly used configuration properties.
 *
 * @property {string} botToken - Telegram bot token
 * @property {string} appName - Application name
 * @property {boolean} isDevelopment - Whether running in development mode
 * @property {number} port - Server port
 * @property {string} dashboardAddress - Dashboard URL
 *
 * @example
 * import { config } from './utils/config.js';
 * const token = config.botToken;
 * const customVar = config.getString('MY_VAR', 'default');
 */
class Config {
  /**
   * Creates a new Config instance and validates required environment variables.
   * @constructor
   */
  constructor() {
    this.validateRequiredEnvVars();
  }

  /**
   * Get string environment variable with optional default
   */
  getString(key, defaultValue = null) {
    const value = process.env[key];
    if (value === undefined) {
      if (defaultValue === null) {
        log.warn(`Missing environment variable: ${key}`);
      }
      return defaultValue;
    }
    return value;
  }

  /**
   * Get number environment variable with optional default
   */
  getNumber(key, defaultValue = null) {
    const value = process.env[key];
    if (value === undefined) {
      if (defaultValue === null) {
        log.warn(`Missing environment variable: ${key}`);
      }
      return defaultValue;
    }
    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) {
      log.warn(`Invalid number format for ${key}: ${value}`);
      return defaultValue;
    }
    return numValue;
  }

  /**
   * Get boolean environment variable with optional default
   */
  getBoolean(key, defaultValue = false) {
    const value = process.env[key];
    if (value === undefined) {
      return defaultValue;
    }
    return value.toLowerCase() === 'true';
  }

  /**
   * Get required environment variable (throws if missing)
   */
  getRequired(key) {
    const value = process.env[key];
    if (!value) {
      const error = `Required environment variable missing: ${key}`;
      log.error(error);
      throw new Error(error);
    }
    return value;
  }

  /**
   * Validate that all required environment variables are present
   */
  validateRequiredEnvVars() {
    const required = [
      'BOT_TOKEN',
      // Add other required variables as needed
    ];

    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      const error = `Missing required environment variables: ${missing.join(', ')}`;
      log.error(error);
      throw new Error(error);
    }
  }

  // Bot Configuration
  get botToken() {
    return this.getRequired('BOT_TOKEN');
  }

  get openaiApiKey() {
    return this.getString('OPENAI_API_KEY');
  }

  get discordToken() {
    return this.getString('DISCORD_TOKEN');
  }

  // Server Configuration
  get port() {
    return this.getNumber('PORT', process.env.NODE_ENV === 'production' ? 443 : 8080);
  }

  get nodeEnv() {
    return this.getString('NODE_ENV', 'development');
  }

  get isProduction() {
    return this.nodeEnv === 'production';
  }

  get isDevelopment() {
    return this.nodeEnv === 'development';
  }

  // Dashboard Configuration
  get dashboardAddress() {
    return this.getString('DASHBOARD_ADDRESS', 'https://dashboard.holons.io');
  }

  // Feature Flags
  get showQuestsAsImages() {
    return this.getBoolean('SHOW_QUESTS_AS_IMAGES', true);
  }

  get questImageFastMode() {
    return this.getBoolean('QUEST_IMAGE_FAST_MODE', true);
  }

  // Database Configuration
  get dbPath() {
    return this.getString('DB_PATH', './radata');
  }

  // Logging Configuration
  get logLevel() {
    return this.getString('LOG_LEVEL', this.isProduction ? 'warn' : 'debug');
  }

  // Security Configuration
  get sessionSecret() {
    return this.getString('SESSION_SECRET', 'holonsbot-secret-key-change-in-production');
  }

  get corsOrigin() {
    return this.getString('CORS_ORIGIN', '*');
  }

  // Rate Limiting Configuration
  get rateLimitWindowMs() {
    return this.getNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000); // 15 minutes
  }

  get rateLimitMax() {
    return this.getNumber('RATE_LIMIT_MAX', 100); // 100 requests per window
  }

  // File Upload Configuration
  get maxFileSize() {
    return this.getNumber('MAX_FILE_SIZE', 10 * 1024 * 1024); // 10MB
  }

  get uploadPath() {
    return this.getString('UPLOAD_PATH', './images');
  }

  // SSL Configuration
  get sslKeyPath() {
    return this.getString('SSL_KEY_PATH', './certs/private-key.pem');
  }

  get sslCertPath() {
    return this.getString('SSL_CERT_PATH', './certs/certificate.pem');
  }

  /**
   * Get all configuration as an object (excluding sensitive values)
   */
  toObject() {
    return {
      nodeEnv: this.nodeEnv,
      port: this.port,
      isProduction: this.isProduction,
      showQuestsAsImages: this.showQuestsAsImages,
      questImageFastMode: this.questImageFastMode,
      logLevel: this.logLevel,
      rateLimitWindowMs: this.rateLimitWindowMs,
      rateLimitMax: this.rateLimitMax,
      maxFileSize: this.maxFileSize,
      // Exclude sensitive values like tokens and keys
    };
  }
}

// Export singleton instance
export const config = new Config();
export default config;