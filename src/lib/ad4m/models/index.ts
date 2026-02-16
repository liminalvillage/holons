/**
 * AD4M Subject Class Definitions for Holons Data Types
 *
 * These classes define the semantic data models for Holons using AD4M's
 * decorator-based Subject Class system. Each class compiles to Prolog-based
 * Social DNA (SDNA) that defines how instances are stored as links in a
 * Perspective graph.
 *
 * Mapping from Harvest/HoloSphere concepts:
 * - Each HoloSphere "lens" (e.g., 'settings', 'quests', 'users') maps to
 *   one or more Subject Classes here.
 * - Data stored as key-value in GunDB/Nostr is decomposed into typed links
 *   with predicate URIs in the `holons://` namespace.
 * - Collections (arrays in HoloSphere) map to @Collection decorators.
 * - Complex nested objects are stored as JSON literals via resolveLanguage: "literal".
 *
 * Predicate namespace: `holons://` with sub-namespaces per entity type.
 * See Appendix A of the integration plan for the full predicate registry.
 *
 * @module ad4m/models
 */

import {
  Ad4mModel,
  ModelOptions,
  Property,
  Optional,
  ReadOnly,
  Flag,
  Collection,
} from '@coasys/ad4m';

// =============================================================================
// HolonSettings
// =============================================================================

/**
 * Settings for a Holon (maps to HoloSphere lens: 'settings').
 *
 * In HoloSphere, settings are stored as a single JSON object per holon.
 * In AD4M, each setting field becomes a typed link from the settings instance
 * base expression, allowing semantic queries across holons.
 *
 * HoloSphere access pattern:
 *   holosphere.get(holonId, 'settings', holonId)
 *   holosphere.put(holonId, 'settings', settingsObj)
 *
 * AD4M equivalent:
 *   HolonSettings.query(perspective).get() → returns array (should have exactly 1)
 *   new HolonSettings(perspective); settings.name = "..."; await settings.save()
 */
@ModelOptions({ name: 'HolonSettings' })
export class HolonSettings extends Ad4mModel {
  @Property({ through: 'holons://name', resolveLanguage: 'literal' })
  name: string = '';

  @Optional({ through: 'holons://purpose', resolveLanguage: 'literal' })
  purpose?: string;

  @Property({ through: 'holons://admin', resolveLanguage: 'literal' })
  admin: string = '';

  @Optional({ through: 'holons://hex', resolveLanguage: 'literal' })
  hex?: string;

  @Optional({ through: 'holons://timezone', resolveLanguage: 'literal' })
  timezone?: string;

  @Optional({ through: 'holons://language', resolveLanguage: 'literal' })
  language?: string;

  @Optional({ through: 'holons://theme', resolveLanguage: 'literal' })
  theme?: string;

  @Optional({ through: 'holons://image', resolveLanguage: 'literal' })
  image?: string;

  @Optional({ through: 'holons://description', resolveLanguage: 'literal' })
  description?: string;

  @Optional({ through: 'holons://locality', resolveLanguage: 'literal' })
  locality?: string;

  @Optional({ through: 'holons://region', resolveLanguage: 'literal' })
  region?: string;

  @Optional({ through: 'holons://countryName', resolveLanguage: 'literal' })
  countryName?: string;

  @Optional({ through: 'holons://primaryUrl', resolveLanguage: 'literal' })
  primaryUrl?: string;

  @Optional({ through: 'holons://rss', resolveLanguage: 'literal' })
  rss?: string;

  @Optional({ through: 'holons://geographicScope', resolveLanguage: 'literal' })
  geographicScope?: string;

  @Optional({ through: 'holons://status', resolveLanguage: 'literal' })
  status?: string;

  @Property({ through: 'holons://version', resolveLanguage: 'literal' })
  version: number = 1;

  /**
   * Flow management config stored as JSON literal.
   * Too complex for individual links at this stage.
   * NOTE: Consider decomposing into a sub-model if semantic queries on individual
   * flow management fields become necessary.
   */
  @Optional({ through: 'holons://flowManagement', resolveLanguage: 'literal' })
  flowManagement?: string;

