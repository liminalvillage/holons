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
  /**
   * Per-put deadline (ms) for Gun's ack callback. When the deadline fires,
   * the returned promise resolves with `{ success: true, queued: true, ... }`
   * so an offline/partitioned mesh can't hang the caller — Gun keeps the
   * write locally and replays it on reconnect. Default 5000. Pass `0` to
   * disable and wait for ack indefinitely.
   */
  timeout?: number;
}

interface PutGlobalOptions {
  /**
   * Per-put deadline (ms) for Gun's ack callback. The promise still
   * resolves to `undefined` (its public contract); on timeout a warning
   * is logged. Default 5000. Pass `0` to disable.
   */
  timeout?: number;
}

interface GetOptions {
  resolveHolograms?: boolean;
  validationOptions?: object;
  /** Per-`.once()` deadline in ms; cold paths resolve `null` after this. Default 8000. Pass `0` to disable. */
  timeout?: number;
  /** Return `_deleted: true` soft-tombstoned records instead of treating them as not-found. Default false. */
  includeDeleted?: boolean;
}

interface GetAllOptions {
  /** Per-`.once()` deadline in ms; cold paths resolve `[]` after this. Default 8000. Pass `0` to disable. */
  timeout?: number;
  /** Include `_deleted: true` soft-tombstoned records in the response. Default false. */
  includeDeleted?: boolean;
  /**
   * Provenance-annotated dual-source read: signed/authorized items tagged
   * `_verified: true`, unsigned/legacy/untrusted items tagged
   * `_verified: false, _unverified: true`. For display/migration only — never
   * trust `_unverified` items. Requires signing enabled. Default false.
   */
  includeUnverified?: boolean;
}

interface SubscribeOptions {
  /** Also notify on deletes (tombstones) instead of only live values. */
  includeDeletes?: boolean;
  /** Surface unsigned/legacy/untrusted updates tagged `_unverified` instead of dropping them under enforce. Display-only — never trust. Default false. */
  includeUnverified?: boolean;
}

interface ResolveHologramOptions {
  followHolograms?: boolean;
  visited?: Set<string>;
}

interface Hologram {
  id: string;
  soul: string;
  [key: string]: any;
}

/**
 * Canonical envelope attached to data resolved from a hologram reference.
 *
 * Single source of truth for resolved-hologram metadata. Every read path that
 * returns data resolved from a hologram (get, getAll, subscribe, getFederated,
 * getGlobal, getAllGlobal) attaches this field via `attachHologramMeta`.
 *
 * On success: `isHologram === true` and source* fields point at the origin.
 * On failure: `isHologram === false` and `error` describes why resolution failed.
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
}

export interface ResolvedHologramData {
  _hologram: ResolvedHologramMeta;
  [key: string]: any;
}

/**
 * Federation provenance envelope stamped on records that arrived via a
 * federated partner. Set by `getFederated` and by `propagate` when writing
 * to outbound partners.
 *
 * **Exported.** Domain types should declare `_federation?: FederationMeta`
 * instead of inlining the shape.
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
}

/**
 * Soft-tombstone marker recognised by `get`/`getAll`. A record with
 * `_deleted: true` is treated as not-found in the default response and
 * surfaced only when `{ includeDeleted: true }` is passed.
 *
 * **Exported.** Domain types that want to allow tombstoned records on the
 * wire should declare `_deleted?: boolean`.
 */
export type DeletedMarker = boolean;

/**
 * Convenience mixin: the three envelope fields the library stamps onto
 * records. Domain types can extend or intersect with this to avoid
 * redeclaring the shapes.
 */
export interface HolosphereEnvelope {
  _hologram?: ResolvedHologramMeta;
  _federation?: FederationMeta;
  _deleted?: DeletedMarker;
}

/**
 * Per-partner directional lens config. Directions are from the holding
 * space's perspective: `inbound` lenses are received from the partner,
 * `outbound` lenses are sent to the partner.
 */
interface FederationLensConfig {
  inbound: string[];
  outbound: string[];
  timestamp: number;
}

