/**
 * @fileoverview Factory functions for HoloSphere and KeyManager instances.
 *
 * The HoloSphere instance is now built by `@holons/core/holosphere`; this
 * file is a thin Node wrapper that resolves a private key (env / file /
 * generate) and wires the bot-only KeyManager.
 *
 * @module src/createHoloSphere
 */
import { createHoloSphere as coreCreateHoloSphere } from '@holons/core/holosphere';
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
 * @param {string} [appName] - Application name (defaults to env APPNAME or 'Holons')
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
    const resolvedAppName = appName || process.env.APPNAME || 'Holons';
    const { privateKey: pkOverride, backend, logLevel, relays: _ignoredRelays, ...extra } = options;
    const privateKey = pkOverride
        || process.env.HOLOSPHERE_PRIVATE_KEY
        || getOrCreateKey(resolvedAppName, generatePrivateKey);

    // NOTE: `relays` here is intentionally NOT forwarded — holosphere 1.3
    // ignores top-level `relays` and only consumes `nostr.relays`. The bot
    // historically passed it as a hint and ran on Gun's default peer; pass
    // `extra: { nostr: { relays: [...] } }` if/when migrating to nostr.
    return coreCreateHoloSphere({
        appName: resolvedAppName,
        privateKey,
        backend: backend || 'nostr',
        logLevel: logLevel || 'INFO',
        extra,
    });
}

/**
 * Creates a KeyManager instance for per-holon key management.
 *
 * The KeyManager assigns each Telegram holon its own unique keypair,
 * enabling cross-author federation between chats using capability tokens.
 *
 * @param {string} [appName] - Application name (defaults to env APPNAME or 'Holons')
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
    const resolvedAppName = appName || process.env.APPNAME || 'Holons';

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

// Re-export createHologram for convenience
export { createHologram } from 'holosphere';
