/**
 * Dual-Write Adapter
 *
 * Wraps both HoloSphere and the AD4M adapter behind a single interface.
 * Depending on the configured mode, routes operations to one or both backends.
 *
 * Modes:
 * - 'holosphere': All ops go to HoloSphere only (default, no AD4M dependency)
 * - 'ad4m': All ops go to AD4M only (requires connected executor)
 * - 'dual': Writes go to both; reads come from HoloSphere (primary) with
 *           background validation against AD4M. Logs discrepancies.
 *
 * Components use this adapter exactly like they use HoloSphere today.
 * The mode switch is transparent — components never know which backend is active.
 *
 * @module ad4m/dual-adapter
 */

import type { HoloSphere } from 'holosphere';
import { HoloSphereAd4mAdapter, type Subscription } from './adapter';
import type { Ad4mConnectionConfig } from './connection';
import type { BackendMode } from './config';

/** Callback for dual-mode discrepancy logging */
export type DiscrepancyLogger = (
  operation: string,
  lens: string,
  holosphereResult: any,
  ad4mResult: any,
  details?: string
) => void;

/** Configuration for the DualWriteAdapter */
export interface DualAdapterConfig {
  /** The existing HoloSphere instance */
  holosphere: HoloSphere;
  /** AD4M connection config (only needed if mode != 'holosphere') */
  ad4mConfig?: Ad4mConnectionConfig;
  /** Which backend mode to use */
  mode: BackendMode;
  /** Optional discrepancy logger for dual mode */
  onDiscrepancy?: DiscrepancyLogger;
}

/**
 * Default discrepancy logger — writes to console.warn.
 */
const defaultDiscrepancyLogger: DiscrepancyLogger = (
  operation, lens, holosphereResult, ad4mResult, details
) => {
  console.warn(
    `[DualAdapter] Discrepancy in ${operation}(${lens}):`,
    { holosphereResult, ad4mResult, details }
  );
};

// =============================================================================
// Metrics
// =============================================================================

/** Per-operation latency and error tracking for a single backend */
export interface BackendMetrics {
  /** Total number of operations */
  totalOps: number;
  /** Total number of errors */
  errorCount: number;
  /** Cumulative latency in ms (divide by totalOps for average) */
  totalLatencyMs: number;
  /** Per-operation type breakdown */
  ops: Record<string, { count: number; errors: number; totalMs: number }>;
}

/** Combined metrics for both backends */
export interface DualAdapterMetrics {
  holosphere: BackendMetrics;
  ad4m: BackendMetrics;
  /** When metrics tracking started */
  since: number;
}

function createEmptyBackendMetrics(): BackendMetrics {
  return { totalOps: 0, errorCount: 0, totalLatencyMs: 0, ops: {} };
}

function recordOp(metrics: BackendMetrics, operation: string, durationMs: number, isError: boolean): void {
  metrics.totalOps++;
  metrics.totalLatencyMs += durationMs;
  if (isError) metrics.errorCount++;

  if (!metrics.ops[operation]) {
    metrics.ops[operation] = { count: 0, errors: 0, totalMs: 0 };
  }
  const op = metrics.ops[operation];
  op.count++;
  op.totalMs += durationMs;
  if (isError) op.errors++;
}

/**
 * DualWriteAdapter — transparent backend multiplexer.
 *
 * Implements the same API surface as HoloSphere so it can replace it
 * in the Svelte context without any component changes.
 *
 * Tracks per-operation latency and error counts for both backends.
 * Retrieve metrics via `getMetrics()`.
 *
 * ## Usage
 *
 * ```typescript
 * const adapter = new DualWriteAdapter({
 *   holosphere: existingHoloSphere,
 *   ad4mConfig: { executorUrl: 'ws://localhost:12000/graphql', token: '...' },
 *   mode: 'dual'
 * });
 * await adapter.init();
 *
 * // Now use exactly like HoloSphere:
 * const quests = await adapter.getAll(holonId, 'quests');
 *
 * // Check performance:
 * const metrics = adapter.getMetrics();
 * console.log('AD4M avg latency:', metrics.ad4m.totalLatencyMs / metrics.ad4m.totalOps);
 * ```
 */
