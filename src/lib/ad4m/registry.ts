/**
 * Agent Holon Index — Agent-centric holon discovery
 *
 * In AD4M's agent-centric model, there is no global registry. Instead:
 *
 * 1. Each agent maintains a **local holon index** — a private perspective
 *    that tracks all holons they know about (created, joined, or shared by others).
 * 2. Discovery happens **socially** — agents share neighbourhood URLs with
 *    each other via expression channels or shared perspectives.
 * 3. Federation works through `FederationLink` instances in each holon's
 *    own perspective, enabling graph-walking discovery.
 * 4. Optional **directory perspectives** can exist for opt-in discoverability,
 *    but they are not required infrastructure — just another neighbourhood
 *    you can choose to publish to.
 *
 * Architecture:
 * ```
 * ┌──────────────────────────────────────┐
 * │  Agent's Local Holon Index           │  (private perspective)
 * │  (tracks all holons this agent       │
 * │   knows about)                       │
 * │                                      │
 * │  HolonIndexEntry instances:          │
 * │    - name, description               │
 * │    - neighbourhoodUrl (if shared)    │
 * │    - perspectiveUuid (local ref)     │
 * │    - source: created|joined|shared   │
 * │    - sharedBy (DID of sharer)        │
 * └──────────────────────────────────────┘
 *          ↓ references ↓
 * ┌────────┐  ┌────────┐  ┌────────┐
 * │Holon A │  │Holon B │  │Holon C │
 * │(local) │  │(neigh.)│  │(neigh.)│
 * └────────┘  └────────┘  └────────┘
 * ```
 *
 * Discovery flows:
 * - **Create**: Agent creates a holon → entry added to their index
 * - **Join**: Agent joins a neighbourhood URL → entry added to their index
 * - **Share**: Another agent sends a neighbourhood URL → entry added with sharedBy DID
 * - **Federate**: Walking FederationLinks in a holon's perspective reveals related holons
 * - **Directory** (opt-in): Agent publishes entry to a shared directory neighbourhood
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
// Index Entry Subject Class
// =============================================================================

/**
 * An entry in the agent's local holon index.
 *
 * This subject class lives in the agent's private index perspective.
 * It tracks a holon the agent knows about — whether they created it,
 * joined it, or received a reference from another agent.
 */
@ModelOptions({ name: 'HolonIndexEntry' })
export class HolonIndexEntry extends Ad4mModel {
  /** The holon's display name */
  @Property({ through: 'holons://index/name', resolveLanguage: 'literal' })
  name: string = '';

  /** Brief description */
  @Optional({ through: 'holons://index/description', resolveLanguage: 'literal' })
  description?: string;

  /**
   * The Neighbourhood URL of the holon (if it has been published/shared).
   * Null for purely local holons that haven't been shared yet.
   */
  @Optional({ through: 'holons://index/neighbourhoodUrl' })
  neighbourhoodUrl?: string;

  /**
   * Local perspective UUID for this holon.
   * Every holon the agent knows about has a local perspective
   * (created locally or obtained by joining a neighbourhood).
   */
  @Property({ through: 'holons://index/perspectiveUuid', resolveLanguage: 'literal' })
  perspectiveUuid: string = '';

  /**
   * How this agent learned about this holon.
   * - "created": Agent created this holon
   * - "joined": Agent joined an existing neighbourhood
   * - "shared": Another agent shared the reference
   */
  @Property({ through: 'holons://index/source', resolveLanguage: 'literal' })
  source: string = 'created';

  /** DID of the agent who shared this holon reference (if source is "shared") */
  @Optional({ through: 'holons://index/sharedBy' })
  sharedBy?: string;

  /** Image/logo URL */
  @Optional({ through: 'holons://index/image', resolveLanguage: 'literal' })
  image?: string;

  /** Tags for local filtering/categorization */
  @Collection({ through: 'holons://index/tag' })
  tags: string[] = [];

  @Flag({ through: 'holons://type', value: 'holons://holonIndexEntry' })
  type: string = '';
}

// =============================================================================
// Shared Holon Reference (for agent-to-agent sharing)
// =============================================================================

/**
 * A reference to a holon shared between agents.
 *
 * When Agent A wants to tell Agent B about a holon, they create a
 * SharedHolonRef in a perspective that both agents can read (e.g., a
 * shared social perspective, a DM channel, or a community neighbourhood).
 *
 * The receiving agent can then join the neighbourhood and add a
 * HolonIndexEntry to their local index.
 */
@ModelOptions({ name: 'SharedHolonRef' })
export class SharedHolonRef extends Ad4mModel {
  /** Name of the holon being shared */
  @Property({ through: 'holons://shared/name', resolveLanguage: 'literal' })
  name: string = '';

  /** Brief description */
  @Optional({ through: 'holons://shared/description', resolveLanguage: 'literal' })
  description?: string;

