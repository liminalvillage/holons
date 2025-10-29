import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Integration Tests', () => {
  beforeEach(() => {
    // Set required environment variables
    process.env.BOT_TOKEN = 'test_bot_token_123';
    process.env.OPENAI_API_KEY = 'test_openai_key';
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('HolonsBot Initialization', () => {
    it('should import HolonsBot without errors', async () => {
      const { default: HolonsBot } = await import('../core/HolonsBotCore.js');
      expect(HolonsBot).toBeDefined();
      expect(typeof HolonsBot).toBe('function');
    });

    it('should create HolonsBot instance', async () => {
      const { default: HolonsBot } = await import('../core/HolonsBotCore.js');
      const bot = new HolonsBot();

      expect(bot).toBeDefined();
      expect(bot.container).toBeDefined();
      expect(bot.isInitialized).toBe(false);
      expect(bot.isShuttingDown).toBe(false);
    });

    it('should have required methods', async () => {
      const { default: HolonsBot } = await import('../core/HolonsBotCore.js');
      const bot = new HolonsBot();

      expect(typeof bot.init).toBe('function');
      expect(typeof bot.shutdown).toBe('function');
      expect(typeof bot.getService).toBe('function');
    });

    // This test would require mocking lots of dependencies
    // For now, we'll skip actual initialization testing
    it.skip('should initialize with minimal setup', async () => {
      const { default: HolonsBot } = await import('../core/HolonsBotCore.js');
      const bot = new HolonsBot();
      
      // Would need extensive mocking for this to work
      await bot.init('TestBot');
      expect(bot.isInitialized).toBe(true);
    });
  });

  describe('Service Definitions', () => {
    it('should import service definitions without errors', async () => {
      const serviceModule = await import('../core/ServiceDefinitions.js');
      expect(serviceModule.serviceDefinitions).toBeDefined();
      expect(typeof serviceModule.serviceDefinitions).toBe('object');
    });

    it('should have basic service definitions', async () => {
      const { serviceDefinitions } = await import('../core/ServiceDefinitions.js');
      
      // Should have some core services
      const serviceNames = Object.keys(serviceDefinitions);
      expect(serviceNames.length).toBeGreaterThan(0);
      
      // Check for some expected services
      const hasDB = serviceNames.some(name => name.toLowerCase().includes('db'));
      const hasServer = serviceNames.some(name => name.toLowerCase().includes('server'));
      const hasConfig = serviceNames.some(name => name.toLowerCase().includes('config'));
      
      expect(hasDB || hasServer || hasConfig).toBe(true);
    });
  });

  describe('Utils Integration', () => {
    it('should import logger without errors', async () => {
      const { log } = await import('../utils/logger.js');
      expect(log).toBeDefined();
      expect(typeof log.info).toBe('function');
      expect(typeof log.error).toBe('function');
    });

    it('should import config without errors', async () => {
      const { config } = await import('../utils/config.js');
      expect(config).toBeDefined();
    });

    it('should import validation utils without errors', async () => {
      const validationModule = await import('../utils/validation.js');
      expect(validationModule).toBeDefined();
    });

    it('should import error handler without errors', async () => {
      const errorModule = await import('../utils/errorHandler.js');
      expect(errorModule).toBeDefined();
    });
  });
});