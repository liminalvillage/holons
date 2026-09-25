/**
 * @fileoverview Factory functions for HoloSphere and KeyManager instances.
 *
 * The HoloSphere instance is now built by `@holons/core/holosphere`; this
 * file is a thin Node wrapper that resolves a private key (env / file /
 * generate) and wires the bot-only KeyManager.
 *
 * @module src/createHoloSphere
 */
import {
  createHoloSphere as coreCreateHoloSphere,
  resolveEnforce,
  resolveRelays,
} from '@holons/core/holosphere';
import { getOrCreateKey } from '../utils/key-storage.js';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { cellToLatLng } from 'h3-js';
import {
  nsecToHex,
  buildProjections,
  parseProjectionList,
  buildGroupState,
  groupStateHash,
  wrapDirectMessage,
} from '@holons/core/nostr';
import {
  deriveIdentityProviderKey,
  deriveTelegramNostrKey,
} from '@holons/core/auth';
import { createLinkedKeysResolver, linkedKeysOf } from '@holons/core/users';
import { syncMembersLog } from '@holons/core/protocol';
import { FLOW_CLAIMS_LENS } from '@holons/core/flows';
import { GOVERNANCE_VOTES_LENS } from '@holons/core/governance';
import { getPrivacySnapshot, grantLens } from '@holons/core/privacy';
import KeyManager from './KeyManager.js';

/**
 * Generates a hex-encoded private key for Nostr.
 * @private
 * @returns {string} Hex-encoded private key
 */
function generatePrivateKey() {
  const secretKey = generateSecretKey();
  return Buffer.from(secretKey).toString('hex');
}

/**
 * Creates and configures a HoloSphere instance.
 *
 * Uses persistent private key so the same identity is maintained across restarts.
 * This allows the bot to access its previous data from Nostr relays.
 *
 * Priority for the signing key (nsec1… or 64-char hex):
 * 1) .env HOLOSPHERE_NSEC
 * 2) stored key from utils/key-storage
 * 3) generate new key
 *
 * The relays are the wire (HOLOSPHERE_RELAYS, default: the production
 * relays): every write is published as a signed kind-30078 event and every
 * touched (holon, lens) is synced into a local file-backed store under
 * HOLOSPHERE_STORE_DIR (default `./holosphere-store`), so a restart only
 * catches up from its cursor instead of re-downloading the network.
 *
 * @param {string} [appName] - Application name (defaults to env HOLONS_APP or 'Holons')
 * @param {Object} [options] - Additional HoloSphere configuration options
 * @param {string} [options.privateKey] - Override private key
 * @param {string[]} [options.relays] - Override relay list
 * @param {{adapter?: string, dir?: string}} [options.store] - Override the local store
 * @param {string} [options.logLevel] - Log level (default: 'INFO')
 * @returns {HoloSphere} Configured HoloSphere instance
 *
 * @example
 * import createHoloSphere from './createHoloSphere.js';
 * const holosphere = createHoloSphere('MyApp');
 * await holosphere.put(holonId, 'quests', questData);
 */
