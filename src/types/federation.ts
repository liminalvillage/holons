/**
 * Federation API Types
 *
 * TypeScript definitions for HoloSphere federation features including
 * holograms, capabilities, and federation configuration.
 */

// ============================================================
// Federation Direction & Mode
// ============================================================

export type FederationDirection = 'inbound' | 'outbound' | 'bidirectional';
export type FederationMode = 'reference' | 'copy';

// ============================================================
// Hologram Types
// ============================================================

/**
 * Target reference within a hologram
 */
export interface HologramTarget {
  holonId: string;
  lensName: string;
  dataId: string;
  authorPubKey?: string;
  appname?: string;
}

/**
 * Hologram metadata
 */
export interface HologramMeta {
  sourceHolon: string;
  sourcePubKey?: string;
  grantedAt?: number;
  created?: number;
  updatedAt?: number;
}

/**
 * Unresolved hologram structure (when resolveHolograms: false)
 */
export interface Hologram<T = Record<string, unknown>> {
  id: string;
  hologram: true;
  soul: string;
  target: HologramTarget;
  capability: string;
  _meta?: HologramMeta;
  // Cached data fields from source (spread of T)
  [key: string]: unknown;
}

/**
 * Resolved hologram metadata (attached to resolved items)
 */
export interface ResolvedHologramInfo {
  isHologram: true;
  soul: string;
  sourceHolon: string;
  sourcePubKey?: string;
  localOverrides?: string[];
}

/**
 * Type guard to check if an item is an unresolved hologram
 */
export function isHologram(item: unknown): item is Hologram {
  return (
    typeof item === 'object' &&
    item !== null &&
    'hologram' in item &&
    (item as Hologram).hologram === true
  );
}

/**
 * Type guard to check if an item is a resolved hologram
 */
export function isResolvedHologram(item: unknown): item is { _hologram: ResolvedHologramInfo } {
  return (
    typeof item === 'object' &&
    item !== null &&
    '_hologram' in item &&
    typeof (item as { _hologram: unknown })._hologram === 'object'
  );
}

// ============================================================
// Federation Options
// ============================================================

/**
 * Options for federate() method
 */
export interface FederateOptions {
  /** Direction of data flow */
  direction?: FederationDirection;
  /** Create holograms (reference) or copies */
  mode?: FederationMode;
  /** Propagate existing data during federation setup */
  propagate?: boolean;
  /** Filter function to select which items to federate */
  filter?: (item: unknown) => boolean;
  /** Capability permissions to grant */
  permissions?: string[];
  /** Pre-issued capability token */
  capability?: string;
  /** Write as a different agent */
  asAgent?: string;
}

/**
 * Options for get() method with federation support
 */
export interface GetOptions {
  /** Whether to resolve holograms to source data (default: true) */
  resolveHolograms?: boolean;
  /** Capability token for cross-holon access */
  capabilityToken?: string;
  /** Read as a different agent */
  asAgent?: string;
}

/**
 * Options for put() method with federation support
 */
export interface PutOptions {
  /** Write as a different agent (private key) */
  asAgent?: string;
  /** Auto-propagate to federated holons (default: true) */
  autoPropagate?: boolean;
  /** Wait for relay confirmation (default: false) */
  blocking?: boolean;
  /** Validate against schema (default: true) */
  validate?: boolean;
  /** Capability token for write-through */
  capabilityToken?: string;
}

// ============================================================
// Federation Configuration
// ============================================================

/**
 * Federation partner configuration
 */
export interface FederationPartner {
  id: string;
  name?: string;
  pubKey: string;
  npub?: string;
  status: 'connected' | 'pending' | 'rejected' | 'draft' | 'error';
  lensConfig: LensConfig;
  capabilities?: Record<string, CapabilityInfo>;
  lastSeen?: number;
  createdAt?: number;
}

/**
 * Lens configuration for a federation partner
 */
export interface LensConfig {
  inbound: string[];
  outbound: string[];
}

/**
 * Capability information - V2 (permanent tokens with revocation)
 */
