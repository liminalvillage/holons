// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Private lenses: sealed content on the relay, keys handed out on purpose.
//
// A lens the owner marks private keeps its envelope tags in the clear and
// seals its content (store/sealed.js). This layer holds the keys:
//
//   vault     the owner's own record per private lens — `_vault/lens:<lens>`
//             in the holon, self-sealed to the owner's key, replaceable and
//             synced like any other record, so the owner reads on every
//             device holding that key. It carries the lens keys (history
//             kept for mid-rotation records), the mode, and the grant ledger.
//   keyring   what this instance can open right now: lens keys by kid and
//             item content keys, from its own vaults and from grants it
//             received. Installed into the store as the `unseal` hook, so
//             every read path (get/getAll/subscribe/federated/holograms)
//             sees plaintext without knowing about any of this.
//   grants    NIP-17 gift-wrapped DMs (nostr-dm.js) carrying a lens key or
//             one item's content key to a pubkey. A received grant is kept
//             in the store's `keys` table (sealed to this instance's key)
//             and copied into the grantee's own personal-holon vault so
//             their other devices recover it.
//
// The privacy flag is the OWNER'S VAULT, not the public settings record:
// settings is last-writer-wins with enforcement off, so anyone could flip a
// lens "public" there and the owner's next write would go out in the clear.
// `settings.privacy.lenses[lens]` is only a hint for other UIs.
//
// Revocation is forward-only: the lens key AND every item's content key are
// rotated and the items rewritten; what a revoked party already read stays
// read. See PRIVACY.md.

import {
    isSealed, kidOf, generateKey, sealItem, unsealItem, cekOf, sealSelf, unsealSelf, isLocked, SELF_KID,
} from './store/sealed.js';
import { eventToItem } from './nostr-events.js';
import { sendDirectMessage, subscribeDirectMessages } from './nostr-dm.js';
import { isAcceptedSender } from './authority.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export const VAULT_LENS = '_vault';
export const GRANT_SUBJECT = 'holons/grant';
export const GRANT_TYPE = 'holons/grant';
export const GRANT_VERSION = 1;

/** Lenses that can never be private: the machinery itself, or public by design. */
export const NEVER_PRIVATE = Object.freeze([
    'settings', VAULT_LENS, '_members', '_check', 'users', 'federation', 'holons_registry', 'schemas', 'hubclaims',
]);

/** How far back the grant subscription looks (NIP-59 back-dates wraps by up to two days; grants may wait months). */
const GRANT_LOOKBACK_SEC = 10 * 365 * 24 * 3600;

const HEX64 = /^[0-9a-f]{64}$/i;
const nowIso = () => new Date().toISOString();
const toBytes = (k) => (typeof k === 'string' ? hexToBytes(k) : k);
const vaultId = (lens) => `lens:${lens}`;
const grantCopyId = (holon, lens) => `grant:${holon}:${lens}`;

/** Parse + validate a grant payload; null when it is not one. */
export function parseGrant(raw) {
    let p = raw;
    if (typeof raw === 'string') {
        try { p = JSON.parse(raw); } catch { return null; }
    }
    if (!p || typeof p !== 'object' || p.t !== GRANT_TYPE || p.v !== GRANT_VERSION) return null;
    if (typeof p.holon !== 'string' || !p.holon || typeof p.lens !== 'string' || !p.lens) return null;
    if (typeof p.kid !== 'string' || !/^[0-9a-f]{16}$/.test(p.kid)) return null;
    const out = { t: GRANT_TYPE, v: GRANT_VERSION, id: String(p.id || ''), holon: p.holon, lens: p.lens, kid: p.kid, at: typeof p.at === 'string' ? p.at : nowIso() };
    if (p.item != null) {
        if (typeof p.item !== 'string' || !p.item || typeof p.cek !== 'string' || !HEX64.test(p.cek)) return null;
        out.item = p.item;
        out.cek = p.cek.toLowerCase();
    } else {
        if (typeof p.key !== 'string' || !HEX64.test(p.key)) return null;
        out.key = p.key.toLowerCase();
        if (kidOf(out.key) !== out.kid) return null;     // self-certifying: the key must hash to its kid
    }
    return out;
}