export default function createHoloSphere(appName, options = {}) {
  const resolvedAppName =
    appName || process.env.HOLONS_APP || process.env.APPNAME || 'Holons';
  const {
    privateKey: pkOverride,
    logLevel,
    relays: relaysOption,
    store: storeOption,
    ...extra
  } = options;
  const privateKey = nsecToHex(
    pkOverride ||
      process.env.HOLOSPHERE_NSEC ||
      getOrCreateKey(resolvedAppName, generatePrivateKey)
  );

  const relays = resolveRelays(
    Array.isArray(relaysOption) && relaysOption.length
      ? relaysOption
      : process.env.HOLOSPHERE_RELAYS
  );
  const store = storeOption || {
    adapter: 'file',
    dir: process.env.HOLOSPHERE_STORE_DIR || './holosphere-store',
  };

  // Standard-kind projections: every write is ALSO published as its standard
  // Nostr kind (NIP-52 / NIP-99 / kind 0 / NIP-51 / NIP-58 / NIP-29) so
  // third-party clients can read it. ON for every lens by default;
  // HOLOSPHERE_PROJECTIONS=off|quests,events,… narrows or disables it. See
  // packages/holosphere/NOSTR-BACKEND.md.
  const projectionLenses = parseProjectionList(
    process.env.HOLOSPHERE_PROJECTIONS
  );
  const projectionOptions = projectionLenses.length
    ? buildProjectionOptions(resolvedAppName, privateKey, projectionLenses)
    : {};
  // Reverse sync (HOLOSPHERE_PROJECTIONS_SYNC=on|off, default on): external
  // edits of those standard kinds — by the holon key, a member's derived key
  // or a pubkey listed in the holon's settings.nostrTrustedPubkeys — are
  // folded back into the records. HOLOSPHERE_PROJECTIONS_LOOKBACK=7d bounds
  // the cold-start catch-up.
  if (projectionLenses.length) {
    const sync = (process.env.HOLOSPHERE_PROJECTIONS_SYNC || 'on')
      .trim()
      .toLowerCase();
    projectionOptions.reverseSync = !['off', 'false', '0', 'no'].includes(sync);
    const lookback = parseDuration(process.env.HOLOSPHERE_PROJECTIONS_LOOKBACK);
    if (lookback) projectionOptions.reverseLookbackSec = lookback;
  }

  // Callers depend on this factory staying synchronous: the instance is
  // returned before its store has opened and its relay sync is up. Writes
  // queue behind `ready()` inside holosphere; HolonsBotCore awaits it
  // before launching the bot.
  const instance = coreCreateHoloSphere({
    appName: resolvedAppName,
    privateKey,
    relays,
    store,
    // Shifts are NOT carried on the kind-30078 envelope: occurrences, signups
    // and the identity directory are the standard NIP-52 / kind-31926 events
    // Elinor already publishes, decoded straight into lenses. Reading them
    // needs relay.commonshub.dev in HOLOSPHERE_RELAYS — it is in the default
    // set, so only an explicit override has to include it.
    standardWires: {
      shifts: {
        coordinatorPubkey: process.env.SHIFTS_COORDINATOR_PUBKEY || undefined,
      },
      shiftIdentity: {},
    },
    // Fund claims and votes are append-only logs (kind 1808): members append
    // signed entries (/fundclaim, /vote), every reader folds the same log
    // (see FundClaims.js, GovernanceVotes.js).
    appendLenses: [FLOW_CLAIMS_LENS, GOVERNANCE_VOTES_LENS],
    // Authorized reads (HOLOSPHERE_ENFORCE=off reads the open graph).
    enforce: resolveEnforce(process.env.HOLOSPHERE_ENFORCE),
    nostr: projectionOptions,
    extra: { logLevel: logLevel || 'INFO', ...extra },
  });
  projectionHost.instance = instance;
  console.log(
    `[holosphere] relays → ${relays.join(', ')} (store: ${store.adapter}${store.dir ? ` ${store.dir}` : ''})`
  );

  return instance;
}

/**
 * Projection hooks + per-user signer for this bot.
 *
 * - `signerFor(telegramId)` derives the member's key with NOSTR_DERIVATION_SECRET
 *   (same rule as the web login and /shifts), enabling kind-0 profiles and
 *   NIP-52 RSVP companions signed by the member, not the holon. Without the
 *   secret those events are simply dropped.
 * - `timezoneFor(holon)` reads the holon's settings lens lazily (first call
 *   returns undefined and warms the cache).
 *
 * @param {string} appName
 * @param {string} privateKey hex
 * @param {string[]} lenses
 * @returns {{projections: object[], signerFor?: Function}}
 */
