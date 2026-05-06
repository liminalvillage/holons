/**
 * Nostr Relay Configuration for HoloSphere
 *
 * This configuration file defines which Nostr relays to use for synchronization.
 *
 * IMPORTANT: To sync quests across different nodes, you MUST use real relay URLs.
 * Using an empty array (relays: []) will only store data locally.
 */

export const RELAY_CONFIG = {
  // Production relays - Using holons.io relay
  production: [
    'wss://relay.holons.io',          // Primary holons relay
  ],

  // Development relays - Using holons.io relay
  development: [
    'wss://relay.holons.io',          // Primary holons relay
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
