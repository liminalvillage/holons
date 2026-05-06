// `config` is imported for its side effect (dotenv.config()) and to keep the
// module import graph identical to the original JS source.
import '../utils/config.js';
import { log } from '../utils/logger.js';

/** Extracts a printable message from an unknown caught value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A factory function that produces a service instance.
 * Receives a map of resolved dependencies and the owning container.
 */
export type ServiceFactory<T = unknown> = (
  deps: Record<string, unknown>,
  container: ServiceContainer
) => T | Promise<T>;

/** Options accepted by {@link ServiceContainer.register}. */
export interface ServiceRegistrationOptions {
  /** Whether to cache the produced instance as a singleton. Defaults to `true`. */
  singleton?: boolean;
  /** Names of services that must be resolved before this factory runs. */
  dependencies?: string[];
}

/** Internal record stored per registered service. */
interface ServiceDefinition {
  factory: ServiceFactory;
  singleton: boolean;
  dependencies: string[];
  initialized: boolean;
}

/** Optional shutdown hook implemented by services that need cleanup. */
export interface Shutdownable {
  shutdown(): Promise<void> | void;
}

/** Shape returned by {@link ServiceContainer.getDependencyGraph}. */
export type DependencyGraph = Record<
  string,
  {
    dependencies: string[];
    singleton: boolean;
    initialized: boolean;
  }
>;

/**
 * Dependency Injection Container for managing service lifecycle and dependencies.
 *
 * @example
 * const container = new ServiceContainer();
 * container.register('database', () => new DB(), { singleton: true });
 * container.register('users', (deps) => new Users(deps.database), { dependencies: ['database'] });
 * await container.initializeAll();
 * const users = await container.get('users');
 */
export class ServiceContainer {
  /** Map of service names to instances during initialization (or the literal string `'initializing'`). */
  public services: Map<string, unknown>;
  /** Map of service names to factory definitions. */
  public factories: Map<string, ServiceDefinition>;
  /** Map of singleton service names to cached instances. */
  public singletons: Map<string, unknown>;
  /** Set of service names that have been initialized. */
  public initialized: Set<string>;

  constructor() {
    this.services = new Map();
    this.factories = new Map();
    this.singletons = new Map();
    this.initialized = new Set();
  }

  /** Registers a service factory with the container. */
  register<T = unknown>(
    name: string,
    factory: ServiceFactory<T>,
    options: ServiceRegistrationOptions = {}
  ): void {
    this.factories.set(name, {
      factory: factory as ServiceFactory,
      singleton: options.singleton !== false, // Default to singleton
      dependencies: options.dependencies || [],
      initialized: false,
    });

    log.debug('Service registered', { name, dependencies: options.dependencies });
  }

  /** Gets a service instance, creating it if necessary. */
  async get<T = unknown>(name: string): Promise<T> {
    // Return existing singleton if available
    if (this.singletons.has(name)) {
      return this.singletons.get(name) as T;
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
      const dependencies: Record<string, unknown> = {};
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
      return instance as T;
    } catch (error) {
      this.services.delete(name);
      log.error('Failed to initialize service', { name, error: errorMessage(error) });
      throw error;
    }
  }

  /** Checks if a service is registered in the container. */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /** Gets all registered service names. */
  getServiceNames(): string[] {
    return Array.from(this.factories.keys());
  }

  /** Initializes all registered services in dependency order. */
  async initializeAll(): Promise<void> {
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
      log.error('Failed to initialize all services', { error: errorMessage(error) });
      throw error;
    }
  }

  /** Shuts down all services that have a shutdown method. */
  async shutdown(): Promise<void> {
    log.info('Shutting down services');

    const shutdownPromises: Promise<unknown>[] = [];

    for (const [name, instance] of this.singletons) {
      const candidate = instance as Partial<Shutdownable> | null | undefined;
      if (candidate && typeof candidate.shutdown === 'function') {
        shutdownPromises.push(
          Promise.resolve(candidate.shutdown()).catch((error: unknown) => {
            log.error('Error shutting down service', { name, error: errorMessage(error) });
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

  /** Gets the service dependency graph for debugging purposes. */
  getDependencyGraph(): DependencyGraph {
    const graph: DependencyGraph = {};

    for (const [name, definition] of this.factories) {
      graph[name] = {
        dependencies: definition.dependencies,
        singleton: definition.singleton,
        initialized: this.initialized.has(name),
      };
    }

    return graph;
  }

  /** Validates that all service dependencies are registered. */
  validateDependencies(): void {
    const errors: string[] = [];

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

  /** Creates a scoped container with copied factory definitions (useful for testing). */
  createScope(): ServiceContainer {
    const scope = new ServiceContainer();

    // Copy factory definitions
    for (const [name, definition] of this.factories) {
      scope.factories.set(name, { ...definition });
    }

    return scope;
  }
}

export default ServiceContainer;