function buildProjectionOptions(appName, privateKey, lenses) {
  const secret = (process.env.NOSTR_DERIVATION_SECRET || '').trim();
  const signerFor = secret
    ? id => {
        try {
          return deriveTelegramNostrKey(id, secret).privateKey;
        } catch {
          return null;
        }
      }
    : undefined;
  const pubkeyFor = secret
    ? id => {
        try {
          return deriveTelegramNostrKey(id, secret).publicKey;
        } catch {
          return undefined;
        }
      }
    : undefined;
  // Service-level identity provider: signs kind-31926 attestation companions
  // (Elinor's Telegram↔npub directory). Same secret → same provider key on
  // every surface, so republishes replace instead of duplicating.
  let providerKey = null;
  let providerPubkey;
  if (secret) {
    try {
      const provider = deriveIdentityProviderKey(secret);
      providerKey = provider.privateKey;
      providerPubkey = provider.publicKey;
    } catch {
      /* signing degrades to no attestations */
    }
  }
  const holonPubkey = getPublicKey(
    Uint8Array.from(Buffer.from(privateKey, 'hex'))
  );
  const trust = createTrustCache(holonPubkey, secret);
  // A member's linked keys (personal-holon `users` record) for the kind-31926
  // attestation companion; `invalidateLinkedKeys` after /key link|unlink.
  linkedKeys = createLinkedKeysResolver({
    get: (holon, lens, key) => {
      const hs = projectionHost.instance;
      if (!hs || typeof hs.get !== 'function')
        return Promise.reject(new Error('projection host not ready'));
      return hs.get(String(holon), lens, String(key));
    },
  });
  const tzCache = new Map();
  const timezoneFor = holon => {
    if (tzCache.has(holon)) return tzCache.get(holon) || undefined;
    tzCache.set(holon, ''); // warm once; later writes pick it up
    const hs = projectionHost.instance;
    if (hs && typeof hs.get === 'function') {
      hs.get(String(holon), 'settings', String(holon))
        .then(s => {
          if (s && typeof s.timezone === 'string')
            tzCache.set(holon, s.timezone);
        })
        .catch(() => {});
    }
    return undefined;
  };
  const projections = buildProjections(lenses, {
    appName,
    holonPubkey,
    cellToLatLng,
    timezoneFor,
    pubkeyFor,
    userIdFor: trust.userIdFor,
    providerPubkey,
    linkedKeysFor: linkedKeys.linkedKeysFor,
  });
  console.log(
    `[holosphere] projections on → ${lenses.join(', ')}${signerFor ? ' (+ per-user signer)' : ''}${providerKey ? ' (+ identity provider)' : ''}`
  );
  return {
    projections,
    ...(signerFor ? { signerFor } : {}),
    ...(providerKey ? { providerKey } : {}),
    trustedAuthors: trust.trustedAuthors,
  };
}

/**
 * Who may edit a holon's records over Nostr, and who a pubkey is.
 *
 * Per holon: the holon signer, every member's derived key (from the `users`
 * lens, via NOSTR_DERIVATION_SECRET), every key a member LINKED to
 * themselves (`linkedKeys` on their record here or on their personal-holon
 * record — `/key link`, proof-verified) and `settings.nostrTrustedPubkeys`.
 * A linked key resolves to its member like the derived one does, so a
 * profile edit or a shift signup from the member's own Nostr client folds
 * back as theirs. Cached 5 minutes; the reverse sync asks on every accepted
 * event, so a new member or link is trusted within that window. Without the
 * secret only the holon key is trusted (RSVPs / kind 0 cannot be attributed
 * to anyone).
 *
 * @param {string} holonPubkey
 * @param {string} secret NOSTR_DERIVATION_SECRET ('' = none)
 */
