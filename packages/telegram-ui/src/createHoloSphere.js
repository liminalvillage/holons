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
import { generateSecretKey } from 'nostr-tools';
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

  const instance = coreCreateHoloSphere({
    appName: resolvedAppName,
    privateKey,
    backend: resolvedBackend,
    logLevel: logLevel || 'INFO',
    extra: {
      ...(relayIsWire ? { nostr: { relays } } : {}),
      ...extra,
    },
  });

  // Callers depend on this factory staying synchronous, so the backup is armed
  // in the background: writes in the first moments after startup may land on
  // Gun before the publisher is up. A no-op unless HOLOSPHERE_SIGNING is set.
  enableRelayBackup(instance, {
    relays,
    mode: parseRelayBackupMode(process.env.HOLOSPHERE_SIGNING),
    backend: resolvedBackend,
  }).then(on => {
    if (on) console.log(`[holosphere] relay backup on → ${relays.join(', ')}`);
  });

  return instance;
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
