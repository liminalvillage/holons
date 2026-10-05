// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Private scopes: sealed content on the relay, keys handed out on purpose.
//
// A SCOPE is a lens or one item of it: `{ holon, lens }` or `{ holon, lens,
// item }`. A scope is private exactly when its VAULT record exists —
// `_vault/<lens>` or `_vault/<lens>/<item>` in the holon, content sealed to
// the owner's key, tags public. The record's existence is the privacy flag
// every instance can see; its plaintext holds the scope key (history kept
// for mid-rotation records) and whatever the domain layer stores about the
// audience (opaque here: `audience`, `sent`).
//
//   keyring   what this instance can open right now: scope keys by kid, from
//             its own vault records and from grants it received. Installed
//             into the store as the `unseal` hook, so every read path
//             (get/getAll/subscribe/federated/holograms) sees plaintext it
//             holds keys for and locked stubs for the rest.
//   grants    NIP-17 gift-wrapped DMs (nostr-dm.js) carrying a scope key to a
//             pubkey. A received key is copied into the recipient's own
//             personal-holon `_vault` (`grant:<holon>:<lens>[:<item>]`) —
//             local-first, so it opens at once and other devices recover it.
//
// Who hands a key out matters as much as the key: a grant counts only from
// a key that speaks for the holon (authority.js, or the app's
// `config.privacy.acceptGrantFrom`). Revocation is forward-only: the scope
// key rotates, the scope's items are rewritten; what a revoked party already
// read stays read. See PRIVACY.md.

import {
    isSealed, kidOf, generateKey, sealItem, unsealItem, sealSelf, unsealSelf, isLocked, SELF_KID,
} from './store/sealed.js';
import { eventToItem } from './nostr-events.js';
import { sendDirectMessage, subscribeDirectMessages } from './nostr-dm.js';
import { isAcceptedSender } from './authority.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export const VAULT_LENS = '_vault';
export const GRANT_SUBJECT = 'holons/grant';
export const GRANT_TYPE = 'holons/grant';
export const GRANT_VERSION = 2;

/** Lenses that can never be private: the machinery itself, or public by design. */
export const NEVER_PRIVATE = Object.freeze([
    'settings', VAULT_LENS, '_members', '_check', 'users', 'federation', 'holons_registry', 'schemas', 'hubclaims',
]);

/** How far back the grant subscription looks (NIP-59 back-dates wraps by up to two days; grants may wait months). */
const GRANT_LOOKBACK_SEC = 10 * 365 * 24 * 3600;

const HEX64 = /^[0-9a-f]{64}$/i;
const nowIso = () => new Date().toISOString();
const COPY_PREFIX = 'grant:';

/** Normalise a scope; throws when it has no holon or lens. */
export function normScope(scope) {
    const holon = scope && scope.holon != null ? String(scope.holon).trim() : '';
    const lens = scope && scope.lens != null ? String(scope.lens).trim() : '';
    if (!holon || !lens) throw new Error('privacy: a scope needs a holon and a lens');
    const item = scope.item != null && String(scope.item) !== '' ? String(scope.item) : null;
    return item ? { holon, lens, item } : { holon, lens };
}

/** The owner's vault record id of a scope: `<lens>` or `<lens>/<item>`. */
export function vaultId(scope) {
    return scope.item ? `${scope.lens}/${scope.item}` : scope.lens;
}

/** The grantee's copy id of a scope, in its own `_vault`. */
export function copyId(scope) {
    return `${COPY_PREFIX}${scope.holon}:${scope.lens}${scope.item ? `:${scope.item}` : ''}`;
}

/** The scope an owner vault id names (ids under `_vault` of the owner holon). */
export function scopeOfVaultId(holon, id) {
    if (typeof id !== 'string' || !id || id.startsWith(COPY_PREFIX)) return null;
    const slash = id.indexOf('/');
    if (slash < 0) return { holon: String(holon), lens: id };
    const lens = id.slice(0, slash);
    const item = id.slice(slash + 1);
    return lens && item ? { holon: String(holon), lens, item } : null;
}

