/**
 * @fileoverview Factory function to create and configure HoloSphere instance.
 * @module src/createHoloSphere
 */
import { HoloSphere } from 'holosphere';
import { getOrCreateKey } from '../utils/key-storage.js';
import { generateSecretKey } from 'nostr-tools';

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

// Re-export createHologram for convenience
export { createHologram } from 'holosphere';
