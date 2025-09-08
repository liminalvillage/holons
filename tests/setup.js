// Test setup file
import { vi } from 'vitest';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.BOT_TOKEN = 'test_token';
process.env.OPENAI_API_KEY = 'test_key';

// Mock console methods to reduce test output noise
global.console = {
  ...console,
  // Keep log functionality but can be overridden in specific tests
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};