/**
 * HoloSphere-to-AD4M Adapter
 *
 * Implements the same interface/API shape as HoloSphere so it can serve as
 * a drop-in replacement in Harvest components. Components currently use:
 *
 *   holosphere.get(holonId, lens, key?)
 *   holosphere.getAll(holonId, lens)
 *   holosphere.put(holonId, lens, data)
 *   holosphere.put(holonId, lens, key, value)   [overload]
 *   holosphere.delete(holonId, lens, key?)
 *   holosphere.subscribe(holonId, lens, callback)
 *
 * This adapter translates those calls into AD4M Subject Class operations:
 * - get/getAll → Ad4mModel.findAll() or Ad4mModel.query().get()
 * - put → new Ad4mModel(perspective); Object.assign(); await .save()
 * - delete → instance.delete()
 * - subscribe → Ad4mModel.query(perspective).subscribe()
 *
 * Each holonId maps to an AD4M Perspective (local) or Neighbourhood (shared).
 * Each lens maps to a Subject Class via LENS_MODEL_MAP.
 *
 * Discovery is agent-centric: there is no global registry or namespace.
 * Each agent maintains a local holon index (see AgentHolonIndex in registry.ts).
 * Holons are discovered socially — shared via neighbourhood URLs between agents.
 *
 * @module ad4m/adapter
 */

import { Ad4mClient, Ad4mModel, PerspectiveProxy } from '@coasys/ad4m';
import { Ad4mConnection, Ad4mConnectionConfig } from './connection';
import {
  LENS_MODEL_MAP,
  ALL_SUBJECT_CLASSES,
  HolonSettings,
  Quest,
  HolonMember,
  ShoppingItem,
  CouncilAdvisor,
  Chromosome,
  DNASequence,
  QuestTreeNode,
  FederationLink,
  OfferWant,
  Role,
  Badge,
  Invite,
  GenericData,
} from './models/index';

/** Options for put operations (matches HoloSphere API) */
export interface PutOptions {
  /** Identity to act as (maps to actingAs in HoloSphere) */
  actingAs?: string;
  /** Whether to suppress error notifications */
  silent?: boolean;
}

/** Subscription handle matching HoloSphere's API */
export interface Subscription {
  unsubscribe: () => void;
}

/**
 * HoloSphereAd4mAdapter — drop-in replacement for HoloSphere using AD4M.
 *
 * This adapter maintains the exact API shape that Harvest components expect
 * from the HoloSphere library, while routing all data through AD4M's
 * Subject Class system and Perspective/Neighbourhood storage.
 *
 * ## Architecture
 *
 * ```
 * Component → adapter.get(holonId, 'quests')
 *                ↓
 *            getPerspective(holonId) → PerspectiveProxy
 *                ↓
 *            getModelForLens('quests') → Quest (Ad4mModel class)
 *                ↓
 *            Quest.findAll(perspective) → Quest instances
 *                ↓
 *            Convert to HoloSphere-compatible format
 *                ↓
 *            Return to component
 * ```
 *
 * ## Data Format Conversion
 *
 * HoloSphere stores data as flat JSON objects with an `id` field.
 * AD4M stores data as Subject Class instances with a `baseExpression` identifier.
 *
 * The adapter converts between these formats:
 * - On read: Ad4mModel instance → plain object with `id` set to baseExpression
 * - On write: plain object → Ad4mModel instance with properties assigned
 *
 * ## Usage
 *
 * ```typescript
 * const adapter = new HoloSphereAd4mAdapter({
 *   executorUrl: 'ws://localhost:12000/graphql',
 *   token: 'your-jwt-token'
 * });
 * await adapter.connect();
 *
 * // Use exactly like HoloSphere:
 * const quests = await adapter.getAll(holonId, 'quests');
 * await adapter.put(holonId, 'quests', { title: 'New Quest', status: 'ongoing' });
 * ```
 *
 * TODO: Test all methods with a real AD4M executor.
 * TODO: Handle cases where the perspective doesn't exist yet (auto-create?).
 * TODO: Implement federation-related methods (federate, getFederation, etc.).
 */
export class HoloSphereAd4mAdapter {
  private connection: Ad4mConnection;
  private perspectiveCache: Map<string, PerspectiveProxy> = new Map();
  private sdnaInitialized: Set<string> = new Set();
  private subscriptionDisposers: Map<string, (() => void)[]> = new Map();