  /** The neighbourhood URL to join */
  @Property({ through: 'holons://shared/neighbourhoodUrl' })
  neighbourhoodUrl: string = '';

  /** DID of the agent sharing this reference */
  @Optional({ through: 'holons://shared/sharedBy' })
  sharedBy?: string;

  /** Optional message from the sharer */
  @Optional({ through: 'holons://shared/message', resolveLanguage: 'literal' })
  message?: string;

  /** Image/logo URL */
  @Optional({ through: 'holons://shared/image', resolveLanguage: 'literal' })
  image?: string;

  @Flag({ through: 'holons://type', value: 'holons://sharedHolonRef' })
  type: string = '';
}

// =============================================================================
// Agent Holon Index Manager
// =============================================================================

/**
 * Manages the agent's local holon index for discovery and organization.
 *
 * Each agent has a private perspective that serves as their personal index
 * of all holons they know about. This replaces the old global registry pattern.
 *
 * Usage:
 * ```typescript
 * const index = new AgentHolonIndex(ad4mConnection);
 * await index.initialize();
 *
 * // Track a holon the agent created
 * await index.trackCreated({
 *   name: 'My Community',
 *   perspectiveUuid: 'abc-123',
 *   neighbourhoodUrl: 'neighbourhood://...',
 *   tags: ['community']
 * });
 *
 * // List all holons this agent knows about
 * const holons = await index.listAll();
 *
 * // Share a holon with another agent via a shared perspective
 * await index.shareHolon(sharedPerspective, {
 *   name: 'My Community',
 *   neighbourhoodUrl: 'neighbourhood://...',
 * });
 *
 * // Receive shared holons from a shared perspective
 * const shared = await index.receiveSharedHolons(sharedPerspective);
 * ```
 */
export class AgentHolonIndex {
  private connection: Ad4mConnection;
  private indexPerspective: PerspectiveProxy | null = null;

  constructor(connection: Ad4mConnection) {
    this.connection = connection;
  }

  /** Whether the index has been initialized */
  get isInitialized(): boolean {
    return this.indexPerspective !== null;
  }

  /** The underlying index perspective (for advanced use) */
  get perspective(): PerspectiveProxy | null {
    return this.indexPerspective;
  }

  /**
   * Initialize the agent's holon index.
   *
   * Looks for an existing "Holon Index" perspective or creates one.
   * This is always a local (private) perspective — never a neighbourhood.
   */
  async initialize(): Promise<void> {
    // Look for existing index perspective
    const allPerspectives = await this.connection.getAllPerspectives();
    const existing = allPerspectives.find(p => p.name === 'Holon Index');

    if (existing) {
      this.indexPerspective = existing;
    } else {
      this.indexPerspective = await this.connection.createPerspective('Holon Index');
    }

    // Ensure SDNA is registered
    await this.indexPerspective.ensureSDNASubjectClass(HolonIndexEntry);
  }

  /**
   * List all holons this agent knows about.
   */
  async listAll(): Promise<HolonIndexEntry[]> {
    this.ensureInitialized();
    return HolonIndexEntry.findAll(this.indexPerspective!);
  }

