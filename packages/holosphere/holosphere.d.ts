// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Type declarations for holosphere 2.x — signed Nostr events on relays,
// mirrored into a local event-sourced store (see STORE.md).

import type { Store, StoreAdapter, NostrEvent } from './store/index.js';

export type { Store, StoreAdapter, NostrEvent, StoreRecord, StoreSnapshot, StoreOp, WatchMeta, Cursor } from './store/index.js';

/**
 * Federation propagation options interface
 */
interface PropagationOptions {
  useHolograms?: boolean;
  targetSpaces?: string[];
  password?: string | null;
  propagateToParents?: boolean;
  maxParentLevels?: number;
}

/**
 * Options for retracting propagated copies (see `propagateDeletion`).
 */
interface DeletionPropagationOptions {
  propagateToParents?: boolean;
  maxParentLevels?: number;
  /** Per-read deadline (ms) when inspecting each parent hexagon. */
  readTimeoutMs?: number;
}

interface DeletionPropagationResult {
  /** Copies actually retracted. */
  success: number;
  errors: number;
  /** Copies left alone: absent, already tombstoned, or not ours. */
  skipped: number;
  messages: string[];
  propagated?: boolean;
}

interface DeleteOptions {
  /** Retract copies from parent hexagons (default: true). */
  autoPropagate?: boolean;
  /** Await the retraction instead of running it in the background. */
  awaitPropagation?: boolean;
  propagationOptions?: DeletionPropagationOptions;
  /** Store only — never sign or publish (reserved namespaces). */
  local?: boolean;
}

interface PutOptions {
  autoPropagate?: boolean;
  propagationOptions?: PropagationOptions;
  disableHologramRedirection?: boolean;
  /**
   * Keep the `_federation` provenance stamp on the stored record instead of
   * stripping it. Internal to `propagate` — it is what makes a propagated copy
   * distinguishable from a record the target holon wrote itself (and so what
   * lets `propagateDeletion` retract it later). Ordinary writes must not set it.
   */
  preserveFederationMeta?: boolean;
  actingAs?: string;
  password?: string | null;
  /** Await federation propagation instead of running it in the background. */
  awaitPropagation?: boolean;
  /** Store only — never sign or publish (reserved namespaces). */
  local?: boolean;
}

interface PutGlobalOptions {
  local?: boolean;
}

interface GetOptions {
  resolveHolograms?: boolean;
  validationOptions?: object;
  /** Return `_deleted: true` soft-tombstoned records instead of treating them as not-found. Default false. */
  includeDeleted?: boolean;
}

interface GetAllOptions {
  /** Include `_deleted: true` soft-tombstoned records in the response. Default false. */
  includeDeleted?: boolean;
  /** Return hologram pointers as stored instead of resolving them. Default true (resolve). */
  resolveHolograms?: boolean;
  /**
   * Provenance-annotated read: signed/authorized items tagged `_verified: true`,
   * unsigned/untrusted items tagged `_verified: false, _unverified: true`. For
   * display only — never trust `_unverified` items. Default false.
   */
  includeUnverified?: boolean;
}

interface SubscribeOptions {
  /** Also notify on deletes (`callback(null, key)`) instead of only live values. Default true. */
  includeDeletes?: boolean;
  /** Surface unsigned/untrusted updates tagged `_unverified` instead of dropping them under enforce. Display-only. Default false. */
  includeUnverified?: boolean;
}

interface ResolveHologramOptions {
  followHolograms?: boolean;
  visited?: Set<string>;
  maxDepth?: number;
  currentDepth?: number;
}

interface Hologram {
  id: string;
  soul: string;
  [key: string]: any;
}

/**
 * Canonical envelope attached to data resolved from a hologram reference.
 *
 * **Exported.** Domain types in consumers should declare
 * `_hologram?: ResolvedHologramMeta` instead of inlining the shape.
 */
export interface ResolvedHologramMeta {
  isHologram: boolean;
  soul: string;
  sourceHolon?: string | null;
  sourceLens?: string | null;
  sourceKey?: string | null;
  /** Display name of the source holon — stamped by `resolveHologram` when known. */
  sourceHolonName?: string;
  resolvedAt: number;
  error?: string;
  deleted?: boolean;
}

