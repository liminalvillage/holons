/**
 * @module holosphere
 * @version 1.3.0
 * @description Holonic Geospatial Communication Infrastructure
 * @author Roberto Valenti
 * @license GPL-3.0-or-later
 */

import * as h3 from 'h3-js';
import Gun from 'gun'
import Ajv2019 from 'ajv/dist/2019.js'
import * as Federation from './federation.js';
import * as SchemaOps from './schema.js';
import * as ContentOps from './content.js';
import * as NodeOps from './node.js';
import * as GlobalOps from './global.js';
import * as HologramOps from './hologram.js';
import * as ComputeOps from './compute.js';
import * as Utils from './utils.js';

// Named exports (v2-compatible)
import { nostrUtils } from './nostr-utils-shim.js';
import { subscriptions, buildLensPath } from './subscriptions-shim.js';
import { registry } from './registry-shim.js';
import * as handshake from './handshake-shim.js';

// Define the version constant
const HOLOSPHERE_VERSION = '1.3.0';
const version = HOLOSPHERE_VERSION;

class HoloSphere {
    /**
     * Initializes a new instance of the HoloSphere class.
     * Supports both v1 positional args and v2 config object.
     *
     * v1: new HoloSphere(appname, strict, openaikey, gunOptions)
     * v2: new HoloSphere({ appName, privateKey, backend, nostr: { peers, relays } })
     *
     * @param {string|object} appnameOrConfig - App name string (v1) or config object (v2).
     * @param {boolean} [strict=false] - Whether to enforce strict schema validation (v1 only).
     * @param {string|null} [openaikey=null] - The OpenAI API key (v1 only).
     * @param {object} [gunOptions={}] - Optional Gun constructor options (v1 only).
     */
    constructor(appnameOrConfig, strict = false, openaikey = null, gunOptions = {}) {
        // Detect v2-style config object
        if (typeof appnameOrConfig === 'object' && appnameOrConfig !== null) {
            const config = appnameOrConfig;
            this.config = config;
            this.appname = config.appName || config.appname || 'holosphere';
            this.strict = config.strict || false;
            this._privateKey = config.privateKey || null;

            // Derive public key from private key
            if (this._privateKey) {
                try {
                    const pubHex = nostrUtils.getPublicKeyFromBytes
                        ? nostrUtils.getPublicKeyFromBytes(this._privateKey)
                        : nostrUtils.getPublicKey(
                            typeof this._privateKey === 'string'
                                ? this._privateKey
                                : nostrUtils.bytesToHex(this._privateKey)
                          );
                    this.client = { publicKey: pubHex };
                } catch (e) {
                    console.warn('Failed to derive public key from private key:', e.message);
                    this.client = { publicKey: '' };
                }
            } else {
                this.client = { publicKey: '' };
            }

            // Map nostr relay/peer config to GunDB peers
            const relays = config.nostr?.relays || config.nostr?.peers || [];
            if (relays.length > 0) {
                const gunPeers = relays.map(r =>
                    r.replace('wss://', 'https://').replace('ws://', 'http://') + '/gun'
                );
                gunOptions = { peers: gunPeers, ...gunOptions };
            }

            // Allow explicit Gun options (peers, file, radisk, …) in v2 config.
            if (config.gunOptions) {
                gunOptions = { ...gunOptions, ...config.gunOptions };
            }

            openaikey = config.openaiKey || config.openaikey || null;
        } else {
            // v1-style positional args
            this.appname = appnameOrConfig;
            this.config = { appName: appnameOrConfig };
            this.client = { publicKey: '' };
            this.strict = strict;
            this._privateKey = null;
        }

        console.log('HoloSphere v' + HOLOSPHERE_VERSION);

        this.validator = new Ajv2019({
            allErrors: true,
            strict: false,
            validateSchema: true
        });

        // Define default Gun options with radisk enabled
        const defaultGunOptions = {
            peers: ['https://gun.holons.io/gun'],
            axe: false,
            radisk: true,
            file: './holosphere'
        };

        // In browser environment, disable localStorage when radisk is enabled
        if (typeof window !== 'undefined' && (gunOptions.radisk !== false)) {
            defaultGunOptions.localStorage = false;
        }

        // Merge provided options with defaults
        const finalGunOptions = { ...defaultGunOptions, ...gunOptions };
        console.log("Initializing Gun with options:", finalGunOptions);

        // Use provided Gun instance or create new one with final options
        this.gun = Gun(finalGunOptions);

        // OpenAI is optional - callers can set this.openai directly if needed
        this.openai = null;

        // Initialize subscriptions
        this.subscriptions = {};

        // Initialize schema cache
        this.schemaCache = new Map();

        // Holon-name cache so resolveHologram + getFederated don't refetch
        // `settings/<holon>` for every hologram from the same source.
        this._holonNameCache = new Map();

        // Initialize allowed authors set (for canWrite)
        this._allowedAuthors = new Set();

        // Phase 1 signing layer (null until enableSigning() is called)
        this._signer = null;
    }