export function createTrustCache(
  holonPubkey,
  secret,
  ttlMs = 5 * 60 * 1000,
  { ctx = null, publish = null } = {}
) {
  const byPubkey = new Map(); // pubkey -> telegram user id (all holons)
  const perHolon = new Map(); // holon -> { at, list }
  const groupHashes = new Map(); // holon -> [hash of 39000, 39001, 39002]
  let warned = false;

  /** Republish the holon's NIP-29 state when (and only when) it changed. */
  function publishGroupState(holon, settings, memberIds) {
    if (!ctx || !publish) return;
    try {
      const templates = buildGroupState(
        ctx,
        String(holon),
        settings || {},
        memberIds
      );
      const hashes = templates.map(groupStateHash);
      const prev = groupHashes.get(String(holon)) || [];
      const changed = templates.filter((_, i) => hashes[i] !== prev[i]);
      groupHashes.set(String(holon), hashes);
      if (changed.length) publish(changed);
    } catch (e) {
      console.warn('[holosphere] group state publish failed:', e?.message);
    }
  }

  async function refresh(holon) {
    const list = new Set([holonPubkey]);
    const hs = projectionHost.instance;
    if (!hs || typeof hs.getAll !== 'function') return [...list];
    const memberIds = [];
    if (secret) {
      let users = [];
      try {
        users = (await hs.getAll(String(holon), 'users')) || [];
      } catch {
        users = [];
      }
      const derived = new Set();
      for (const u of users) {
        if (!u || u.id === undefined || u.id === null) continue;
        memberIds.push(u.id);
        try {
          const pk = deriveTelegramNostrKey(u.id, secret).publicKey;
          byPubkey.set(pk, u.id);
          list.add(pk);
          derived.add(pk);
        } catch {
          /* skip */
        }
      }
      // Linked keys, second pass: a derived key always outranks a link, and a
      // key two members both claim stays with whoever mapped it first
      // (mirrors the read-side attestation guard — never remapped).
      for (const u of users) {
        if (!u || u.id === undefined || u.id === null) continue;
        let personal = null;
        try {
          personal = await hs.get(String(u.id), 'users', String(u.id));
        } catch {
          /* no personal record */
        }
        for (const pk of new Set([
          ...linkedKeysOf(u),
          ...linkedKeysOf(personal),
        ])) {
          if (derived.has(pk)) continue;
          const owner = byPubkey.get(pk);
          if (owner !== undefined && String(owner) !== String(u.id)) continue;
          byPubkey.set(pk, u.id);
          list.add(pk);
        }
      }
    } else if (!warned) {
      warned = true;
      console.warn(
        '[holosphere] NOSTR_DERIVATION_SECRET unset — reverse sync trusts the holon key only (no member RSVPs / profiles)'
      );
    }
    let settings = null;
    try {
      settings = await hs.get(String(holon), 'settings', String(holon));
      for (const k of Array.isArray(settings?.nostrTrustedPubkeys)
        ? settings.nostrTrustedPubkeys
        : [])
        if (typeof k === 'string' && /^[0-9a-f]{64}$/i.test(k))
          list.add(k.toLowerCase());
    } catch {
      /* no settings yet */
    }
    publishGroupState(holon, settings, memberIds);
    syncMembership(holon, settings, list);
    return [...list];
  }

  /**
   * The same roster, signed: the holon key founds its `_members` log once
   * and keeps it in line with the keys trusted here (members; the admin's
   * key as admin). This is what turns "who is in the users lens" into a
   * signed, as-of-time fact every reader folds the same way (see
   * @holons/core/protocol membership). Readers without the derivation
   * secret pin the trust anchor from `settings.holonPubkey`, written once.
   * Fire-and-forget; a failed sync is retried on the next refresh.
   */
  function syncMembership(holon, settings, keys) {
    const hs = projectionHost.instance;
    if (!secret || !hs || !hs.signingEnabled) return;
    const desired = new Map();
    for (const k of keys) if (k !== holonPubkey) desired.set(k, 'member');
    const adminId =
      settings?.admin != null ? String(settings.admin).trim() : '';
    if (adminId) {
      try {
        desired.set(deriveTelegramNostrKey(adminId, secret).publicKey, 'admin');
      } catch {
        /* no admin key */
      }
    }
    syncMembersLog(hs, String(holon), desired)
      .then(r => {
        if (r.founded)
          console.log(
            `[holosphere] founded ${holon}: membership log signed by the holon key`
          );
      })
      .catch(e =>
        console.warn('[holosphere] membership sync failed:', e?.message)
      );
    grantPrivateLenses(hs, String(holon), [...desired.keys()]).catch(e =>
      console.warn('[holosphere] private lens grants failed:', e?.message)
    );
    if (settings && typeof settings === 'object' && !settings.holonPubkey) {
      hs.put(String(holon), 'settings', {
        ...settings,
        id: settings.id ?? String(holon),
        holonPubkey,
      }).catch(e =>
        console.warn(
          '[holosphere] could not record holonPubkey in settings:',
          e?.message
        )
      );
    }
  }

  /**
   * Members read a private lens of a group holon through their own keys:
   * the holon key owns the vault, so every private lens it holds is shared
   * with each member key that does not have it yet (see
   * @holons/core/privacy). Idempotent per process; a revoked member is
   * not re-granted here — revocation is the caretaker's call.
   */
  const grantedOnce = new Map(); // holon → Set<`${lens}|${pubkey}`>
  async function grantPrivateLenses(hs, holon, pubkeys) {
    if (!hs?.privacy) return;
    let snap;
    try {
      snap = await getPrivacySnapshot(hs, holon);
    } catch {
      return;
    }
    if (!snap.owned.length) return;
    let done = grantedOnce.get(holon);
    if (!done) grantedOnce.set(holon, (done = new Set()));
    for (const lens of snap.owned) {
      for (const pub of pubkeys) {
        const key = `${lens}|${pub}`;
        if (done.has(key) || snap.grants[pub]?.lenses?.includes(lens)) continue;
        done.add(key);
        try {
          await grantLens(hs, holon, lens, pub);
        } catch (e) {
          done.delete(key);
          console.warn(
            `[holosphere] could not share ${holon}/${lens} with ${pub.slice(0, 8)}:`,
            e?.message
          );
        }
      }
    }
  }

  return {
    async trustedAuthors(holon) {
      const cached = perHolon.get(String(holon));
      if (cached && Date.now() - cached.at < ttlMs) return cached.list;
      const list = await refresh(holon);
      perHolon.set(String(holon), { at: Date.now(), list });
      return list;
    },
    userIdFor: pubkey => byPubkey.get(pubkey),
  };
}