  /**
   * Lens configuration stored as JSON literal.
   * Controls which lenses are visible/enabled for this holon.
   */
  @Optional({ through: 'holons://lensConfig', resolveLanguage: 'literal' })
  lensConfig?: string;

  /** Tags for discovery/categorization */
  @Collection({ through: 'holons://tag' })
  tags: string[] = [];

  /** Federation configuration links */
  @Collection({ through: 'holons://federationLink' })
  federationLinks: string[] = [];

  @Flag({ through: 'holons://type', value: 'holons://settings' })
  type: string = '';
}

// =============================================================================
// Quest
// =============================================================================

/**
 * A quest/task within a Holon (maps to HoloSphere lens: 'quests').
 *
 * Based on the quests_schema_v0.0.1.json which defines:
 * id, version, chat, initiator, title, picture, document, where, date,
 * when, completed, participants[], appreciation[], stoppers[], type, status.
 *
 * HoloSphere access pattern:
 *   holosphere.getAll(holonId, 'quests')
 *   holosphere.put(holonId, 'quests', questObj)
 *
 * AD4M equivalent:
 *   Quest.query(perspective).get()
 *   Quest.query(perspective).where({ status: 'ongoing' }).get()
 */
@ModelOptions({ name: 'Quest' })
export class Quest extends Ad4mModel {
  @Property({ through: 'holons://quest/title', resolveLanguage: 'literal' })
  title: string = '';

  @Optional({ through: 'holons://quest/version', resolveLanguage: 'literal' })
  version?: string;

  @Optional({ through: 'holons://quest/chat', resolveLanguage: 'literal' })
  chat?: string;

  @Optional({ through: 'holons://quest/initiator', resolveLanguage: 'literal' })
  initiator?: string;

  @Optional({ through: 'holons://quest/picture', resolveLanguage: 'literal' })
  picture?: string;

  @Optional({ through: 'holons://quest/document', resolveLanguage: 'literal' })
  document?: string;

  /**
   * Location stored as JSON literal (latitude/longitude object).
   * Maps to the "where" field in the quest schema.
   */
  @Optional({ through: 'holons://quest/location', resolveLanguage: 'literal' })
  location?: string;

  @Optional({ through: 'holons://quest/date', resolveLanguage: 'literal' })
  date?: number;

  @Property({ through: 'holons://quest/when', resolveLanguage: 'literal' })
  when: string = '';

  @Optional({ through: 'holons://quest/completed', resolveLanguage: 'literal' })
  completed?: string;

  @Property({ through: 'holons://quest/status', resolveLanguage: 'literal',
    initial: 'literal://string:ongoing' })
  status: string = 'ongoing';

  @Optional({ through: 'holons://quest/questType', resolveLanguage: 'literal' })
  questType?: string;

  /** Participant references (usernames, DIDs, or IDs) */
  @Collection({ through: 'holons://quest/participant' })
  participants: string[] = [];

  /** Appreciation entries */
  @Collection({ through: 'holons://quest/appreciation' })
  appreciation: string[] = [];

  /** Stopper entries */
  @Collection({ through: 'holons://quest/stopper' })
  stoppers: string[] = [];

  @Flag({ through: 'holons://type', value: 'holons://quest' })
  type: string = '';
}

// =============================================================================
// HolonMember
// =============================================================================

/**
 * A member of a Holon (maps to HoloSphere lens: 'users').
 *
 * In the current system, users are stored in GunDB with fields like:
 * id, username, first_name, last_name, picture, hours, etc.
 *
 * In AD4M, each member is also an Agent with a DID. The agentDid property
 * links this member record to their AD4M identity.
 *
 * HoloSphere access pattern:
 *   holosphere.get(holonId, 'users', usernameOrId)
 *   holosphere.getAll(holonId, 'users')
 */
@ModelOptions({ name: 'HolonMember' })
export class HolonMember extends Ad4mModel {
  @Property({ through: 'holons://member/username', resolveLanguage: 'literal' })
  username: string = '';

  @Property({ through: 'holons://member/firstName', resolveLanguage: 'literal' })
  firstName: string = '';

  @Optional({ through: 'holons://member/lastName', resolveLanguage: 'literal' })
  lastName?: string;

  @Optional({ through: 'holons://member/picture', resolveLanguage: 'literal' })
  picture?: string;