  /**
   * Create a new adapter instance.
   *
   * @param config - AD4M executor connection configuration
   */
  constructor(config: Ad4mConnectionConfig) {
    this.connection = new Ad4mConnection(config);
  }

  /**
   * Connect to the AD4M executor.
   * Must be called before any data operations.
   *
   * @returns The underlying Ad4mClient
   */
  async connect(): Promise<Ad4mClient> {
    return this.connection.connect();
  }

  /**
   * Initialize (alias for connect, matching HoloSphere.init()).
   */
  async init(): Promise<void> {
    await this.connect();
  }

  /** Whether the adapter has an active connection */
  get isConnected(): boolean {
    return this.connection.isConnected;
  }

  /** Get the underlying Ad4mConnection for advanced operations */
  get ad4mConnection(): Ad4mConnection {
    return this.connection;
  }

  // ===========================================================================
  // Core CRUD Operations (matches HoloSphere API)
  // ===========================================================================

  /**
   * Get data from a holon's lens, optionally by key.
   *
   * Matches HoloSphere.get(holonId, lens, key?)
   *
   * @param holonId - The holon/perspective UUID
   * @param lens - The lens name (e.g., 'settings', 'quests', 'users')
   * @param key - Optional key/ID to get a specific item
   * @returns The data object or null if not found
   */
  async get(holonId: string, lens: string, key?: string): Promise<any> {
    const perspective = await this.ensurePerspective(holonId);
    const ModelClass = this.getModelForLens(lens);
    const isGeneric = ModelClass === GenericData;

    if (key) {
      // Get specific instance by key (base expression)
      try {
        const results = await ModelClass.findAll(perspective);

        if (isGeneric) {
          // For GenericData, match by stored key field
          const match = results.find((instance: any) => {
            return instance.key === key || instance.baseExpression === key;
          });
          if (!match) return null;
          try { return JSON.parse((match as any).data); } catch { return (match as any).data; }
        }

        const match = results.find((instance: any) => {
          return instance.baseExpression === key || instance.id === key;
        });

        return match ? this.instanceToObject(match) : null;
      } catch (error) {
        console.error(`[Ad4mAdapter] get(${holonId}, ${lens}, ${key}) failed:`, error);
        return null;
      }
    }

    // Get first/only instance (useful for settings which has exactly 1)
    try {
      const results = await ModelClass.findAll(perspective);
      if (results.length === 0) return null;

      if (isGeneric) {
        // Return the first matching GenericData's parsed data
        const instance = results.find((r: any) => r.lens === lens) || results[0];
        try { return JSON.parse((instance as any).data); } catch { return (instance as any).data; }
      }

      return this.instanceToObject(results[0]);
    } catch (error) {
      console.error(`[Ad4mAdapter] get(${holonId}, ${lens}) failed:`, error);
      return null;
    }
  }

  /**
   * Get all items from a holon's lens.
   *
   * Matches HoloSphere.getAll(holonId, lens)
   *
   * @param holonId - The holon/perspective UUID
   * @param lens - The lens name
   * @returns Record of items keyed by their ID/baseExpression
   */
  async getAll(holonId: string, lens: string): Promise<Record<string, any>> {
    const perspective = await this.ensurePerspective(holonId);
    const ModelClass = this.getModelForLens(lens);
    const isGeneric = ModelClass === GenericData;

    try {
      const results = await ModelClass.findAll(perspective);
      const record: Record<string, any> = {};

      for (const instance of results) {
        if (isGeneric) {
          // Filter GenericData to only this lens, and parse data
          if ((instance as any).lens && (instance as any).lens !== lens) continue;
          const key = (instance as any).key || (instance as any).baseExpression;
          try { record[key] = JSON.parse((instance as any).data); } catch { record[key] = (instance as any).data; }
        } else {
          const obj = this.instanceToObject(instance);
          const id = obj.id || (instance as any).baseExpression;
          record[id] = obj;
        }
      }

      return record;
    } catch (error) {
      console.error(`[Ad4mAdapter] getAll(${holonId}, ${lens}) failed:`, error);
      return {};
    }
  }