/** Parse + validate a grant payload; null when it is not one. */
export function parseGrant(raw) {
    let p = raw;
    if (typeof raw === 'string') {
        try { p = JSON.parse(raw); } catch { return null; }
    }
    if (!p || typeof p !== 'object' || p.t !== GRANT_TYPE || p.v !== GRANT_VERSION) return null;
    if (typeof p.holon !== 'string' || !p.holon || typeof p.lens !== 'string' || !p.lens) return null;
    if (typeof p.kid !== 'string' || !/^[0-9a-f]{16}$/.test(p.kid)) return null;
    if (typeof p.key !== 'string' || !HEX64.test(p.key)) return null;
    const key = p.key.toLowerCase();
    if (kidOf(key) !== p.kid) return null;     // self-certifying: the key must hash to its kid
    const scope = { holon: p.holon, lens: p.lens };
    if (p.item != null) {
        if (typeof p.item !== 'string' || !p.item) return null;
        scope.item = p.item;
    }
    return { t: GRANT_TYPE, v: GRANT_VERSION, ...scope, kid: p.kid, key, at: typeof p.at === 'string' ? p.at : nowIso() };
}

export function createPrivacy(holo) {
    const keys = new Map();        // `${holon}|${lens}|${item ?? ''}|${kid}` → Uint8Array
    const vaults = new Map();      // `${holon}|${vaultId}` → own vault plaintext (this identity is the owner)
    const copies = new Map();      // `${holon}|${vaultId}` → received copy plaintext (newest key last)
    const loaded = new Map();      // `${pub}|${holon}|${lens}` → Promise (ensureKeys memo)
    const vaultWatchers = new Map(); // holon → unsubscribe
    let stopGrants = null;
    let grantsWanted = false;

    const sk = () => holo._privateKey || null;
    const pub = () => holo.client?.publicKey || '';
    const store = () => holo.store;
    const isGlobal = (holon) => holon === null || holon === undefined || holon === '';
    const kk = (scope, kid) => `${scope.holon}|${scope.lens}|${scope.item ?? ''}|${kid}`;
    const sk2 = (scope) => `${scope.holon}|${vaultId(scope)}`;

    // ------------------------------------------------------- who may hand keys
    //
    // A grant installs a key, and a key decides what this instance seals its
    // own edits under. So a grant counts only from a key that speaks for the
    // holon: by default the holon itself (a personal holon is its key), the
    // anchor of its signed records or a current member of its `_members` log
    // (see authority.js). An app narrows or widens that through
    // `config.privacy.acceptGrantFrom(holo, holon, lens, sender)`.
    async function senderAccepted(holon, lens, sender) {
        if (!sender || !HEX64.test(String(sender))) return false;
        const s = String(sender).toLowerCase();
        if (s === pub().toLowerCase()) return true;
        try {
            await holo._relaySync?.(String(holon), '_members', { await: true });
            await holo._relaySync?.(String(holon), 'settings', { await: true });
        } catch { /* offline: the store decides */ }
        const hook = holo.config?.privacy?.acceptGrantFrom;
        if (typeof hook === 'function') {
            try { return !!(await hook(holo, String(holon), lens, s)); } catch { return false; }
        }
        try { return isAcceptedSender(store(), String(holon), s); } catch { return false; }
    }

    // ---------------------------------------------------------------- policy

    /** Can this lens be private at all? Throws with the reason when not. */
    function assertPrivatizable(holon, lens) {
        if (isGlobal(holon)) throw new Error(`privacy: a global table (${lens}) cannot be private`);
        if (NEVER_PRIVATE.includes(String(lens))) throw new Error(`privacy: lens '${lens}' cannot be private`);
        if (holo.isAppendLens?.(lens)) throw new Error(`privacy: lens '${lens}' is an append-only log and cannot be private`);
        if (store().wire?.isStandardPrimary?.(lens)) throw new Error(`privacy: lens '${lens}' is carried on a standard Nostr kind and cannot be private`);
    }

    function privatizable(holon, lens) {
        try { assertPrivatizable(holon, lens); return true; } catch { return false; }
    }

    // ---------------------------------------------------------------- the flag

    /** The live vault record (own plaintext, someone else's stub) at a scope, or null. */
    function vaultRecord(scope) {
        const rec = store().get(scope.holon, VAULT_LENS, vaultId(scope));
        if (!rec || !rec.item || rec.item._deleted === true) return null;
        return rec;
    }

    /**
     * The private scope that governs an address, or null when it is public:
     * the item's own vault first, then the lens's. Synchronous — reads what
     * is loaded (`ensureKeys` first when the holon may be cold).
     */
    function scopeOf(holon, lens, item) {
        if (isGlobal(holon) || !lens) return null;
        const h = String(holon);
        if (item != null && String(item) !== '') {
            const s = { holon: h, lens, item: String(item) };
            if (vaultRecord(s)) return s;
        }
        const l = { holon: h, lens };
        return vaultRecord(l) ? l : null;
    }

    /** Is this address private (an item, or the lens as a whole)? */
    function isPrivate(holon, lens, item) {
        return scopeOf(holon, lens, item) !== null;
    }

    /**
     * Every private scope of a holon, from the vault records this instance
     * holds (its own and other owners' stubs alike): `{ [lens]: { locked, items } }`.
     */
    function lockedScopes(holon) {
        const out = {};
        if (isGlobal(holon)) return out;
        for (const rec of store().list(holon, VAULT_LENS, { includeLocked: true })) {
            const scope = scopeOfVaultId(holon, rec.id);
            if (!scope) continue;
            const entry = out[scope.lens] || (out[scope.lens] = { locked: false, items: [] });
            if (scope.item) entry.items.push(scope.item); else entry.locked = true;
        }
        for (const e of Object.values(out)) e.items.sort();
        return out;
    }

    /** Should a put at (holon, lens, id) be sealed? Loads the keys first. */
    async function shouldSeal(holon, lens, id) {
        if (!privatizable(holon, lens)) return false;
        await ensureKeys(holon, lens);
        return isPrivate(holon, lens, id);
    }

    // ---------------------------------------------------------------- keyring

    /** The store's unseal hook: opens what the keyring can, else null. */
    function unseal({ holon, lens, id, sealed }) {
        if (!isSealed(sealed)) return null;
        if (sealed.kid === SELF_KID) {
            const s = sk();
            if (!s) return null;
            try { return unsealSelf(sealed, s); } catch { return null; }
        }
        const key = keys.get(kk({ holon, lens, item: id }, sealed.kid)) || keys.get(kk({ holon, lens }, sealed.kid));
        if (!key) return null;
        try { return unsealItem(sealed, key); } catch { return null; }
    }

    function installKeys(scope, record) {
        for (const k of record.keys || []) {
            if (k && typeof k.key === 'string' && HEX64.test(k.key)) keys.set(kk(scope, k.kid || kidOf(k.key)), hexToBytes(k.key));
        }
    }

    function installVault(scope, vault) {
        vaults.set(sk2(scope), vault);
        installKeys(scope, vault);
    }

    function installCopy(scope, copy) {
        copies.set(sk2(scope), copy);
        installKeys(scope, copy);
    }

    /** Open one of this instance's own vault records straight from its envelope. */
    function readOwnRecord(holon, id) {
        const s = sk();
        const me = pub();
        if (!s || !me) return null;
        const events = store().getEvents(holon, VAULT_LENS, id).filter((e) => e.pubkey === me);
        for (const e of events) {   // newest first
            const payload = eventToItem(e);
            if (!isSealed(payload) || payload.kid !== SELF_KID) continue;
            try {
                const obj = unsealSelf(payload, s);
                if (obj && obj._deleted !== true) return obj;
                return null;
            } catch { /* another key's record at our address */ }
        }
        return null;
    }

    /** Write one of this instance's own vault records (self-sealed). */
    async function writeOwnRecord(holon, id, obj) {
        const s = sk();
        if (!s) throw new Error('privacy: no signing key — log in first');
        const body = { ...obj, id };
        const content = JSON.stringify(sealSelf(body, s));
        await holo.put(holon, VAULT_LENS, { id }, {
            _sealedContent: content, _skipProjections: true, autoPropagate: false, disableHologramRedirection: true,
        });
        return body;
    }

    /** Parse a record under `_vault`: an own vault (by id) or a copy (by prefix). */
    function scopeOfRecord(holon, id, item) {
        if (item && item.scope && item.scope.holon && item.scope.lens) {
            const s = { holon: String(item.scope.holon), lens: String(item.scope.lens) };
            if (item.scope.item != null) s.item = String(item.scope.item);
            return s;
        }
        return scopeOfVaultId(holon, id);
    }

    function watchVault(holon) {
        if (vaultWatchers.has(holon) || !store().watch) return;
        const off = store().watch(holon, VAULT_LENS, (item, id, meta) => {
            if (meta.replay || !item || meta.tombstone || meta.locked) return;
            // Only our own records open (self-sealed); anything else stays a stub.
            if (typeof id !== 'string' || !item.keys) return;
            const scope = scopeOfRecord(holon, id, item);
            if (!scope) return;
            if (id.startsWith(COPY_PREFIX)) installCopy(scope, item); else installVault(scope, item);
            store().rescan({ holon: scope.holon, lens: scope.lens });
        }, { replay: false });
        vaultWatchers.set(holon, off);
    }

    /**
     * Make sure every key this identity can have for (holon, lens) is in the
     * keyring: the holon's vault records for the lens and its items (own
     * records), and this identity's own vault copies of received grants.
     * Then re-decode the lens. Memoised per identity + address; a later vault
     * write arrives through the vault watcher.
     */
    function ensureKeys(holon, lens) {
        if (isGlobal(holon) || !lens || lens === VAULT_LENS) return Promise.resolve();
        const me = pub();
        if (!sk() || !me) return Promise.resolve();
        const key = `${me}|${holon}|${lens}`;
        let p = loaded.get(key);
        if (p) return p;
        p = (async () => {
            await holo._relaySync?.(holon, VAULT_LENS, { await: true });
            watchVault(holon);
            for (const id of store().listKeys(holon, VAULT_LENS, { includeLocked: true })) {
                const scope = scopeOfVaultId(holon, id);
                if (!scope || scope.lens !== lens) continue;
                const own = readOwnRecord(holon, id);
                if (own && own.keys) installVault(scope, own);
            }
            if (String(holon) !== me) {
                await holo._relaySync?.(me, VAULT_LENS, { await: true });
                watchVault(me);
                const prefix = `${COPY_PREFIX}${holon}:${lens}`;
                for (const id of store().listKeys(me, VAULT_LENS, { includeLocked: true })) {
                    if (id !== prefix && !id.startsWith(`${prefix}:`)) continue;
                    const copy = readOwnRecord(me, id);
                    const scope = copy ? scopeOfRecord(me, id, copy) : null;
                    if (copy && copy.keys && scope) installCopy(scope, copy);
                }
            }
            store().rescan({ holon, lens });
        })().catch((e) => { console.warn('[privacy] loading keys failed:', e?.message); });
        loaded.set(key, p);
        return p;
    }

    function lockedPresent(holon, lens) {
        try {
            return store().list(holon, lens, { includeDeleted: true, includeLocked: true }).some((r) => isLocked(r.item));
        } catch { return false; }
    }

    /** Does a read of this lens need keys before it can show anything? */
    function wantsKeys(holon, lens) {
        if (isGlobal(holon) || !lens || lens === VAULT_LENS || !sk()) return false;
        if (lockedScopes(holon)[lens]) return true;
        for (const k of copies.keys()) if (k === `${holon}|${lens}` || k.startsWith(`${holon}|${lens}/`)) return true;
        return lockedPresent(holon, lens);
    }

    // ---------------------------------------------------------------- owner side

    function ownVault(scope) {
        return vaults.get(sk2(scope)) || null;
    }

    function owned(scope) {
        return !!ownVault(normScope(scope));
    }

    /** Every scope of a holon this identity owns the vault of. */
    function ownedScopes(holon) {
        const out = [];
        for (const [k, v] of vaults) {
            if (k.startsWith(`${holon}|`) && v && v.scope) out.push({ ...v.scope });
        }
        return out;
    }

    /** The newest key of a scope this instance holds (owner or grantee), or null. */
    function currentKey(scope) {
        const rec = ownVault(scope) || copies.get(sk2(scope)) || null;
        const list = rec && Array.isArray(rec.keys) ? rec.keys : [];
        for (let i = list.length - 1; i >= 0; i--) {
            const k = list[i];
            if (!k || typeof k.key !== 'string' || !HEX64.test(k.key)) continue;
            return { kid: k.kid || kidOf(k.key), key: hexToBytes(k.key) };
        }
        return null;
    }

    async function saveVault(scope, vault) {
        const saved = await writeOwnRecord(scope.holon, vaultId(scope), { ...vault, scope });
        installVault(scope, saved);
        return saved;
    }

    function requireOwner(scope) {
        const v = ownVault(scope);
        if (!v) throw new Error(`privacy: ${scope.holon}/${vaultId(scope)} is not a private scope you own`);
        return v;
    }

    /** Every plaintext item of a scope this owner holds (what a rewrite re-puts). */
    // What the owner SEES is what a rewrite seals. The raw store also holds
    // what enforced reads reject — an unsigned record, one by a key the holon
    // never seated, a stray revival over a signed delete — and rewriting
    // those would publish them under the owner's key, surfacing them on
    // every board. So each record goes through the signing layer first, the
    // same resolution `get`/`getAll` apply (a pointer stays a pointer).
    async function ownItems(scope) {
        const signer = holo._signer;
        const enforced = !!(signer && signer.enforce && !signer.isPerActor?.(scope.lens));
        const authorized = async (id, raw) => {
            if (!enforced) return raw;
            const claim = await signer.resolveItem(holo, scope.holon, scope.lens, id);
            if (claim === undefined) return raw;          // nobody speaks for this holon
            return claim && !isLocked(claim) && claim._deleted !== true ? claim : null;
        };
        if (scope.item) {
            const rec = store().get(scope.holon, scope.lens, scope.item);
            const it = rec?.item;
            if (!it || isLocked(it) || it._deleted === true) return [];
            const ok = await authorized(String(scope.item), it);
            return ok ? [ok] : [];
        }
        const out = [];
        for (const r of store().list(scope.holon, scope.lens)) {
            if (!r.item || isLocked(r.item)) continue;
            const ok = await authorized(String(r.id), r.item);
            if (ok) out.push(ok);
        }
        return out;
    }

    async function rewriteItem(scope, item) {
        const clean = { ...item };
        delete clean._hologram; delete clean._meta; delete clean._federation;
        await holo.put(scope.holon, scope.lens, clean, { autoPropagate: false, disableHologramRedirection: true, _skipProjections: true });
    }

    async function rewriteScope(scope) {
        const items = await ownItems(scope);
        for (const item of items) await rewriteItem(scope, item);
        return items.length;
    }

    /**
     * Make a scope private: a fresh key in a new vault record, the scope's
     * items rewritten sealed. Locking a lens folds the item vaults of that
     * lens (the lens's audience governs from now on). `opts.audience` and
     * `opts.sent` seed the opaque fields. Idempotent.
     */
    async function lock(rawScope, opts = {}) {
        const scope = normScope(rawScope);
        assertPrivatizable(scope.holon, scope.lens);
        await ensureKeys(scope.holon, scope.lens);
        const existing = ownVault(scope);
        if (existing) return { kid: currentKey(scope)?.kid || null, rewritten: 0 };
        if (vaultRecord(scope)) throw new Error(`privacy: ${scope.holon}/${vaultId(scope)} is already private, owned by another key`);
        if (!scope.item) {
            for (const s of ownedScopes(scope.holon)) {
                if (s.lens === scope.lens && s.item) await tombstoneVault(s);
            }
        }
        // The rewrite seals what the scope holds NOW, other members' records
        // included: catch the lens up before deciding what that is.
        try { await holo._relaySync?.(scope.holon, scope.lens, { await: true }); } catch { /* local view */ }
        const key = generateKey();
        const kid = kidOf(key);
        await saveVault(scope, {
            keys: [{ kid, key: bytesToHex(key), at: nowIso() }],
            audience: Array.isArray(opts.audience) ? opts.audience : [],
            sent: opts.sent && typeof opts.sent === 'object' ? opts.sent : {},
        });
        const rewritten = await rewriteScope(scope);
        store().rescan({ holon: scope.holon, lens: scope.lens });
        return { kid, rewritten };
    }

    async function tombstoneVault(scope) {
        await holo.delete(scope.holon, VAULT_LENS, vaultId(scope), null, { autoPropagate: false, _skipProjections: true });
        vaults.delete(sk2(scope));
    }

    /**
     * Make a scope public again: the vault is tombstoned, the scope's items
     * rewritten in the clear. The keys stay in the keyring until logout so
     * records not yet rewritten still open.
     */
    async function unlock(rawScope) {
        const scope = normScope(rawScope);
        await ensureKeys(scope.holon, scope.lens);
        requireOwner(scope);
        await tombstoneVault(scope);
        const rewritten = await rewriteScope(scope);
        store().rescan({ holon: scope.holon, lens: scope.lens });
        return { rewritten };
    }

    /** The opaque audience the domain layer stored on an owned scope. */
    async function audienceGet(rawScope) {
        const scope = normScope(rawScope);
        await ensureKeys(scope.holon, scope.lens);
        const v = ownVault(scope);
        return v ? (Array.isArray(v.audience) ? v.audience : []) : null;
    }

    async function audienceSet(rawScope, audience) {
        const scope = normScope(rawScope);
        await ensureKeys(scope.holon, scope.lens);
        const v = requireOwner(scope);
        await saveVault(scope, { ...v, audience: Array.isArray(audience) ? audience : [] });
        return audience;
    }

    /** Which key id each reader holds, as the domain layer last recorded it. */
    async function sentGet(rawScope) {
        const scope = normScope(rawScope);
        await ensureKeys(scope.holon, scope.lens);
        const v = ownVault(scope);
        return v ? { ...(v.sent || {}) } : null;
    }

    async function sentSet(rawScope, sent) {
        const scope = normScope(rawScope);
        await ensureKeys(scope.holon, scope.lens);
        const v = requireOwner(scope);
        await saveVault(scope, { ...v, sent: sent && typeof sent === 'object' ? sent : {} });
        return sent;
    }

    /** The sealed content for a write. */
    async function seal(holon, lens, item) {
        if (!item || item.id == null) throw new Error('privacy: an item with an id is required');
        await ensureKeys(holon, lens);
        const scope = scopeOf(holon, lens, String(item.id));
        if (!scope) throw new Error(`privacy: ${holon}/${lens}/${item.id} is not private`);
        const cur = currentKey(scope);
        if (!cur) throw new Error(`privacy: no key for ${holon}/${vaultId(scope)} — ask the owner to share it`);
        return sealItem(item, cur.key);
    }

    // ---------------------------------------------------------------- grants

    async function sendGrant(recipient, payload) {
        const s = sk();
        if (!s) throw new Error('privacy: no signing key — log in first');
        if (!HEX64.test(recipient)) throw new Error(`privacy: a reader must be a 64-hex pubkey, got '${recipient}'`);
        if (recipient.toLowerCase() === pub().toLowerCase()) {
            await acceptGrant(payload, pub());
            return true;
        }
        return sendDirectMessage(holo, { privateKey: s, recipientPubkey: recipient.toLowerCase(), content: JSON.stringify(payload), subject: GRANT_SUBJECT });
    }

    /**
     * Hand the scope's current key to readers (pubkeys). Records which kid
     * each one holds in `sent`. Returns the kid and the readers the DM
     * reached (a relay refusal leaves a reader out, to retry next sync).
     */
    async function grant(rawScope, readers) {
        const scope = normScope(rawScope);
        await ensureKeys(scope.holon, scope.lens);
        const v = requireOwner(scope);
        const cur = currentKey(scope);
        if (!cur) throw new Error(`privacy: ${scope.holon}/${vaultId(scope)} holds no usable key`);
        const list = (Array.isArray(readers) ? readers : [readers]).map((r) => String(r).toLowerCase());
        const at = nowIso();
        const payload = { t: GRANT_TYPE, v: GRANT_VERSION, holon: scope.holon, lens: scope.lens, ...(scope.item ? { item: scope.item } : {}), kid: cur.kid, key: bytesToHex(cur.key), at };
        const sent = { ...(v.sent || {}) };
        const reached = [];
        const failed = [];
        for (const who of list) {
            let ok = false;
            try { ok = !!(await sendGrant(who, payload)); } catch { ok = false; }
            if (ok) { sent[who] = cur.kid; reached.push(who); } else failed.push(who);
        }
        await saveVault(scope, { ...v, sent });
        return { kid: cur.kid, sent: reached, failed };
    }

    /**
     * Take the scope back from readers: a new key, every item of the scope
     * rewritten under it, the revoked readers dropped from `sent`. The
     * caller hands the new key to the readers that stay (`grant`).
     */
    async function revoke(rawScope, readers) {
        const scope = normScope(rawScope);
        await ensureKeys(scope.holon, scope.lens);
        const v = requireOwner(scope);
        const gone = new Set((Array.isArray(readers) ? readers : [readers]).map((r) => String(r).toLowerCase()));
        const sent = {};
        for (const [who, kid] of Object.entries(v.sent || {})) if (!gone.has(who)) sent[who] = kid;
        const key = generateKey();
        const kid = kidOf(key);
        await saveVault(scope, { ...v, keys: [...(v.keys || []), { kid, key: bytesToHex(key), at: nowIso() }], sent });
        const rewritten = await rewriteScope(scope);
        return { kid, rewritten, revoked: [...gone] };
    }

    /**
     * Accept a grant addressed to this identity: validate it, copy the key
     * into our own vault (sealed to our key), and re-decode.
     */
    async function acceptGrant(raw, sender = null, { trusted = false } = {}) {
        const g = parseGrant(raw);
        if (!g) return { accepted: false, reason: 'malformed' };
        const s = sk();
        const me = pub();
        if (!s || !me) return { accepted: false, reason: 'no identity' };
        const scope = normScope(g);
        await ensureKeys(scope.holon, scope.lens);
        // A scope this identity owns never takes a foreign key (its vault is the key).
        if (ownVault(scope)) return { accepted: false, reason: 'own scope' };
        if (!trusted && !(await senderAccepted(scope.holon, scope.lens, sender))) {
            return { accepted: false, reason: sender ? 'sender does not speak for the holon' : 'no sender' };
        }
        const existing = copies.get(sk2(scope)) || readOwnRecord(me, copyId(scope)) || { scope, keys: [] };
        const list = (existing.keys || []).filter((k) => k && k.kid !== g.kid);
        list.push({ kid: g.kid, key: g.key, at: g.at, from: sender || null });
        const copy = { ...existing, scope, keys: list };
        // Our own vault copy: local-first, so it opens now and other devices recover it.
        const saved = await writeOwnRecord(me, copyId(scope), copy);
        installCopy(scope, saved);
        store().rescan({ holon: scope.holon, lens: scope.lens });
        return { accepted: true, holon: scope.holon, lens: scope.lens, item: scope.item || null, kid: g.kid };
    }

    function startGrants() {
        grantsWanted = true;
        if (stopGrants || !sk() || !holo.nostrRelays?.().length) return;
        stopGrants = subscribeDirectMessages(holo, sk(), (m) => {
            if (m.subject !== GRANT_SUBJECT) return;
            acceptGrant(m.content, m.sender).catch(() => {});
        }, { sinceSec: GRANT_LOOKBACK_SEC });
    }

    function stopGrantsSub() {
        if (stopGrants) { try { stopGrants(); } catch { /* ignore */ } }
        stopGrants = null;
    }

    // ---------------------------------------------------------------- lifecycle

    function forget() {
        keys.clear(); vaults.clear(); copies.clear(); loaded.clear();
        for (const off of vaultWatchers.values()) { try { off(); } catch { /* ignore */ } }
        vaultWatchers.clear();
    }

    /** A new identity signed in: reload its keys, re-decode everything. */
    async function reload() {
        forget();
        stopGrantsSub();
        store().rescan();
        if (grantsWanted) startGrants();
    }

    /** Signed out: drop the keys, lock every sealed record again, persist. */
    async function clear() {
        forget();
        stopGrantsSub();
        store().rescan();
        try { await store().compact(); } catch { /* adapter without snapshot */ }
    }

    function stop() {
        grantsWanted = false;
        stopGrantsSub();
        forget();
    }

    return {
        VAULT_LENS,
        unseal,
        scopeOf, isPrivate, lockedScopes, wantsKeys, shouldSeal, privatizable, assertPrivatizable,
        ensureKeys, seal,
        owned, ownedScopes,
        lock, unlock, audienceGet, audienceSet, sentGet, sentSet,
        grant, revoke, acceptGrant, parseGrant,
        startGrants, stopGrants: stopGrantsSub,
        reload, clear, stop,
        /** Test/diagnostic: what the keyring holds. */
        _debug: () => ({ keys: Array.from(keys.keys()), vaults: Array.from(vaults.keys()), copies: Array.from(copies.keys()) }),
    };
}

export default { createPrivacy, parseGrant, normScope, vaultId, copyId, scopeOfVaultId, VAULT_LENS, GRANT_SUBJECT, NEVER_PRIVATE };