    /**
     * Waits for the HoloSphere instance to be ready.
     * GunDB connects eagerly, so this resolves immediately.
     * @returns {Promise<HoloSphere>} - The ready instance
     */
    async ready() {
        return this;
    }

    getGun() {
        return this.gun;
    }

    // ================================ SCHEMA FUNCTIONS ================================

    async setSchema(lens, schema) {
        return SchemaOps.setSchema(this, lens, schema);
    }

    async getSchema(lens, options = {}) {
        return SchemaOps.getSchema(this, lens, options);
    }

    clearSchemaCache(lens = null) {
        return SchemaOps.clearSchemaCache(this, lens);
    }

    // ================================ CONTENT FUNCTIONS ================================

    /**
     * Stores content in the specified holon and lens.
     * Supports both v1 and v2 calling conventions:
     *   v1: put(holon, lens, data, password, options)
     *   v2: put(holon, lens, data, { actingAs }) or put(holon, lens, data)
     */
    async put(holon, lens, data, passwordOrOptions = null, options = {}) {
        let password = null;
        if (typeof passwordOrOptions === 'object' && passwordOrOptions !== null) {
            // v2-style: 4th arg is options object (e.g., { actingAs })
            options = passwordOrOptions;
            password = options.password || null;
        } else {
            // v1-style: 4th arg is password string
            password = passwordOrOptions;
        }
        return ContentOps.put(this, holon, lens, data, password, options);
    }

    /**
     * Retrieves content from the specified holon and lens.
     * Supports both v1 and v2 calling conventions:
     *   v1: get(holon, lens, key, password, options)
     *   v2: get(holon, lens) or get(holon, lens, key)
     */
    async get(holon, lens, key = null, password = null, options = {}) {
        if (key === null || key === undefined) {
            // v2-style 2-arg call: get entire lens (return first/only item).
            // Route through this.getAll so the signing layer resolves it.
            const items = await this.getAll(holon, lens, password, options);
            return items && items.length > 0 ? items[0] : null;
        }
        const raw = await ContentOps.get(this, holon, lens, key, password, options);
        // Resolve a single item through the signing layer — every get resolves.
        const signer = this._signer;
        if (signer && signer.enforce && lens !== '_members' && !options._skipAuthorize) {
            if (signer.isPerActor(lens)) {
                // per-author lens: return the subject's aggregated records
                return signer.aggregate(this, holon, lens, key);
            }
            // resolve the single item from its signed envelopes (raw-tamper-proof)
            return signer.resolveItem(this, holon, lens, key);
        }
        return raw;
    }

    async getAll(holon, lens, password = null, options = {}) {
        const items = await ContentOps.getAll(this, holon, lens, password, options);
        const signer = this._signer;
        if (signer && lens !== '_members' && !options._skipAuthorize) {
            // Phase 2 enforce: collapse to the authorized view (changes output).
            if (signer.enforce) {
                // Per-author lenses (participation, reactions, …) aggregate one
                // record per trusted author instead of collapsing to a single winner.
                if (signer.isPerActor(lens)) {
                    return signer.aggregate(this, holon, lens);
                }
                const { items: view } = await signer.authorizedView(this, holon, lens, items);
                return view;
            }
            // Phase 1 shadow: measure the forgery surface without changing output
            // (fire-and-forget so reads are never delayed or altered).
            if (signer.shadow && !options._skipShadow) {
                Promise.resolve()
                    .then(() => signer.shadowCheck(this, holon, lens, items))
                    .catch(() => {});
            }
        }
        return items;
    }