export interface ResolvedHologramData {
  _hologram: ResolvedHologramMeta;
  [key: string]: any;
}

/**
 * Federation provenance envelope stamped on records that arrived via a
 * federated partner.
 *
 * **Exported.** Domain types should declare `_federation?: FederationMeta`.
 */
export interface FederationMeta {
  /** The holon the record was propagated FROM. */
  origin: string;
  /** The lens it was published under at the origin. */
  sourceLens: string;
  /** Origin holon's display name (best-effort; absent if the source has no name). */
  originName?: string;
  /** Source-side id of the record, useful when local-side keys differ. */
  originalId?: string;
  /** Wall-clock ms when the propagation was emitted. */
  propagatedAt?: number;
  propagationType?: string;
  parentLevel?: number;
}

/**
 * Soft-tombstone marker recognised by `get`/`getAll`.
 */
export type DeletedMarker = boolean;

export interface HolosphereEnvelope {
  _hologram?: ResolvedHologramMeta;
  _federation?: FederationMeta;
  _deleted?: DeletedMarker;
}

interface FederationLensConfig {
  inbound: string[];
  outbound: string[];
  timestamp: number;
}

interface FederationInfo {
  id: string;
  name: string;
  federated: string[];
  inbound: string[];
  outbound: string[];
  lensConfig: Record<string, FederationLensConfig>;
  partnerNames: Record<string, string>;
  timestamp: number;
}

interface GetFederatedOptions {
  aggregate?: boolean;
  idField?: string;
  sumFields?: string[];
  concatArrays?: string[];
  removeDuplicates?: boolean;
  mergeStrategy?: (items: any[]) => any;
  includeLocal?: boolean;
  includeFederated?: boolean;
  resolveReferences?: boolean;
  maxFederatedSpaces?: number;
  timeout?: number;
  includeUnverified?: boolean;
}

interface PropagationResult {
  success: number;
  errors: number;
  errorDetails: Array<{ space: string, error: string }>;
  propagated: boolean;
  referencesUsed: boolean;
  error?: string;
  message?: string;
  parentPropagation?: {
    success: number;
    errors: number;
    skipped: number;
    messages: string[];
  };
}

interface PutResult {
  success: boolean;
  isHologramAtPath?: boolean;
  pathHolon: string | null;
  pathLens: string;
  pathKey: string;
  propagationResult?: PropagationResult | null;
  error?: string;
  /** True for a password-lens write (never signed or published). */
  private?: boolean;
  /** Holograms whose `updated` timestamp was bumped by this put. */
  updatedHolograms?: Array<{ soul: string; holon: string; lens: string; key: string }>;
}

interface CanWriteResult {
  canWrite: boolean;
  reason: string;
  accessType: string;
}

/** Hook shape consumed by projections.js (see @holons/core/nostr). */
export interface ProjectionHook {
  lens: string;
  kinds: number[];
  requiresAuthor?: 'user';
  project(holon: string, lens: string, item: unknown): { primary: any; companions?: any[] } | null;
  retract(holon: string, lens: string, id: string): any[];
  parse?(event: any): any | null;
  merge?(current: unknown, reversed: any): unknown | null;
}

export interface SigningOptions {
  /** Measure what enforce would drop, without changing output. */
  shadow?: boolean;
  /** Authorized reads: `true` = federation read-list, `'membership'` = the holon's signed `_members` log. */
  enforce?: boolean | 'membership';
  /** Lenses read as per-author aggregates (participation, reactions, …). */
  perActorLenses?: string[];
  verbose?: boolean;
}

export interface StoreOptions {
  /** `'memory'` (default outside a browser), `'indexeddb'` (default in a browser), `'file'` (Node), `'auto'`, or an adapter instance. */
  adapter?: 'memory' | 'indexeddb' | 'file' | 'auto' | StoreAdapter;
  /** Directory for the file adapter (default `./holosphere-store`). */
  dir?: string;
  /** Persisted ops before the log is compacted (default 50000). */
  compactAfter?: number;
}