interface FederationInfo {
  id: string;
  name: string;
  /** Canonical list of all federation partners (any direction, including no lens flow yet). */
  federated: string[];
  /** Partners we receive data FROM (subset of `federated` with non-empty inbound lenses). */
  inbound: string[];
  /** Partners we send data TO (subset of `federated` with non-empty outbound lenses). */
  outbound: string[];
  /** Per-partner directional lens config. */
  lensConfig: Record<string, FederationLensConfig>;
  /** Optional display names for partners. */
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
  pathHolon: string;
  pathLens: string;
  pathKey: string;
  propagationResult?: PropagationResult | null;
  error?: string;
  /**
   * `true` when the ack deadline fired before Gun confirmed the write
   * (offline/partitioned mesh). The write is still committed locally
   * via radisk and Gun replays it whenever a peer reappears; subscriber
   * notification, hologram cascade, and federation propagation run at
   * that point. Absent or `false` when the put was acknowledged.
   */
  queued?: boolean;
  /** Holograms whose `updated` timestamp was bumped by this put (empty when the put timed out). */
  updatedHolograms?: Array<{ soul: string; holon: string; lens: string; key: string }>;
}

interface CanWriteResult {
  canWrite: boolean;
  reason: string;
  accessType: string;
}

interface HoloSphereConfig {
  appName?: string;
  appname?: string;
  privateKey?: Uint8Array | string | null;
  strict?: boolean;
  /** 'gun' (default) or 'nostr' — with 'nostr' the relay(s) are the wire and
   *  Gun runs peerless as the local-first cache (see relay-transport.js). */
  backend?: string;
  openaiKey?: string | null;
  gunOptions?: Record<string, any>;
  nostr?: {
    peers?: string[];
    relays?: string[];
    persistence?: boolean;
    /** Cold-read catch-up deadline for backend 'nostr' (ms, default 5000). */
    syncTimeoutMs?: number;
    verbose?: boolean;
    /** Standard-kind projection hooks (build with `buildProjections` from
     *  `@holons/core/nostr`). Published next to every 30078 event. */
    projections?: ProjectionHook[];
    /** Per-user signing key lookup for kind-0 / RSVP projections. */
    signerFor?: (userId: string | number) => string | Uint8Array | null | undefined;
  };
  /** Signing-layer options applied by backend 'nostr' init (shadow/enforce/
   *  perActorLenses/verbose — relays are always [] there; the transport
   *  publishes). */
  signing?: {
    shadow?: boolean;
    enforce?: boolean | 'membership';
    perActorLenses?: string[];
    verbose?: boolean;
  };
}

/** Hook shape consumed by projections.js (see @holons/core/nostr). */
export interface ProjectionHook {
  lens: string;
  kinds: number[];
  requiresAuthor?: 'user';
  project(holon: string, lens: string, item: unknown): { primary: any; companions?: any[] } | null;
  retract(holon: string, lens: string, id: string): any[];
}

declare class HoloSphere {
    appname: string;
    config: HoloSphereConfig;
    client: { publicKey: string };
    gun: any;
    subscriptions: Record<string, any>;

    constructor(config: HoloSphereConfig);
    constructor(appname: string, strict?: boolean, openaikey?: string | null, gunOptions?: any);

    ready(): Promise<HoloSphere>;
    getGun(): any;

    // Schema
    setSchema(lens: string, schema: object): Promise<boolean>;
    getSchema(lens: string, options?: { useCache?: boolean; maxCacheAge?: number }): Promise<object | null>;
    clearSchemaCache(lens?: string | null): boolean;

    // Content - v2-compatible signatures
    put(holon: string, lens: string, data: object, options?: PutOptions): Promise<PutResult>;
    put(holon: string, lens: string, data: object, password?: string | null, options?: PutOptions): Promise<PutResult>;
    get(holon: string, lens: string): Promise<any | null>;
    get(holon: string, lens: string, key: string, password?: string | null, options?: GetOptions): Promise<any | null>;
    getAll(holon: string, lens: string, password?: string | null, options?: GetAllOptions): Promise<Array<any>>;
    parse(rawData: any): Promise<object | null>;
    delete(holon: string, lens: string, key: string, password?: string | null, options?: DeleteOptions): Promise<boolean>;
    deleteAll(holon: string, lens: string, password?: string | null, options?: DeleteOptions): Promise<boolean>;

