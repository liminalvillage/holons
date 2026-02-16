/**
 * Holon Registry — Discovering holons across AD4M Neighbourhoods
 *
 * In the current HoloSphere system, holon discovery happens via:
 * - GunDB global namespace: holosphere.getGlobal('holons_registry', holonId)
 * - Known relay URLs for bootstrap
 *
 * In AD4M, we use a shared "Holon Registry" Neighbourhood that all holons
 * publish their metadata to. This enables:
 * - Discovering holons by name, tags, location, etc.
 * - Joining holon neighbourhoods from the registry
 * - Federation discovery (finding related holons)
 *
 * Architecture:
 * ```
 * ┌──────────────────────────────────┐
 * │  Holon Registry Neighbourhood    │  (shared by all Harvest users)
 * │                                  │
 * │  HolonRegistryEntry instances:   │
 * │    - name, description           │
 * │    - neighbourhoodUrl            │
 * │    - ownerDid                    │
 * │    - tags, location, status      │
 * └──────────────────────────────────┘
 *          ↓ join/discover ↓
 * ┌────────┐  ┌────────┐  ┌────────┐
 * │Holon A │  │Holon B │  │Holon C │
 * │(Neigh.)│  │(Neigh.)│  │(Neigh.)│
 * └────────┘  └────────┘  └────────┘
 * ```
 *
 * @module ad4m/registry
 */

import {
  Ad4mModel,
  ModelOptions,
  Property,
  Optional,
  Flag,
  Collection,
  PerspectiveProxy,
} from '@coasys/ad4m';
import { Ad4mConnection } from './connection';

// =============================================================================
// Registry Subject Class
// =============================================================================

/**
 * Registry entry for a holon published to the global registry.
 *
 * This subject class lives in the shared Registry Neighbourhood.
 * Each holon that wants to be discoverable creates one of these.
 */
@ModelOptions({ name: 'HolonRegistryEntry' })
export class HolonRegistryEntry extends Ad4mModel {
  /** The holon's display name */
  @Property({ through: 'holons://registry/name', resolveLanguage: 'literal' })
  name: string = '';

  /** Brief description */
  @Optional({ through: 'holons://registry/description', resolveLanguage: 'literal' })
  description?: string;

  /**
   * The Neighbourhood URL of the holon.
   * Other users can join this neighbourhood to become members.
   */
  @Property({ through: 'holons://registry/neighbourhoodUrl' })
  neighbourhoodUrl: string = '';

  /** DID of the holon's creator/admin */
  @Optional({ through: 'holons://registry/ownerDid' })
  ownerDid?: string;

  /** Image/logo URL */
  @Optional({ through: 'holons://registry/image', resolveLanguage: 'literal' })
  image?: string;

  /** Location (locality or region) */
  @Optional({ through: 'holons://registry/location', resolveLanguage: 'literal' })
  location?: string;

  /** Geographic scope: local, regional, national, international */
  @Optional({ through: 'holons://registry/geographicScope', resolveLanguage: 'literal' })
  geographicScope?: string;

  /** Current status: active, completed, on_hold, etc. */
  @Optional({ through: 'holons://registry/status', resolveLanguage: 'literal' })
  status?: string;

  /** Tags for discovery */
  @Collection({ through: 'holons://registry/tag' })
  tags: string[] = [];

  @Flag({ through: 'holons://type', value: 'holons://registryEntry' })
  type: string = '';
}

// =============================================================================
// Registry Manager
// =============================================================================

/**
 * Manages the global Holon Registry for discovery.
 *
 * The registry is a shared AD4M Neighbourhood that all Harvest users join.
 * It contains HolonRegistryEntry instances for each discoverable holon.
 *
 * Usage:
 * ```typescript
 * const registry = new HolonRegistry(ad4mConnection);
 * await registry.initialize(registryNeighbourhoodUrl);
 *
 * // Discover holons
 * const allHolons = await registry.listAll();
 * const filtered = await registry.search({ tags: ['regenerative'] });
 *
 * // Publish a holon
 * await registry.publish({
 *   name: 'My Community',
 *   neighbourhoodUrl: 'neighbourhood://...',
 *   tags: ['community', 'governance']
 * });
 * ```
 *
 * TODO: Test with a real AD4M executor and shared Neighbourhood.
 * TODO: Implement pagination for large registries.
 * TODO: Add caching layer for registry queries.
 */
export class HolonRegistry {
  private connection: Ad4mConnection;
  private registryPerspective: PerspectiveProxy | null = null;
  private registryUrl: string | null = null;

  constructor(connection: Ad4mConnection) {
    this.connection = connection;
  }

  /** Whether the registry has been initialized */
  get isInitialized(): boolean {
    return this.registryPerspective !== null;
  }

  /**
   * Initialize the registry by joining or creating the registry Neighbourhood.
   *
   * @param registryUrl - URL of the existing registry Neighbourhood.
   *   If not provided, a new local perspective is created (for development).
   *
   * TODO: In production, the registry URL would be a well-known constant
   * or discovered via a bootstrap mechanism.
   */
  async initialize(registryUrl?: string): Promise<void> {
    if (registryUrl) {
      // Join existing registry neighbourhood
      this.registryPerspective = await this.connection.joinNeighbourhood(registryUrl);
      this.registryUrl = registryUrl;
    } else {
      // Create a local perspective for development
      this.registryPerspective = await this.connection.createPerspective('Holons Registry (dev)');
    }

    // Ensure SDNA is registered
    await this.registryPerspective.ensureSDNASubjectClass(HolonRegistryEntry);
  }

