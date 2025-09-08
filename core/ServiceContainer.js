import { config } from '../utils/config.js';

// Simple logger for ServiceContainer to avoid circular dependency
const simpleLog = {
  debug: (message, meta = {}) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEBUG] ${message}`, meta);
    }
  },
  info: (message, meta = {}) => {
    console.log(`[INFO] ${message}`, meta);
  },
  error: (message, meta = {}) => {
    console.error(`[ERROR] ${message}`, meta);
  },
  warn: (message, meta = {}) => {
    console.warn(`[WARN] ${message}`, meta);
  }
};

/**
 * Dependency Injection Container for HolonsBot
 * Manages service lifecycle and dependencies
 */
export class ServiceContainer {
  constructor() {
    this.services = new Map();
    this.factories = new Map();
    this.singletons = new Map();
    this.initialized = new Set();
  }

  /**
   * Register a service factory
   */
  register(name, factory, options = {}) {
    this.factories.set(name, {
      factory,
      singleton: options.singleton !== false, // Default to singleton
      dependencies: options.dependencies || [],
      initialized: false,
    });

    simpleLog.debug('Service registered', { name, dependencies: options.dependencies });
  }

  /**
   * Get a service instance
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

      simpleLog.debug('Service initialized', { name });
      return instance;

    } catch (error) {
      this.services.delete(name);
      simpleLog.error('Failed to initialize service', { name, error: error.message });
      throw error;
    }
  }

  /**
   * Check if a service is registered
   */
  has(name) {
    return this.factories.has(name);
  }

  /**
   * Get all service names
   */
  getServiceNames() {
    return Array.from(this.factories.keys());
  }

  /**
   * Initialize all registered services in dependency order
   */
  async initializeAll() {
    const serviceNames = this.getServiceNames();
    simpleLog.info('Initializing all services', { count: serviceNames.length, services: serviceNames });

    const startTime = Date.now();
    
    try {
      // Initialize services sequentially to handle dependencies properly
      for (const name of serviceNames) {
        await this.get(name);
      }
      
      const duration = Date.now() - startTime;
      simpleLog.info('All services initialized successfully', { duration, count: serviceNames.length });
      
    } catch (error) {
      simpleLog.error('Failed to initialize all services', { error: error.message });
      throw error;
    }
  }

  /**
   * Shutdown all services
   */
  async shutdown() {
    simpleLog.info('Shutting down services');
    
    const shutdownPromises = [];
    
    for (const [name, instance] of this.singletons) {
      if (instance && typeof instance.shutdown === 'function') {
        shutdownPromises.push(
          instance.shutdown().catch(error => {
            simpleLog.error('Error shutting down service', { name, error: error.message });
          })
        );
      }
    }

    await Promise.all(shutdownPromises);
    
    this.services.clear();
    this.singletons.clear();
    this.initialized.clear();
    
    simpleLog.info('All services shut down');
  }

  /**
   * Get service dependency graph for debugging
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
   * Validate service dependencies
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
    
    simpleLog.debug('All dependencies validated successfully');
  }

  /**
   * Create a scoped container (for testing)
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