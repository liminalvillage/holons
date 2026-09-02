/**
 * @module holosphere
 * @version 2.0.0
 * @description Holonic Geospatial Communication Infrastructure
 * @author Roberto Valenti
 * @license AGPL-3.0-or-later
 *
 * Holosphere keeps every record as a signed Nostr event: the relays are the
 * wire and the durable copy, a local event-sourced store (store/) is the
 * cache that makes reads instant and subscriptions fire. See STORE.md and
 * NOSTR-BACKEND.md.
 */

import Ajv2019 from 'ajv/dist/2019.js';
import * as Federation from './federation.js';
import * as SchemaOps from './schema.js';
import * as ContentOps from './content.js';
import * as NodeOps from './node.js';
import * as GlobalOps from './global.js';
import * as HologramOps from './hologram.js';
import * as ComputeOps from './compute.js';
import * as Utils from './utils.js';
import { createStore, CAPABILITIES_HOLON } from './store/index.js';
import { createSigner } from './signing.js';
import { createRelayTransport } from './relay-transport.js';
import { generateSecretKey } from './nostr-events.js';

// Named exports (v2-compatible)
import { nostrUtils } from './nostr-utils-shim.js';
import { subscriptions, buildLensPath } from './subscriptions-shim.js';
import { registry } from './registry-shim.js';
import * as handshake from './handshake-shim.js';

const HOLOSPHERE_VERSION = '2.0.0';
const version = HOLOSPHERE_VERSION;

const HOLONS_REGISTRY_TABLE = 'holons_registry';

class HoloSphere {
    /**
     * v2: new HoloSphere({ appName, privateKey, relays, nostr: {…}, store: {…}, signing: {…}, strict })
     * v1: new HoloSphere(appname, strict)
     *
     * With `relays` the relay set is the wire; without, the instance is
     * local-only (offline, tests). With a `privateKey` every write is signed;
     * with relays but no key an ephemeral key is generated (identity does not
     * survive a restart).
     */
    constructor(appnameOrConfig, strict = false, openaikey = null, legacyOptions = undefined) {
        if (typeof appnameOrConfig === 'object' && appnameOrConfig !== null) {
            const config = appnameOrConfig;
            this.config = config;
            this.appname = config.appName || config.appname || 'holosphere';
            this.strict = config.strict || false;
            this._privateKey = config.privateKey || null;
            if (config.backend && config.backend !== 'nostr') {
                console.warn(`[holosphere] backend '${config.backend}' is no longer supported — the relay is the wire (or the instance is local-only without relays)`);
            }
            if (config.gunOptions) {
                console.warn('[holosphere] gunOptions are ignored: Gun has been removed (see STORE.md for store options)');
            }
            openaikey = config.openaiKey || config.openaikey || null;
        } else {
            this.appname = appnameOrConfig;
            this.config = { appName: appnameOrConfig };
            this.strict = strict;
            this._privateKey = null;
            if (legacyOptions && typeof legacyOptions === 'object' && Object.keys(legacyOptions).length) {
                console.warn('[holosphere] the 4th constructor argument (gun options) is ignored: Gun has been removed');
            }
        }
        const cfg = this.config;
        this._relays = [...(cfg.relays || cfg.nostr?.relays || cfg.nostr?.peers || [])]
            .map((r) => String(r).trim()).filter(Boolean);

        if (!this._privateKey && this._relays.length) {
            this._privateKey = generateSecretKey();
            console.warn('[holosphere] no privateKey configured — generated an ephemeral device key (identity will not survive a restart)');
        }
        this.client = { publicKey: this._privateKey ? this._derivePubKey(this._privateKey) : '' };

        console.log('HoloSphere v' + HOLOSPHERE_VERSION);

        this.validator = new Ajv2019({
            allErrors: true,
            strict: false,
            validateSchema: true
        });

        // The local store (see STORE.md). Adapter defaults to IndexedDB in a
        // browser and memory elsewhere; Node hosts pass `store: { adapter:
        // 'file', dir }` for durability.
        const storeCfg = cfg.store || {};
        this.store = createStore({
            appName: this.appname,
            adapter: storeCfg.adapter,
            dir: storeCfg.dir,
            compactAfter: storeCfg.compactAfter,
        });

        this.openai = null;
        this.subscriptions = {};
        this.schemaCache = new Map();
        // Holon-name cache so resolveHologram + getFederated don't refetch
        // `settings/<holon>` for every hologram from the same source.
        this._holonNameCache = new Map();
        // Allowed authors (canWrite + the default enforce read-list)
        this._allowedAuthors = new Set();
        this._closed = false;

        // Signing: every write is a signed event when a key is present.
        this._signer = null;
        this._readSpace = null;
        const signing = cfg.signing || {};
        if (this._privateKey) {
            this._readSpace = this.client.publicKey || this.appname;
            this._signer = createSigner({
                privateKey: this._privateKey,
                shadow: signing.shadow,
                enforce: signing.enforce,
                perActorLenses: signing.perActorLenses,
                verbose: signing.verbose,
            });
        }

        // Open the store, then (with relays) bring the transport up. Every
        // read/write path awaits this.
        this._relayTransport = null;
        this._ready = this.store.open()
            .then(() => {
                if (this._relays.length) this._startTransport(this._relays);
            })
            .catch((e) => { console.warn('[holosphere] init failed:', e?.message); });
    }

