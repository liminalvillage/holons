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

interface PutOptions {
  autoPropagate?: boolean;
  propagationOptions?: PropagationOptions;
  disableHologramRedirection?: boolean;
  actingAs?: string;
  password?: string | null;
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
 */
interface ResolvedHologramMeta {
  isHologram: boolean;
  soul: string;
  sourceHolon?: string | null;
  sourceLens?: string | null;
  sourceKey?: string | null;
  resolvedAt: number;
  error?: string;
}

interface ResolvedHologramData {
  _hologram: ResolvedHologramMeta;
  [key: string]: any;
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
  backend?: string;
  openaiKey?: string | null;
  nostr?: {
    peers?: string[];
    relays?: string[];
    persistence?: boolean;
  };
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
    delete(holon: string, lens: string, key: string, password?: string | null): Promise<boolean>;
    deleteAll(holon: string, lens: string, password?: string | null): Promise<boolean>;

    // Node
    putNode(holon: string, lens: string, data: object): Promise<boolean>;
    getNode(holon: string, lens: string, key: string): Promise<any | null>;
    getNodeRef(soul: string): any;
    getNodeBySoul(soul: string): Promise<any>;
    deleteNode(holon: string, lens: string, key: string): Promise<boolean>;

    // Global
    putGlobal(tableName: string, data: object, password?: string | null): Promise<void>;
    writeGlobal(tableName: string, data: object): Promise<void>;
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

    // Location
    getHolon(lat: number, lng: number, resolution: number): Promise<string>;
    getScalespace(lat: number, lng: number): string[];
    getHolonScalespace(holon: string): string[];

    // Subscription. Returns synchronously — `await` on the return value
    // still works (await on a non-Promise resolves to the value), so both
    // call styles produce the same `{ unsubscribe }` shape.
    subscribe(holon: string, lens: string, callback: (data: any, key?: string) => void): { unsubscribe: () => void };

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
