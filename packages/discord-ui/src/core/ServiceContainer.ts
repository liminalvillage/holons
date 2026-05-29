/**
 * Dependency-injection container for Discord-UI services. Ported from
 * telegram-ui's `core/ServiceContainer.ts` (same lifecycle/dependency model)
 * so feature services can be wired the same way in both bots.
 */
import { log } from '../utils/logger.js';

export type ServiceFactory<T = unknown> = (
  deps: Record<string, unknown>,
  container: ServiceContainer
) => T | Promise<T>;

export interface ServiceRegistrationOptions {
  /** Cache the produced instance as a singleton. Defaults to `true`. */
  singleton?: boolean;
  /** Names of services that must resolve before this factory runs. */
  dependencies?: string[];
}

interface ServiceDefinition {
  factory: ServiceFactory;
  singleton: boolean;
  dependencies: string[];
}

export interface Shutdownable {
  shutdown(): Promise<void> | void;
}

export type DependencyGraph = Record<
  string,
  { dependencies: string[]; singleton: boolean; initialized: boolean }
>;

export class ServiceContainer {
  public factories: Map<string, ServiceDefinition> = new Map();
  public singletons: Map<string, unknown> = new Map();
  public initialized: Set<string> = new Set();
  private resolving: Set<string> = new Set();

  register<T = unknown>(
    name: string,
    factory: ServiceFactory<T>,
    options: ServiceRegistrationOptions = {}
  ): void {
    this.factories.set(name, {
      factory: factory as ServiceFactory,
      singleton: options.singleton !== false,
      dependencies: options.dependencies || [],
    });
    log.debug('Service registered', {
      name,
      dependencies: options.dependencies,
    });
  }

  async get<T = unknown>(name: string): Promise<T> {
    if (this.singletons.has(name)) return this.singletons.get(name) as T;

    const def = this.factories.get(name);
    if (!def) throw new Error(`Service '${name}' not found`);

    if (this.resolving.has(name)) {
      throw new Error(`Circular dependency detected for service '${name}'`);
    }
    this.resolving.add(name);

    try {
      const deps: Record<string, unknown> = {};
      for (const dep of def.dependencies) deps[dep] = await this.get(dep);

      const instance = await def.factory(deps, this);
      if (def.singleton) this.singletons.set(name, instance);
      this.initialized.add(name);
      log.debug('Service initialized', { name });
      return instance as T;
    } finally {
      this.resolving.delete(name);
    }
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  getServiceNames(): string[] {
    return Array.from(this.factories.keys());
  }

  async initializeAll(): Promise<void> {
    const names = this.getServiceNames();
    log.info('Initializing all services', { count: names.length });
    for (const name of names) await this.get(name);
  }

  validateDependencies(): void {
    const errors: string[] = [];
    for (const [name, def] of this.factories) {
      for (const dep of def.dependencies) {
        if (!this.has(dep)) {
          errors.push(
            `Service '${name}' depends on unregistered service '${dep}'`
          );
        }
      }
    }
    if (errors.length > 0) {
      throw new Error(`Dependency validation failed:\n${errors.join('\n')}`);
    }
  }

  async shutdown(): Promise<void> {
    const promises: Promise<unknown>[] = [];
    for (const [name, instance] of this.singletons) {
      const candidate = instance as Partial<Shutdownable> | null | undefined;
      if (candidate && typeof candidate.shutdown === 'function') {
        promises.push(
          Promise.resolve(candidate.shutdown()).catch((error: unknown) => {
            log.error('Error shutting down service', {
              name,
              error: String(error),
            });
          })
        );
      }
    }
    await Promise.all(promises);
    this.singletons.clear();
    this.initialized.clear();
  }

  getDependencyGraph(): DependencyGraph {
    const graph: DependencyGraph = {};
    for (const [name, def] of this.factories) {
      graph[name] = {
        dependencies: def.dependencies,
        singleton: def.singleton,
        initialized: this.initialized.has(name),
      };
    }
    return graph;
  }
}

export default ServiceContainer;