  @Optional({ through: 'holons://member/hours', resolveLanguage: 'literal' })
  hours?: number;

  /**
   * Link to the member's AD4M Agent DID.
   * Not using resolveLanguage since this is a DID URI, not a literal value.
   */
  @Optional({ through: 'holons://member/agentDid' })
  agentDid?: string;

  /** Role assignments as collection of role name strings */
  @Collection({ through: 'holons://member/role' })
  roles: string[] = [];

  @Flag({ through: 'holons://type', value: 'holons://member' })
  type: string = '';
}

// =============================================================================
// ShoppingItem
// =============================================================================

/**
 * A shopping list item (maps to HoloSphere lens: 'shopping').
 *
 * Simple CRUD entity for collaborative shopping lists within a Holon.
 */
@ModelOptions({ name: 'ShoppingItem' })
export class ShoppingItem extends Ad4mModel {
  @Property({ through: 'holons://shopping/name', resolveLanguage: 'literal' })
  name: string = '';

  @Property({ through: 'holons://shopping/quantity', resolveLanguage: 'literal' })
  quantity: number = 1;

  @Property({ through: 'holons://shopping/done', resolveLanguage: 'literal' })
  done: boolean = false;

  @Property({ through: 'holons://shopping/addedBy', resolveLanguage: 'literal' })
  addedBy: string = '';

  @Property({ through: 'holons://shopping/addedOn', resolveLanguage: 'literal' })
  addedOn: string = '';

  @Flag({ through: 'holons://type', value: 'holons://shoppingItem' })
  type: string = '';
}

// =============================================================================
// CouncilAdvisor
// =============================================================================

/**
 * An AI council advisor (maps to HoloSphere lens: 'advisors').
 *
 * Council advisors are AI-powered characters that provide guidance
 * within a Holon. They have character specifications that define their
 * personality and domain expertise.
 *
 * The characterSpec is stored as a JSON literal because it's a deeply
 * nested object that doesn't benefit from semantic decomposition at this stage.
 */
@ModelOptions({ name: 'CouncilAdvisor' })
export class CouncilAdvisor extends Ad4mModel {
  @Property({ through: 'holons://advisor/name', resolveLanguage: 'literal' })
  name: string = '';

  /**
   * Type of advisor: "real" | "mythic" | "archetype"
   * Using "advisorType" to avoid collision with the Flag-based type discriminator.
   */
  @Property({ through: 'holons://advisor/advisorType', resolveLanguage: 'literal' })
  advisorType: string = 'archetype';

  @Property({ through: 'holons://advisor/lens', resolveLanguage: 'literal' })
  lens: string = '';

  @Optional({ through: 'holons://advisor/avatarUrl', resolveLanguage: 'literal' })
  avatarUrl?: string;

  /**
   * Character specification as JSON literal.
   * Contains personality traits, domain expertise, communication style, etc.
   * NOTE: Consider decomposing into individual properties if querying by
   * specific character traits (e.g., domain expertise) becomes necessary.
   */
  @Property({ through: 'holons://advisor/characterSpec', resolveLanguage: 'literal' })
  characterSpec: string = '{}';

  @Flag({ through: 'holons://type', value: 'holons://advisor' })
  type: string = '';
}

// =============================================================================
// Chromosome
// =============================================================================

/**
 * A governance chromosome (maps to HoloSphere lens: 'chromosome_library').
 *
 * Based on chromosome.schema.json:
 * A governance element (value, tool, or practice) that can be added to
 * a holon's DNA sequence.
 */
@ModelOptions({ name: 'Chromosome' })
export class Chromosome extends Ad4mModel {
  @Property({ through: 'holons://chromosome/holonId', resolveLanguage: 'literal' })
  holonId: string = '';

  @Property({ through: 'holons://chromosome/name', resolveLanguage: 'literal' })
  name: string = '';

  /**
   * Category: "value" | "tool" | "practice"
   * Using "chromosomeType" to avoid collision with the Flag-based type discriminator.
   */
  @Property({ through: 'holons://chromosome/chromosomeType', resolveLanguage: 'literal' })
  chromosomeType: string = 'value';