    async parse(rawData) {
        return ContentOps.parse(this, rawData);
    }

    async delete(holon, lens, key, password = null, options = {}) {
        // Signed delete: authenticate the removal with a signed tombstone so an
        // unauthorized key can't drop your data from the resolved view, and so a
        // per-actor record (participation, …) can be retracted by its owner.
        if (this._signer && holon && !options._skipSign) {
            try { await this._signer.onDelete(this, holon, lens, key); } catch { /* best-effort */ }
        }
        return ContentOps.deleteFunc(this, holon, lens, key, password);
    }

    async deleteAll(holon, lens, password = null) {
        return ContentOps.deleteAll(this, holon, lens, password);
    }

    // ================================ NODE FUNCTIONS ================================

    async putNode(holon, lens, data) {
        return NodeOps.putNode(this, holon, lens, data);
    }

    async getNode(holon, lens, key) {
        return NodeOps.getNode(this, holon, lens, key);
    }

    getNodeRef(soul) {
        return NodeOps.getNodeRef(this, soul);
    }

    async getNodeBySoul(soul) {
        return NodeOps.getNodeBySoul(this, soul);
    }

    async deleteNode(holon, lens, key) {
        return NodeOps.deleteNode(this, holon, lens, key);
    }

    // ================================ GLOBAL FUNCTIONS ================================
    //
    // A "global" is just a holon-less get/put: data at appname/table/key instead
    // of appname/holon/lens/key. These are thin aliases over the holon-aware
    // methods with `holon = null`. (Global tables hold infrastructure like the
    // federation config, so they skip signing/resolution — get/put detect the
    // null holon and route to the holon-less path automatically.)

    async putGlobal(tableName, data, password = null, options = {}) {
        return this.put(null, tableName, data, password, options);
    }

    /** v2-compatible alias for putGlobal (no password param) */
    async writeGlobal(tableName, data, options = {}) {
        return this.put(null, tableName, data, null, options);
    }

    async getGlobal(tableName, key, password = null) {
        return this.get(null, tableName, key, password, { _skipAuthorize: true });
    }

    async getAllGlobal(tableName, password = null) {
        return this.getAll(null, tableName, password, { _skipAuthorize: true });
    }

    async deleteGlobal(tableName, key, password = null) {
        return this.delete(null, tableName, key, password);
    }

    async deleteAllGlobal(tableName, password = null) {
        return this.deleteAll(null, tableName, password);
    }

    /**
     * Subscribe to real-time changes in a global table.
     * v2-compatible: subscribeGlobal(lens, key, callback, options)
     *
     * Returns synchronously — see {@link subscribe}.
     */
    subscribeGlobal(lens, keyOrCallback, callbackOrOptions, options = {}) {
        let key, callback;
        if (typeof keyOrCallback === 'function') {
            callback = keyOrCallback;
            key = null;
            options = callbackOrOptions || {};
        } else {
            key = keyOrCallback;
            callback = callbackOrOptions;
        }
        return GlobalOps.subscribeGlobal(this, lens, key, callback, options);
    }

    // ================================ REFERENCE FUNCTIONS ================================

    createHologram(holon, lens, data) {
        return HologramOps.createHologram(this, holon, lens, data);
    }

    parseSoulPath(soul) {
        return HologramOps.parseSoulPath(soul);
    }

    isHologram(data) {
        return HologramOps.isHologram(data);
    }

    async resolveHologram(hologram, options = {}) {
        return HologramOps.resolveHologram(this, hologram, options);
    }

    attachHologramMeta(originalData, hologramSoul) {
        return HologramOps.attachHologramMeta(originalData, hologramSoul);
    }

    // ================================ COMPUTE FUNCTIONS ================================

    async computeHierarchy(holon, lens, options, maxLevels = 15, password = null) {
        return ComputeOps.computeHierarchy(this, holon, lens, options, maxLevels, password);
    }

    async compute(holon, lens, options, password = null) {
        return ComputeOps.compute(this, holon, lens, options, password);
    }

    async summarize(history) {
        return ComputeOps.summarize(this, history);
    }

    async upcast(holon, lens, content, maxLevels = 15) {
        return ComputeOps.upcast(this, holon, lens, content, maxLevels);
    }