export class DualWriteAdapter {
  private holosphere: HoloSphere;
  private ad4m: HoloSphereAd4mAdapter | null = null;
  private _mode: BackendMode;
  private logDiscrepancy: DiscrepancyLogger;
  private hsMetrics: BackendMetrics = createEmptyBackendMetrics();
  private ad4mMetrics: BackendMetrics = createEmptyBackendMetrics();
  private metricsSince: number = Date.now();

  constructor(config: DualAdapterConfig) {
    this.holosphere = config.holosphere;
    this._mode = config.mode;
    this.logDiscrepancy = config.onDiscrepancy ?? defaultDiscrepancyLogger;

    if (config.ad4mConfig && config.mode !== 'holosphere') {
      this.ad4m = new HoloSphereAd4mAdapter(config.ad4mConfig);
    }
  }

  /** Current backend mode */
  get mode(): BackendMode {
    return this._mode;
  }

  /** Switch modes at runtime */
  set mode(newMode: BackendMode) {
    this._mode = newMode;
  }

  /** Whether the AD4M adapter is connected */
  get isAd4mConnected(): boolean {
    return this.ad4m?.isConnected ?? false;
  }

  /** The underlying HoloSphere instance (for pass-through access) */
  get client(): any {
    // In AD4M-only mode, return the ad4m adapter's client stub
    if (this._mode === 'ad4m' && this.ad4m) {
      return this.ad4m.client;
    }
    return (this.holosphere as any).client;
  }

  /** Get the underlying HoloSphere instance for direct access */
  get holosphereInstance(): HoloSphere {
    return this.holosphere;
  }

  /** The underlying AD4M adapter (for advanced operations) */
  get ad4mAdapter(): HoloSphereAd4mAdapter | null {
    return this.ad4m;
  }

  /**
   * Get operation metrics for both backends.
   * Returns in-memory counters — no external dependencies.
   */
  getMetrics(): DualAdapterMetrics {
    return {
      holosphere: { ...this.hsMetrics, ops: { ...this.hsMetrics.ops } },
      ad4m: { ...this.ad4mMetrics, ops: { ...this.ad4mMetrics.ops } },
      since: this.metricsSince,
    };
  }

  /**
   * Reset all metrics counters.
   */
  resetMetrics(): void {
    this.hsMetrics = createEmptyBackendMetrics();
    this.ad4mMetrics = createEmptyBackendMetrics();
    this.metricsSince = Date.now();
  }