interface HoloSphereConfig {
  appName?: string;
  appname?: string;
  /** Signing identity. With relays but no key an ephemeral key is generated. */
  privateKey?: Uint8Array | string | null;
  strict?: boolean;
  /** Relay URLs — the wire. Without relays the instance is local-only. */
  relays?: string[];
  openaiKey?: string | null;
  /** Local store configuration (see STORE.md). */
  store?: StoreOptions;
  /** Read-side signing modes. */
  signing?: SigningOptions;
  nostr?: {
    /** Alias of top-level `relays`. */
    relays?: string[];
    /** @deprecated alias of `relays`. */
    peers?: string[];
    /** Cold-read catch-up deadline (ms, default 5000). */
    syncTimeoutMs?: number;
    /** Backfill page size (default 500 — strfry's `maxFilterLimit`). */
    pageSize?: number;
    verbose?: boolean;
    /** Standard-kind projection hooks (build with `buildProjections` from `@holons/core/nostr`). */
    projections?: ProjectionHook[];
    /** Per-user signing key lookup for kind-0 / RSVP projections. */
    signerFor?: (userId: string | number) => string | Uint8Array | null | undefined;
    providerKey?: string | Uint8Array | null;
    /** Fold external edits of projected kinds back into records (default true when projections are set). */
    reverseSync?: boolean;
    /** Pubkeys allowed to edit a holon's records over Nostr (default: own key ∪ read-list). */
    trustedAuthors?: (holon: string) => string[] | Promise<string[]>;
    /** Cold-start catch-up window for reverse sync, seconds (default 7 days). */
    reverseLookbackSec?: number;
  };
  /** @deprecated ignored — the relay is the wire. */
  backend?: string;
}

export interface EnableSigningOptions extends SigningOptions {
  privateKey?: Uint8Array | string;
  /** Bring the relay transport up on an instance created without relays. */
  relays?: string[];
  /** Keys (npub or hex) to add to the read-list. */
  readKeys?: string[];
  federationSpace?: string;
  projections?: ProjectionHook[];
  signerFor?: HoloSphereConfig['nostr'] extends infer N ? (N extends { signerFor?: infer S } ? S : never) : never;
  providerKey?: string | Uint8Array | null;
  reverseSync?: boolean;
  trustedAuthors?: (holon: string) => string[] | Promise<string[]>;
  reverseLookbackSec?: number;
}

export interface Signer {
  pubkey: string;
  shadow: boolean;
  enforce: false | 'federation' | 'membership';
  getReport(): Record<string, any>;
  resetReport(): void;
  isPerActor(lens: string): boolean;
  addPerActorLens(lens: string): void;
  getPerActorLenses(): string[];
  aggregate(holo: HoloSphere, holon: string, lens: string, subject?: string | null): Promise<any[]>;
  authorizedView(holo: HoloSphere, holon: string, lens: string, rawItems: any[], opts?: { includeDeleted?: boolean }): Promise<{ items: any[]; pending: any[] }>;
  resolveItem(holo: HoloSphere, holon: string, lens: string, key: string, opts?: { includeDeleted?: boolean }): Promise<any | null>;
}

declare class HoloSphere {
    appname: string;
    config: HoloSphereConfig;
    client: { publicKey: string };
    /** The local store (see STORE.md). */
    readonly store: Store;
    subscriptions: Record<string, any>;

    constructor(config: HoloSphereConfig);
    constructor(appname: string, strict?: boolean);

    /** Resolves once the store is open and the relay transport (if any) is up. */
    ready(): Promise<HoloSphere>;

    // Schema
    setSchema(lens: string, schema: object): Promise<boolean>;
    getSchema(lens: string, options?: { useCache?: boolean; maxCacheAge?: number }): Promise<object | null>;
    clearSchemaCache(lens?: string | null): boolean;

    // Content
    put(holon: string | null, lens: string, data: object, options?: PutOptions): Promise<PutResult>;
    put(holon: string | null, lens: string, data: object, password?: string | null, options?: PutOptions): Promise<PutResult>;
    get(holon: string | null, lens: string): Promise<any | null>;
    get(holon: string | null, lens: string, key: string, password?: string | null, options?: GetOptions): Promise<any | null>;
    getAll(holon: string | null, lens: string, password?: string | null, options?: GetAllOptions): Promise<Array<any>>;
    parse(rawData: any): Promise<object | null>;
    delete(holon: string | null, lens: string, key: string, password?: string | null, options?: DeleteOptions): Promise<boolean>;
    deleteAll(holon: string | null, lens: string, password?: string | null, options?: DeleteOptions): Promise<boolean>;

