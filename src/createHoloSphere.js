/**
 * @fileoverview Factory functions for HoloSphere and KeyManager instances.
 * @module src/createHoloSphere
 */
import { HoloSphere } from 'holosphere';
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
    const privateKey = options.privateKey
        || process.env.HOLOSPHERE_PRIVATE_KEY
        || getOrCreateKey(resolvedAppName, generatePrivateKey);

    const holosphere = new HoloSphere({
        backend: 'nostr',
        appName: resolvedAppName,
        privateKey: privateKey,
        logLevel: options.logLevel || 'INFO',
        relays: options.relays || ['wss://relay.holons.io/'],
        ...options
    });

    return holosphere;
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