  /**
   * Write data to a holon's lens.
   *
   * Matches HoloSphere.put(holonId, lens, value)
   * Also supports: HoloSphere.put(holonId, lens, key, value) via overload detection.
   *
   * If the data has an `id` or matches an existing base expression, it updates.
   * Otherwise, it creates a new instance.
   *
   * @param holonId - The holon/perspective UUID
   * @param lens - The lens name
   * @param dataOrKey - The data object, or a key if 4th arg is provided
   * @param valueOrOptions - The value (if key was 3rd arg) or options
   */
  async put(
    holonId: string,
    lens: string,
    dataOrKey: any,
    valueOrOptions?: any
  ): Promise<void> {
    const perspective = await this.ensurePerspective(holonId);
    const ModelClass = this.getModelForLens(lens);
    const isGeneric = ModelClass === GenericData;

    // Detect overload: put(holonId, lens, key, value) vs put(holonId, lens, data)
    let data: any;
    let key: string | undefined;

    if (typeof dataOrKey === 'string' && valueOrOptions !== undefined && typeof valueOrOptions === 'object') {
      // Called as put(holonId, lens, key, value)
      key = dataOrKey;
      data = valueOrOptions;
    } else {
      // Called as put(holonId, lens, data)
      data = dataOrKey;
    }

    try {
      if (isGeneric) {
        // For GenericData: store as JSON with lens and key metadata
        const storageKey = key || data?.id || '';
        const existing = await GenericData.findAll(perspective);
        let instance = existing.find((inst: any) =>
          inst.lens === lens && (inst.key === storageKey || (!storageKey && inst.lens === lens))
        );

        if (instance) {
          (instance as any).data = JSON.stringify(data);
          (instance as any).updatedAt = Date.now();
          await (instance as any).update();
        } else {
          const newInstance = new GenericData(perspective);
          newInstance.data = JSON.stringify(data);
          newInstance.key = storageKey;
          newInstance.lens = lens;
          newInstance.updatedAt = Date.now();
          await newInstance.save();
        }
        return;
      }

      // Check if this is an update (existing instance) or create (new instance)
      const existingId = key || data?.id || data?.baseExpression;
      let instance: any;

      if (existingId) {
        // Try to find existing instance
        const existing = await ModelClass.findAll(perspective);
        instance = existing.find((inst: any) => {
          return inst.baseExpression === existingId || (inst as any).id === existingId;
        });
      }

      if (instance) {
        // Update existing instance
        this.assignDataToInstance(instance, data);
        await instance.update();
      } else {
        // Create new instance
        instance = new ModelClass(perspective);
        this.assignDataToInstance(instance, data);
        await instance.save();
      }
    } catch (error) {
      console.error(`[Ad4mAdapter] put(${holonId}, ${lens}) failed:`, error);
      throw error;
    }
  }

  /**
   * Delete data from a holon's lens.
   *
   * Matches HoloSphere.delete(holonId, lens, key?)
   *
   * @param holonId - The holon/perspective UUID
   * @param lens - The lens name
   * @param key - The key/ID of the item to delete
   */
  async delete(holonId: string, lens: string, key?: string): Promise<void> {
    const perspective = await this.ensurePerspective(holonId);
    const ModelClass = this.getModelForLens(lens);
    const isGeneric = ModelClass === GenericData;

    if (!key) {
      console.warn(`[Ad4mAdapter] delete called without key for lens: ${lens}`);
      return;
    }

    try {
      const existing = await ModelClass.findAll(perspective);
      let instance: any;

      if (isGeneric) {
        instance = existing.find((inst: any) =>
          inst.lens === lens && (inst.key === key || inst.baseExpression === key)
        );
      } else {
        instance = existing.find((inst: any) => {
          return inst.baseExpression === key || (inst as any).id === key;
        });
      }

      if (instance) {
        await instance.delete();
      } else {
        console.warn(`[Ad4mAdapter] delete: instance not found for key ${key} in lens ${lens}`);
      }
    } catch (error) {
      console.error(`[Ad4mAdapter] delete(${holonId}, ${lens}, ${key}) failed:`, error);
      throw error;
    }
  }

  /**
   * Read data (alias for get, matching HoloSphere.read()).
   */
  async read(holonId: string, lens: string, key?: string): Promise<any> {
    return this.get(holonId, lens, key);
  }

  /**
   * Write data (alias for put, matching HoloSphere.write()).
   */
  async write(holonId: string, lens: string, data: any, options?: any): Promise<void> {
    return this.put(holonId, lens, data, options);
  }

