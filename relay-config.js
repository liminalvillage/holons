/**
 * Nostr Relay Configuration for HoloSphere
 *
 * This configuration file defines which Nostr relays to use for synchronization.
 *
 * IMPORTANT: To sync quests across different nodes, you MUST use real relay URLs.
 * Using an empty array (relays: []) will only store data locally.
 */

export const RELAY_CONFIG = {
  // Production relays - Use these for real network synchronization
  // Based on your relay list with good connectivity and event support
  production: [
    'wss://nos.lol',                    // 128 events, connected
    'wss://at.nostrworks.com',          // 100 events, connected
    'wss://btc.klendazu.com',           // 100 events, connected
    'wss://nostr.wine',                 // 0 events, connected
    'wss://lightningrelay.com',         // 0 events, connected
    'wss://knostr.neutrine.com',        // 0 events, connected
    'wss://nostr-1.nbo.angani.co',      // connected
  ],

  // Development relays - Use for testing (most active relays)
  development: [
    'wss://nos.lol',
    'wss://at.nostrworks.com',
    'wss://btc.klendazu.com',
  ],

  // Local only - No network sync (for offline testing)
  local: [],
};

/**
 * Get relay configuration based on environment
 * @param {string} env - Environment: 'production', 'development', or 'local'
 * @returns {string[]} Array of relay URLs
 */
export function getRelays(env = 'production') {
  return RELAY_CONFIG[env] || RELAY_CONFIG.production;
}

/**
 * Example usage:
 *
 * import { HoloSphere } from './dist/esm/holosphere.js';
 * import { getRelays } from './relay-config.js';
 *
 * // For network synchronization (RECOMMENDED)
 * const hs = new HoloSphere({
 *   appName: 'my-quest-game',
 *   relays: getRelays('production')
 * });
 *
 * // For local testing only (NO SYNC)
 * const hsLocal = new HoloSphere({
 *   appName: 'my-quest-game',
 *   relays: getRelays('local')
 * });
 */
