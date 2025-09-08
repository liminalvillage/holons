import { describe, it, expect, beforeEach, vi } from 'vitest';
import ServiceContainer from '../core/ServiceContainer.js';

describe('Refactored Architecture Tests', () => {
  let container;

  beforeEach(() => {
    container = new ServiceContainer();
    
    // Mock environment variables to prevent errors
    process.env.BOT_TOKEN = 'test_token';
    process.env.OPENAI_API_KEY = 'test_key';
  });

  describe('ServiceContainer', () => {
    it('should create a service container', () => {
      expect(container).toBeDefined();
      expect(container.services).toBeDefined();
      expect(container.factories).toBeDefined();
    });

    it('should register a simple service', () => {
      const mockFactory = vi.fn(() => ({ test: true }));
      
      container.register('testService', mockFactory, {
        dependencies: []
      });

      expect(container.factories.has('testService')).toBe(true);
    });

    it('should get a registered service', async () => {
      const mockService = { test: true };
      const mockFactory = vi.fn(() => mockService);
      
      container.register('testService', mockFactory, {
        dependencies: []
      });

      const service = await container.get('testService');
      expect(service).toBe(mockService);
      expect(mockFactory).toHaveBeenCalled();
    });

    it('should return singleton instances', async () => {
      const mockService = { test: true };
      const mockFactory = vi.fn(() => mockService);
      
      container.register('testService', mockFactory, {
        singleton: true,
        dependencies: []
      });

      const service1 = await container.get('testService');
      const service2 = await container.get('testService');
      
      expect(service1).toBe(service2);
      expect(mockFactory).toHaveBeenCalledTimes(1);
    });

    it('should throw error for unregistered service', async () => {
      await expect(container.get('nonExistentService'))
        .rejects
        .toThrow("Service 'nonExistentService' not found");
    });
  });

  describe('Service Dependencies', () => {
    it('should handle service dependencies', async () => {
      const depService = { name: 'dependency' };
      
      container.register('dep', () => depService, { dependencies: [] });
      container.register('main', async (dependencies) => {
        return { name: 'main', dep: dependencies.dep };
      }, { dependencies: ['dep'] });

      const service = await container.get('main');
      expect(service.dep).toBe(depService);
    });

    it('should detect circular dependencies', async () => {
      container.register('serviceA', async (dependencies, containerInstance) => {
        // This will cause circular dependency
        await containerInstance.get('serviceB');
        return { name: 'A' };
      }, { dependencies: [] });

      container.register('serviceB', async (dependencies, containerInstance) => {
        await containerInstance.get('serviceA');
        return { name: 'B' };
      }, { dependencies: [] });

      await expect(container.get('serviceA'))
        .rejects
        .toThrow(/Circular dependency detected/);
    });
  });
});