    async updateParent(id, report) {
        return ComputeOps.updateParent(this, id, report);
    }

    async propagate(holon, lens, data, options = {}) {
        return Federation.propagate(this, holon, lens, data, options);
    }

    async getHolon(lat, lng, resolution) {
        return Utils.getHolon(lat, lng, resolution);
    }

    getScalespace(lat, lng) {
        return Utils.getScalespace(lat, lng);
    }

    getHolonScalespace(holon) {
        return Utils.getHolonScalespace(holon);
    }

    /**
     * Subscribe to real-time changes for a holon/lens.
     *
     * Synchronous return: `{ unsubscribe: () => void }`. Callers do not
     * need to `await` — both `const s = holosphere.subscribe(...)` and
     * `const s = await holosphere.subscribe(...)` yield the same shape.
     */
    subscribe(holon, lens, callback, options = {}) {
        const signer = this._signer;
        // In enforce mode, resolve each update through the signing layer so
        // subscribers see the authorized value (or null when an update isn't from
        // a trusted, valid signature, or the item was deleted) — symmetric with
        // get/getAll. Re-resolving on every change makes deletes notify too.
        if (signer && signer.enforce && holon && lens !== '_members') {
            const self = this;
            const resolved = async (_data, key) => {
                // The signed envelope is written before the raw write that triggers
                // this, so a single resolve is consistent (no race).
                try {
                    if (signer.isPerActor(lens)) {
                        callback(await signer.aggregate(self, holon, lens, key), key);
                    } else {
                        callback(await signer.resolveItem(self, holon, lens, key), key);
                    }
                } catch { /* ignore */ }
            };
            return Utils.subscribe(this, holon, lens, resolved, { includeDeletes: true });
        }
        return Utils.subscribe(this, holon, lens, callback, options);
    }

    notifySubscribers(data) {
        return Utils.notifySubscribers(this, data);
    }

    /**
     * Resolve a holon's display name from its `settings/<holon>` record.
     * Cached per-instance so repeated lookups (e.g. one per hologram in a
     * federated batch) only fetch once. Returns `null` when no name is set.
     *
     * Used internally by `resolveHologram` to stamp
     * `_hologram.sourceHolonName` so every consumer of a resolved hologram
     * already has the display name without a second round-trip.
     */
    async getHolonName(holonId) {
        if (!holonId) return null;
        const key = String(holonId);
        if (this._holonNameCache.has(key)) return this._holonNameCache.get(key);
        try {
            const settings = await this.get(key, 'settings', key);
            let name = null;
            if (settings) {
                if (Array.isArray(settings)) {
                    const found = settings.find(s => s && typeof s.name === 'string' && s.name.trim() !== '');
                    name = found ? found.name : null;
                } else if (typeof settings.name === 'string' && settings.name.trim() !== '') {
                    name = settings.name;
                }
            }
            this._holonNameCache.set(key, name);
            return name;
        } catch {
            this._holonNameCache.set(key, null);
            return null;
        }
    }

    generateId() {
        return Utils.generateId();
    }

    // ================================ FEDERATION FUNCTIONS ================================

    async federate(holonId1, holonId2, password1 = null, password2 = null, bidirectional = true, lensConfig = {}) {
        return Federation.federate(this, holonId1, holonId2, password1, password2, bidirectional, lensConfig);
    }

    /**
     * Convenience wrapper around federate() for the common bidirectional case.
     * @param {string} sourceHolon - Source holon ID
     * @param {string} targetHolon - Target holon ID
     * @param {object} [options] - Federation options
     * @param {object} [options.lensConfig] - Lens config from sourceHolon's perspective
     * @param {string[]} [options.lensConfig.inbound] - Lenses sourceHolon receives from targetHolon
     * @param {string[]} [options.lensConfig.outbound] - Lenses sourceHolon sends to targetHolon
     * @param {string} [options.partnerName] - Display name for the partner
     * @returns {Promise<boolean>}
     */
    async federateHolon(sourceHolon, targetHolon, options = {}) {
        const lensConfig = options.lensConfig || {};
        const inbound  = Array.isArray(lensConfig.inbound)  ? lensConfig.inbound  : [];
        const outbound = Array.isArray(lensConfig.outbound) ? lensConfig.outbound : [];

        const ok = await Federation.federate(this, sourceHolon, targetHolon, null, null, true, {
            inbound,
            outbound
        });

        if (ok && options.partnerName) {
            try {
                const fedInfo = await this.getFederation(sourceHolon);
                if (fedInfo) {
                    if (!fedInfo.partnerNames) fedInfo.partnerNames = {};
                    fedInfo.partnerNames[targetHolon] = options.partnerName;
                    await this.putGlobal('federation', fedInfo);
                }
            } catch (e) {
                console.warn('Failed to store partner name:', e.message);
            }
        }

        return ok;
    }