    _startTransport(relays) {
        if (this._relayTransport || this._closed || !relays.length) return;
        const cfg = this.config || {};
        const signing = cfg.signing || {};
        this._relays = [...relays];
        this._relayTransport = createRelayTransport(this, {
            relays,
            privateKey: this._privateKey,
            syncTimeoutMs: cfg.nostr?.syncTimeoutMs,
            pageSize: cfg.nostr?.pageSize,
            verbose: signing.verbose || cfg.nostr?.verbose,
            projections: cfg.nostr?.projections,
            signerFor: cfg.nostr?.signerFor,
            providerKey: cfg.nostr?.providerKey,
            reverseSync: cfg.nostr?.reverseSync,
            trustedAuthors: cfg.nostr?.trustedAuthors,
            reverseLookbackSec: cfg.nostr?.reverseLookbackSec,
        });
        // Read-list hydration after init settles: goes through the normal read
        // path, so it can pull the saved federation list over the relay.
        Promise.resolve().then(() => this._hydrateReadKeys()).catch(() => { /* nothing saved yet */ });
    }

    /** Await store + transport init before touching data. */
    async _awaitBackend() {
        await this._ready;
    }

    /** Catch a (holon, lens) up from the relays; live afterwards. */
    _relaySync(holon, lens, { await: awaited = false } = {}) {
        const t = this._relayTransport;
        if (!t || !lens || holon === CAPABILITIES_HOLON) return awaited ? Promise.resolve() : undefined;
        const p = t.ensureSync(holon, lens);
        if (awaited) return p.catch(() => { /* relay unreachable — read local */ });
        p.catch(() => { /* fire-and-forget */ });
    }