/** `7d`, `12h`, `30m`, `3600` (seconds) → seconds; undefined when unparsable. */
export function parseDuration(raw) {
  const m = /^\s*(\d+)\s*([smhd]?)\s*$/i.exec(String(raw ?? ''));
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2].toLowerCase()];
  return n > 0 ? n * unit : undefined;
}

/** The most recent instance, so timezoneFor can read settings without a cycle. */
const projectionHost = { instance: null, notifier: null };

/** Test seam: point the projection host at a fake instance. */
export function setProjectionHostForTests(instance) {
  projectionHost.instance = instance;
}

let linkedKeys = null;

/**
 * Drop the cached linked-key list for a member (or everyone) so the next
 * profile projection attests the new key set at once.
 * @param {string|number} [userId]
 */
export function invalidateLinkedKeys(userId) {
  linkedKeys?.invalidate(userId);
}

/**
 * Best-effort NIP-17 DM to a member's derived key (reminders, need events).
 * The member reads it in any Nostr client holding the key the web login
 * exposes. No relays / no secret / non-numeric id → silently skipped.
 *
 * @param {string|number} userId Telegram user id
 * @param {string} text
 * @param {string} [subject]
 * @returns {Promise<boolean>} whether a wrap was published
 */
export async function notifyNostr(userId, text, subject = 'Holons') {
  const hs = projectionHost.instance;
  const n = projectionHost.notifier;
  if (!hs || !n?.secret || typeof hs.publishNostrEvents !== 'function')
    return false;
  if (userId == null || !/^\d+$/.test(String(userId))) return false;
  if (typeof hs.nostrRelays === 'function' && !hs.nostrRelays().length)
    return false;
  try {
    const { publicKey } = deriveTelegramNostrKey(userId, n.secret);
    hs.publishNostrEvents(
      wrapDirectMessage(n.holonSk, publicKey, text, subject)
    );
    return true;
  } catch (e) {
    console.warn('[holosphere] nostr DM failed:', e?.message);
    return false;
  }
}

/**
 * Creates a KeyManager instance for per-holon key management.
 *
 * The KeyManager assigns each Telegram holon its own unique keypair,
 * enabling cross-author federation between chats using capability tokens.
 *
 * @param {string} [appName] - Application name (defaults to env HOLONS_APP or 'Holons')
 * @param {Object} [options] - Configuration options
 * @param {string} [options.privateKey] - Override master private key
 * @param {string[]} [options.relays] - Override relay list
 * @param {string} [options.logLevel] - Log level (default: 'INFO')
 * @returns {KeyManager} Configured KeyManager instance
 *
 * @example
 * import { createKeyManager } from './createHoloSphere.js';
 * const keyManager = createKeyManager('MyApp');
 *
 * // Get HoloSphere for a specific holon (creates key if needed)
 * const holosphere = await keyManager.getHolosphere(chatId);
 *
 * // Federate two holons
 * await keyManager.federateHolons(chatA, chatB, 'quests');
 */
export function createKeyManager(appName, options = {}) {
  const resolvedAppName =
    appName || process.env.HOLONS_APP || process.env.APPNAME || 'Holons';

  // Create master HoloSphere (bot's identity)
  const masterHolosphere = createHoloSphere(resolvedAppName, options);

  // Add self-reference for backward compatibility
  masterHolosphere.holosphere = masterHolosphere;

  // Create KeyManager with master holosphere
  const keyManager = new KeyManager(resolvedAppName, masterHolosphere, {
    relays: resolveRelays(options.relays || process.env.HOLOSPHERE_RELAYS),
    logLevel: options.logLevel || 'INFO',
  });

  return keyManager;
}

// (There used to be a `export { createHologram } from 'holosphere'` here.
// `createHologram` is an INSTANCE METHOD on HoloSphere, never a module export,
// so that line made this file unimportable by any real ESM loader — it only
// survived because tsx transpiles to CJS, where a missing named export is
// undefined at runtime instead of a link error. Nothing imported it.)