    /**
     * v2-compatible federation removal.
     * @param {string} sourceHolon - Source holon ID
     * @param {string} targetHolon - Target holon ID
     * @returns {Promise<boolean>}
     */
    async unfederateHolon(sourceHolon, targetHolon) {
        return Federation.unfederate(this, sourceHolon, targetHolon, null, null);
    }

    async subscribeFederation(holonId, password, callback, options = {}) {
        return Federation.subscribeFederation(this, holonId, password, callback, options);
    }

    /**
     * Gets federation info for a holon.
     * Returns v2-compatible shape with `federated`, `lensConfig`, `partnerNames` fields.
     */
    async getFederation(holonId, password = null) {
        const result = await Federation.getFederation(this, holonId, password);
        if (!result) return { federated: [], lensConfig: {}, partnerNames: {} };

        // Add v2-compatible fields alongside existing v1 fields
        if (!result.federated) result.federated = result.federation || [];
        if (!result.partnerNames) result.partnerNames = {};
        // Ensure lensConfig exists (v1 already stores this)
        if (!result.lensConfig) result.lensConfig = {};

        return result;
    }

    async getFederatedConfig(holonId, targetHolonId, password = null) {
        return Federation.getFederatedConfig(this, holonId, targetHolonId, password);
    }

    async unfederate(holonId1, holonId2, password1, password2 = null) {
        return await Federation.unfederate(this, holonId1, holonId2, password1, password2);
    }

    async removeNotify(holonId1, holonId2, password1 = null) {
        console.log(`HoloSphere.removeNotify called: ${holonId1}, ${holonId2}`);
        try {
            const result = await Federation.removeNotify(this, holonId1, holonId2, password1);
            console.log(`HoloSphere.removeNotify completed successfully: ${result}`);
            return result;
        } catch (error) {
            console.error(`HoloSphere.removeNotify failed:`, error);
            throw error;
        }
    }

    async getFederated(holon, lens, options = {}) {
        return Federation.getFederated(this, holon, lens, options);
    }

    async federateMessage(originalChatId, messageId, federatedChatId, federatedMessageId, type = 'generic') {
        return Federation.federateMessage(this, originalChatId, messageId, federatedChatId, federatedMessageId, type);
    }

    async getFederatedMessages(originalChatId, messageId) {
        return Federation.getFederatedMessages(this, originalChatId, messageId);
    }

    async updateFederatedMessages(originalChatId, messageId, updateCallback) {
        return Federation.updateFederatedMessages(this, originalChatId, messageId, updateCallback);
    }

    async resetFederation(holonId, password = null) {
        return Federation.resetFederation(this, holonId, password);
    }

    // ================================ AUTHORIZATION FUNCTIONS ================================

    /**
     * Check if a public key can write to a holon/lens.
     * @param {string} holonId - The holon ID
     * @param {string} lensName - The lens name
     * @param {string} actingAs - The public key attempting to write
     * @param {object} [options] - Additional options
     * @returns {Promise<{ canWrite: boolean, reason: string, accessType: string }>}
     */
    async canWrite(holonId, lensName, actingAs, options = {}) {
        // Owner always has access
        if (actingAs === this.client?.publicKey || actingAs === holonId) {
            return { canWrite: true, reason: 'owner', accessType: 'owner' };
        }

        // Check allowed authors
        if (this._allowedAuthors.has(actingAs)) {
            return { canWrite: true, reason: 'allowed_author', accessType: 'allowed' };
        }

        // Check federation
        try {
            const fed = await Federation.getFederation(this, holonId);
            if (fed && fed.federation && fed.federation.includes(actingAs)) {
                return { canWrite: true, reason: 'federated', accessType: 'federation' };
            }
        } catch (e) { /* ignore */ }

        return { canWrite: false, reason: 'not_authorized', accessType: 'none' };
    }