    // Store views
    /** Holons this instance holds records for, unioned with the `holons_registry` global. */
    listHolons(): Promise<string[]>;
    listLenses(holon: string | null): string[];
    listKeys(holon: string | null, lens: string, options?: { includeDeleted?: boolean }): string[];
    /** Souls of the hologram pointers that reference a record. */
    getBacklinks(holon: string | null, lens: string, key: string): string[];
    /** Signed events held locally (oldest first). */
    exportEvents(filter?: { holon?: string | null; lens?: string; authors?: string[] }): NostrEvent[];
    /** Apply signed events (verified); with `publish` also republish them to the relays. */
    importEvents(events: NostrEvent[], options?: { publish?: boolean }): Promise<{ received: number; applied: number; rejected: number }>;

    // Node
    getNode(holon: string, lens: string, key: string): Promise<any | null>;
    getNodeBySoul(soul: string): Promise<any | null>;
    deleteNode(holon: string, lens: string, key: string): Promise<boolean>;

    // Global
    putGlobal(tableName: string, data: object, password?: string | null, options?: PutOptions): Promise<PutResult>;
    writeGlobal(tableName: string, data: object, options?: PutOptions): Promise<void>;
    getGlobal(tableName: string, key: string, password?: string | null): Promise<any | null>;
    getAllGlobal(tableName: string, password?: string | null): Promise<Array<any>>;
    deleteGlobal(tableName: string, key: string, password?: string | null): Promise<boolean>;
    deleteAllGlobal(tableName: string, password?: string | null): Promise<boolean>;
    subscribeGlobal(lens: string, key: string | null, callback: (data: any, key?: string) => void, options?: { realtimeOnly?: boolean }): { unsubscribe: () => void; stop: () => void };
    subscribeGlobal(lens: string, callback: (data: any, key?: string) => void): { unsubscribe: () => void; stop: () => void };

    // Hologram
    createHologram(holon: string, lens: string, data: { id: string, [key: string]: any }): Hologram;
    isHologram(data: any): data is Hologram;
    parseSoulPath(soul: string): { appname: string, holon: string, lens: string, key: string } | null;
    resolveHologram(hologram: Hologram, options?: ResolveHologramOptions): Promise<ResolvedHologramData | null>;
    resolveHologramDetailed(hologram: Hologram, options?: ResolveHologramOptions): Promise<{ status: 'resolved' | 'deleted' | 'unresolved' | 'circular' | 'depth' | 'invalid' | 'error'; data: ResolvedHologramData | null; soul: string | null; reason: string }>;
    attachHologramMeta<T extends object>(originalData: T, hologramSoul: string): T & ResolvedHologramData;

    // Compute
    computeHierarchy(holon: string, lens: string, options: object, maxLevels?: number, password?: string | null): Promise<Array<any>>;
    compute(holon: string, lens: string, options: object | string, password?: string | null): Promise<any>;
    summarize(history: string): Promise<string>;
    upcast(holon: string, lens: string, content: object, maxLevels?: number): Promise<object>;
    updateParent(id: string, report: string): Promise<object>;
    propagate(holon: string, lens: string, data: object, options?: PropagationOptions): Promise<PropagationResult>;
    propagateDeletion(holon: string, lens: string, key?: string | null, options?: DeletionPropagationOptions): Promise<DeletionPropagationResult>;

    // Location
    getHolon(lat: number, lng: number, resolution: number): Promise<string>;
    getScalespace(lat: number, lng: number): string[];
    getHolonScalespace(holon: string): string[];