    /**
     * Resolves once the store is open and the relay transport (if any) is up.
     * @returns {Promise<HoloSphere>}
     */
    async ready() {
        await this._awaitBackend();
        return this;
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
     *   v1: put(holon, lens, data, password, options)
     *   v2: put(holon, lens, data, { actingAs, … }) or put(holon, lens, data)
     */
    async put(holon, lens, data, passwordOrOptions = null, options = {}) {
        let password = null;
        if (typeof passwordOrOptions === 'object' && passwordOrOptions !== null) {
            options = passwordOrOptions;
            password = options.password || null;
        } else {
            password = passwordOrOptions;
        }
        await this._awaitBackend();
        // Writing implies interest — open the live relay sync for this lens.
        if (!password && !options.local) this._relaySync(holon, lens);
        return ContentOps.put(this, holon, lens, data, password, options);
    }

    /**
     * Retrieves content from the specified holon and lens.
     *   v1: get(holon, lens, key, password, options)
     *   v2: get(holon, lens) or get(holon, lens, key)
     */
    async get(holon, lens, key = null, password = null, options = {}) {
        await this._awaitBackend();
        // Catch this lens up from the relay before reading, so a cold read
        // sees the wire's current state (bounded by the sync timeout).
        if (!password) await this._relaySync(holon, lens, { await: true });
        if (key === null || key === undefined) {
            // v2-style 2-arg call: get entire lens (return first/only item).
            const items = await this.getAll(holon, lens, password, options);
            return items && items.length > 0 ? items[0] : null;
        }
        const raw = await ContentOps.get(this, holon, lens, key, password, options);
        // Private (password) reads bypass the signing layer: the encrypted
        // space is access-controlled by the password itself and never signed.
        const signer = this._signer;
        if (signer && signer.enforce && !password && holon && lens && key && lens !== '_members' && !options._skipAuthorize) {
            if (signer.isPerActor(lens)) {
                return signer.aggregate(this, holon, lens, key);
            }
            const claim = await signer.resolveItem(this, holon, lens, key, { includeDeleted: !!options.includeDeleted });
            if (claim && options.resolveHolograms !== false && this.isHologram(claim) && !claim._deleted) {
                // The authorized claim is a pointer: resolve it like the plain
                // read does, threading the cycle guard.
                const res = await this.resolveHologramDetailed(claim, {
                    followHolograms: true,
                    visited: options.visited,
                    maxDepth: options.maxDepth || 10,
                    currentDepth: options.currentDepth || 0,
                });
                if (res.status === 'resolved') return res.data;
                if (res.status === 'deleted' && options.includeDeleted) {
                    return { id: claim.id, _deleted: true, _hologram: { isHologram: true, soul: res.soul, deleted: true } };
                }
                return null;
            }
            return claim;
        }
        return raw;
    }

    /**
     * Read a whole lens.
     *
     * `options.includeUnverified` returns a provenance-annotated view:
     * signed/authorized items tagged `_verified: true`, unsigned/untrusted
     * items tagged `_verified: false, _unverified: true` (display only —
     * never trust `_unverified` items for auth/ownership).
     */
    async getAll(holon, lens, password = null, options = {}) {
        await this._awaitBackend();
        if (!password) await this._relaySync(holon, lens, { await: true });
        const items = await ContentOps.getAll(this, holon, lens, password, options);
        const signer = this._signer;
        if (signer && !password && holon && lens && lens !== '_members' && !options._skipAuthorize) {
            if (options.includeUnverified) {
                if (signer.isPerActor(lens)) {
                    const recs = await signer.aggregate(this, holon, lens);
                    return recs.map((r) => ({ ...r, _verified: true }));
                }
                const { items: ok, pending } = await signer.authorizedView(this, holon, lens, items);
                return [
                    ...ok.map((i) => ({ ...i, _verified: true })),
                    ...pending.map((i) => ({ ...i, _verified: false, _unverified: true })),
                ];
            }
            if (signer.enforce) {
                if (signer.isPerActor(lens)) {
                    return signer.aggregate(this, holon, lens);
                }
                const { items: view } = await signer.authorizedView(this, holon, lens, items, {
                    includeDeleted: !!options.includeDeleted,
                });
                return view;
            }
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
        await this._awaitBackend();
        return ContentOps.deleteFunc(this, holon, lens, key, password, options);
    }

    async deleteAll(holon, lens, password = null, options = {}) {
        await this._awaitBackend();
        return ContentOps.deleteAll(this, holon, lens, password, options);
    }

    // ================================ STORE VIEWS ================================

    /**
     * Every holon this instance holds records for, unioned with the global
     * holons registry (`holons_registry`), so a cold client can list holons
     * it has never opened.
     */
    async listHolons() {
        await this._awaitBackend();
        const out = new Set(this.store.listHolons());
        try {
            const entries = await this.getAllGlobal(HOLONS_REGISTRY_TABLE);
            for (const e of entries || []) if (e && e.id != null) out.add(String(e.id));
        } catch { /* no registry */ }
        return Array.from(out);
    }

    /** Lenses this instance holds records for in a holon. */
    listLenses(holon) {
        return this.store.listLenses(holon);
    }

    /** Ids of the live records in a lens (no relay round-trip). */
    listKeys(holon, lens, options = {}) {
        return this.store.listKeys(holon, lens, options);
    }

    /** Souls of the hologram pointers that reference a record. */
    getBacklinks(holon, lens, key) {
        return this.store.getBacklinks(this.store.soulOf(holon, lens, key));
    }

    /** Signed events held locally (oldest first), optionally narrowed. */
    exportEvents(filter = {}) {
        return this.store.exportEvents(filter);
    }

    /**
     * Apply a batch of signed events (signatures verified). With `publish`
     * they are also republished to the relay set — a verbatim migration.
     */
    async importEvents(events, { publish = false } = {}) {
        await this._awaitBackend();
        const result = this.store.importEvents(events);
        if (publish && this._relayTransport) this._relayTransport.publishEvents(events);
        return result;
    }

    // ================================ NODE FUNCTIONS ================================

    async getNode(holon, lens, key) {
        await this._awaitBackend();
        return NodeOps.getNode(this, holon, lens, key);
    }

    async getNodeBySoul(soul) {
        await this._awaitBackend();
        return NodeOps.getNodeBySoul(this, soul);
    }

    async deleteNode(holon, lens, key) {
        await this._awaitBackend();
        return NodeOps.deleteNode(this, holon, lens, key);
    }

    // ================================ GLOBAL FUNCTIONS ================================
    //
    // A "global" is just a holon-less get/put: data at appname/_g/table/key
    // instead of appname/holon/lens/key. Global tables hold infrastructure
    // like the federation config, so they skip signing enforcement.

    async putGlobal(tableName, data, password = null, options = {}) {
        return this.put(null, tableName, data, password, options);
    }

    /** v2-compatible alias for putGlobal (no password param). Contract is
     *  Promise<void> — don't leak put's result object. */
    async writeGlobal(tableName, data, options = {}) {
        await this.put(null, tableName, data, null, options);
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
     *   subscribeGlobal(lens, key, callback, options) | subscribeGlobal(lens, callback)
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
        this._ready.then(() => this._relaySync(null, lens)).catch(() => {});
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

    /**
     * Like {@link resolveHologram} but returns a typed
     * `{ status, data, soul, reason }` envelope so callers can distinguish a
     * DELETION (`status: 'deleted'`) from LATENCY (`status: 'unresolved'`).
     */
    async resolveHologramDetailed(hologram, options = {}) {
        return HologramOps.resolveHologramDetailed(this, hologram, options);
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

    /**
     * Retract a record (or every record this holon propagated, when `key` is
     * null) from the parent hexagons `propagate` copied it to.
     */
    async propagateDeletion(holon, lens, key = null, options = {}) {
        return Federation.propagateDeletion(this, holon, lens, key, options);
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
     * Synchronous return: `{ unsubscribe: () => void }`. Every subscriber
     * gets the current snapshot replayed, then one callback per change.
     */
    subscribe(holon, lens, callback, options = {}) {
        this._ready.then(() => this._relaySync(holon, lens)).catch(() => {});
        const signer = this._signer;
        const annotate = !!options.includeUnverified;
        // In enforce mode, resolve each update through the signing layer so
        // subscribers see the authorized value (or null when an update isn't
        // from a trusted, valid signature, or the item was deleted) —
        // symmetric with get/getAll. With `includeUnverified`, unsigned/
        // untrusted updates are surfaced tagged `_unverified` instead of
        // dropped (display-only). The record and its envelope land in the
        // store together, so a resolve is never a race against the write.
        if (signer && holon && lens !== '_members' && (signer.enforce || annotate)) {
            const self = this;
            let active = true;
            const resolved = async (raw, key) => {
                const id = key ?? raw?.id;
                if (id == null || !active) return;
                try {
                    if (signer.isPerActor(lens)) {
                        const agg = await signer.aggregate(self, holon, lens, id);
                        if (active) callback(agg, id);
                        return;
                    }
                    let verified = await signer.resolveItem(self, holon, lens, id);
                    if (verified && self.isHologram(verified) && !verified._deleted) {
                        // Utils.subscribe already resolved this pointer for us.
                        if (raw && raw._hologram?.soul === verified.soul) verified = raw;
                        else {
                            const res = await self.resolveHologramDetailed(verified, { followHolograms: true });
                            verified = res.status === 'resolved' ? res.data : null;
                        }
                    }
                    if (!active) return;
                    if (verified) {
                        callback(annotate ? { ...verified, _verified: true } : verified, id);
                    } else if (raw && !raw._deleted) {
                        callback(annotate ? { ...raw, _verified: false, _unverified: true } : null, id);
                    } else {
                        callback(null, id); // genuine tombstone/delete/absent
                    }
                } catch { /* ignore */ }
            };
            const sub = Utils.subscribe(this, holon, lens, resolved, { includeDeletes: true });
            return { unsubscribe: () => { active = false; sub.unsubscribe(); } };
        }
        return Utils.subscribe(this, holon, lens, callback, options);
    }

    /** @deprecated no-op: the store's change feed notifies subscribers. */
    notifySubscribers(data) {
        return Utils.notifySubscribers(this, data);
    }

    /** Re-fetch every synced lens from the relays (e.g. from an `online` handler). */
    async resyncSubscriptions() {
        await this._awaitBackend();
        if (this._relayTransport) await this._relayTransport.resync();
    }

    /**
     * Resolve a holon's display name from its `settings/<holon>` record.
     * Cached per-instance. Returns `null` when no name is set.
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

    async unfederateHolon(sourceHolon, targetHolon) {
        return Federation.unfederate(this, sourceHolon, targetHolon, null, null);
    }

    async subscribeFederation(holonId, password, callback, options = {}) {
        return Federation.subscribeFederation(this, holonId, password, callback, options);
    }

    /**
     * Gets federation info for a holon (v2-compatible shape).
     */
    async getFederation(holonId, password = null) {
        const result = await Federation.getFederation(this, holonId, password);
        if (!result) return { federated: [], lensConfig: {}, partnerNames: {} };
        if (!result.federated) result.federated = result.federation || [];
        if (!result.partnerNames) result.partnerNames = {};
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
        try {
            return await Federation.removeNotify(this, holonId1, holonId2, password1);
        } catch (error) {
            console.error('HoloSphere.removeNotify failed:', error);
            throw error;
        }
    }

    async getFederated(holon, lens, options = {}) {
        return Federation.getFederated(this, holon, lens, options);
    }

    /**
     * Live federated read — the streaming equivalent of {@link getFederated}.
     */
    subscribeFederated(holon, lens, callback, options = {}) {
        return Federation.subscribeFederated(this, holon, lens, callback, options);
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
     * @returns {Promise<{ canWrite: boolean, reason: string, accessType: string }>}
     */
    async canWrite(holonId, lensName, actingAs, options = {}) {
        if (actingAs === this.client?.publicKey || actingAs === holonId) {
            return { canWrite: true, reason: 'owner', accessType: 'owner' };
        }
        if (this._allowedAuthors.has(actingAs)) {
            return { canWrite: true, reason: 'allowed_author', accessType: 'allowed' };
        }
        try {
            const fed = await Federation.getFederation(this, holonId);
            if (fed && fed.federation && fed.federation.includes(actingAs)) {
                return { canWrite: true, reason: 'federated', accessType: 'federation' };
            }
        } catch (e) { /* ignore */ }
        return { canWrite: false, reason: 'not_authorized', accessType: 'none' };
    }

    addAllowedAuthor(pubkey) {
        this._allowedAuthors.add(pubkey);
    }

    removeAllowedAuthor(pubkey) {
        this._allowedAuthors.delete(pubkey);
    }

    listAllowedAuthors() {
        return Array.from(this._allowedAuthors);
    }

    // ================================ SIGNING ================================
    //
    // Every write is a signed NIP-01 event when the instance has a key. The
    // modes below only change how READS treat those signatures. See SIGNING.md.

    /**
     * (Re)configure signing: shadow / enforce / per-actor lenses / read keys.
     * Pass `privateKey` to sign with a different identity; pass `relays` to
     * bring the relay transport up on an instance created without them.
     * @returns {Promise<object>} the signer
     */
    async enableSigning(opts = {}) {
        await this._awaitBackend();
        const privateKey = opts.privateKey || this._privateKey;
        if (!privateKey) throw new Error('enableSigning: a privateKey is required');
        if (opts.privateKey && opts.privateKey !== this._privateKey) {
            this._privateKey = opts.privateKey;
            this.client = { publicKey: this._derivePubKey(opts.privateKey) };
        }
        // Your read-list lives under your "read space" (default: your own key).
        // Hydrate it from the SAVED federation list, then add any explicit seeds.
        this._readSpace = opts.federationSpace || this.client?.publicKey || this.appname;
        await this._hydrateReadKeys();
        if (Array.isArray(opts.readKeys)) opts.readKeys.forEach((k) => this._addReadKeyLocal(k));
        const prev = this._signer;
        this._signer = createSigner({
            privateKey,
            verbose: opts.verbose,
            shadow: opts.shadow,
            enforce: opts.enforce,
            perActorLenses: opts.perActorLenses ?? prev?.getPerActorLenses?.() ?? [],
        });
        const relays = (opts.relays || []).map((r) => String(r).trim()).filter(Boolean);
        if (relays.length && !this._relayTransport) {
            const cfg = this.config || {};
            this.config = {
                ...cfg,
                nostr: {
                    ...(cfg.nostr || {}),
                    projections: opts.projections ?? cfg.nostr?.projections,
                    signerFor: opts.signerFor ?? cfg.nostr?.signerFor,
                    providerKey: opts.providerKey ?? cfg.nostr?.providerKey,
                    reverseSync: opts.reverseSync ?? cfg.nostr?.reverseSync,
                    trustedAuthors: opts.trustedAuthors ?? cfg.nostr?.trustedAuthors,
                    reverseLookbackSec: opts.reverseLookbackSec ?? cfg.nostr?.reverseLookbackSec,
                },
            };
            this._startTransport(relays);
        }
        return this._signer;
    }

    /**
     * Publish already-signed Nostr events of any kind on the relay set. No-op
     * without relays. Used for group state (NIP-29), gift wraps (NIP-17) and
     * other events the host builds itself.
     */
    publishNostrEvents(events) {
        this._awaitBackend().then(() => {
            if (this._relayTransport) return this._relayTransport.publishEvents(events);
        }).catch(() => {});
    }

    /** Raw live REQ on the relay set; returns a close function. */
    subscribeNostr(filter, onevent) {
        let close = null;
        let stopped = false;
        this._awaitBackend().then(() => {
            if (stopped) return;
            if (this._relayTransport) close = this._relayTransport.subscribeRaw(filter, onevent);
        }).catch(() => {});
        return () => { stopped = true; try { close?.(); } catch { /* ignore */ } };
    }

    /** Relay URLs of the wire ([] when local-only). */
    nostrRelays() {
        if (this._relayTransport) return [...this._relayTransport.relays];
        return [...this._relays];
    }

    /** Stop signing (writes become raw, local-only records). */
    disableSigning() {
        try { this._signer?.close(); } catch { /* ignore */ }
        this._signer = null;
    }

    /**
     * Log in as a signing identity: every subsequent put/delete is signed
     * with it. If already signed in, switches identity cleanly.
     * @returns {Promise<{pubkey:string, signer:object}>}
     */
    async login(privateKey, opts = {}) {
        if (!privateKey) throw new Error('login: a privateKey is required');
        if (this._signer) this.disableSigning();
        this._privateKey = privateKey;
        this.client = { publicKey: this._derivePubKey(privateKey) };
        const signer = await this.enableSigning({ ...opts, privateKey });
        return { pubkey: this.client.publicKey, signer };
    }

    /** Log out: stop signing and clear the active signing identity. */
    logout() {
        this.disableSigning();
        this._privateKey = null;
        this.client = { publicKey: '' };
    }

    get currentPubkey() {
        return this.client?.publicKey || '';
    }

    get loggedIn() {
        return this._signer !== null && !!this.client?.publicKey;
    }

    _derivePubKey(privateKey) {
        try {
            return nostrUtils.getPublicKeyFromBytes
                ? nostrUtils.getPublicKeyFromBytes(privateKey)
                : nostrUtils.getPublicKey(
                    typeof privateKey === 'string'
                        ? privateKey
                        : nostrUtils.bytesToHex(privateKey)
                  );
        } catch (e) {
            console.warn('failed to derive public key:', e?.message);
            return '';
        }
    }

    get signingEnabled() {
        return this._signer !== null;
    }

    get enforceActive() {
        return !!this._signer?.enforce;
    }

    /** @deprecated relays belong to the transport — see nostrRelays(). */
    getSigningRelays() {
        return this.nostrRelays();
    }

    /** @deprecated relays are fixed at construction. */
    setSigningRelays() {
        console.warn('[holosphere] setSigningRelays is a no-op: relays are configured at construction');
    }

    /**
     * Shadow audit a lens: classify every item against its signed claims.
     * Output of the lens is unchanged.
     */
    async auditLens(holon, lens) {
        if (!this._signer) throw new Error('auditLens: signing not enabled');
        const items = await this.getAll(holon, lens, null, { _skipShadow: true });
        return this._signer.shadowCheck(this, holon, lens, items);
    }

    getShadowReport() {
        return this._signer ? this._signer.getReport() : null;
    }

    resetShadowReport() {
        this._signer?.resetReport();
    }

    // -------- Per-author aggregate (signed, filterable collaborative state) --------

    async aggregate(holon, lens, subject = null) {
        if (!this._signer) throw new Error('aggregate: signing not enabled');
        await this._awaitBackend();
        await this._relaySync(holon, lens, { await: true });
        return this._signer.aggregate(this, holon, lens, subject);
    }

    /** Mark a lens as per-author, so enforce-mode `getAll` aggregates it. */
    setPerActorLens(lens) {
        if (!this._signer) throw new Error('setPerActorLens: signing not enabled');
        this._signer.addPerActorLens(lens);
    }

    // -------- Federation read-list (default authorized read) --------

    _addReadKeyLocal(key) {
        const hex = (nostrUtils.parseNpubOrHex && nostrUtils.parseNpubOrHex(key)) || key;
        if (hex) this._allowedAuthors.add(hex);
        return hex;
    }

    async _hydrateReadKeys() {
        if (!this._readSpace) return;
        try {
            const fed = await this.getFederation(this._readSpace);
            const list = (fed && (fed.federated || fed.federation)) || [];
            for (const k of list) this._addReadKeyLocal(k);
        } catch { /* nothing federated yet */ }
    }

    /** Trust a key (npub or hex): add it to your read-set AND your saved federation list. */
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

    async refreshReadKeys() {
        await this._hydrateReadKeys();
        return this.getReadKeys();
    }

    /** Your effective read-list: your own key + your saved federation list. */
    getReadKeys() {
        const own = this.client?.publicKey;
        return [...(own ? [own] : []), ...this._allowedAuthors];
    }

    // -------- Membership (`enforce: 'membership'` holon-authority mode) --------

    setGenesis(holon, pubkey) {
        if (!this._signer) throw new Error('setGenesis: signing not enabled');
        this._signer.pinGenesis(holon, pubkey);
    }

    /** Found a holon: self-signed genesis making the local key the first admin. */
    async foundHolon(holon, opts = {}) {
        if (!this._signer) throw new Error('foundHolon: signing not enabled');
        await this._awaitBackend();
        this._signer.pinGenesis(holon, this._signer.pubkey);
        await this._signer.signAndStore(this, holon, '_members', { id: 'genesis', op: 'genesis', role: 'admin' }, { at: opts.at });
        this._relaySync(holon, '_members');
        return this._signer.pubkey;
    }

    /** Add a member (only effective if the local key is an admin of the holon). */
    async addMember(holon, pubkey, role = 'member', opts = {}) {
        if (!this._signer) throw new Error('addMember: signing not enabled');
        await this._awaitBackend();
        const at = opts.at;
        await this._signer.signAndStore(this, holon, '_members', { id: `add:${pubkey}:${at ?? Date.now()}`, op: 'add', pubkey, role }, { at });
    }

    /** Remove a member (only effective if the local key is an admin). */
    async removeMember(holon, pubkey, opts = {}) {
        if (!this._signer) throw new Error('removeMember: signing not enabled');
        await this._awaitBackend();
        const at = opts.at;
        await this._signer.signAndStore(this, holon, '_members', { id: `remove:${pubkey}:${at ?? Date.now()}`, op: 'remove', pubkey }, { at });
    }

    /** Current authorized members → Map(pubkey -> role). */
    async getMembers(holon) {
        if (!this._signer) throw new Error('getMembers: signing not enabled');
        await this._awaitBackend();
        await this._relaySync(holon, '_members', { await: true });
        const tl = await this._signer.resolveMembership(this, holon);
        return tl.currentMembers();
    }

    /** Items present in the lens but NOT backed by an authorized signature. */
    async getPending(holon, lens) {
        if (!this._signer) throw new Error('getPending: signing not enabled');
        const items = await this.getAll(holon, lens, null, { _skipAuthorize: true });
        const { pending } = await this._signer.authorizedView(this, holon, lens, items);
        return pending;
    }

    // ================================ LIFECYCLE ================================

    async close() {
        this._closed = true;
        try { this._relayTransport?.close(); } catch { /* ignore */ }
        this._relayTransport = null;
        return Utils.close(this);
    }

    getVersion() {
        return HOLOSPHERE_VERSION;
    }
}

export default HoloSphere;
export { HoloSphere, handshake, nostrUtils, subscriptions, buildLensPath, registry, version };