    /**
     * Add a public key to the allowed authors list.
     * @param {string} pubkey - The public key to allow
     */
    addAllowedAuthor(pubkey) {
        this._allowedAuthors.add(pubkey);
    }

    /**
     * Remove a public key from the allowed authors list.
     * @param {string} pubkey - The public key to remove
     */
    removeAllowedAuthor(pubkey) {
        this._allowedAuthors.delete(pubkey);
    }

    /**
     * List all allowed authors.
     * @returns {string[]}
     */
    listAllowedAuthors() {
        return Array.from(this._allowedAuthors);
    }

    // ================================ SIGNING (Phase 1) ================================
    //
    // Opt-in NIP-01 signing: sign-on-write + dual-publish to Nostr relay(s),
    // plus relay-backed recover and relay migration. Non-breaking — the Gun
    // store is unchanged; signed events are published alongside. Requires the
    // optional `nostr-tools` dependency. See NOSTR-SIGNING-PLAN.md.

    /**
     * Enable signing. Every subsequent put publishes a signed event to the
     * configured relays.
     * @param {object} [opts]
     * @param {string|Uint8Array} [opts.privateKey] - defaults to the instance key
     * @param {string[]} [opts.relays] - defaults to config.nostr.relays
     * @param {boolean} [opts.verbose]
     * @returns {Promise<object>} the signer
     */
    async enableSigning(opts = {}) {
        const { createSigner } = await import('./signing.js');
        const privateKey = opts.privateKey || this._privateKey;
        const relays = opts.relays
            || this.config?.nostr?.relays
            || this.config?.nostr?.peers
            || [];
        // Your read-list lives under your "read space" (default: your own key).
        // Hydrate it from the SAVED federation list, then add any explicit seeds.
        this._readSpace = opts.federationSpace || this.client?.publicKey || this.appname;
        await this._hydrateReadKeys();
        if (Array.isArray(opts.readKeys)) opts.readKeys.forEach((k) => this._addReadKeyLocal(k));
        this._signer = await createSigner({
            privateKey, relays, verbose: opts.verbose,
            shadow: opts.shadow, enforce: opts.enforce, storeEnvelope: opts.storeEnvelope,
            perActorLenses: opts.perActorLenses,
        });
        return this._signer;
    }

    /** Disable signing and close relay connections. */
    disableSigning() {
        try { this._signer?.close(); } catch { /* ignore */ }
        this._signer = null;
    }

    /** Whether signing is currently enabled. */
    get signingEnabled() {
        return this._signer !== null;
    }

    /** Current signing relays (empty if signing is disabled). */
    getSigningRelays() {
        return this._signer ? this._signer.relays : [];
    }

    /** Replace the signing relay set. */
    setSigningRelays(relays) {
        if (!this._signer) throw new Error('setSigningRelays: signing not enabled');
        this._signer.setRelays(relays);
    }

    /**
     * Recover a holon/lens from the relays into the local Gun store (verifies
     * signatures, drops forgeries).
     * @returns {Promise<{found:number, restored:number}>}
     */
    async rehydrate(holon, lens, opts = {}) {
        if (!this._signer) throw new Error('rehydrate: signing not enabled');
        return this._signer.rehydrate(this, holon, lens, opts);
    }

    /**
     * Move your data to a different relay set. Republishes your signed events
     * verbatim (signatures stay valid, ids dedup). With no filter it moves ALL
     * your data across every holon/lens.
     * @param {object} o
     * @param {string[]} o.to - destination relays
     * @param {string[]} [o.from] - source relays (defaults to current)
     * @param {boolean} [o.switch] - switch to `to` after a successful move
     * @returns {Promise<{total:number, moved:number, switched:boolean}>}
     */
    async migrateRelays(o) {
        if (!this._signer) throw new Error('migrateRelays: signing not enabled');
        return this._signer.migrate(o);
    }