    /**
     * Subscribe to real-time changes for a holon/lens. Returns synchronously.
     * Every subscriber gets the current snapshot replayed, then one callback
     * per change: `callback(object, key)` for values, `callback(null, key)`
     * for deletions.
     */
    subscribe(holon: string, lens: string, callback: (data: any, key?: string) => void, options?: SubscribeOptions): { unsubscribe: () => void };
    /** @deprecated no-op: the store's change feed notifies subscribers. */
    notifySubscribers(data: any): void;
    /** Re-fetch every synced lens from the relays (e.g. from an `online` handler). */
    resyncSubscriptions(): Promise<void>;
    getHolonName(holonId: string): Promise<string | null>;

    // Federation - v1 style
    federate(holonId1: string, holonId2: string, password1?: string | null, password2?: string | null, bidirectional?: boolean, lensConfig?: { inbound?: string[], outbound?: string[] }): Promise<boolean>;
    unfederate(holonId1: string, holonId2: string, password1?: string | null, password2?: string | null): Promise<boolean>;

    // Federation - v2 style
    federateHolon(sourceHolon: string, targetHolon: string, options?: { lensConfig?: { inbound?: string[]; outbound?: string[] }; partnerName?: string }): Promise<boolean>;
    unfederateHolon(sourceHolon: string, targetHolon: string): Promise<boolean>;

    subscribeFederation(holonId: string, password: string | null, callback: (data: any, federatedSpace?: string, lens?: string) => void, options?: { lenses?: string[], throttle?: number }): Promise<{ unsubscribe: () => void, getSubscriptionCount: () => number }>;
    getFederation(holonId: string, password?: string | null): Promise<FederationInfo | null>;
    getFederatedConfig(holonId: string, targetHolonId: string, password?: string | null): Promise<{ inbound: string[], outbound: string[] } | null>;
    removeNotify(holonId1: string, holonId2: string, password1?: string | null): Promise<boolean>;
    getFederated(holon: string, lens: string, options?: GetFederatedOptions): Promise<Array<any>>;
    subscribeFederated(holon: string, lens: string, callback: (items: any[]) => void, options?: {
        includeLocal?: boolean;
        includeFederated?: boolean;
        dedupe?: boolean;
        /** False when the lens's ids are only holon-unique (e.g. `checklists`). */
        dedupeAcrossSpaces?: boolean;
        idField?: string;
        maxFederatedSpaces?: number;
    }): { unsubscribe: () => void; setFederated: (on: boolean) => void };
    federateMessage(originalChatId: string, messageId: string, federatedChatId: string, federatedMessageId: string, type?: string): Promise<void>;
    getFederatedMessages(originalChatId: string, messageId: string): Promise<object | null>;
    updateFederatedMessages(originalChatId: string, messageId: string, updateCallback: (chatId: string, messageId: string) => Promise<void>): Promise<void>;
    resetFederation(holonId: string, password?: string | null): Promise<boolean>;

    // Authorization
    canWrite(holonId: string, lensName: string, actingAs: string, options?: any): Promise<CanWriteResult>;
    addAllowedAuthor(pubkey: string): void;
    removeAllowedAuthor(pubkey: string): void;
    listAllowedAuthors(): string[];

    // Signing (see SIGNING.md)
    enableSigning(opts?: EnableSigningOptions): Promise<Signer>;
    disableSigning(): void;
    login(privateKey: Uint8Array | string, opts?: EnableSigningOptions): Promise<{ pubkey: string; signer: Signer }>;
    logout(): void;
    readonly currentPubkey: string;
    readonly loggedIn: boolean;
    readonly signingEnabled: boolean;
    readonly enforceActive: boolean;
    /** Publish already-signed Nostr events (any kind) on the relay set. */
    publishNostrEvents(events: any | any[]): void;
    /** Raw live REQ on the relay set; returns a close function. */
    subscribeNostr(filter: Record<string, unknown>, onevent: (event: any) => void): () => void;
    /** Relay URLs of the wire ([] when local-only). */
    nostrRelays(): string[];
    auditLens(holon: string, lens: string): Promise<{ items: number; accounted: number; wouldDrop: number; unsigned: number; invalidSig: number; mismatch: number }>;
    getShadowReport(): Record<string, any> | null;
    resetShadowReport(): void;
    aggregate(holon: string, lens: string, subject?: string | null): Promise<any[]>;
    setPerActorLens(lens: string): void;
    addReadKey(key: string): Promise<string>;
    removeReadKey(key: string): Promise<void>;
    refreshReadKeys(): Promise<string[]>;
    getReadKeys(): string[];
    setGenesis(holon: string, pubkey: string): void;
    foundHolon(holon: string, opts?: { at?: number }): Promise<string>;
    addMember(holon: string, pubkey: string, role?: 'member' | 'admin', opts?: { at?: number }): Promise<void>;
    removeMember(holon: string, pubkey: string, opts?: { at?: number }): Promise<void>;
    getMembers(holon: string): Promise<Map<string, string>>;
    getPending(holon: string, lens: string): Promise<any[]>;