  /**
   * List all holons in the registry.
   *
   * @returns Array of registry entries
   */
  async listAll(): Promise<HolonRegistryEntry[]> {
    this.ensureInitialized();
    return HolonRegistryEntry.findAll(this.registryPerspective!);
  }

  /**
   * Search for holons matching criteria.
   *
   * @param criteria - Search filters
   * @returns Matching registry entries
   *
   * TODO: Implement more sophisticated search (e.g., geospatial proximity).
   */
  async search(criteria: {
    name?: string;
    tags?: string[];
    status?: string;
    geographicScope?: string;
  }): Promise<HolonRegistryEntry[]> {
    this.ensureInitialized();

    const where: Record<string, any> = {};

    if (criteria.name) {
      where.name = criteria.name;
    }
    if (criteria.status) {
      where.status = criteria.status;
    }
    if (criteria.geographicScope) {
      where.geographicScope = criteria.geographicScope;
    }

    // For tags, we need to find entries that have ALL specified tags
    // This is a limitation — AD4M collections don't support "contains all" queries easily
    // TODO: Implement tag filtering post-query if where clause isn't sufficient
    const results = await HolonRegistryEntry.findAll(this.registryPerspective!, {
      where: Object.keys(where).length > 0 ? where : undefined,
    });

    // Post-filter by tags if specified
    if (criteria.tags && criteria.tags.length > 0) {
      return results.filter(entry =>
        criteria.tags!.every(tag => entry.tags.includes(tag))
      );
    }

    return results;
  }

  /**
   * Publish a holon to the registry.
   *
   * Creates a HolonRegistryEntry instance in the registry Neighbourhood.
   *
   * @param info - Holon information to publish
   * @returns The created registry entry
   */
  async publish(info: {
    name: string;
    neighbourhoodUrl: string;
    description?: string;
    image?: string;
    location?: string;
    geographicScope?: string;
    status?: string;
    tags?: string[];
  }): Promise<HolonRegistryEntry> {
    this.ensureInitialized();

    const entry = new HolonRegistryEntry(this.registryPerspective!);
    entry.name = info.name;
    entry.neighbourhoodUrl = info.neighbourhoodUrl;

    if (info.description) entry.description = info.description;
    if (info.image) entry.image = info.image;
    if (info.location) entry.location = info.location;
    if (info.geographicScope) entry.geographicScope = info.geographicScope;
    if (info.status) entry.status = info.status;

    // Set owner DID
    try {
      const did = await this.connection.getAgentDid();
      entry.ownerDid = did;
    } catch (e) {
      console.warn('[HolonRegistry] Could not get agent DID for registry entry');
    }

    await entry.save();

    // Set tags via collection
    if (info.tags && info.tags.length > 0) {
      entry.tags = info.tags;
      await entry.update();
    }

    return entry;
  }

  /**
   * Update an existing registry entry.
   *
   * @param entryBaseExpression - The baseExpression of the entry to update
   * @param updates - Fields to update
   */
  async update(
    entryBaseExpression: string,
    updates: Partial<{
      name: string;
      description: string;
      image: string;
      location: string;
      geographicScope: string;
      status: string;
      tags: string[];
    }>
  ): Promise<void> {
    this.ensureInitialized();

    const entries = await HolonRegistryEntry.findAll(this.registryPerspective!);
    const entry = entries.find(e => e.baseExpression === entryBaseExpression);

    if (!entry) {
      throw new Error(`Registry entry not found: ${entryBaseExpression}`);
    }

    if (updates.name !== undefined) entry.name = updates.name;
    if (updates.description !== undefined) entry.description = updates.description;
    if (updates.image !== undefined) entry.image = updates.image;
    if (updates.location !== undefined) entry.location = updates.location;
    if (updates.geographicScope !== undefined) entry.geographicScope = updates.geographicScope;
    if (updates.status !== undefined) entry.status = updates.status;
    if (updates.tags !== undefined) entry.tags = updates.tags;

    await entry.update();
  }

  /**
   * Remove a holon from the registry.
   *
   * @param entryBaseExpression - The baseExpression of the entry to remove
   */
  async unpublish(entryBaseExpression: string): Promise<void> {
    this.ensureInitialized();

    const entries = await HolonRegistryEntry.findAll(this.registryPerspective!);
    const entry = entries.find(e => e.baseExpression === entryBaseExpression);

    if (!entry) {
      throw new Error(`Registry entry not found: ${entryBaseExpression}`);
    }

    await entry.delete();
  }

  /**
   * Get a specific registry entry by its neighbourhood URL.
   *
   * @param neighbourhoodUrl - The neighbourhood URL to look up
   * @returns The registry entry, or null if not found
   */
  async getByNeighbourhoodUrl(neighbourhoodUrl: string): Promise<HolonRegistryEntry | null> {
    this.ensureInitialized();

    const results = await HolonRegistryEntry.findAll(this.registryPerspective!, {
      where: { neighbourhoodUrl },
    });

    return results[0] || null;
  }

  private ensureInitialized(): PerspectiveProxy {
    if (!this.registryPerspective) {
      throw new Error('HolonRegistry not initialized. Call initialize() first.');
    }
    return this.registryPerspective;
  }
}
