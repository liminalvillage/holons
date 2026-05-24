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

        // Initialize allowed authors set (for canWrite)
        this._allowedAuthors = new Set();
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
            // v2-style 2-arg call: get entire lens (return first/only item)
            const items = await ContentOps.getAll(this, holon, lens, null);
            return items && items.length > 0 ? items[0] : null;
        }
        return ContentOps.get(this, holon, lens, key, password, options);
    }

    async getAll(holon, lens, password = null) {
        return ContentOps.getAll(this, holon, lens, password);
    }

    async parse(rawData) {
        return ContentOps.parse(this, rawData);
    }

    async delete(holon, lens, key, password = null) {
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

    async putGlobal(tableName, data, password = null) {
        return GlobalOps.putGlobal(this, tableName, data, password);
    }

    /**
     * v2-compatible alias for putGlobal (no password param)
     */
    async writeGlobal(tableName, data) {
        return GlobalOps.putGlobal(this, tableName, data, null);
    }

    async getGlobal(tableName, key, password = null) {
        return GlobalOps.getGlobal(this, tableName, key, password);
    }

    async getAllGlobal(tableName, password = null) {
        return GlobalOps.getAllGlobal(this, tableName, password);
    }

    async deleteGlobal(tableName, key, password = null) {
        return GlobalOps.deleteGlobal(this, tableName, key, password);
    }

    async deleteAllGlobal(tableName, password = null) {
        return GlobalOps.deleteAllGlobal(this, tableName, password);
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
    subscribe(holon, lens, callback) {
        return Utils.subscribe(this, holon, lens, callback);
    }

    notifySubscribers(data) {
        return Utils.notifySubscribers(this, data);
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