    // Utility
    generateId(): string;
    close(): Promise<void>;
    getVersion(): string;
}

// Named exports
export declare const version: string;

export declare const nostrUtils: {
    generatePrivateKey(): string;
    getPublicKey(privateKeyHex: string): string;
    getPublicKeyFromBytes(privateKeyBytes: Uint8Array): string;
    parseNsecOrHex(input: string): string | null;
    parseNpubOrHex(input: string): string | null;
    hexToNpub(hex: string): string;
    hexToNsec(hex: string): string;
    npubToHex(npub: string): string;
    nsecToHex(nsec: string): string;
    hexToBytes(hex: string): Uint8Array;
    bytesToHex(bytes: Uint8Array): string;
    shortenPubKey(pubkey: string, len?: number): string;
    shortenNpub(npub: string, len?: number): string;
    generateNonce(): string;
};

export declare function buildLensPath(appName: string, holonId: string, lens: string): string;

export declare const subscriptions: {
    createSubscription(client: HoloSphere, path: string, callback: (data: any, key?: string) => void, options?: { realtimeOnly?: boolean; resolveHolograms?: boolean; appname?: string }): { unsubscribe: () => void; stop: () => void };
};

export declare const registry: {
    storeInboundCapability(client: HoloSphere, appName: string, holonId: string, capability: any): Promise<{ success: boolean; id?: string; error?: string }>;
    getInboundCapabilities(client: HoloSphere, appName: string, holonId: string): Promise<any[]>;
    removeInboundCapability(client: HoloSphere, appName: string, holonId: string, capabilityId: string): Promise<boolean>;
};

export declare const handshake: {
    subscribeToFederationDMs(holosphere: HoloSphere, privateKey: any, publicKey: string, handlers: {
        onRequest?: (request: any, senderPubKey: string) => void;
        onResponse?: (response: any, senderPubKey: string) => void;
        onUpdate?: (update: any, senderPubKey: string) => void;
        onUpdateResponse?: (response: any, senderPubKey: string) => void;
    }): () => void;
    initiateFederationHandshake(holosphere: HoloSphere, privateKey: any, params: {
        partnerPubKey: string;
        holonId: string;
        holonName: string;
        lensConfig?: any;
        message?: string;
    }): Promise<{ success: boolean; requestId?: string }>;
    acceptFederationRequest(holosphere: HoloSphere, privateKey: any, params: {
        requesterPubKey: string;
        holonId: string;
        holonName: string;
        lensConfig?: any;
        requestId?: string;
    }): Promise<{ success: boolean }>;
    rejectFederationRequest(holosphere: HoloSphere, privateKey: any, params: {
        requesterPubKey: string;
        holonId: string;
        reason?: string;
        requestId?: string;
    }): Promise<{ success: boolean }>;
    processFederationResponse(holosphere: HoloSphere, response: any, senderPubKey: string, options?: {
        holonId: string;
        inboundLenses?: string[];
    }): Promise<{ success: boolean; responderHolonId?: string; error?: string }>;
    requestFederationUpdate(holosphere: HoloSphere, privateKey: any, params: {
        partnerPubKey: string;
        holonId: string;
        holonName: string;
        newLensConfig?: any;
        message?: string;
    }): Promise<{ success: boolean }>;
    acceptFederationUpdate(holosphere: HoloSphere, privateKey: any, params: any): Promise<{ success: boolean }>;
    rejectFederationUpdate(holosphere: HoloSphere, privateKey: any, params: any): Promise<{ success: boolean }>;
};

export default HoloSphere;
export { HoloSphere };