  /**
   * Wait for the adapter to be ready (pass-through for HoloSphere.ready()).
   * In AD4M mode, this ensures the connection is established.
   */
  async ready(): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
  }

  /**
   * Get the client-like object (provides publicKey compatibility).
   * In AD4M, the "public key" is the agent DID.
   */
  get client(): { publicKey: string | null } {
    return {
      get publicKey(): string | null {
        // Return null; the actual DID is resolved asynchronously via getAgentDid()
        return null;
      }
    };
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /**
   * Subscribe to real-time updates for a holon's lens.
   *
   * Matches HoloSphere.subscribe(holonId, lens, callback)
   *
   * Uses AD4M's live query subscription system. The callback receives
   * individual data items as they change (matching HoloSphere's event-based API).
   *
   * @param holonId - The holon/perspective UUID
   * @param lens - The lens name
   * @param callback - Called with (data, key) on each update
   * @returns Subscription handle with unsubscribe() method
   *
   * TODO: Test with real executor — subscription behavior may differ from
   * HoloSphere's GunDB-based subscriptions (which fire per-item vs per-query).
   */
  subscribe(
    holonId: string,
    lens: string,
    callback: (data: any, key: string) => void
  ): Subscription {
    const ModelClass = this.getModelForLens(lens);
    let disposed = false;
    let queryDisposer: (() => void) | null = null;

    if (!ModelClass) {
      console.warn(`[Ad4mAdapter] No model mapped for lens: ${lens}`);
      return { unsubscribe: () => {} };
    }

    // Set up subscription asynchronously
    const setupSubscription = async () => {
      try {
        const perspective = await this.ensurePerspective(holonId);
        const builder = ModelClass.query(perspective);

        await builder.subscribe((results: any[]) => {
          if (disposed) return;

          // Convert each result to HoloSphere format and call callback
          for (const instance of results) {
            const obj = this.instanceToObject(instance);
            const key = obj.id || instance.baseExpression;
            callback(obj, key);
          }
        });

        // Store disposer for cleanup
        queryDisposer = () => builder.dispose();

        // Track subscription for cleanup
        const subKey = `${holonId}:${lens}`;
        if (!this.subscriptionDisposers.has(subKey)) {
          this.subscriptionDisposers.set(subKey, []);
        }
        this.subscriptionDisposers.get(subKey)!.push(() => builder.dispose());
      } catch (error) {
        console.error(`[Ad4mAdapter] subscribe(${holonId}, ${lens}) failed:`, error);
      }
    };

    // Fire and forget — subscription setup is async but HoloSphere API is sync
    setupSubscription();

    return {
      unsubscribe: () => {
        disposed = true;
        if (queryDisposer) queryDisposer();
      },
    };
  }

  // ===========================================================================
  // Profile Operations (stub — matches HoloSphere API)
  // ===========================================================================

  /**
   * Get holon profile.
   *
   * In AD4M, this maps to the HolonSettings instance in the perspective.
   * TODO: Implement properly when profile format is finalized.
   */
  async getHolonProfile(holonId: string): Promise<any> {
    return this.get(holonId, 'settings');
  }

  /**
   * Set holon profile.
   */
  async setHolonProfile(holonId: string, profile: any): Promise<void> {
    return this.put(holonId, 'settings', profile);
  }

  // ===========================================================================
  // Federation Operations (stub)
  // ===========================================================================

  /**
   * Federate two holons by creating FederationLink instances.
   *
   * In agent-centric AD4M, federation creates a FederationLink in the source
   * holon's perspective pointing to the target holon's neighbourhood URL.
   * Discovery of federated holons works by walking these links.
   *
   * @param sourceHolonId - Perspective UUID of the source holon
   * @param targetNeighbourhoodUrl - Neighbourhood URL of the target holon
   * @param targetName - Display name of the target holon
   * @param relationship - Relationship type (default: 'federated')
   * @param inboundLenses - Lenses to accept data from the target
   * @param outboundLenses - Lenses to share with the target
   */
  async federate(
    sourceHolonId: string,
    targetNeighbourhoodUrl: string,
    targetName: string,
    relationship: string = 'federated',
    inboundLenses: string[] = [],
    outboundLenses: string[] = [],
  ): Promise<void> {
    const perspective = await this.ensurePerspective(sourceHolonId);

    const link = new FederationLink(perspective);
    link.targetNeighbourhood = targetNeighbourhoodUrl;
    link.targetName = targetName;
    link.relationship = relationship;
    link.inboundLenses = inboundLenses;
    link.outboundLenses = outboundLenses;

    await link.save();
  }

  /**
   * Get federation links for a holon.
   *
   * Returns all FederationLink instances from the holon's perspective,
   * representing the holons it is federated with.
   */
  async getFederation(holonId: string): Promise<any> {
    return this.getAll(holonId, 'federation');
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Dispose of all subscriptions and disconnect.
   */
  async dispose(): Promise<void> {
    // Dispose all subscriptions
    for (const [_, disposers] of this.subscriptionDisposers) {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch (e) {
          // ignore
        }
      }
    }
    this.subscriptionDisposers.clear();
    this.perspectiveCache.clear();
    this.sdnaInitialized.clear();
    await this.connection.disconnect();
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  /**
   * Get or create a PerspectiveProxy for a holon ID and ensure SDNA is registered.
   *
   * The first time a perspective is accessed, all Holons subject classes are
   * registered via ensureSDNASubjectClass(). This is idempotent on the AD4M side.
   */
  private async ensurePerspective(holonId: string): Promise<PerspectiveProxy> {
    if (this.perspectiveCache.has(holonId)) {
      return this.perspectiveCache.get(holonId)!;
    }

    const perspective = await this.connection.getPerspective(holonId);

    // Register all subject classes if not done yet for this perspective
    if (!this.sdnaInitialized.has(holonId)) {
      await this.registerAllSubjectClasses(perspective);
      this.sdnaInitialized.add(holonId);
    }

    this.perspectiveCache.set(holonId, perspective);
    return perspective;
  }

  /**
   * Register all Holons subject classes in a perspective's SDNA.
   *
   * This ensures the perspective knows about all our data types.
   * ensureSDNASubjectClass is idempotent — if the class already exists,
   * it's a no-op.
   *
   * TODO: Consider lazy registration (only register classes as they're used)
   * for better startup performance.
   */
  private async registerAllSubjectClasses(perspective: PerspectiveProxy): Promise<void> {
    for (const ModelClass of ALL_SUBJECT_CLASSES) {
      try {
        await perspective.ensureSDNASubjectClass(ModelClass);
      } catch (error) {
        console.error(`[Ad4mAdapter] Failed to register SDNA for ${(ModelClass as any).className}:`, error);
      }
    }
  }

  /**
   * Get the Ad4mModel subclass for a given HoloSphere lens name.
   * Falls back to GenericData for unmapped lenses so all data is preserved.
   */
  private getModelForLens(lens: string): typeof Ad4mModel {
    return LENS_MODEL_MAP[lens] || GenericData;
  }

  /**
   * Convert an Ad4mModel instance to a plain object matching HoloSphere's format.
   *
   * HoloSphere returns plain JSON objects with an `id` field.
   * Ad4mModel instances have properties defined by decorators, plus
   * metadata like baseExpression, author, timestamp.
   */
  private instanceToObject(instance: any): any {
    const obj: any = {};

    // Copy all enumerable own properties
    for (const [key, value] of Object.entries(instance)) {
      // Skip internal/metadata properties
      if (key.startsWith('_') || key.startsWith('#')) continue;
      obj[key] = value;
    }

    // Ensure `id` is set (HoloSphere convention)
    if (!obj.id) {
      obj.id = instance.baseExpression;
    }

    // Include AD4M metadata for debugging/advanced use
    obj._baseExpression = instance.baseExpression;
    if (instance.author) obj._author = instance.author;
    if (instance.timestamp) obj._timestamp = instance.timestamp;

    return obj;
  }

  /**
   * Assign data from a plain object to an Ad4mModel instance.
   *
   * Handles the mapping from HoloSphere's flat JSON format to
   * Ad4mModel's property-based system.
   */
  private assignDataToInstance(instance: any, data: any): void {
    if (!data || typeof data !== 'object') return;

    for (const [key, value] of Object.entries(data)) {
      // Skip internal fields
      if (key === 'id' || key === '_baseExpression' || key === '_author' || key === '_timestamp') continue;
      // Skip undefined values
      if (value === undefined) continue;

      // Check if this property exists on the instance
      // (Ad4mModel instances have all properties defined via decorators)
      if (key in instance || Object.getPrototypeOf(instance).hasOwnProperty(key)) {
        try {
          instance[key] = value;
        } catch (e) {
          // Some properties might be read-only (Flag-decorated)
          // Silently skip those
        }
      }
    }
  }
}