  @Property({ through: 'holons://chromosome/description', resolveLanguage: 'literal' })
  description: string = '';

  @Optional({ through: 'holons://chromosome/icon', resolveLanguage: 'literal' })
  icon?: string;

  @Optional({ through: 'holons://chromosome/color', resolveLanguage: 'literal' })
  color?: string;

  @Flag({ through: 'holons://type', value: 'holons://chromosome' })
  type: string = '';
}

// =============================================================================
// DNASequence
// =============================================================================

/**
 * The ordered governance structure of a Holon (maps to HoloSphere lens: 'dna_sequence').
 *
 * Based on dna-sequence.schema.json:
 * An ordered collection of chromosome IDs defining a holon's governance.
 * One DNA sequence per holon (1:1 relationship).
 */
@ModelOptions({ name: 'DNASequence' })
export class DNASequence extends Ad4mModel {
  @Property({ through: 'holons://dna/holonId', resolveLanguage: 'literal' })
  holonId: string = '';

  /**
   * Ordered list of chromosome base expression references.
   * Order is preserved by link timestamps (AD4M collection ordering).
   */
  @Collection({ through: 'holons://dna/chromosome' })
  chromosomeIds: string[] = [];

  @Property({ through: 'holons://dna/version', resolveLanguage: 'literal' })
  version: number = 1;

  @Flag({ through: 'holons://type', value: 'holons://dnaSequence' })
  type: string = '';
}

// =============================================================================
// QuestTreeNode
// =============================================================================

/**
 * A node in a quest decomposition tree.
 *
 * Quest trees break down a vision into actionable sub-quests organized
 * in a hierarchical tree. Each node can have children, dependencies,
 * required skills, and associated actions.
 *
 * Tree structure is encoded via parent/child links:
 * - parentId: link to parent node's base expression (empty for root nodes)
 * - childIds: collection of links to child node base expressions
 */
@ModelOptions({ name: 'QuestTreeNode' })
export class QuestTreeNode extends Ad4mModel {
  @Property({ through: 'holons://questTree/title', resolveLanguage: 'literal' })
  title: string = '';

  @Optional({ through: 'holons://questTree/description', resolveLanguage: 'literal' })
  description?: string;

  /** Base expression of parent node. Absence means this is a root node. */
  @Optional({ through: 'holons://questTree/parent' })
  parentId?: string;

  /** Base expressions of child nodes */
  @Collection({ through: 'holons://questTree/child' })
  childIds: string[] = [];

  @Property({ through: 'holons://questTree/generation', resolveLanguage: 'literal' })
  generation: number = 0;

  @Property({ through: 'holons://questTree/status', resolveLanguage: 'literal',
    initial: 'literal://string:pending' })
  status: string = 'pending';

  /** Base expressions or IDs of dependency nodes */
  @Collection({ through: 'holons://questTree/dependency' })
  dependencies: string[] = [];

  @Collection({ through: 'holons://questTree/skill' })
  skillsRequired: string[] = [];

  @Property({ through: 'holons://questTree/impactCategory', resolveLanguage: 'literal',
    initial: 'literal://string:social' })
  impactCategory: string = 'social';

  @Optional({ through: 'holons://questTree/futureState', resolveLanguage: 'literal' })
  futureState?: string;

  @Collection({ through: 'holons://questTree/assumption' })
  assumptions: string[] = [];

  @Collection({ through: 'holons://questTree/question' })
  questions: string[] = [];

  @Collection({ through: 'holons://questTree/action' })
  actions: string[] = [];

  /** Participant references */
  @Collection({ through: 'holons://questTree/participant' })
  participants: string[] = [];

  @Flag({ through: 'holons://type', value: 'holons://questTreeNode' })
  type: string = '';
}

// =============================================================================
// FederationLink
// =============================================================================

/**
 * A federation relationship between holons (stored within each holon's perspective).
 *
 * In the current system, federation is managed via HoloSphere capability tokens
 * and Nostr DMs. In AD4M, federation maps to cross-Neighbourhood links.
 * Each FederationLink instance lives in the source holon's Neighbourhood and
 * points to the target holon's Neighbourhood URL.
 */