  /** Run an operation on a backend with metrics tracking */
  private async tracked<T>(
    backend: 'holosphere' | 'ad4m',
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const metrics = backend === 'holosphere' ? this.hsMetrics : this.ad4mMetrics;
    const start = Date.now();
    let isError = false;
    try {
      return await fn();
    } catch (err) {
      isError = true;
      throw err;
    } finally {
      recordOp(metrics, operation, Date.now() - start, isError);
    }
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the adapter(s).
   * In holosphere-only mode, this is a no-op (HoloSphere is already initialized).
   * In ad4m or dual mode, connects to the AD4M executor.
   */
  async init(): Promise<void> {
    if (this._mode !== 'holosphere' && this.ad4m) {
      try {
        await this.ad4m.connect();
        console.log('[DualAdapter] AD4M connected');
      } catch (error) {
        console.error('[DualAdapter] AD4M connection failed:', error);
        if (this._mode === 'ad4m') {
          throw error; // Fatal in ad4m-only mode
        }
        // In dual mode, continue with HoloSphere only
        console.warn('[DualAdapter] Falling back to HoloSphere-only (dual mode degraded)');
      }
    }
  }

  /**
   * Set up the AD4M adapter after construction (for lazy initialization).
   */
  async connectAd4m(config: Ad4mConnectionConfig): Promise<void> {
    this.ad4m = new HoloSphereAd4mAdapter(config);
    await this.ad4m.connect();
  }

  // ===========================================================================
  // HoloSphere-compatible ready()
  // ===========================================================================

  /** Wait for backend readiness (pass-through to HoloSphere) */
  async ready(): Promise<void> {
    // HoloSphere.ready() waits for Nostr backend
    if (typeof (this.holosphere as any).ready === 'function') {
      await (this.holosphere as any).ready();
    }
  }

  // ===========================================================================
  // Core CRUD — get
  // ===========================================================================

  /**
   * Get data from a holon's lens, optionally by key.
   * Matches HoloSphere.get(holonId, lens, key?)
   */
  async get(holonId: string, lens: string, key?: string): Promise<any> {
    switch (this._mode) {
      case 'holosphere':
        return this.tracked('holosphere', 'get', () => this.holosphere.get(holonId, lens, key));

      case 'ad4m':
        if (!this.ad4m) throw new Error('AD4M adapter not initialized');
        return this.tracked('ad4m', 'get', () => this.ad4m!.get(holonId, lens, key));

      case 'dual': {
        // Read from HoloSphere (primary)
        const hsResult = await this.tracked('holosphere', 'get', () => this.holosphere.get(holonId, lens, key));

        // Background validation against AD4M (fire-and-forget)
        if (this.ad4m?.isConnected) {
          this.tracked('ad4m', 'get', () => this.ad4m!.get(holonId, lens, key)).then((ad4mResult) => {
            if (hsResult && ad4mResult) {
              this.compareResults('get', lens, hsResult, ad4mResult);
            }
          }).catch((err) => {
            console.debug('[DualAdapter] AD4M background get failed:', err.message);
          });
        }

        return hsResult;
      }
    }
  }

  // ===========================================================================
  // Core CRUD — getAll
  // ===========================================================================

  /**
   * Get all items from a holon's lens.
   * Matches HoloSphere.getAll(holonId, lens)
   */
  async getAll(holonId: string, lens: string): Promise<Record<string, any>> {
    switch (this._mode) {
      case 'holosphere':
        return this.tracked('holosphere', 'getAll', () => this.holosphere.getAll(holonId, lens));

      case 'ad4m':
        if (!this.ad4m) throw new Error('AD4M adapter not initialized');
        return this.tracked('ad4m', 'getAll', () => this.ad4m!.getAll(holonId, lens));

      case 'dual': {
        const hsResult = await this.tracked('holosphere', 'getAll', () => this.holosphere.getAll(holonId, lens));

        if (this.ad4m?.isConnected) {
          this.tracked('ad4m', 'getAll', () => this.ad4m!.getAll(holonId, lens)).then((ad4mResult) => {
            const hsCount = Object.keys(hsResult || {}).length;
            const ad4mCount = Object.keys(ad4mResult || {}).length;
            if (hsCount !== ad4mCount) {
              this.logDiscrepancy(
                'getAll', lens, hsResult, ad4mResult,
                `Count mismatch: HoloSphere=${hsCount}, AD4M=${ad4mCount}`
              );
            }
          }).catch((err) => {
            console.debug('[DualAdapter] AD4M background getAll failed:', err.message);
          });
        }

        return hsResult;
      }
    }
  }

  // ===========================================================================
  // Core CRUD — put
  // ===========================================================================

  /**
   * Write data to a holon's lens.
   * Matches HoloSphere.put(holonId, lens, data, options?)
   */
  async put(holonId: string, lens: string, data: any, options?: any): Promise<void> {
    switch (this._mode) {
      case 'holosphere':
        return this.tracked('holosphere', 'put', () => this.holosphere.put(holonId, lens, data, options));

      case 'ad4m':
        if (!this.ad4m) throw new Error('AD4M adapter not initialized');
        return this.tracked('ad4m', 'put', () => this.ad4m!.put(holonId, lens, data, options));

      case 'dual': {
        // Write to HoloSphere first (primary)
        await this.tracked('holosphere', 'put', () => this.holosphere.put(holonId, lens, data, options));

        // Write to AD4M (background, non-blocking)
        if (this.ad4m?.isConnected) {
          this.tracked('ad4m', 'put', () => this.ad4m!.put(holonId, lens, data, options)).catch((err) => {
            console.error('[DualAdapter] AD4M background put failed:', err.message);
            this.logDiscrepancy('put', lens, data, null, `AD4M write failed: ${err.message}`);
          });
        }
        return;
      }
    }
  }

  /**
   * Write data (alias matching HoloSphere.write if it exists).
   */
  async write(holonId: string, lens: string, data: any, options?: any): Promise<void> {
    return this.put(holonId, lens, data, options);
  }

  // ===========================================================================
  // Read alias
  // ===========================================================================

  /** Read data (alias for get, matching HoloSphere.read()) */
  async read(holonId: string, lens: string, key?: string): Promise<any> {
    return this.get(holonId, lens, key);
  }

  // ===========================================================================
  // Core CRUD — delete
  // ===========================================================================

  /**
   * Delete data from a holon's lens.
   * Matches HoloSphere.delete(holonId, lens, key?)
   */
  async delete(holonId: string, lens: string, key?: string): Promise<void> {
    switch (this._mode) {
      case 'holosphere':
        return this.tracked('holosphere', 'delete', () => (this.holosphere as any).delete(holonId, lens, key));

      case 'ad4m':
        if (!this.ad4m) throw new Error('AD4M adapter not initialized');
        return this.tracked('ad4m', 'delete', () => this.ad4m!.delete(holonId, lens, key));

      case 'dual': {
        await this.tracked('holosphere', 'delete', () => (this.holosphere as any).delete(holonId, lens, key));

        if (this.ad4m?.isConnected) {
          this.tracked('ad4m', 'delete', () => this.ad4m!.delete(holonId, lens, key)).catch((err) => {
            console.error('[DualAdapter] AD4M background delete failed:', err.message);
          });
        }
        return;
      }
    }
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /**
   * Subscribe to real-time updates.
   * Matches HoloSphere.subscribe(holonId, lens, callback)
   */
  subscribe(
    holonId: string,
    lens: string,
    callback: (data: any, key: string) => void
  ): Subscription {
    let hsSub: { unsubscribe: () => void } | null = null;
    let ad4mSub: { unsubscribe: () => void } | null = null;

    switch (this._mode) {
      case 'holosphere':
        this.holosphere.subscribe(holonId, lens, callback).then(sub => {
          hsSub = sub;
        });
        return { unsubscribe: () => { if (hsSub) hsSub.unsubscribe(); } };

      case 'ad4m':
        if (!this.ad4m) throw new Error('AD4M adapter not initialized');
        return this.ad4m.subscribe(holonId, lens, callback);

      case 'dual': {
        // Subscribe to HoloSphere (primary)
        this.holosphere.subscribe(holonId, lens, callback).then(sub => {
          hsSub = sub;
        });

        // Also subscribe to AD4M for comparison logging (don't call user callback)
        if (this.ad4m?.isConnected) {
          ad4mSub = this.ad4m.subscribe(holonId, lens, (data, key) => {
            console.debug(`[DualAdapter] AD4M subscription update for ${lens}:${key}`);
          });
        }

        return {
          unsubscribe: () => {
            if (hsSub) hsSub.unsubscribe();
            if (ad4mSub) ad4mSub.unsubscribe();
          },
        };
      }
    }
  }

  // ===========================================================================
  // Agent-Local Operations (replaces global operations)
  // ===========================================================================

  /**
   * @deprecated Global lenses don't exist in agent-centric AD4M.
   * Data is either in a local perspective, a shared neighbourhood, or unknown.
   * Use per-holon get/put operations instead.
   */
  async writeGlobal(lens: string, ...args: any[]): Promise<void> {
    if (this._mode === 'ad4m') {
      console.warn('[DualAdapter] writeGlobal() has no equivalent in agent-centric AD4M. Use per-holon put() instead.');
      return;
    }
    return (this.holosphere as any).writeGlobal(lens, ...args);
  }

  /**
   * @deprecated Global lenses don't exist in agent-centric AD4M.
   * Use the AgentHolonIndex for discovery, or per-holon get() for data.
   */
  async getGlobal(lens: string, key?: string): Promise<any> {
    if (this._mode === 'ad4m') {
      console.warn('[DualAdapter] getGlobal() has no equivalent in agent-centric AD4M. Use AgentHolonIndex or per-holon get() instead.');
      return null;
    }
    return (this.holosphere as any).getGlobal(lens, key);
  }

  /**
   * @deprecated Global lenses don't exist in agent-centric AD4M.
   */
  async getAllGlobal(lens: string): Promise<Record<string, any>> {
    if (this._mode === 'ad4m') {
      console.warn('[DualAdapter] getAllGlobal() has no equivalent in agent-centric AD4M. Use AgentHolonIndex for discovery.');
      return {};
    }
    return (this.holosphere as any).getAllGlobal?.(lens) ?? {};
  }

  /** Get federation links for a holon */
  async getFederation(holonId: string): Promise<any> {
    if (this._mode === 'ad4m' && this.ad4m) {
      return this.ad4m.getFederation(holonId);
    }
    return (this.holosphere as any).getFederation?.(holonId);
  }

  // ===========================================================================
  // Profile Operations
  // ===========================================================================

  async getHolonProfile(holonId: string): Promise<any> {
    return this.get(holonId, 'settings');
  }

  async setHolonProfile(holonId: string, profile: any): Promise<void> {
    return this.put(holonId, 'settings', profile);
  }

  // ===========================================================================
  // Federation Operations (pass-through to HoloSphere)
  // ===========================================================================

  /**
   * Federation in AD4M uses FederationLink instances within each holon's
   * perspective, enabling graph-walking discovery between related holons.
   * In HoloSphere mode, this passes through to the existing implementation.
   */
  async federateHolon(...args: any[]): Promise<any> {
    if (this._mode === 'ad4m' && this.ad4m) {
      // In AD4M mode, use the adapter's federation method
      return this.ad4m.federate(args[0], args[1], args[2], args[3], args[4], args[5]);
    }
    return (this.holosphere as any).federateHolon?.(...args);
  }

  // ===========================================================================
  // Utility Methods (pass-through)
  // ===========================================================================

  /** Get public key from private key */
  async getPublicKey(privateKey: string): Promise<string> {
    return (this.holosphere as any).getPublicKey(privateKey);
  }

  /** Issue capability token */
  async issueCapability(...args: any[]): Promise<any> {
    return (this.holosphere as any).issueCapability?.(...args);
  }

  /** Check write permission */
  async canWrite(holonId: string, lens: string, actingAs: string, options?: any): Promise<any> {
    return (this.holosphere as any).canWrite?.(holonId, lens, actingAs, options);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Dispose of the AD4M adapter (if active).
   * HoloSphere cleanup is handled by the existing app lifecycle.
   */
  async dispose(): Promise<void> {
    if (this.ad4m) {
      await this.ad4m.dispose();
      this.ad4m = null;
    }
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  /**
   * Compare results from both backends and log discrepancies.
   * Used in dual mode for background validation.
   */
  private compareResults(
    operation: string,
    lens: string,
    hsResult: any,
    ad4mResult: any
  ): void {
    try {
      // Simple deep comparison — could be made smarter for known data shapes
      const hsKeys = typeof hsResult === 'object' ? Object.keys(hsResult) : [];
      const ad4mKeys = typeof ad4mResult === 'object' ? Object.keys(ad4mResult) : [];

      // Compare key counts
      if (hsKeys.length !== ad4mKeys.length) {
        this.logDiscrepancy(
          operation, lens, hsResult, ad4mResult,
          `Key count mismatch: HoloSphere=${hsKeys.length}, AD4M=${ad4mKeys.length}`
        );
        return;
      }

      // Compare key-level values for known important fields
      const importantKeys = ['name', 'title', 'status', 'id'];
      for (const key of importantKeys) {
        if (hsResult?.[key] !== undefined && ad4mResult?.[key] !== undefined) {
          if (String(hsResult[key]) !== String(ad4mResult[key])) {
            this.logDiscrepancy(
              operation, lens, hsResult, ad4mResult,
              `Value mismatch for "${key}": HoloSphere="${hsResult[key]}", AD4M="${ad4mResult[key]}"`
            );
          }
        }
      }
    } catch (e) {
      // Don't let comparison errors affect the main flow
      console.debug('[DualAdapter] Comparison error:', e);
    }
  }
}
