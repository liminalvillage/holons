import { config } from '../utils/config.js';
import { log } from '../utils/logger.js';

/**
 * Dependency Injection Container for managing service lifecycle and dependencies.
 *
 * @class ServiceContainer
 * @module core/ServiceContainer
 * @description A lightweight DI container that handles service registration, dependency
 * resolution, singleton management, and graceful shutdown of all services.
 *
 * @property {Map<string, *>} services - Map of service names to instances during initialization
 * @property {Map<string, Object>} factories - Map of service names to factory definitions
 * @property {Map<string, *>} singletons - Map of singleton service names to cached instances
 * @property {Set<string>} initialized - Set of service names that have been initialized
 *
 * @example
 * const container = new ServiceContainer();
 * container.register('database', (deps) => new DB(), { singleton: true });
 * container.register('users', (deps) => new Users(deps.database), { dependencies: ['database'] });
 * await container.initializeAll();
 * const users = await container.get('users');
 */
export class ServiceContainer {
  /**
   * Creates a new ServiceContainer instance.
   * @constructor
   */
  constructor() {
    this.services = new Map();
    this.factories = new Map();
    this.singletons = new Map();
    this.initialized = new Set();
  }

  /**
   * Registers a service factory with the container.
   * @param {string} name - Unique name for the service
   * @param {Function} factory - Factory function that creates the service instance
   * @param {Object} [options={}] - Registration options
   * @param {boolean} [options.singleton=true] - Whether to cache the instance as a singleton
   * @param {string[]} [options.dependencies=[]] - Names of services this service depends on
   * @returns {void}
   */
  register(name, factory, options = {}) {
    this.factories.set(name, {
      factory,
      singleton: options.singleton !== false, // Default to singleton
      dependencies: options.dependencies || [],
      initialized: false,
    });

    log.debug('Service registered', { name, dependencies: options.dependencies });
  }

  /**
   * Gets a service instance, creating it if necessary.
   * @async
   * @param {string} name - The name of the service to retrieve
   * @returns {Promise<*>} The service instance
   * @throws {Error} If service not found or circular dependency detected
   */
  async get(name) {
    // Return existing singleton if available
    if (this.singletons.has(name)) {
      return this.singletons.get(name);
    }

    const serviceDefinition = this.factories.get(name);
    if (!serviceDefinition) {
      throw new Error(`Service '${name}' not found`);
    }

    // Prevent circular dependencies during initialization
    if (this.services.has(name)) {
      throw new Error(`Circular dependency detected for service '${name}'`);
    }

    this.services.set(name, 'initializing');

    try {
      // Resolve dependencies first
      const dependencies = {};
      for (const depName of serviceDefinition.dependencies) {
        dependencies[depName] = await this.get(depName);
      }

      // Create the service instance
      const instance = await serviceDefinition.factory(dependencies, this);
      
      // Store as singleton if configured
      if (serviceDefinition.singleton) {
        this.singletons.set(name, instance);
      }

      this.services.set(name, instance);
      this.initialized.add(name);

      log.debug('Service initialized', { name });
      return instance;

    } catch (error) {
      this.services.delete(name);
      log.error('Failed to initialize service', { name, error: error.message });
      throw error;
    }
  }

  /**
   * Checks if a service is registered in the container.
   * @param {string} name - The service name to check
   * @returns {boolean} True if the service is registered
   */
  has(name) {
    return this.factories.has(name);
  }

  /**
   * Gets all registered service names.
   * @returns {string[]} Array of service names
   */
  getServiceNames() {
    return Array.from(this.factories.keys());
  }

  /**
   * Initializes all registered services in dependency order.
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If any service fails to initialize
   */
  async initializeAll() {
    const serviceNames = this.getServiceNames();
    log.info('Initializing all services', { count: serviceNames.length, services: serviceNames });

    const startTime = Date.now();
    
    try {
      // Initialize services sequentially to handle dependencies properly
      for (const name of serviceNames) {
        await this.get(name);
      }
      
      const duration = Date.now() - startTime;
      log.info('All services initialized successfully', { duration, count: serviceNames.length });
      
    } catch (error) {
      log.error('Failed to initialize all services', { error: error.message });
      throw error;
    }
  }

  /**
   * Shuts down all services that have a shutdown method.
   * @async
   * @returns {Promise<void>}
   */
  async shutdown() {
    log.info('Shutting down services');
    
    const shutdownPromises = [];
    
    for (const [name, instance] of this.singletons) {
      if (instance && typeof instance.shutdown === 'function') {
        shutdownPromises.push(
          instance.shutdown().catch(error => {
            log.error('Error shutting down service', { name, error: error.message });
          })
        );
      }
    }

    await Promise.all(shutdownPromises);
    
    this.services.clear();
    this.singletons.clear();
    this.initialized.clear();
    
    log.info('All services shut down');
  }

  /**
   * Gets the service dependency graph for debugging purposes.
   * @returns {Object.<string, {dependencies: string[], singleton: boolean, initialized: boolean}>} Dependency graph
   */
  getDependencyGraph() {
    const graph = {};
    
    for (const [name, definition] of this.factories) {
      graph[name] = {
        dependencies: definition.dependencies,
        singleton: definition.singleton,
        initialized: this.initialized.has(name),
      };
    }
    
    return graph;
  }

  /**
   * Validates that all service dependencies are registered.
   * @returns {void}
   * @throws {Error} If any dependencies are missing
   */
  validateDependencies() {
    const errors = [];
    
    for (const [name, definition] of this.factories) {
      for (const depName of definition.dependencies) {
        if (!this.has(depName)) {
          errors.push(`Service '${name}' depends on unregistered service '${depName}'`);
        }
      }
    }
    
    if (errors.length > 0) {
      throw new Error(`Dependency validation failed:\n${errors.join('\n')}`);
    }
    
    log.debug('All dependencies validated successfully', {});
  }

  /**
   * Creates a scoped container with copied factory definitions (useful for testing).
   * @returns {ServiceContainer} A new container with copied factory definitions
   */
  createScope() {
    const scope = new ServiceContainer();
    
    // Copy factory definitions
    for (const [name, definition] of this.factories) {
      scope.factories.set(name, { ...definition });
    }
    
    return scope;
  }
}

export default ServiceContainer;