    // Node
    putNode(holon: string, lens: string, data: object): Promise<boolean>;
    getNode(holon: string, lens: string, key: string): Promise<any | null>;
    getNodeRef(soul: string): any;
    getNodeBySoul(soul: string): Promise<any>;
    deleteNode(holon: string, lens: string, key: string): Promise<boolean>;

    // Global
    putGlobal(tableName: string, data: object, password?: string | null, options?: PutGlobalOptions): Promise<void>;
    writeGlobal(tableName: string, data: object, options?: PutGlobalOptions): Promise<void>;
    getGlobal(tableName: string, key: string, password?: string | null): Promise<any | null>;
    getAllGlobal(tableName: string, password?: string | null): Promise<Array<any>>;
    deleteGlobal(tableName: string, key: string, password?: string | null): Promise<boolean>;
    deleteAllGlobal(tableName: string, password?: string | null): Promise<boolean>;
    subscribeGlobal(lens: string, key: string | null, callback: (data: any, key?: string) => void, options?: { realtimeOnly?: boolean }): { unsubscribe: () => void };
    subscribeGlobal(lens: string, callback: (data: any, key?: string) => void): { unsubscribe: () => void };

    // Hologram
    createHologram(holon: string, lens: string, data: { id: string, [key: string]: any }): Hologram;
    isHologram(data: any): data is Hologram;
    parseSoulPath(soul: string): { appname: string, holon: string, lens: string, key: string } | null;
    resolveHologram(hologram: Hologram, options?: ResolveHologramOptions): Promise<ResolvedHologramData | null>;
    attachHologramMeta<T extends object>(originalData: T, hologramSoul: string): T & ResolvedHologramData;

    // Compute
    computeHierarchy(holon: string, lens: string, options: object, maxLevels?: number, password?: string | null): Promise<Array<any>>;
    compute(holon: string, lens: string, options: object | string, password?: string | null): Promise<any>;
    summarize(history: string): Promise<string>;
    upcast(holon: string, lens: string, content: object, maxLevels?: number): Promise<object>;
    updateParent(id: string, report: string): Promise<object>;
    propagate(holon: string, lens: string, data: object, options?: PropagationOptions): Promise<PropagationResult>;
    /**
     * Retract a record from the parent hexagons `propagate` copied it to.
     * `key: null` retracts every copy this holon propagated into `lens`.
     * Called automatically by `delete`/`deleteAll`; exposed for repairing
     * records deleted before deletion propagation existed.
     */
    propagateDeletion(holon: string, lens: string, key?: string | null, options?: DeletionPropagationOptions): Promise<DeletionPropagationResult>;

    // Location
    getHolon(lat: number, lng: number, resolution: number): Promise<string>;
    getScalespace(lat: number, lng: number): string[];
    getHolonScalespace(holon: string): string[];

    // Subscription. Returns synchronously — `await` on the return value
    // still works (await on a non-Promise resolves to the value), so both
    // call styles produce the same `{ unsubscribe }` shape.
    subscribe(holon: string, lens: string, callback: (data: any, key?: string) => void, options?: SubscribeOptions): { unsubscribe: () => void };

    /**
     * Re-reads every (holon, lens) path with a live `subscribe()` so relay
     * state written while the wire was down flows through the existing
     * listeners. Runs automatically (debounced) after a websocket reconnect;
     * safe to call manually, e.g. from a browser `online` handler.
     */
    resyncSubscriptions(): Promise<void>;

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
    /**
     * Live federation-aware read — the streaming equivalent of `getFederated`.
     * Subscribes to `lens` on `holon` plus every partner it receives `lens` from,
     * merging into one id-deduped stream (local wins) with partner items tagged
     * `_federation`. The returned handle can toggle partners live via
     * `setFederated(on)` without disturbing the local subscription.
     */
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

    // Utility
    generateId(): string;
    close(): Promise<void>;
    getVersion(): string;
    userName(holonId: string): string;
    configureRadisk(options?: { file?: string; radisk?: boolean; until?: number | null; retry?: number; timeout?: number }): void;
    getRadiskStats(): { enabled: boolean; filePath: string; retry: number; timeout: number; until: number | null; peers: any[]; localStorage: boolean } | { error: string };
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