  /**
   * Search for holons in the agent's index.
   */
  async search(criteria: {
    name?: string;
    source?: string;
    tags?: string[];
  }): Promise<HolonIndexEntry[]> {
    this.ensureInitialized();

    const where: Record<string, any> = {};
    if (criteria.name) where.name = criteria.name;
    if (criteria.source) where.source = criteria.source;

    const results = await HolonIndexEntry.findAll(this.indexPerspective!, {
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
   * Track a holon that this agent created.
   */
  async trackCreated(info: {
    name: string;
    perspectiveUuid: string;
    neighbourhoodUrl?: string;
    description?: string;
    image?: string;
    tags?: string[];
  }): Promise<HolonIndexEntry> {
    return this.addEntry({ ...info, source: 'created' });
  }

  /**
   * Track a holon that this agent joined.
   */
  async trackJoined(info: {
    name: string;
    perspectiveUuid: string;
    neighbourhoodUrl: string;
    description?: string;
    image?: string;
    tags?: string[];
  }): Promise<HolonIndexEntry> {
    return this.addEntry({ ...info, source: 'joined' });
  }

  /**
   * Track a holon that was shared with this agent by another agent.
   */
  async trackShared(info: {
    name: string;
    perspectiveUuid: string;
    neighbourhoodUrl: string;
    sharedBy: string;
    description?: string;
    image?: string;
    tags?: string[];
  }): Promise<HolonIndexEntry> {
    return this.addEntry({ ...info, source: 'shared' });
  }

  /**
   * Share a holon reference with other agents by creating a SharedHolonRef
   * in a shared perspective (e.g., a community neighbourhood or DM channel).
   *
   * @param sharedPerspective - A perspective that other agents can read
   * @param info - The holon reference to share
   */
  async shareHolon(
    sharedPerspective: PerspectiveProxy,
    info: {
      name: string;
      neighbourhoodUrl: string;
      description?: string;
      image?: string;
      message?: string;
    }
  ): Promise<SharedHolonRef> {
    await sharedPerspective.ensureSDNASubjectClass(SharedHolonRef);

    const ref = new SharedHolonRef(sharedPerspective);
    ref.name = info.name;
    ref.neighbourhoodUrl = info.neighbourhoodUrl;
    if (info.description) ref.description = info.description;
    if (info.image) ref.image = info.image;
    if (info.message) ref.message = info.message;

    // Set sharer DID
    try {
      ref.sharedBy = await this.connection.getAgentDid();
    } catch {
      console.warn('[AgentHolonIndex] Could not get agent DID for shared ref');
    }

    await ref.save();
    return ref;
  }

  /**
   * Receive shared holon references from a shared perspective.
   *
   * Scans a shared perspective for SharedHolonRef instances that this
   * agent hasn't already added to their index.
   *
   * @param sharedPerspective - The perspective to scan for shared references
   * @returns Array of SharedHolonRef instances found
   */
  async receiveSharedHolons(sharedPerspective: PerspectiveProxy): Promise<SharedHolonRef[]> {
    await sharedPerspective.ensureSDNASubjectClass(SharedHolonRef);
    return SharedHolonRef.findAll(sharedPerspective);
  }

  /**
   * Update an existing index entry.
   */
  async update(
    entryBaseExpression: string,
    updates: Partial<{
      name: string;
      description: string;
      image: string;
      neighbourhoodUrl: string;
      tags: string[];
    }>
  ): Promise<void> {
    this.ensureInitialized();

    const entries = await HolonIndexEntry.findAll(this.indexPerspective!);
    const entry = entries.find(e => e.baseExpression === entryBaseExpression);

    if (!entry) {
      throw new Error(`Index entry not found: ${entryBaseExpression}`);
    }

    if (updates.name !== undefined) entry.name = updates.name;
    if (updates.description !== undefined) entry.description = updates.description;
    if (updates.image !== undefined) entry.image = updates.image;
    if (updates.neighbourhoodUrl !== undefined) entry.neighbourhoodUrl = updates.neighbourhoodUrl;
    if (updates.tags !== undefined) entry.tags = updates.tags;

    await entry.update();
  }

  /**
   * Remove a holon from the agent's index.
   * This does NOT delete the holon itself — just removes the agent's reference to it.
   */
  async remove(entryBaseExpression: string): Promise<void> {
    this.ensureInitialized();

    const entries = await HolonIndexEntry.findAll(this.indexPerspective!);
    const entry = entries.find(e => e.baseExpression === entryBaseExpression);

    if (!entry) {
      throw new Error(`Index entry not found: ${entryBaseExpression}`);
    }

    await entry.delete();
  }

  /**
   * Find an index entry by perspective UUID.
   */
  async getByPerspectiveUuid(perspectiveUuid: string): Promise<HolonIndexEntry | null> {
    this.ensureInitialized();

    const results = await HolonIndexEntry.findAll(this.indexPerspective!, {
      where: { perspectiveUuid },
    });

    return results[0] || null;
  }

  /**
   * Find an index entry by neighbourhood URL.
   */
  async getByNeighbourhoodUrl(neighbourhoodUrl: string): Promise<HolonIndexEntry | null> {
    this.ensureInitialized();

    const results = await HolonIndexEntry.findAll(this.indexPerspective!, {
      where: { neighbourhoodUrl },
    });

    return results[0] || null;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private async addEntry(info: {
    name: string;
    perspectiveUuid: string;
    source: string;
    neighbourhoodUrl?: string;
    sharedBy?: string;
    description?: string;
    image?: string;
    tags?: string[];
  }): Promise<HolonIndexEntry> {
    this.ensureInitialized();

    const entry = new HolonIndexEntry(this.indexPerspective!);
    entry.name = info.name;
    entry.perspectiveUuid = info.perspectiveUuid;
    entry.source = info.source;

    if (info.neighbourhoodUrl) entry.neighbourhoodUrl = info.neighbourhoodUrl;
    if (info.sharedBy) entry.sharedBy = info.sharedBy;
    if (info.description) entry.description = info.description;
    if (info.image) entry.image = info.image;

    await entry.save();

    if (info.tags && info.tags.length > 0) {
      entry.tags = info.tags;
      await entry.update();
    }

    return entry;
  }

  private ensureInitialized(): PerspectiveProxy {
    if (!this.indexPerspective) {
      throw new Error('AgentHolonIndex not initialized. Call initialize() first.');
    }
    return this.indexPerspective;
  }
}