@ModelOptions({ name: 'FederationLink' })
export class FederationLink extends Ad4mModel {
  /**
   * Target holon's Neighbourhood URL.
   * Not using resolveLanguage since this is a URL/URI reference.
   */
  @Property({ through: 'holons://federation/targetNeighbourhood' })
  targetNeighbourhood: string = '';

  @Property({ through: 'holons://federation/targetName', resolveLanguage: 'literal' })
  targetName: string = '';

  @Property({ through: 'holons://federation/relationship', resolveLanguage: 'literal',
    initial: 'literal://string:federated' })
  relationship: string = 'federated';

  /** Lenses that this holon accepts data from the target */
  @Collection({ through: 'holons://federation/inboundLens' })
  inboundLenses: string[] = [];

  /** Lenses that this holon shares with the target */
  @Collection({ through: 'holons://federation/outboundLens' })
  outboundLenses: string[] = [];

  @Flag({ through: 'holons://type', value: 'holons://federation' })
  type: string = '';
}

// =============================================================================
// OfferWant
// =============================================================================

/**
 * An offer or want posting (maps to HoloSphere lens: 'offers').
 *
 * Based on offers_wants_schema-v0.0.2.json (Murmurations format).
 * Represents something a holon member is offering or requesting.
 */
@ModelOptions({ name: 'OfferWant' })
export class OfferWant extends Ad4mModel {
  @Property({ through: 'holons://offer/title', resolveLanguage: 'literal' })
  title: string = '';

  @Property({ through: 'holons://offer/description', resolveLanguage: 'literal' })
  description: string = '';

  /** "offer" or "want" */
  @Property({ through: 'holons://offer/exchangeType', resolveLanguage: 'literal' })
  exchangeType: string = 'offer';

  /** "good" or "service" */
  @Optional({ through: 'holons://offer/itemType', resolveLanguage: 'literal' })
  itemType?: string;

  @Optional({ through: 'holons://offer/image', resolveLanguage: 'literal' })
  image?: string;

  @Optional({ through: 'holons://offer/detailsUrl', resolveLanguage: 'literal' })
  detailsUrl?: string;

  /** Geolocation as JSON literal { lat, lon } */
  @Optional({ through: 'holons://offer/geolocation', resolveLanguage: 'literal' })
  geolocation?: string;

  @Optional({ through: 'holons://offer/geographicScope', resolveLanguage: 'literal' })
  geographicScope?: string;

  /** Contact details as JSON literal */
  @Optional({ through: 'holons://offer/contactDetails', resolveLanguage: 'literal' })
  contactDetails?: string;

  @Optional({ through: 'holons://offer/expiresAt', resolveLanguage: 'literal' })
  expiresAt?: number;

  /** Transaction types: borrow-lend, rent-lease, buy-sell, receive-donate */
  @Collection({ through: 'holons://offer/transactionType' })
  transactionTypes: string[] = [];

  @Collection({ through: 'holons://offer/tag' })
  tags: string[] = [];

  @Flag({ through: 'holons://type', value: 'holons://offerWant' })
  type: string = '';
}

// =============================================================================
// Role
// =============================================================================

/**
 * A role within a Holon (maps to HoloSphere lens: 'roles').
 *
 * Roles define responsibilities and access levels within a holon.
 * Used by QR action service and Roles component.
 */
@ModelOptions({ name: 'Role' })
export class Role extends Ad4mModel {
  @Property({ through: 'holons://role/title', resolveLanguage: 'literal' })
  title: string = '';

  @Optional({ through: 'holons://role/description', resolveLanguage: 'literal' })
  description?: string;

  @Optional({ through: 'holons://role/color', resolveLanguage: 'literal' })
  color?: string;

  @Optional({ through: 'holons://role/icon', resolveLanguage: 'literal' })
  icon?: string;

  /** JSON-encoded permissions/capabilities for this role */
  @Optional({ through: 'holons://role/permissions', resolveLanguage: 'literal' })
  permissions?: string;

  /** Members assigned to this role (usernames or IDs) */
  @Collection({ through: 'holons://role/member' })
  members: string[] = [];

  @Flag({ through: 'holons://type', value: 'holons://role' })
  type: string = '';
}

// =============================================================================
// Badge
// =============================================================================

