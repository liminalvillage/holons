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
  enableRelayBackup,
  parseRelayBackupMode,
} from '@holons/core/holosphere';
import { getOrCreateKey } from '../utils/key-storage.js';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { cellToLatLng } from 'h3-js';
import {
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
 * Priority for private key:
 * 1) .env HOLOSPHERE_PRIVATE_KEY
 * 2) stored key from utils/key-storage
 * 3) generate new key
 *
 * @param {string} [appName] - Application name (defaults to env HOLONS_APP or 'Holons')
 * @param {Object} [options] - Additional HoloSphere configuration options
 * @param {string} [options.privateKey] - Override private key
 * @param {string[]} [options.relays] - Override relay list
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
    backend,
    logLevel,
    relays: relaysOption,
    ...extra
  } = options;
  const privateKey =
    pkOverride ||
    process.env.HOLOSPHERE_PRIVATE_KEY ||
    getOrCreateKey(resolvedAppName, generatePrivateKey);

  // Relays serve two DIFFERENT arrangements, picked by HOLOSPHERE_BACKEND:
  //
  //   HOLOSPHERE_BACKEND=nostr  → the relay is the WIRE. Gun runs peerless as
  //     a local cache, so the bot sees only what is on the relay — a full
  //     migration off gun.holons.io, not something to switch on casually.
  //
  //   anything else (default)   → Gun stays the wire and the relay is a
  //     BACKUP: with HOLOSPHERE_SIGNING=shadow every write is additionally
  //     published as a signed NIP-01 event. Nothing that works today changes.
  //
  // Either way needs HOLOSPHERE_RELAYS=wss://relay.holons.io[,wss://…] (or
  // options.relays). See packages/holosphere/relay-transport.js.
  const relays =
    Array.isArray(relaysOption) && relaysOption.length
      ? relaysOption
      : (process.env.HOLOSPHERE_RELAYS || '')
          .split(',')
          .map(r => r.trim())
          .filter(Boolean);
  const resolvedBackend =
    backend || process.env.HOLOSPHERE_BACKEND?.toLowerCase() || 'gun';
  const relayIsWire = resolvedBackend === 'nostr' && relays.length > 0;

  // Standard-kind projections (HOLOSPHERE_PROJECTIONS=off|all|quests,events,…):
  // every write on a listed lens is ALSO published as its standard Nostr kind
  // (NIP-52 / NIP-99 / kind 0 / NIP-51) so third-party clients can read it.
  // Opt-in and only meaningful with relays. See packages/holosphere/NOSTR-BACKEND.md.
  const projectionLenses = relays.length
    ? parseProjectionList(process.env.HOLOSPHERE_PROJECTIONS)
    : [];
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

  const instance = coreCreateHoloSphere({
    appName: resolvedAppName,
    privateKey,
    backend: resolvedBackend,
    logLevel: logLevel || 'INFO',
    extra: {
      ...(relayIsWire ? { nostr: { relays, ...projectionOptions } } : {}),
      ...extra,
    },
  });

  // Callers depend on this factory staying synchronous, so the backup is armed
  // in the background: writes in the first moments after startup may land on
  // Gun before the publisher is up. A no-op unless HOLOSPHERE_SIGNING is set.
  projectionHost.instance = instance;
  enableRelayBackup(instance, {
    relays,
    mode: parseRelayBackupMode(process.env.HOLOSPHERE_SIGNING),
    backend: resolvedBackend,
    ...projectionOptions,
  }).then(on => {
    if (on) console.log(`[holosphere] relay backup on → ${relays.join(', ')}`);
  });

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
 * lens, via NOSTR_DERIVATION_SECRET) and `settings.nostrTrustedPubkeys`.
 * Cached 5 minutes; the reverse sync asks on every accepted event, so a new
 * member is trusted within that window. Without the secret only the holon
 * key is trusted (RSVPs / kind 0 cannot be attributed to anyone).
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
      for (const u of users) {
        if (!u || u.id === undefined || u.id === null) continue;
        memberIds.push(u.id);
        try {
          const pk = deriveTelegramNostrKey(u.id, secret).publicKey;
          byPubkey.set(pk, u.id);
          list.add(pk);
        } catch {
          /* skip */
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
    return [...list];
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
    relays: options.relays || ['wss://relay.holons.io/'],
    logLevel: options.logLevel || 'INFO',
  });

  return keyManager;
}

// (There used to be a `export { createHologram } from 'holosphere'` here.
// `createHologram` is an INSTANCE METHOD on HoloSphere, never a module export,
// so that line made this file unimportable by any real ESM loader — it only
// survived because tsx transpiles to CJS, where a missing named export is
// undefined at runtime instead of a link error. Nothing imported it.)
