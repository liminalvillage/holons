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

// Connection resilience tuning (see _setupConnectionResilience).
// Resync debounce: long enough for a reconnect flap to settle, short enough
// that a kiosk catches up within a couple of seconds of the wire returning.
const RECONNECT_RESYNC_DEBOUNCE_MS = 2000;
// Zombie-socket heartbeat: a peer silent for two intervals (once pinged) is
// force-closed so Gun's reconnect machinery takes over. Also serves as a
// NAT/proxy keepalive, so keep it comfortably under common 60s idle timeouts.
const HEARTBEAT_INTERVAL_MS = 25000;

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

            // `backend: 'nostr'` promotes the relay(s) to the wire — but only
            // when relays are actually configured. Callers have passed
            // `backend: 'nostr'` aspirationally since before the transport
            // existed (bot, discord) while running on Gun's default peer;
            // without relays we keep that behavior instead of stranding them
            // on a peerless local cache.
            const relays = config.nostr?.relays || config.nostr?.peers || [];
            this._backend = config.backend === 'nostr' && relays.length > 0 ? 'nostr' : 'gun';
            if (config.backend === 'nostr' && this._backend !== 'nostr') {
                console.warn("[holosphere] backend 'nostr' requested without config.nostr.relays — falling back to the gun backend");
            }

            // Map nostr relay/peer config to GunDB peers (gun backend only).
            // In the nostr backend the relays ARE the wire: Gun stays a
            // peerless local-first cache and all networking goes through
            // relay-transport.js.
            if (this._backend !== 'nostr' && relays.length > 0) {
                const gunPeers = relays.map(r =>
                    r.replace('wss://', 'https://').replace('ws://', 'http://') + '/gun'
                );
                gunOptions = { peers: gunPeers, ...gunOptions };
            }
            if (this._backend === 'nostr' && gunOptions.peers === undefined && !config.gunOptions?.peers) {
                // Peerless local cache: no gun peers, and no gun stats timer
                // (it re-arms forever and would pin a finished Node process).
                gunOptions = { peers: [], stats: false, ...gunOptions };
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
            this._backend = 'gun';
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
            file: './holosphere',
            // Gun's websocket layer spends a per-peer reconnect budget
            // (`peer.retry`, stock default 60) that is decremented on every
            // rapid retry and NEVER replenished by a successful reconnect —
            // one ~2-minute relay outage (or short blips accumulated over
            // days of uptime) exhausts it, after which the page silently
            // never reconnects. Long-lived surfaces (kiosk screens,
            // dashboards, bots) must retry forever; callers can still
            // override via gunOptions.
            retry: Infinity
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

        // Connection resilience (see _setupConnectionResilience): keep the
        // websocket reconnect loop alive forever and resync live
        // subscriptions after every reconnect, so long-lived pages never go
        // silently stale.
        this._closed = false;
        this._sawBye = false;
        this._resyncTimer = null;
        this._heartbeatTimer = null;
        this._lastHeard = 0;
        // The peers configured at construction (Gun keys opt.peers by url).
        // Only these are ever auto-restored after a drop.
        this._resilientPeers = new Set(Object.keys(this.gun?._?.opt?.peers || {}));
        this._setupConnectionResilience();

        // Nostr backend: the relay is the wire (see relay-transport.js). Init
        // is async (dynamic nostr-tools import + enableSigning), so kick it
        // off here and have every read/write path await it via _awaitBackend.
        this._relayTransport = null;
        this._backendReady = null;
        if (this._backend === 'nostr') {
            this._backendReady = this._initNostrBackend()
                .catch((e) => { console.warn('[holosphere] nostr backend init failed:', e?.message); });
        }
    }

    // ============================ NOSTR BACKEND ============================
    //
    // `backend: 'nostr'` promotes the Nostr relay(s) to the system's wire:
    // Gun runs peerless as the local-first cache, every non-private write is
    // published as a signed NIP-01 event, and reads/subscriptions live-sync
    // each (holon, lens) from the relay. The signing layer runs envelope-only
    // (relays: []) so verification/enforce works exactly as before while the
    // transport is the single publisher.

    async _initNostrBackend() {
        const cfg = this.config || {};
        const relays = cfg.nostr?.relays || cfg.nostr?.peers || [];
        if (!relays.length) throw new Error("backend 'nostr' requires config.nostr.relays");
        if (!this._privateKey) {
            const { generateSecretKey } = await import('./nostr-events.js');
            this._privateKey = generateSecretKey();
            this.client = { publicKey: this._derivePubKey(this._privateKey) };
            console.warn('[holosphere] nostr backend: no privateKey configured — generated an ephemeral device key', this.client.publicKey);
        }
        // Envelope-only signing: local `_events` attestation + shadow/enforce
        // still work, but the signer never publishes (the transport does, so
        // nothing goes out twice). The signer is created DIRECTLY (not via
        // enableSigning) because enableSigning hydrates the federation
        // read-list with data reads, and every data read awaits this very
        // init — hydration runs in the background right after instead.
        const signing = cfg.signing || {};
        const { createSigner } = await import('./signing.js');
        this._readSpace = this.client?.publicKey || this.appname;
        this._signer = await createSigner({
            privateKey: this._privateKey,
            relays: [],
            storeEnvelope: true,
            shadow: signing.shadow,
            enforce: signing.enforce,
            perActorLenses: signing.perActorLenses,
            verbose: signing.verbose,
        });
        const { createRelayTransport } = await import('./relay-transport.js');
        this._relayTransport = createRelayTransport(this, {
            relays,
            privateKey: this._privateKey,
            syncTimeoutMs: cfg.nostr?.syncTimeoutMs,
            verbose: signing.verbose || cfg.nostr?.verbose,
        });
        // Read-list hydration AFTER init settles: goes through the normal
        // (backend-awaiting) read path, so it can even pull the saved
        // federation list over the relay.
        Promise.resolve().then(() => this._hydrateReadKeys()).catch(() => { /* nothing saved yet */ });
    }

    /** Await nostr-backend init before touching data (no-op on gun backend). */
    async _awaitBackend() {
        if (this._backendReady) {
            await this._backendReady; // never rejects (constructor attaches catch)
        }
    }

    /** Live-sync a (holon, lens) from the relay before/alongside a read. */
    _relaySync(holon, lens, { await: awaited = false } = {}) {
        const t = this._relayTransport;
        if (!t) return awaited ? Promise.resolve() : undefined;
        const p = t.ensureSync(holon, lens);
        if (awaited) return p.catch(() => { /* relay unreachable — read local */ });
        p.catch(() => { /* fire-and-forget */ });
    }

    /**
     * Waits for the HoloSphere instance to be ready.
     * GunDB connects eagerly, so this resolves immediately on the gun
     * backend; the nostr backend resolves once the relay transport is up.
     * @returns {Promise<HoloSphere>} - The ready instance
     */
    async ready() {
        await this._awaitBackend();
        return this;
    }

    getGun() {
        return this.gun;
    }

    // ============================ CONNECTION RESILIENCE ============================
    //
    // Gun's stock websocket layer has three gaps that make a long-lived page
    // (kiosk screen, dashboard, bot) go silently stale after a disconnect:
    //
    //   1. Its `bye` handler deletes the peer from `opt.peers`, and its
    //      reconnect loop refuses to retry a peer missing from `opt.peers` —
    //      so if the single automatic retry ~2s after a drop fails (any
    //      outage longer than a blip), the peer is orphaned forever.
    //   2. The reconnect budget (`peer.retry`) is never replenished on
    //      success (mitigated by the `retry: Infinity` default above).
    //   3. A half-open TCP connection (NAT/proxy idle timeout, silent wifi
    //      drop) never fires `close`, so the reconnect machinery never even
    //      starts: the socket looks OPEN but hears nothing.
    //
    // This layer (a) re-registers dropped peers so the retry loop keeps
    // going, (b) resyncs every live-subscribed lens after a reconnect —
    // Gun re-asks for live souls on `hi`, but its `ask` bookkeeping doesn't
    // reliably cover `map().on()` children, so we re-read through `getAll`,
    // whose wire replies merge into the graph and fire the already-attached
    // listeners — and (c) sends a periodic DAM ping and force-closes a peer
    // that stays silent across two intervals, which kicks (a)+(b) in.

    _setupConnectionResilience() {
        const root = this.gun && this.gun._;
        if (!root || typeof root.on !== 'function') return;
        const self = this;

        // Gun's onto emitter chains listeners — propagate with
        // `this.to.next(peer)` first, exactly like Gun's own hooks, so a
        // later listener is never starved.
        root.on('bye', function (peer) {
            this.to.next(peer);
            self._sawBye = true;
            // Gun's mesh `bye` handler deletes `opt.peers[id]` AFTER this
            // chain runs; restore the entry a tick later so the websocket
            // reconnect loop (which bails on a missing entry) keeps retrying.
            const url = peer && (peer.url || peer.id);
            if (!url || !self._resilientPeers.has(url)) return;
            setTimeout(() => {
                const peers = self.gun?._?.opt?.peers;
                if (self._closed || !peers || peers[url]) return;
                peers[url] = peer;
            }, 0);
        });

        root.on('hi', function (peer) {
            this.to.next(peer);
            if (self._closed || !self._sawBye) return; // first connect — nothing missed
            self._sawBye = false;
            self._scheduleResync();
        });

        this._heartbeatTimer = setInterval(
            () => this._heartbeatTick(),
            HEARTBEAT_INTERVAL_MS,
        );
        // Don't hold a short-lived Node process open for the heartbeat.
        if (typeof this._heartbeatTimer.unref === 'function') {
            this._heartbeatTimer.unref();
        }
    }

    // Debounced so a flapping connection (or several peers reconnecting at
    // once) coalesces into one resync pass after the wire settles.
    _scheduleResync() {
        if (this._closed || this._resyncTimer) return;
        this._resyncTimer = setTimeout(() => {
            this._resyncTimer = null;
            this.resyncSubscriptions().catch(() => { /* best-effort */ });
        }, RECONNECT_RESYNC_DEBOUNCE_MS);
        if (typeof this._resyncTimer.unref === 'function') {
            this._resyncTimer.unref();
        }
    }

    /**
     * Re-reads every (holon, lens) path that has a live `subscribe()` so the
     * relay's current state flows through the existing `map().on()`
     * listeners — catching up on anything written while the wire was down.
     * Runs automatically (debounced) after a reconnect; safe to call
     * manually, e.g. from a browser `online` handler.
     */
    async resyncSubscriptions() {
        if (this._closed) return;
        const groups = this._subscriptionGroups;
        if (!groups || groups.size === 0) return;
        const paths = [...groups.values()].map((g) => ({ holon: g.holon, lens: g.lens }));
        await Promise.allSettled(
            paths.map(({ holon, lens }) => this.getAll(holon, lens)),
        );
    }

    // Half-open (zombie) socket detection. `mesh.hear.c` counts every raw
    // message received across all peers; if a whole interval passes with no
    // traffic, ping each OPEN peer (a DAM `?`, which the relay acks) and, if
    // the next interval is still silent, force-close the wire — Gun's
    // `onclose` then drives the normal reconnect + resync path. The counter
    // is instance-wide, so with several peers a chatty one can mask a zombie;
    // every production surface here runs a single relay, and the ping doubles
    // as a NAT keepalive either way.
    _heartbeatTick() {
        if (this._closed) return;
        const opt = this.gun?._?.opt;
        const mesh = opt && opt.mesh;
        if (!mesh || typeof mesh.say !== 'function') return;
        const heard = (mesh.hear && mesh.hear.c) || 0;
        const quiet = heard <= this._lastHeard;
        this._lastHeard = heard;
        for (const url of this._resilientPeers) {
            const peer = opt.peers && opt.peers[url];
            const wire = peer && peer.wire;
            if (!wire || wire.readyState !== 1 /* OPEN */) {
                if (peer) peer.__hbPinged = false; // reconnect loop owns it
                continue;
            }
            if (!quiet) {
                peer.__hbPinged = false;
                continue;
            }
            if (peer.__hbPinged) {
                peer.__hbPinged = false;
                try { wire.close(); } catch { /* already dead */ }
            } else {
                peer.__hbPinged = true;
                try { mesh.say({ dam: '?', pid: opt.pid }, peer); } catch { /* ignore */ }
            }
        }
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
        await this._awaitBackend();
        // Writing implies interest — open the live relay sync for this lens
        // (fire-and-forget; the put itself publishes via content.js).
        if (!password) this._relaySync(holon, lens);
        return ContentOps.put(this, holon, lens, data, password, options);
    }

    /**
     * Retrieves content from the specified holon and lens.
     * Supports both v1 and v2 calling conventions:
     *   v1: get(holon, lens, key, password, options)
     *   v2: get(holon, lens) or get(holon, lens, key)
     */
    async get(holon, lens, key = null, password = null, options = {}) {
        await this._awaitBackend();
        // Nostr backend: catch up this lens from the relay before reading, so
        // a cold read sees the wire's current state (bounded by the sync
        // timeout — an unreachable relay degrades to a local read).
        if (!password) await this._relaySync(holon, lens, { await: true });
        if (key === null || key === undefined) {
            // v2-style 2-arg call: get entire lens (return first/only item).
            // Route through this.getAll so the signing layer resolves it.
            const items = await this.getAll(holon, lens, password, options);
            return items && items.length > 0 ? items[0] : null;
        }
        const raw = await ContentOps.get(this, holon, lens, key, password, options);
        // Resolve a single item through the signing layer — every get resolves.
        // Private (password) reads bypass it: the SEA-encrypted space is
        // access-controlled by the password itself and never signed, so the
        // envelope store has nothing to say about it.
        const signer = this._signer;
        if (signer && signer.enforce && !password && lens !== '_members' && !options._skipAuthorize) {
            if (signer.isPerActor(lens)) {
                // per-author lens: return the subject's aggregated records
                return signer.aggregate(this, holon, lens, key);
            }
            // resolve the single item from its signed envelopes (raw-tamper-proof)
            return signer.resolveItem(this, holon, lens, key, { includeDeleted: !!options.includeDeleted });
        }
        return raw;
    }

    /**
     * Read a whole lens.
     *
     * `options.includeUnverified` returns a **provenance-annotated dual-source
     * view**: signed/authorized items tagged `_verified: true`, and legacy or
     * unsigned/untrusted items tagged `_verified: false, _unverified: true`. This
     * is the safe, public way to "show everything" during a signing migration —
     * the UI can render grandfathered data while badging it. Requires signing to
     * be enabled (shadow or enforce); with signing off there's nothing to verify
     * against, so the raw list is returned untagged. NEVER trust `_unverified`
     * items for auth/ownership — they're for display only.
     */
    async getAll(holon, lens, password = null, options = {}) {
        await this._awaitBackend();
        if (!password) await this._relaySync(holon, lens, { await: true });
        const items = await ContentOps.getAll(this, holon, lens, password, options);
        // Private (password) reads bypass the signing layer entirely — see get().
        const signer = this._signer;
        if (signer && !password && lens !== '_members' && !options._skipAuthorize) {
            // Provenance-annotated dual-source read (signed + grandfathered legacy).
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
            // Phase 2 enforce: collapse to the authorized view (changes output).
            if (signer.enforce) {
                // Per-author lenses (participation, reactions, …) aggregate one
                // record per trusted author instead of collapsing to a single winner.
                if (signer.isPerActor(lens)) {
                    return signer.aggregate(this, holon, lens);
                }
                const { items: view } = await signer.authorizedView(this, holon, lens, items, {
                    includeDeleted: !!options.includeDeleted,
                });
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
        await this._awaitBackend();
        // Signed delete: authenticate the removal with a signed tombstone so an
        // unauthorized key can't drop your data from the resolved view, and so a
        // per-actor record (participation, …) can be retracted by its owner.
        let tombstone = null;
        if (this._signer && holon && !options._skipSign) {
            try { tombstone = await this._signer.onDelete(this, holon, lens, key); } catch { /* best-effort */ }
        }
        // Nostr backend: the delete travels the wire as a signed tombstone
        // event (globals included — the signer above only covers holon paths).
        if (this._relayTransport && !password && !options._skipPublish) {
            try { this._relayTransport.publishDelete(holon, lens, key, tombstone); } catch { /* best-effort */ }
        }
        return ContentOps.deleteFunc(this, holon, lens, key, password);
    }

    async deleteAll(holon, lens, password = null, options = {}) {
        await this._awaitBackend();
        // Signed bulk delete: tombstone every id first (mirrors delete()) so an
        // enforce-mode reader can't resurrect the lens from leftover envelopes.
        // Private (password) lenses are never signed, so there's nothing to
        // tombstone there.
        if (this._signer && holon && !password && !options._skipSign) {
            try {
                const raw = await ContentOps.getAll(this, holon, lens, null, {
                    _skipAuthorize: true, _skipShadow: true, resolveHolograms: false, includeDeleted: true,
                });
                const ids = new Set((raw || []).filter((it) => it && it.id != null).map((it) => String(it.id)));
                if (this._signer.enforce) {
                    // Union with the enforced view so ids living only in the
                    // envelope store (raw slot already gone) get tombstoned too.
                    try {
                        const view = await this.getAll(holon, lens);
                        for (const it of view || []) if (it && it.id != null) ids.add(String(it.id));
                    } catch { /* best-effort */ }
                }
                await Promise.all([...ids].map(async (id) => {
                    try {
                        const tombstone = await this._signer.onDelete(this, holon, lens, id);
                        if (this._relayTransport && !options._skipPublish) {
                            this._relayTransport.publishDelete(holon, lens, id, tombstone);
                        }
                    } catch { /* best-effort */ }
                }));
            } catch { /* best-effort, mirror delete() */ }
        }
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

    /** v2-compatible alias for putGlobal (no password param). Contract is
     *  Promise<void> (see holosphere.d.ts) — don't leak put's result object. */
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
        if (this._backendReady) {
            this._backendReady.then(() => this._relaySync(null, lens)).catch(() => {});
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

    /**
     * Like {@link resolveHologram} but returns a typed
     * `{ status, data, soul, reason }` envelope so callers can distinguish a
     * DELETION (`status: 'deleted'`) from network LATENCY (`status: 'unresolved'`).
     * See `HologramOps.HOLOGRAM_STATUS` / `isPrunableHologramStatus`.
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
        // Nostr backend: open the live relay sync for this lens so remote
        // events flow into the local graph and fire this subscription. The
        // gun-side listener attaches synchronously below either way.
        if (this._backendReady) {
            this._backendReady.then(() => this._relaySync(holon, lens)).catch(() => {});
        }
        const signer = this._signer;
        const annotate = !!options.includeUnverified;
        // In enforce mode, resolve each update through the signing layer so
        // subscribers see the authorized value (or null when an update isn't from
        // a trusted, valid signature, or the item was deleted) — symmetric with
        // get/getAll. With `includeUnverified`, instead of DROPPING unsigned/
        // untrusted updates we surface them tagged `_unverified` (display-only —
        // never trust them for auth). Re-resolving on every change makes deletes
        // notify too.
        if (signer && holon && lens !== '_members' && (signer.enforce || annotate)) {
            const self = this;

            // Resolving an update reads the sibling `_events` envelope subtree
            // (signer.resolveItem/aggregate) from INSIDE this lens's map().on()
            // handler. Those reads make Gun re-emit the whole lens, re-firing
            // this handler with VALUE-IDENTICAL echoes — a positive feedback
            // loop. Unguarded it grows without bound: a single write to a lens
            // with N items fans out into thousands of resolves, the event loop
            // starves, the put never settles (write-timeout), and the new item
            // never appears. (off/shadow pass the raw callback — no in-handler
            // reads — so they converge; only this enforce/annotate path loops.)
            //
            // So we DROP value-identical echoes. But a resolve can legitimately
            // CHANGE result without the raw changing: right after a reload the
            // raw item often arrives (from radisk/a peer) before the local
            // `_events` envelope has loaded, so the first resolve comes back
            // UNVERIFIED even though the item is signed. If we deduped that away
            // permanently, a signed item would show as unsigned until the next
            // write. So an UNCONFIRMED result (couldn't verify a present item)
            // gets a few TIME-SPACED re-verifications — enough to catch the
            // late envelope, bounded so a genuinely-unsigned item settles fast
            // and the echo storm never re-arms (retries are timer-driven, not
            // echo-driven). A CONFIRMED result (verified item, or a real
            // tombstone/absent) is final and dedupes its echoes.
            const VERIFY_RETRY_MS = [400, 1200, 3000];
            const st = new Map(); // id -> { sig, confirmed, attempts, timer, raw, holo }
            const sig = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
            const clearT = (e) => { if (e && e.timer) { clearTimeout(e.timer); e.timer = null; } };
            // When Gun is runaway-re-emitting this lens (a corrupt circular
            // hologram, a mutual-federation cycle, …) utils.subscribe sets
            // `__onFireWarnedAt`. While that's hot, our `_events` reads would only
            // pour fuel on the storm — so the wrapper goes dormant (no resolve, no
            // retry) until it subsides. The raw write already landed; reads recover
            // on the next clean update or reload.
            const storming = () => self.__onFireWarnedAt && (Date.now() - self.__onFireWarnedAt) < 4000;

            const emit = async (id) => {
                const e = st.get(id);
                if (!e) return;
                const raw = e.raw;
                let confirmed = true;
                try {
                    if (signer.isPerActor(lens)) {
                        const agg = await signer.aggregate(self, holon, lens, id);
                        confirmed = Array.isArray(agg) && agg.length > 0; // empty may be a cold read
                        callback(agg, id);
                    } else {
                        const verified = await signer.resolveItem(self, holon, lens, id);
                        if (verified) {
                            callback(annotate ? { ...verified, _verified: true } : verified, id);
                        } else if (raw && !raw._deleted) {
                            // present item that didn't verify — maybe a cold envelope read
                            confirmed = false;
                            callback(annotate ? { ...raw, _verified: false, _unverified: true } : null, id);
                        } else {
                            callback(null, id); // genuine tombstone/delete/absent — final
                        }
                    }
                } catch { /* ignore */ }
                const cur = st.get(id);
                if (!cur || cur.sig !== e.sig) return; // superseded by a newer value
                cur.confirmed = confirmed;
                // Retry only a present, NON-hologram item that didn't verify, and
                // never while storming. Holograms are pointers (the SOURCE carries
                // the signature) with no local envelope, and a cascading hologram
                // rewrites `updated` every fire — retrying it would dodge the
                // echo-dedup and re-arm endlessly, feeding the storm.
                if (!confirmed && !cur.holo && cur.attempts < VERIFY_RETRY_MS.length) {
                    const delay = VERIFY_RETRY_MS[cur.attempts++];
                    cur.timer = setTimeout(() => {
                        if (st.get(id) === cur && !storming()) { cur.timer = null; emit(id); }
                    }, delay);
                }
            };

            const resolved = (raw, key) => {
                // Gun can re-fire an update with `key` undefined (a lens-level echo
                // of an item-level write); fall back to the raw record's id so we
                // resolve the right envelope instead of mis-tagging it unverified.
                const id = key ?? raw?.id;
                if (id == null) return;
                if (storming()) return; // don't add reads to a runaway lens
                const s = sig(raw);
                const e = st.get(id);
                if (e && e.sig === s) return; // value-identical echo — drop (retries are timer-driven)
                if (e) clearT(e);
                const holo = !!(raw && (raw.soul || raw._hologram));
                st.set(id, { sig: s, confirmed: false, attempts: 0, timer: null, raw, holo });
                emit(id);
            };
            const sub = Utils.subscribe(this, holon, lens, resolved, { includeDeletes: true });
            return { unsubscribe: () => { for (const e of st.values()) clearT(e); st.clear(); sub.unsubscribe(); } };
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

    /**
     * Live federated read — the streaming equivalent of {@link getFederated}.
     * Subscribes to `lens` on this holon plus every partner it receives `lens`
     * from, merging into one id-deduped stream (local wins on collision) with
     * partner items tagged `_federation`. Returns `{ unsubscribe }` synchronously.
     * See {@link Federation.subscribeFederated} for the full contract.
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
    // optional `nostr-tools` dependency. See SIGNING.md.

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

    /**
     * Log in as a signing identity. Sets the active key AMBIENTLY — every
     * subsequent put/delete is signed with it, with NO per-call key — and
     * (re)enables signing. If already signed in, switches identity cleanly.
     *
     * Mode options (relays/shadow/enforce/storeEnvelope/perActorLenses/readKeys/
     * federationSpace) match {@link enableSigning}; omit them for sane defaults.
     * Envelope storage defaults to ON so the signature is actually persisted and
     * verifiable locally even without relays (override via `opts.storeEnvelope`).
     *
     * @param {string|Uint8Array} privateKey - the identity to sign as
     * @param {object} [opts] - same shape as {@link enableSigning} (privateKey is taken from the first arg)
     * @returns {Promise<{pubkey:string, signer:object}>}
     */
    async login(privateKey, opts = {}) {
        if (!privateKey) throw new Error('login: a privateKey is required');
        if (this._signer) this.disableSigning();        // clean switch when re-logging in
        this._privateKey = privateKey;
        this.client = { publicKey: this._derivePubKey(privateKey) };
        const signer = await this.enableSigning({ storeEnvelope: true, ...opts, privateKey });
        return { pubkey: this.client.publicKey, signer };
    }

    /**
     * Log out: stop signing and clear the active signing identity. Subsequent
     * puts are unsigned (raw Gun writes) until the next {@link login}.
     */
    logout() {
        this.disableSigning();
        this._privateKey = null;
        this.client = { publicKey: '' };
    }

    /** The pubkey of the currently logged-in signing identity (or '' if none). */
    get currentPubkey() {
        return this.client?.publicKey || '';
    }

    /** Whether a signing identity is currently logged in. */
    get loggedIn() {
        return this._signer !== null && !!this.client?.publicKey;
    }

    /** Derive a hex nostr public key from a secret key (hex string or bytes). */
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
            console.warn('login: failed to derive public key:', e?.message);
            return '';
        }
    }

    /** Whether signing is currently enabled. */
    get signingEnabled() {
        return this._signer !== null;
    }

    /** Whether enforce (authorized-read) mode is active. */
    get enforceActive() {
        return !!this._signer?.enforce;
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
    // See the membership section of SIGNING.md.

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
        // Stop the resilience layer first so it can't restore peers or
        // schedule resyncs while the instance tears down.
        this._closed = true;
        if (this._resyncTimer) {
            clearTimeout(this._resyncTimer);
            this._resyncTimer = null;
        }
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        try { this._relayTransport?.close(); } catch { /* ignore */ }
        this._relayTransport = null;
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
            timeout: 5000
        };

        const radiskOptions = { ...defaultOptions, ...options };
        // `retry` is NOT a radisk option — Gun reads opt.retry only as the
        // websocket reconnect budget (defaulted to Infinity in the
        // constructor). Pass it through only when explicitly set, so
        // configuring radisk can't silently cap reconnection.
        if (radiskOptions.retry === undefined) delete radiskOptions.retry;

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
            // The live websocket reconnect budget (not a radisk knob).
            retry: options.retry,
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