export function createPrivacy(holo) {
    const lensKeys = new Map();   // `${holon}|${lens}|${kid}` → Uint8Array
    const itemKeys = new Map();   // `${holon}|${lens}|${id}`  → Uint8Array
    const vaults = new Map();     // `${holon}|${lens}` → own vault plaintext
    const grantedKid = new Map(); // `${holon}|${lens}` → kid of the newest lens key received (grantee side)
    const itemLenses = new Set();  // `${holon}|${lens}` with at least one received item key
    const loaded = new Map();     // `${pub}|${holon}|${lens}` → Promise (ensureKeys memo)
    const vaultWatchers = new Map(); // holon → unsubscribe
    let stopGrants = null;
    let grantsWanted = false;

    const sk = () => holo._privateKey || null;
    const pub = () => holo.client?.publicKey || '';
    const store = () => holo.store;
    const app = () => holo.appname;
    const lk = (holon, lens, kid) => `${holon}|${lens}|${kid}`;
    const ik = (holon, lens, id) => `${holon}|${lens}|${id}`;
    const vk = (holon, lens) => `${holon}|${lens}`;
    const rowKey = (recipient, holon, lens, tail) => `${app()}|${recipient}|${holon}|${lens}|${tail}`;
    const isGlobal = (holon) => holon === null || holon === undefined || holon === '';

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
        // What says who speaks for the holon travels on the wire too.
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

    /**
     * May a sealed envelope signed by `author` decide the content key this
     * instance re-uses for its own edit? The owner trusts itself and the keys
     * it granted the lens to; a grantee trusts the keys that may grant.
     */
    async function trustedAuthor(holon, lens, author) {
        if (!author) return false;
        const a = String(author).toLowerCase();
        if (a === pub().toLowerCase()) return true;
        const v = ownVault(holon, lens);
        if (v) return !!(v.grants && v.grants[a]);
        return senderAccepted(holon, lens, a);
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

    /** Public hint on the holon's settings record (written by core alongside the vault). */
    function settingsHint(holon, lens) {
        try {
            const item = store().get(holon, 'settings', String(holon))?.item;
            const mode = item?.privacy?.lenses?.[lens];
            return mode === 'private' || mode === 'public' ? mode : null;
        } catch { return null; }
    }

    function lockedPresent(holon, lens) {
        try {
            return store().list(holon, lens, { includeDeleted: true, includeLocked: true }).some((r) => isLocked(r.item));
        } catch { return false; }
    }

    /**
     * Is this lens private, as far as this instance can tell right now: the
     * owner's own vault says so, the public hint says so, or the lens already
     * holds sealed records. Synchronous — reads what is loaded.
     */
    function isPrivateLens(holon, lens) {
        if (isGlobal(holon) || !lens) return false;
        const v = vaults.get(vk(holon, lens));
        if (v) return v.mode !== 'public';
        // A key handed to this identity says the lens is private — a grantee
        // holding every key sees no locked stub and may have no hint.
        if (grantedKid.has(vk(holon, lens)) || itemLenses.has(vk(holon, lens))) return true;
        if (settingsHint(holon, lens) === 'private') return true;
        return lockedPresent(holon, lens);
    }

    /** Should a put at (holon, lens) be sealed? Loads the vault first. */
    async function shouldSeal(holon, lens, options = {}) {
        if (options.privacy === 'public') return false;
        if (options.privacy === 'private') { assertPrivatizable(holon, lens); return true; }
        if (!privatizable(holon, lens)) return false;
        await ensureKeys(holon, lens);
        return isPrivateLens(holon, lens);
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
        const key = lensKeys.get(lk(holon, lens, sealed.kid));
        if (key && typeof sealed.k === 'string') {
            try { return unsealItem(sealed, { lensKey: key }); } catch { /* fall through to the item key */ }
        }
        const cek = itemKeys.get(ik(holon, lens, id));
        if (cek) {
            try { return unsealItem(sealed, { cek }); } catch { return null; }
        }
        return null;
    }

    function installVault(holon, lens, vault) {
        vaults.set(vk(holon, lens), vault);
        for (const k of vault.keys || []) {
            if (k && typeof k.key === 'string' && HEX64.test(k.key)) lensKeys.set(lk(holon, lens, k.kid || kidOf(k.key)), hexToBytes(k.key));
        }
    }

    function installGrantCopy(holon, lens, copy) {
        for (const k of copy.keys || []) {
            if (k && typeof k.key === 'string' && HEX64.test(k.key)) {
                const kid = k.kid || kidOf(k.key);
                lensKeys.set(lk(holon, lens, kid), hexToBytes(k.key));
                noteGranted(holon, lens, kid, k.at);
            }
        }
        for (const [id, cek] of Object.entries(copy.items || {})) {
            if (typeof cek === 'string' && HEX64.test(cek)) itemKeys.set(ik(holon, lens, id), hexToBytes(cek)); itemLenses.add(vk(holon, lens));
        }
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

    /** Received-key rows for the current identity. */
    function loadRows() {
        const s = sk();
        const me = pub();
        if (!s || !me) return;
        for (const { cipher } of store().keysList(`${app()}|${me}|`)) {
            let payload = null;
            try { payload = JSON.parse(cipher); } catch { continue; }
            let row = null;
            try { row = unsealSelf(payload, s); } catch { continue; }
            if (!row || !row.holon || !row.lens) continue;
            if (row.key && HEX64.test(row.key)) {
                const kid = row.kid || kidOf(row.key);
                lensKeys.set(lk(row.holon, row.lens, kid), hexToBytes(row.key));
                noteGranted(row.holon, row.lens, kid, row.at);
            }
            if (row.item && row.cek && HEX64.test(row.cek)) itemKeys.set(ik(row.holon, row.lens, row.item), hexToBytes(row.cek)); itemLenses.add(vk(row.holon, row.lens));
        }
    }

    const grantedAt = new Map(); // `${holon}|${lens}` → ISO time of the newest lens key received
    function noteGranted(holon, lens, kid, at) {
        const k = vk(holon, lens);
        const when = typeof at === 'string' ? at : '';
        if (!grantedKid.has(k) || when >= (grantedAt.get(k) || '')) { grantedKid.set(k, kid); grantedAt.set(k, when); }
    }

    function watchVault(holon) {
        if (vaultWatchers.has(holon) || !store().watch) return;
        const off = store().watch(holon, VAULT_LENS, (item, id, meta) => {
            if (meta.replay || !item || meta.tombstone || meta.locked) return;
            // Only our own records open (self-sealed); anything else stays a stub.
            if (typeof id !== 'string') return;
            if (id.startsWith('lens:')) {
                const lens = id.slice('lens:'.length);
                if (!item.keys) return;
                installVault(holon, lens, item);
                store().rescan({ holon, lens });
            } else if (id.startsWith('grant:')) {
                const [, target, lens] = id.split(':');
                if (!target || !lens) return;
                installGrantCopy(target, lens, item);
                store().rescan({ holon: target, lens });
            }
        }, { replay: false });
        vaultWatchers.set(holon, off);
    }

    /**
     * Make sure every key this identity can have for (holon, lens) is in the
     * keyring: the holon's vault (own records), this identity's own vault
     * copies of received grants, and the local `keys` rows. Then re-decode
     * the lens. Memoised per identity + address; a later vault write arrives
     * through the vault watcher.
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
            const own = readOwnRecord(holon, vaultId(lens));
            if (own) installVault(holon, lens, own);
            if (String(holon) !== me) {
                await holo._relaySync?.(me, VAULT_LENS, { await: true });
                watchVault(me);
                const copy = readOwnRecord(me, grantCopyId(holon, lens));
                if (copy) installGrantCopy(holon, lens, copy);
            }
            loadRows();
            store().rescan({ holon, lens });
        })().catch((e) => { console.warn('[privacy] loading keys failed:', e?.message); });
        loaded.set(key, p);
        return p;
    }

    /** Does a read of this lens need keys before it can show anything? */
    function wantsKeys(holon, lens) {
        if (isGlobal(holon) || !lens || lens === VAULT_LENS || !sk()) return false;
        return isPrivateLens(holon, lens) || vaults.has(vk(holon, lens));
    }

    // ---------------------------------------------------------------- owner side

    function ownVault(holon, lens) {
        return vaults.get(vk(holon, lens)) || null;
    }

    function currentKey(holon, lens) {
        const v = ownVault(holon, lens);
        if (!v || !v.current) return null;
        const key = lensKeys.get(lk(holon, lens, v.current));
        return key ? { kid: v.current, key } : null;
    }

    async function saveVault(holon, lens, vault) {
        const saved = await writeOwnRecord(holon, vaultId(lens), vault);
        installVault(holon, lens, saved);
        return saved;
    }

    function freshVault(lens) {
        const key = generateKey();
        const kid = kidOf(key);
        return { lens, mode: 'private', current: kid, keys: [{ kid, key: bytesToHex(key), at: nowIso() }], grants: {} };
    }

    /**
     * Set the lens mode. 'private' creates the lens key on first use;
     * 'public' keeps the keys (records already sealed stay readable) but
     * new writes go out in the clear.
     */
    async function setLensMode(holon, lens, mode) {
        if (mode !== 'private' && mode !== 'public') throw new Error(`privacy: mode must be 'private' or 'public', got '${mode}'`);
        assertPrivatizable(holon, lens);
        await ensureKeys(holon, lens);
        let v = ownVault(holon, lens);
        if (!v) {
            if (mode === 'public') return null;
            v = freshVault(lens);
        } else {
            v = { ...v, mode };
        }
        loaded.delete(`${pub()}|${holon}|${lens}`);
        const saved = await saveVault(holon, lens, v);
        store().rescan({ holon, lens });
        return { lens, mode: saved.mode, kid: saved.current };
    }

    /** The owner's lens key, creating the vault on the first private write. */
    async function ensureLensKey(holon, lens) {
        await ensureKeys(holon, lens);
        let cur = currentKey(holon, lens);
        if (cur) return cur;
        const own = ownVault(holon, lens);
        if (own && own.mode === 'public') throw new Error(`privacy: lens '${lens}' is public`);
        if (own) throw new Error(`privacy: vault for ${holon}/${lens} holds no usable key`);
        // Not the owner: a grant may still let us write (an item grantee
        // re-sealing under the same content key), handled by seal(). Here
        // the caller needs a LENS key, which only the owner creates.
        if (settingsHint(holon, lens) === 'private' || lockedPresent(holon, lens)) {
            throw new Error(`privacy: no key for ${holon}/${lens} — ask the owner to share the lens`);
        }
        await saveVault(holon, lens, freshVault(lens));
        cur = currentKey(holon, lens);
        if (!cur) throw new Error(`privacy: could not create a key for ${holon}/${lens}`);
        return cur;
    }

    /** The sealed content for a write. Keeps the item's content key across edits. */
    async function seal(holon, lens, item, options = {}) {
        if (!item || item.id == null) throw new Error('privacy: an item with an id is required');
        await ensureKeys(holon, lens);
        const id = String(item.id);
        const rotate = options._rotateItemKey === true;
        // What the address currently holds, from the winning envelope.
        let currentSealed = null;
        const rec = store().get(holon, lens, id);
        const evt = rec?.eventId ? store().events.get(rec.eventId) : null;
        // A planted envelope (any key can write to a relay) must not pick the
        // content key of our edit: only a trusted author's wrap is re-used.
        if (evt && (await trustedAuthor(holon, lens, evt.pubkey))) {
            const p = eventToItem(evt);
            if (isSealed(p) && p.kid !== SELF_KID) currentSealed = p;
        }
        const cur = currentKey(holon, lens);
        if (cur) {
            let cek = null;
            if (!rotate && currentSealed) {
                const oldKey = lensKeys.get(lk(holon, lens, currentSealed.kid));
                if (oldKey && typeof currentSealed.k === 'string') {
                    try { cek = cekOf(currentSealed, oldKey); } catch { cek = null; }
                }
                if (!cek) cek = itemKeys.get(ik(holon, lens, id)) || null;
            }
            if (!cek) cek = generateKey();
            return sealItem(item, { cek, lensKey: cur.key, kid: cur.kid });
        }
        // Not the owner: an item grantee edits under the same content key
        // and keeps the wrap verbatim (it cannot re-wrap without the lens key).
        const cek = itemKeys.get(ik(holon, lens, id));
        if (cek && currentSealed && typeof currentSealed.k === 'string' && !rotate) {
            return sealItem(item, { cek, kid: currentSealed.kid, k: currentSealed.k });
        }
        const lensKey = currentSealed ? lensKeys.get(lk(holon, lens, currentSealed.kid)) : null;
        if (lensKey && currentSealed) {
            // A lens grantee: re-seal under the owner's current lens key.
            let existing = null;
            try { existing = rotate ? null : cekOf(currentSealed, lensKey); } catch { existing = null; }
            return sealItem(item, { cek: existing || generateKey(), lensKey, kid: currentSealed.kid });
        }
        // No trusted envelope at the address: a lens grantee seals under the
        // newest lens key it was handed for this lens.
        const granted = grantedKid.get(vk(holon, lens));
        const grantedKey = granted ? lensKeys.get(lk(holon, lens, granted)) : null;
        if (grantedKey) return sealItem(item, { cek: generateKey(), lensKey: grantedKey, kid: granted });
        // First private write of a lens nobody sealed yet: become its owner
        // (or learn why we cannot — the error names the reason).
        const created = await ensureLensKey(holon, lens);
        return sealItem(item, { cek: generateKey(), lensKey: created.key, kid: created.kid });
    }

    // ---------------------------------------------------------------- grants

    async function sendGrant(recipient, payload) {
        const s = sk();
        if (!s) throw new Error('privacy: no signing key — log in first');
        if (!HEX64.test(recipient)) throw new Error(`privacy: grantee must be a 64-hex pubkey, got '${recipient}'`);
        const content = JSON.stringify(payload);
        if (recipient.toLowerCase() === pub().toLowerCase()) {
            await acceptGrant(payload, pub());
            return true;
        }
        return sendDirectMessage(holo, { privateKey: s, recipientPubkey: recipient.toLowerCase(), content, subject: GRANT_SUBJECT });
    }

    function requireOwner(holon, lens) {
        const cur = currentKey(holon, lens);
        if (!cur) throw new Error(`privacy: ${holon}/${lens} is not a private lens you own`);
        return cur;
    }

    /** Share the whole lens with a pubkey. */
    async function grantLens(holon, lens, recipient) {
        await ensureKeys(holon, lens);
        const cur = requireOwner(holon, lens);
        const grantee = String(recipient).toLowerCase();
        const at = nowIso();
        const payload = { t: GRANT_TYPE, v: GRANT_VERSION, id: `${cur.kid}:${grantee.slice(0, 8)}:${Date.now()}`, holon: String(holon), lens, kid: cur.kid, key: bytesToHex(cur.key), at };
        const sent = await sendGrant(grantee, payload);
        const v = ownVault(holon, lens);
        const grants = { ...(v.grants || {}) };
        grants[grantee] = { ...(grants[grantee] || {}), lens: { kid: cur.kid, at } };
        await saveVault(holon, lens, { ...v, grants });
        return { sent: !!sent, kid: cur.kid, grantee };
    }

    /** Share one item with a pubkey. */
    async function grantItem(holon, lens, id, recipient) {
        await ensureKeys(holon, lens);
        requireOwner(holon, lens);
        const grantee = String(recipient).toLowerCase();
        const rec = store().get(holon, lens, String(id));
        const evt = rec?.eventId ? store().events.get(rec.eventId) : null;
        const payload = evt ? eventToItem(evt) : null;
        if (!isSealed(payload) || typeof payload.k !== 'string') throw new Error(`privacy: ${holon}/${lens}/${id} is not a sealed item`);
        const lensKey = lensKeys.get(lk(holon, lens, payload.kid));
        if (!lensKey) throw new Error(`privacy: no lens key ${payload.kid} for ${holon}/${lens}`);
        const cek = cekOf(payload, lensKey);
        const at = nowIso();
        const grant = { t: GRANT_TYPE, v: GRANT_VERSION, id: `${payload.kid}:${String(id)}:${grantee.slice(0, 8)}:${Date.now()}`, holon: String(holon), lens, kid: payload.kid, item: String(id), cek: bytesToHex(cek), at };
        const sent = await sendGrant(grantee, grant);
        const v = ownVault(holon, lens);
        const grants = { ...(v.grants || {}) };
        const g = { ...(grants[grantee] || {}) };
        g.items = { ...(g.items || {}), [String(id)]: { at } };
        grants[grantee] = g;
        await saveVault(holon, lens, { ...v, grants });
        return { sent: !!sent, grantee, item: String(id) };
    }

    /** Every plaintext item of a lens this owner holds (what a rewrite re-puts). */
    function ownItems(holon, lens) {
        return store().list(holon, lens).map((r) => r.item).filter((it) => it && !isLocked(it));
    }

    async function rewriteItem(holon, lens, item) {
        const clean = { ...item };
        delete clean._hologram; delete clean._meta; delete clean._federation;
        await holo.put(holon, lens, clean, { _rotateItemKey: true, autoPropagate: false, disableHologramRedirection: true, _skipProjections: true });
    }

    /**
     * Revoke a pubkey's lens grant: new lens key, new content key for EVERY
     * item (a lens grantee could have cached them all), every item rewritten,
     * remaining grantees re-granted.
     */
    async function revokeLens(holon, lens, recipient) {
        await ensureKeys(holon, lens);
        requireOwner(holon, lens);
        const revoked = String(recipient).toLowerCase();
        const v = ownVault(holon, lens);
        const grants = { ...(v.grants || {}) };
        if (grants[revoked]) {
            const { lens: _l, ...rest } = grants[revoked];
            if (Object.keys(rest.items || {}).length) grants[revoked] = rest; else delete grants[revoked];
        }
        const key = generateKey();
        const kid = kidOf(key);
        const rotated = { ...v, current: kid, keys: [...(v.keys || []), { kid, key: bytesToHex(key), at: nowIso() }], grants };
        await saveVault(holon, lens, rotated);
        const items = ownItems(holon, lens);
        for (const item of items) await rewriteItem(holon, lens, item);
        // Re-grant: lens grantees get the new key, item grantees the new content keys.
        const regranted = [];
        for (const [who, g] of Object.entries(grants)) {
            if (g.lens) { await grantLens(holon, lens, who); regranted.push(who); }
            for (const id of Object.keys(g.items || {})) {
                if (items.some((it) => String(it.id) === id)) { await grantItem(holon, lens, id, who); regranted.push(who); }
            }
        }
        return { kid, rewritten: items.length, regranted: Array.from(new Set(regranted)) };
    }

    /** Revoke a pubkey's grant on one item: new content key, item rewritten, other item grantees re-granted. */
    async function revokeItem(holon, lens, id, recipient) {
        await ensureKeys(holon, lens);
        requireOwner(holon, lens);
        const revoked = String(recipient).toLowerCase();
        const v = ownVault(holon, lens);
        const grants = { ...(v.grants || {}) };
        if (grants[revoked]?.items?.[String(id)]) {
            const items = { ...grants[revoked].items };
            delete items[String(id)];
            const g = { ...grants[revoked], items };
            if (!Object.keys(items).length) delete g.items;
            if (!g.lens && !g.items) delete grants[revoked]; else grants[revoked] = g;
        }
        await saveVault(holon, lens, { ...v, grants });
        const rec = store().get(holon, lens, String(id));
        if (!rec || isLocked(rec.item) || rec.item?._deleted) return { rewritten: 0, regranted: [] };
        await rewriteItem(holon, lens, rec.item);
        const regranted = [];
        for (const [who, g] of Object.entries(grants)) {
            if (g.items?.[String(id)]) { await grantItem(holon, lens, id, who); regranted.push(who); }
        }
        return { rewritten: 1, regranted };
    }

    /** The grant ledger of a lens (or of every private lens of the holon this instance owns). */
    async function listGrants(holon, lens) {
        const out = {};
        const lenses = lens ? [lens] : Array.from(vaults.keys()).filter((k) => k.startsWith(`${holon}|`)).map((k) => k.slice(String(holon).length + 1));
        for (const l of lenses) {
            await ensureKeys(holon, l);
            const v = ownVault(holon, l);
            if (!v) continue;
            for (const [who, g] of Object.entries(v.grants || {})) {
                const entry = out[who] || (out[who] = { lenses: [], items: {} });
                if (g.lens) entry.lenses.push(l);
                for (const id of Object.keys(g.items || {})) (entry.items[l] || (entry.items[l] = [])).push(id);
            }
        }
        return out;
    }

    /** Every private lens this instance owns in a holon, with its mode. */
    function ownedLenses(holon) {
        const out = {};
        for (const [k, v] of vaults) {
            if (k.startsWith(`${holon}|`)) out[k.slice(String(holon).length + 1)] = v.mode || 'private';
        }
        return out;
    }

    /**
     * Accept a grant addressed to this identity: validate it, keep it (sealed
     * to our key) in the store, copy it into our own vault, and re-decode.
     */
    async function acceptGrant(raw, sender = null, { trusted = false } = {}) {
        const g = parseGrant(raw);
        if (!g) return { accepted: false, reason: 'malformed' };
        const s = sk();
        const me = pub();
        if (!s || !me) return { accepted: false, reason: 'no identity' };
        // Who hands the key out matters as much as the key: a grant from a
        // key that does not speak for the holon is dropped, and a lens this
        // identity owns never takes a foreign lens key (its vault is the key).
        await ensureKeys(g.holon, g.lens);
        if (g.key && ownVault(g.holon, g.lens)) return { accepted: false, reason: 'own lens' };
        if (!trusted && !(await senderAccepted(g.holon, g.lens, sender))) {
            return { accepted: false, reason: sender ? 'sender does not speak for the holon' : 'no sender' };
        }
        const row = { holon: g.holon, lens: g.lens, kid: g.kid, key: g.key, item: g.item, cek: g.cek, from: sender, at: g.at };
        // A content key must open the record it claims, when we hold it.
        if (g.item) {
            const rec = store().get(g.holon, g.lens, g.item);
            const evt = rec?.eventId ? store().events.get(rec.eventId) : null;
            const payload = evt ? eventToItem(evt) : null;
            if (isSealed(payload) && payload.kid === g.kid) {
                try { unsealItem(payload, { cek: g.cek }); } catch { return { accepted: false, reason: 'key does not open the item' }; }
            }
        }
        store().keysPut(rowKey(me, g.holon, g.lens, g.item ? `item:${g.item}` : g.kid), JSON.stringify(sealSelf(row, s)));
        if (g.key) { lensKeys.set(lk(g.holon, g.lens, g.kid), hexToBytes(g.key)); noteGranted(g.holon, g.lens, g.kid, g.at); }
        if (g.item) itemKeys.set(ik(g.holon, g.lens, g.item), hexToBytes(g.cek)); itemLenses.add(vk(g.holon, g.lens));
        // Our own vault copy, so other devices with this key recover it.
        if (String(g.holon) !== me) {
            try {
                const existing = readOwnRecord(me, grantCopyId(g.holon, g.lens)) || { holon: g.holon, lens: g.lens, keys: [], items: {} };
                const copy = { ...existing, keys: [...(existing.keys || [])], items: { ...(existing.items || {}) } };
                if (g.key && !copy.keys.some((k) => k.kid === g.kid)) copy.keys.push({ kid: g.kid, key: g.key, at: g.at });
                if (g.item) copy.items[g.item] = g.cek;
                await writeOwnRecord(me, grantCopyId(g.holon, g.lens), copy);
            } catch (e) { console.warn('[privacy] vault copy of a grant failed:', e?.message); }
        }
        store().rescan({ holon: g.holon, lens: g.lens });
        return { accepted: true, holon: g.holon, lens: g.lens, item: g.item || null, kid: g.kid };
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
        lensKeys.clear(); itemKeys.clear(); vaults.clear(); loaded.clear(); grantedKid.clear(); grantedAt.clear(); itemLenses.clear();
        for (const off of vaultWatchers.values()) { try { off(); } catch { /* ignore */ } }
        vaultWatchers.clear();
    }

    /** A new identity signed in: reload its keys, re-decode everything. */
    async function reload() {
        forget();
        stopGrantsSub();
        loadRows();
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
        isPrivateLens, wantsKeys, shouldSeal, privatizable, assertPrivatizable,
        ensureKeys, ensureLensKey, seal,
        setLensMode, ownedLenses,
        grantLens, grantItem, revokeLens, revokeItem, listGrants,
        acceptGrant, parseGrant,
        startGrants, stopGrants: stopGrantsSub,
        reload, clear, stop,
        /** Test/diagnostic: what the keyring holds. */
        _debug: () => ({ lensKeys: Array.from(lensKeys.keys()), itemKeys: Array.from(itemKeys.keys()), vaults: Array.from(vaults.keys()) }),
        /** Test/diagnostic: a lens key by kid (bytes), or null. */
        _keyFor: (holon, lens, kid) => lensKeys.get(lk(holon, lens, kid)) || null,
    };
}

export default { createPrivacy, parseGrant, VAULT_LENS, GRANT_SUBJECT, NEVER_PRIVATE };