export interface CapabilityInfo {
  /** Unique capability ID for revocation (cap_xxx format) */
  id?: string;
  /** Encoded capability token */
  token: string;
  /** Permissions granted */
  permissions: string[];
  /** Access scope */
  scope: CapabilityScope;
  /** When the capability was issued */
  issuedAt: number;
  /** Direction: inbound (we receive) or outbound (we grant) */
  direction?: FederationDirection;
  /** Whether this capability has been revoked */
  revoked?: boolean;
  /** Reason for revocation if revoked */
  revokedReason?: string;
}

/**
 * Capability scope definition - V2
 */
export interface CapabilityScope {
  holonId: string | '*';
  lensName: string | '*';
  dataId?: string | '*';
}

/**
 * V2 Capability Token Structure (decoded)
 */
export interface CapabilityTokenV2 {
  type: 'capability';
  version: '2.0';
  /** Unique ID for revocation tracking */
  id: string;
  permissions: string[];
  scope: CapabilityScope;
  recipient: string;
  issuer: string;
  /** Whether this is a self-capability (same issuer/recipient) */
  isSelfCapability: boolean;
  nonce: string;
  /** Timestamp when issued */
  issued: number;
}

// ============================================================
// Federation Result Types
// ============================================================

/**
 * Result from federate() call
 */
export interface FederateResult {
  success: boolean;
  direction: FederationDirection;
  mode: FederationMode;
  sourceHolon: string;
  targetHolon: string;
  lensName: string;
  propagated?: number;
  capability?: string;
  error?: string;
}

/**
 * Result from unfederate() / unlink() call - V2
 */
export interface UnlinkResult {
  /** IDs of revoked capabilities */
  revoked: string[];
}

/**
 * @deprecated Use UnlinkResult instead
 */
export interface UnfederateResult {
  success: boolean;
  removedCapabilities?: number;
  error?: string;
}

/**
 * Result from link() call - V2
 */
export interface LinkResult {
  /** Encoded capability token */
  capability: string;
  /** Unique ID for the link (same as capability ID) */
  linkId: string;
}

// ============================================================
// Federation State (for UI/stores)
// ============================================================

/**
 * Federation state for a holon
 */
export interface FederationState {
  partners: FederationPartner[];
  pendingRequests: FederationRequest[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
}

/**
 * Federation request (incoming or outgoing)
 * @deprecated V2 uses direct link() - no pending requests needed
 */
export interface FederationRequest {
  id: string;
  direction: 'incoming' | 'outgoing';
  partnerPubKey: string;
  partnerName?: string;
  lensConfig: LensConfig;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
  message?: string;
}

// ============================================================
// Available Lenses (Harvest-specific)
// ============================================================

/**
 * Standard lenses available for federation in Harvest
 */
export const FEDERATION_LENSES = [
  'quests',
  'offers',
  'shopping',
  'expenses',
  'announcements',
  'library',
  'recurring',
  'tags',
  'users'
] as const;

export type FederationLens = typeof FEDERATION_LENSES[number];

/**
 * Lens display information
 */
export interface LensInfo {
  name: FederationLens;
  label: string;
  description: string;
  icon?: string;
}

export const LENS_INFO: Record<FederationLens, LensInfo> = {
  quests: {
    name: 'quests',
    label: 'Tasks',
    description: 'Shared tasks and quests'
  },
  offers: {
    name: 'offers',
    label: 'Offers',
    description: 'Offers and requests'
  },
  shopping: {
    name: 'shopping',
    label: 'Shopping',
    description: 'Shopping lists'
  },
  expenses: {
    name: 'expenses',
    label: 'Expenses',
    description: 'Expense tracking'
  },
  announcements: {
    name: 'announcements',
    label: 'Announcements',
    description: 'Shared announcements'
  },
  library: {
    name: 'library',
    label: 'Library',
    description: 'Shared library items'
  },
  recurring: {
    name: 'recurring',
    label: 'Recurring',
    description: 'Recurring items'
  },
  tags: {
    name: 'tags',
    label: 'Tags',
    description: 'Shared tags'
  },
  users: {
    name: 'users',
    label: 'Users',
    description: 'User profiles'
  }
};