/**
 * A badge within a Holon (maps to HoloSphere lens: 'badges').
 *
 * Badges are achievements that can be awarded to holon members.
 */
@ModelOptions({ name: 'Badge' })
export class Badge extends Ad4mModel {
  @Property({ through: 'holons://badge/title', resolveLanguage: 'literal' })
  title: string = '';

  @Optional({ through: 'holons://badge/description', resolveLanguage: 'literal' })
  description?: string;

  @Optional({ through: 'holons://badge/icon', resolveLanguage: 'literal' })
  icon?: string;

  @Optional({ through: 'holons://badge/image', resolveLanguage: 'literal' })
  image?: string;

  @Optional({ through: 'holons://badge/criteria', resolveLanguage: 'literal' })
  criteria?: string;

  /** Members who have earned this badge */
  @Collection({ through: 'holons://badge/awardee' })
  awardees: string[] = [];

  @Flag({ through: 'holons://type', value: 'holons://badge' })
  type: string = '';
}

// =============================================================================
// Invite
// =============================================================================

/**
 * An invitation to join a Holon (maps to HoloSphere lens: 'invites').
 */
@ModelOptions({ name: 'Invite' })
export class Invite extends Ad4mModel {
  @Property({ through: 'holons://invite/title', resolveLanguage: 'literal' })
  title: string = '';

  @Optional({ through: 'holons://invite/description', resolveLanguage: 'literal' })
  description?: string;

  @Optional({ through: 'holons://invite/code', resolveLanguage: 'literal' })
  code?: string;

  @Optional({ through: 'holons://invite/maxUses', resolveLanguage: 'literal' })
  maxUses?: number;

  @Optional({ through: 'holons://invite/usedCount', resolveLanguage: 'literal' })
  usedCount?: number;

  @Optional({ through: 'holons://invite/expiresAt', resolveLanguage: 'literal' })
  expiresAt?: number;

  @Flag({ through: 'holons://type', value: 'holons://invite' })
  type: string = '';
}

// =============================================================================
// GenericData — catch-all for unmapped lenses
// =============================================================================

/**
 * A generic data container for lenses without dedicated models.
 *
 * Stores data as a JSON literal, preserving the full object structure.
 * Used for: previous_rituals, ritual_origin, design_session_*, profile, 
 * telegram_mappings, federation_keys, federation_capabilities, hns, etc.
 */
@ModelOptions({ name: 'GenericData' })
export class GenericData extends Ad4mModel {
  /** The data payload as a JSON string */
  @Property({ through: 'holons://generic/data', resolveLanguage: 'literal' })
  data: string = '{}';

  /** The key used in HoloSphere to store this item */
  @Optional({ through: 'holons://generic/key', resolveLanguage: 'literal' })
  key?: string;

  /** Which lens this data belongs to */
  @Optional({ through: 'holons://generic/lens', resolveLanguage: 'literal' })
  lens?: string;

  @Flag({ through: 'holons://type', value: 'holons://genericData' })
  type: string = '';
}

// =============================================================================
// Lens-to-Model Mapping
// =============================================================================

/**
 * Maps HoloSphere lens names to their corresponding AD4M Subject Classes.
 *
 * This is used by the adapter to route HoloSphere API calls to the correct
 * AD4M model class. The lens names match those used in Harvest components:
 *   holosphere.get(holonId, 'quests', key)  →  Quest model
 *   holosphere.getAll(holonId, 'users')     →  HolonMember model
 *
 * Lenses without dedicated models fall through to GenericData in the adapter.
 */
export const LENS_MODEL_MAP: Record<string, typeof Ad4mModel> = {
  settings: HolonSettings,
  quests: Quest,
  users: HolonMember,
  shopping: ShoppingItem,
  advisors: CouncilAdvisor,
  chromosome_library: Chromosome,
  dna_sequence: DNASequence,
  offers: OfferWant,
  quest_tree: QuestTreeNode,
  federation: FederationLink,
  roles: Role,
  badges: Badge,
  invites: Invite,
};

/**
 * All subject classes that need to be registered in a Holon's perspective.
 * Use with `perspective.ensureSDNASubjectClass()` for each class.
 */
export const ALL_SUBJECT_CLASSES = [
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
] as const;
