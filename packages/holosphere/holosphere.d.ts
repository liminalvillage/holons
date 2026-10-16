// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Type declarations for holosphere 2.x — signed Nostr events on relays,
// mirrored into a local event-sourced store (see STORE.md).

import type { Store, StoreAdapter, NostrEvent, WireRegistry } from './store/index.js';

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
  /** Return the `{ id, _locked: true }` stub of a sealed record this instance cannot open. Default false. */
  includeLocked?: boolean;
}

interface GetAllOptions {
  /** Include `_deleted: true` soft-tombstoned records in the response. Default false. */
  includeDeleted?: boolean;
  /** Include the `{ id, _locked: true }` stubs of sealed records this instance cannot open. Default false. */
  includeLocked?: boolean;
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

/** A private scope: a lens, or one item of it. See PRIVACY.md. */
export interface Scope {
  holon: string;
  lens: string;
  item?: string;
}

/** A grant as it travels (NIP-17 DM, subject `holons/grant`): the scope and its current key. */
interface GrantPayload {
  t: 'holons/grant';
  v: 2;
  holon: string;
  lens: string;
  item?: string;
  /** Key id: 16 hex chars of sha256(key). */
  kid: string;
  /** The scope key (hex). */
  key: string;
  at: string;
}

/** The private scopes of a holon, by lens: the lens as a whole, or single items. */
interface LockedScopes {
  [lens: string]: { locked: boolean; items: string[] };
}

interface Privacy {
  /** The private scope governing an address (the item's own vault first, then the lens's), or null. Synchronous. */
  scopeOf(holon: string | null, lens: string, item?: string | null): Scope | null;
  isPrivate(holon: string | null, lens: string, item?: string | null): boolean;
  /** Every private scope of a holon this instance has seen vault records for (own and others'). Synchronous. */
  lockedScopes(holon: string | null): LockedScopes;
  privatizable(holon: string | null, lens: string): boolean;
  assertPrivatizable(holon: string | null, lens: string): void;
  /** Load every key the active identity can have for a lens (and its items), then re-decode it. */
  ensureKeys(holon: string | null, lens: string): Promise<void>;
  /** Does this identity own the scope's vault (it can lock/unlock, share, revoke)? Synchronous after `ensureKeys`. */
  owned(scope: Scope): boolean;
  ownedScopes(holon: string): Scope[];
  /** Does this identity hold a usable key for the scope, as owner or reader? Synchronous after `ensureKeys`. */
  holdsKey(scope: Scope): boolean;
  /** Could this identity unlock or take over the scope: it owns it, or it is an admin of the holon holding the key. */
  canManage(scope: Scope): boolean;
  /** The role a key holds in a holon now: 'admin' | 'member' | null (stranger) | undefined (nobody defined, open). */
  roleOf(holon: string, pubkey: string): 'admin' | 'member' | null | undefined;
  /** May this identity do `action` (a capabilities.js key) in the holon? Open holons allow everything. */
  may(holon: string, action: string): boolean;
  /** Make a scope private: a fresh key, the vault record, the scope's items rewritten sealed. Idempotent. */
  lock(scope: Scope, opts?: { audience?: unknown[]; sent?: Record<string, string> }): Promise<{ kid: string | null; rewritten: number }>;
  /** Make a scope public again: items rewritten in the clear, the vault tombstoned. */
  unlock(scope: Scope): Promise<{ rewritten: number }>;
  /** The opaque audience the domain layer stored on an owned scope (null when not owned). */
  audienceGet(scope: Scope): Promise<unknown[] | null>;
  audienceSet(scope: Scope, audience: unknown[]): Promise<unknown[]>;
  /** Which key id each reader pubkey holds, as last recorded (null when not owned). */
  sentGet(scope: Scope): Promise<Record<string, string> | null>;
  sentSet(scope: Scope, sent: Record<string, string>): Promise<Record<string, string>>;
  /** Hand the scope's current key to reader pubkeys over NIP-17. */
  grant(scope: Scope, readers: string | string[]): Promise<{ kid: string; sent: string[]; failed: string[] }>;
  /** Rotate the scope key, rewrite the scope, forget the revoked readers. The caller re-grants the rest. */
  revoke(scope: Scope, readers: string | string[]): Promise<{ kid: string; rewritten: number; revoked: string[] }>;
  /** Accept a grant addressed to this identity (validated, copied into its own vault, re-decoded). `trusted` skips the sender policy. */
  acceptGrant(payload: GrantPayload | string, sender?: string | null, opts?: { trusted?: boolean }): Promise<{ accepted: boolean; reason?: string; holon?: string; lens?: string; item?: string | null; kid?: string }>;
  parseGrant(raw: unknown): GrantPayload | null;
  startGrants(): void;
  stopGrants(): void;
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

export interface PrivacyOptions {
  /**
   * May `sender` hand out (or edit under) keys of `holon`? Default: the holon
   * itself, the anchor of its signed records, or a current member of its
   * `_members` log (see authority.js).
   */
  acceptGrantFrom?: (holo: HoloSphere, holon: string, lens: string, sender: string) => boolean | Promise<boolean>;
  /**
   * The role `pubkey` holds in `holon` right now, SYNCHRONOUSLY from what the
   * instance holds: 'admin' | 'member' | null (a stranger) | undefined
   * (nobody speaks for the holon — it is open). Decides whose vault record
   * counts (a member's) and who may tombstone another key's (an admin).
   * Default: the holon's own signed `_members` log (see authority.js).
   */
  roleOf?: (holo: HoloSphere, holon: string, pubkey: string) => 'admin' | 'member' | null | undefined;
}

/** What the `vouch` hook is asked about: one claim at one address. */
export interface VouchContext {
  /** The holon the claim was written into. */
  holon: string;
  lens: string;
  id: string;
  /** The claim as signed: a `{ id, soul }` pointer or a `_federation`-stamped copy. */
  claim: Record<string, any>;
  /** Who signed it and when (seconds). */
  author: string;
  createdAt: number;
  /** What a pointer resolves to (through the source holon's own enforcement); the claim itself for a copy. */
  resolved: Record<string, any>;
}

export interface SigningOptions {
  /** Measure what enforce would drop, without changing output. */
  shadow?: boolean;
  /**
   * Authorized reads: `true` = federation read-list, `'membership'` = the
   * holon's signed `_members` log, `'authority'` = the `authority` hook
   * decides per holon (null = nobody defined, that holon reads unenforced).
   */
  enforce?: boolean | 'membership' | 'authority';
  /** For `enforce: 'authority'`: who counts for a holon, as `(pubkey, created_at) => boolean`, or null. */
  authority?: (holo: HoloSphere, holon: string) => Promise<((pubkey: string, createdAt: number) => boolean) | null> | ((pubkey: string, createdAt: number) => boolean) | null;
  /**
   * For enforced reads: may a POINTER (hologram) or federated copy signed by
   * an unseated key count anyway? Asked with the claim, its author and the
   * value the pointer resolves to; tombstones are never put to it.
   */
  vouch?: (holo: HoloSphere, ctx: VouchContext) => Promise<boolean> | boolean;
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
  /** Which kinds this store consumes; defaults to the envelope alone. */
  wire?: WireRegistry;
  /** Lenses carried on the append-only log kind (1808): every entry kept, never replaced. */
  appendLenses?: string[];
}

/** The entries a log event points at, by `e`-tag marker. */
export interface LogRefs {
  prev: string[];
  basis: string[];
  attests: string[];
  disputes: string[];
  other: string[];
}

/** A verified entry of an append-only lens, as `getLog` / `subscribeLog` yield it. */
export interface LogEntry<T = Record<string, unknown>> {
  /** The event id — also the record id. */
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  refs: LogRefs;
  /** The decoded body (`id` = event id, plus a `_log` block). */
  item: T & { id: string; _log: { pubkey: string; created_at: number; kind: number; refs: LogRefs } };
  event: NostrEvent;
}

export type LogRefsInput = Partial<Record<'prev' | 'basis' | 'attests' | 'disputes', string | string[]>> | Array<{ id: string; marker?: string } | string>;

interface HoloSphereConfig {
  appName?: string;
  appname?: string;
  /** Signing identity. With relays but no key an ephemeral key is generated. */
  /** 64-char hex, NIP-19 `nsec1…` or raw bytes. */
  privateKey?: Uint8Array | string | null;
  strict?: boolean;
  /** Relay URLs — the wire. Without relays the instance is local-only. */
  relays?: string[];
  openaiKey?: string | null;
  /** Local store configuration (see STORE.md). */
  store?: StoreOptions;
  /** Read-side signing modes. */
  signing?: SigningOptions;
  /** Privacy policy hooks (see PRIVACY.md). */
  privacy?: PrivacyOptions;
  nostr?: {
    /** Alias of top-level `relays`. */
    relays?: string[];
    /** @deprecated alias of `relays`. */
    peers?: string[];
    /** Cold-read catch-up deadline (ms, default 5000). */
    syncTimeoutMs?: number;
    /** Backfill page size (default 500 — strfry's `maxFilterLimit`). */
    pageSize?: number;
    /** A (holon, lens) pulled this recently is read from the store without a query (ms, default 3000). */
    freshnessMs?: number;
    /** Catch-up queries in flight at once (default 6 — well under a relay's per-connection REQ cap). */
    maxConcurrentQueries?: number;
    /** Filters per live REQ before a second REQ is opened (default 10). */
    maxFiltersPerReq?: number;
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
  enforce: false | 'federation' | 'membership' | 'authority';
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

    // Append-only logs (see log.js)
    /** Carry `lens` on the append-only log kind from now on (idempotent). */
    registerAppendLens(lens: string): void;
    isAppendLens(lens: string): boolean;
    /** Append a signed entry with the instance key; returns the signed event. */
    append(holon: string | null, lens: string, item: object, options?: { refs?: LogRefsInput; created_at?: number }): Promise<NostrEvent>;
    /** Apply + publish a log entry signed elsewhere. */
    appendSigned(event: NostrEvent): Promise<{ applied: boolean; reason?: string }>;
    /** Every verified entry of a log lens, oldest first. */
    getLog<T = Record<string, unknown>>(holon: string | null, lens: string, options?: { since?: number; until?: number; authors?: string[] }): Promise<LogEntry<T>[]>;
    /** Ordered replay, then each new entry; returns the unsubscribe function. */
    subscribeLog<T = Record<string, unknown>>(holon: string | null, lens: string, callback: (entry: LogEntry<T>) => void, options?: { replay?: boolean }): () => void;

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
    /** Re-fetch every synced lens from the relays and resend the outbox (e.g. from an `online` handler). */
    resyncSubscriptions(): Promise<void>;
    /** Published events no relay has acknowledged yet, oldest first. */
    getOutbox(): Promise<NostrEvent[]>;
    /** Resend the outbox now; resolves to how many events a relay took. */
    flushOutbox(): Promise<number>;
    getHolonName(holonId: string): Promise<string | null>;

    // Federation - v1 style
    federate(holonId1: string, holonId2: string, password1?: string | null, password2?: string | null, bidirectional?: boolean, lensConfig?: { inbound?: string[], outbound?: string[] }): Promise<boolean>;
    unfederate(holonId1: string, holonId2: string, password1?: string | null, password2?: string | null, bidirectional?: boolean): Promise<boolean>;

    // Federation - v2 style
    federateHolon(sourceHolon: string, targetHolon: string, options?: { lensConfig?: { inbound?: string[]; outbound?: string[] }; partnerName?: string }): Promise<boolean>;
    unfederateHolon(sourceHolon: string, targetHolon: string): Promise<boolean>;

    subscribeFederation(holonId: string, password: string | null, callback: (data: any, federatedSpace?: string, lens?: string) => void, options?: { lenses?: string[], throttle?: number }): Promise<{ unsubscribe: () => void, getSubscriptionCount: () => number }>;
    getFederation(holonId: string, password?: string | null): Promise<FederationInfo | null>;
    /** The federation record with its standing: what counts, the raw record, and whether an admin signed what counts. */
    getFederationStanding(holonId: string, password?: string | null): Promise<{ record: FederationInfo | null; raw: FederationInfo | null; endorsed: boolean }>;
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
    /** Drops the signing identity; sealed records lock again once the returned promise settles. */
    logout(): Promise<void>;

    // Privacy (see PRIVACY.md)
    /** Vaults, keyring and grants of the active identity. */
    readonly privacy: Privacy;
    /** Is this address private — the lens as a whole, or this one item? Synchronous. */
    isPrivate(holon: string | null, lens: string, item?: string | null): boolean;
    readonly currentPubkey: string;
    readonly loggedIn: boolean;
    readonly signingEnabled: boolean;
    readonly enforceActive: boolean;
    /** Publish already-signed Nostr events (any kind) on the relay set. */
    publishNostrEvents(events: any | any[]): void;
    /** Raw live REQ on the relay set; returns a close function. */
    subscribeNostr(filter: Record<string, unknown>, onevent: (event: any) => void): () => void;
    /** One bounded relay query (REQ closed on EOSE) through the REQ budget; [] when local-only or closed. */
    queryNostr(filter: Record<string, unknown>): Promise<any[]>;
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