    /**
     * Shadow audit a lens: read it and classify every item against its local
     * signed envelope (accounted vs would-drop). Returns a per-call summary and
     * also updates the cumulative report. Output of the lens is unchanged.
     * Requires signing enabled with `shadow: true`.
     * @returns {Promise<{items, accounted, wouldDrop, unsigned, invalidSig, mismatch}>}
     */
    async auditLens(holon, lens) {
        if (!this._signer) throw new Error('auditLens: signing not enabled');
        const items = await this.getAll(holon, lens, null, { _skipShadow: true });
        return this._signer.shadowCheck(this, holon, lens, items);
    }

    /** Cumulative shadow/authorized report (empty if signing is off). */
    getShadowReport() {
        return this._signer ? this._signer.getReport() : null;
    }

    /** Reset the cumulative report. */
    resetShadowReport() {
        this._signer?.resetReport();
    }

    // -------- Per-author aggregate (signed, filterable collaborative state) --------
    //
    // For collaborative state where many actors each assert their own status
    // (participation, reactions, votes, RSVPs), store one signed record per actor
    // (write with `id` = the subject) instead of a shared mutable array. Each
    // actor's record lives under their own key, so it can't be forged across keys
    // and your read-list filters it. `aggregate` returns each trusted actor's
    // LATEST record; toggling is just a newer record from that actor.

    /**
     * Per-author aggregate for a lens (optionally one subject). Returns each
     * trusted author's latest signed record, tagged with `_owner` + `_subject`.
     * @returns {Promise<object[]>}
     */
    async aggregate(holon, lens, subject = null) {
        if (!this._signer) throw new Error('aggregate: signing not enabled');
        return this._signer.aggregate(this, holon, lens, subject);
    }

    /** Mark a lens as per-author, so enforce-mode `getAll` aggregates it. */
    setPerActorLens(lens) {
        if (!this._signer) throw new Error('setPerActorLens: signing not enabled');
        this._signer.addPerActorLens(lens);
    }

    // -------- Federation read-list (default authorized read) --------
    //
    // In the default `enforce` mode, your authorized-read set IS your SAVED
    // federation list — the keys you've federated with under your read space
    // (default: your own key), hydrated on enableSigning — plus your own key.
    // `addReadKey`/`removeReadKey` write through to that saved federation, so the
    // allow-list and the federation list are one and the same. Reader-scoped,
    // current-list (Nostr follow model). Accepts npub or hex.

    /** Add a key (npub/hex) to the in-memory read-set only (no persistence). */
    _addReadKeyLocal(key) {
        const hex = (nostrUtils.parseNpubOrHex && nostrUtils.parseNpubOrHex(key)) || key;
        if (hex) this._allowedAuthors.add(hex);
        return hex;
    }

    /** Load the read-set from the saved federation list (additive). */
    async _hydrateReadKeys() {
        if (!this._readSpace) return;
        try {
            const fed = await this.getFederation(this._readSpace);
            const list = (fed && (fed.federated || fed.federation)) || [];
            for (const k of list) this._addReadKeyLocal(k);
        } catch { /* nothing federated yet */ }
    }

    /**
     * Trust a key (npub or hex): add it to your read-set AND persist it to your
     * saved federation list. Returns the hex key.
     */
    async addReadKey(key) {
        const hex = this._addReadKeyLocal(key);
        if (this._readSpace && hex && hex !== this.client?.publicKey) {
            try { await this.federate(this._readSpace, hex, null, null, false); } catch { /* best-effort persist */ }
        }
        return hex;
    }

    /** Stop trusting a key: remove from the read-set AND your saved federation. */
    async removeReadKey(key) {
        const hex = (nostrUtils.parseNpubOrHex && nostrUtils.parseNpubOrHex(key)) || key;
        this._allowedAuthors.delete(hex);
        if (this._readSpace && hex) { try { await this.unfederate(this._readSpace, hex); } catch { /* ignore */ } }
    }

    /** Reload the read-set from the saved federation list. */
    async refreshReadKeys() {
        await this._hydrateReadKeys();
        return this.getReadKeys();
    }

    /** Your effective read-list: your own key + your saved federation list. */
    getReadKeys() {
        const own = this.client?.publicKey;
        return [...(own ? [own] : []), ...this._allowedAuthors];
    }

    // -------- Membership (optional `enforce: 'membership'` holon-authority mode) --------
    //
    // An alternative to the federation read-list: authority lives ON THE HOLON
    // as a signed, append-only log rooted at a genesis key (admin-gated
    // add/remove, as-of-time). Use this when the *space* defines who may write
    // (e.g. a shared treasury), rather than each reader choosing whose keys to
    // read. Only consulted when signing was enabled with `enforce: 'membership'`.
    // See NOSTR-SIGNING-PLAN.md §6.

    /** Pin the trusted genesis pubkey for a holon (else TOFU = earliest genesis). */
    setGenesis(holon, pubkey) {
        if (!this._signer) throw new Error('setGenesis: signing not enabled');
        this._signer.pinGenesis(holon, pubkey);
    }

    /**
     * Found a holon: write a self-signed genesis membership event making the
     * local key the first admin, and pin it as the trust anchor.
     * @returns {Promise<string>} the genesis pubkey
     */
    async foundHolon(holon, opts = {}) {
        if (!this._signer) throw new Error('foundHolon: signing not enabled');
        this._signer.pinGenesis(holon, this._signer.pubkey);
        const item = { id: 'genesis', op: 'genesis', role: 'admin' };
        await this._signer.signAndStore(this, holon, '_members', item, { at: opts.at });
        await this.put(holon, '_members', item, null, { _skipSign: true });
        return this._signer.pubkey;
    }

    /**
     * Add a member (only effective if the local key is an admin of the holon).
     * @param {string} role - 'member' (default) or 'admin'
     */
    async addMember(holon, pubkey, role = 'member', opts = {}) {
        if (!this._signer) throw new Error('addMember: signing not enabled');
        const at = opts.at;
        const item = { id: `add:${pubkey}:${at ?? Date.now()}`, op: 'add', pubkey, role };
        await this._signer.signAndStore(this, holon, '_members', item, { at });
        await this.put(holon, '_members', item, null, { _skipSign: true });
    }

    /** Remove a member (only effective if the local key is an admin). */
    async removeMember(holon, pubkey, opts = {}) {
        if (!this._signer) throw new Error('removeMember: signing not enabled');
        const at = opts.at;
        const item = { id: `remove:${pubkey}:${at ?? Date.now()}`, op: 'remove', pubkey };
        await this._signer.signAndStore(this, holon, '_members', item, { at });
        await this.put(holon, '_members', item, null, { _skipSign: true });
    }

    /** Current authorized members → Map(pubkey -> role). */
    async getMembers(holon) {
        if (!this._signer) throw new Error('getMembers: signing not enabled');
        const tl = await this._signer.resolveMembership(this, holon);
        return tl.currentMembers();
    }

    /**
     * Items present in the lens but NOT backed by an authorized signature
     * (unsigned / unauthorized / invalid). What enforce-mode reads hide.
     */
    async getPending(holon, lens) {
        if (!this._signer) throw new Error('getPending: signing not enabled');
        const items = await this.getAll(holon, lens, null, { _skipAuthorize: true });
        const { pending } = await this._signer.authorizedView(this, holon, lens, items);
        return pending;
    }

    // ================================ END FEDERATION FUNCTIONS ================================

    async close() {
        return Utils.close(this);
    }

    userName(holonId) {
        return Utils.userName(this, holonId);
    }

    getVersion() {
        return HOLOSPHERE_VERSION;
    }

    configureRadisk(options = {}) {
        const defaultOptions = {
            file: './radata',
            radisk: true,
            until: null,
            retry: 3,
            timeout: 5000
        };

        const radiskOptions = { ...defaultOptions, ...options };

        if (this.gun && this.gun._.opt) {
            Object.assign(this.gun._.opt, radiskOptions);
            console.log("Radisk configuration updated:", radiskOptions);
        } else {
            console.warn("Gun instance not available for radisk configuration");
        }
    }

    getRadiskStats() {
        if (!this.gun || !this.gun._.opt) {
            return { error: "Gun instance not available" };
        }

        const options = this.gun._.opt;
        return {
            enabled: options.radisk || false,
            filePath: options.file || './radata',
            retry: options.retry || 3,
            timeout: options.timeout || 5000,
            until: options.until || null,
            peers: options.peers || [],
            localStorage: options.localStorage || false
        };
    }
}

// Default and named exports (v2-compatible)
export default HoloSphere;
export { HoloSphere, handshake, nostrUtils, subscriptions, buildLensPath, registry, version };
