/**
 * @fileoverview KeyManager - Per-Holon Public Key Management
 *
 * Manages unique keypairs for each Telegram holon, enabling cross-author
 * federation between chats using the unified capability system.
 *
 * @module src/KeyManager
 */

import { HoloSphere } from 'holosphere';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  publishToFederation,
  removeFederationPartner,
  setFederationPartner,
} from '@holons/core/federation';
import { getOrCreateHolonKey, listHolonKeys } from '../utils/key-storage.js';

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
 * Get public key from private key (hex format)
 * @private
 * @param {string} privateKeyHex - Hex-encoded private key
 * @returns {string} Hex-encoded public key
 */
function getPublicKeyHex(privateKeyHex) {
  const privateKeyBytes = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));
  return getPublicKey(privateKeyBytes);
}

/**
 * KeyManager - Manages per-holon keypairs and HoloSphere instances
 *
 * Each Telegram chat (holon) gets its own unique keypair, allowing for
 * cross-author federation between chats using capability tokens.
 *
 * @class KeyManager
 */
class KeyManager {
  /**
   * Create a KeyManager instance
   * @param {string} appName - Application name for key storage
   * @param {HoloSphere} masterHolosphere - Master HoloSphere instance (bot's key)
   * @param {Object} options - Configuration options
   * @param {string[]} [options.relays] - Nostr relay URLs
   * @param {string} [options.logLevel] - Log level
   */
  constructor(appName, masterHolosphere, options = {}) {
    this.appName = appName;
    this.masterHolosphere = masterHolosphere;
    this.options = options;

    /** @type {Map<string, HoloSphere>} Cached HoloSphere instances per holon */
    this.holonInstances = new Map();

    /** @type {Map<string, string>} Cached public keys per holon (telegramId → pubkey) */
    this.publicKeyCache = new Map();

    /** @type {Map<string, string>} Reverse mapping cache (pubkey → telegramId) */
    this.telegramIdCache = new Map();

    /** @type {string} Global holon for registry storage */
    this.registryHolonId = 'global';

    /** @type {string} Lens name for key registry */
    this.registryLensName = 'keyRegistry';
  }

  /**
   * Get or create a HoloSphere instance for a specific holon
   * Each holon gets its own keypair for independent identity
   *
   * @param {string} holonId - Holon identifier (e.g., Telegram chat ID)
   * @returns {Promise<HoloSphere>} HoloSphere instance for the holon
   */
  async getHolosphere(holonId) {
    const holonIdStr = String(holonId);

    // Return cached instance if available
    if (this.holonInstances.has(holonIdStr)) {
      return this.holonInstances.get(holonIdStr);
    }

    // Get or create private key for this holon
    const privateKey = getOrCreateHolonKey(
      this.appName,
      holonIdStr,
      generatePrivateKey
    );

    // Create HoloSphere instance with holon's key. Per-holon signers share
    // the master's relays; their store stays in memory (the master holds
    // the warm file store — this one only needs to sign and publish).
    const holosphere = new HoloSphere({
      appName: this.appName,
      privateKey: privateKey,
      relays: this.options.relays || ['wss://relay.holons.io/'],
      store: { adapter: 'memory' },
      logLevel: this.options.logLevel || 'INFO',
    });

    // Add self-reference for backward compatibility
    holosphere.holosphere = holosphere;

    // Cache the instance
    this.holonInstances.set(holonIdStr, holosphere);

    // Cache the public key (bidirectional)
    const publicKey = getPublicKeyHex(privateKey);
    this.publicKeyCache.set(holonIdStr, publicKey);
    this.telegramIdCache.set(publicKey, holonIdStr);

    // Register holon -> pubkey mapping (for auto-capability resolution)
    // This enables read() to find data written by this holon's key
    this.masterHolosphere.registerHolon(holonIdStr, publicKey).catch(err => {
      console.warn(
        `[KeyManager] Failed to register holon ${holonIdStr}:`,
        err.message
      );
    });

    // Register in global key registry (async, don't await)
    this._updateRegistry(holonIdStr, publicKey).catch(err => {
      console.warn(
        `[KeyManager] Failed to update registry for ${holonIdStr}:`,
        err.message
      );
    });

    return holosphere;
  }

  /**
   * Get the public key for a holon
   * @param {string} holonId - Holon identifier (can be Telegram ID or hex public key)
   * @returns {Promise<string>} Hex-encoded public key
   */
  async getPublicKey(holonId) {
    const holonIdStr = String(holonId);

    // If the input is already a 64-char hex string, it's likely a public key - return as-is
    if (/^[0-9a-f]{64}$/i.test(holonIdStr)) {
      return holonIdStr.toLowerCase();
    }

    // Return cached public key if available
    if (this.publicKeyCache.has(holonIdStr)) {
      return this.publicKeyCache.get(holonIdStr);
    }

    // Get or create key and derive public key
    const privateKey = getOrCreateHolonKey(
      this.appName,
      holonIdStr,
      generatePrivateKey
    );
    const publicKey = getPublicKeyHex(privateKey);

    // Cache it (bidirectional)
    this.publicKeyCache.set(holonIdStr, publicKey);
    this.telegramIdCache.set(publicKey, holonIdStr);

    return publicKey;
  }

  /**
   * Get the Telegram ID for a public key
   * Looks up the reverse mapping cache or registry
   *
   * @param {string} pubkey - Hex-encoded public key
   * @returns {Promise<string|null>} Telegram ID or null if not found
   */
  async getTelegramId(pubkey) {
    const pubkeyStr = String(pubkey).toLowerCase();

    // Check reverse cache first
    if (this.telegramIdCache.has(pubkeyStr)) {
      return this.telegramIdCache.get(pubkeyStr);
    }

    // Try to look up in the global registry
    try {
      const entries = await this.getAllRegistryEntries();
      for (const entry of entries) {
        if (entry.publicKey?.toLowerCase() === pubkeyStr) {
          // Cache it for next time
          this.telegramIdCache.set(pubkeyStr, entry.holonId);
          return entry.holonId;
        }
      }
    } catch (err) {
      console.warn(
        `[KeyManager] Failed to lookup telegramId for pubkey:`,
        err.message
      );
    }

    return null;
  }

  /**
   * Check if a string is a valid public key format (64 hex chars)
   * @param {string} str - String to check
   * @returns {boolean} True if valid pubkey format
   */
  isPubKey(str) {
    return /^[0-9a-f]{64}$/i.test(String(str));
  }

  /**
   * Normalize an identifier to a public key
   * If it's already a pubkey, returns as-is; otherwise resolves Telegram ID to pubkey
   *
   * @param {string} identifier - Telegram ID or public key
   * @returns {Promise<string>} Public key
   */
  async toPubKey(identifier) {
    const idStr = String(identifier);
    if (this.isPubKey(idStr)) {
      return idStr.toLowerCase();
    }
    return this.getPublicKey(idStr);
  }

  /**
   * Get the master HoloSphere's public key
   * @returns {string} Hex-encoded public key
   */
  getMasterPublicKey() {
    return this.masterHolosphere.client.publicKey;
  }

  /**
   * Get all registered holon IDs
   * @returns {string[]} Array of holon IDs
   */
  getRegisteredHolonIds() {
    return listHolonKeys(this.appName);
  }

  /**
   * Update the global key registry with a holon's public key
   * @private
   * @param {string} holonId - Holon identifier
   * @param {string} publicKey - Hex-encoded public key
   * @param {string} [alias] - Optional human-readable name
   * @returns {Promise<void>}
   */
  async _updateRegistry(holonId, publicKey, alias = null) {
    const registryEntry = {
      id: holonId,
      holonId: holonId,
      publicKey: publicKey,
      alias: alias,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Store in global registry using master holosphere
    await this.masterHolosphere.put(
      this.registryHolonId,
      this.registryLensName,
      registryEntry
    );
  }

  /**
   * Look up a holon's public key from the registry
   * @param {string} holonId - Holon identifier
   * @returns {Promise<Object|null>} Registry entry or null
   */
  async lookupRegistry(holonId) {
    const holonIdStr = String(holonId);

    try {
      const entry = await this.masterHolosphere.get(
        this.registryHolonId,
        this.registryLensName,
        holonIdStr
      );
      return entry;
    } catch (err) {
      return null;
    }
  }

  /**
   * Get all entries from the key registry
   * @returns {Promise<Object[]>} Array of registry entries
   */
  async getAllRegistryEntries() {
    try {
      const entries = await this.masterHolosphere.query(
        this.registryHolonId,
        this.registryLensName
      );
      return entries || [];
    } catch (err) {
      return [];
    }
  }

  /**
   * Propagate a lens's EXISTING items from one holon to another as hologram
   * references — the "copy existing data" step after a lens direction is
   * enabled. (New items flow live via the federation record; this backfills
   * what was already there.)
   *
   * Holograms here are an explicit opt-in: the caller confirmed the copy.
   *
   * NOTE: this used to call holosphere.federate() with object arguments that
   * didn't match its positional signature, silently writing a corrupt
   * federation node and propagating nothing. It now delegates to
   * `publishToFederation` from @holons/core/federation per item.
   *
   * @param {string} sourceHolonId - Holon (id or pubkey) whose items to copy
   * @param {string} targetHolonId - Holon (id or pubkey) receiving them
   * @param {string} lensName - Lens to propagate
   * @returns {Promise<{success: boolean, published: number, errors: string[]}>}
   */
  async federateHolons(sourceHolonId, targetHolonId, lensName) {
    const sourcePublicKey = await this.getPublicKey(sourceHolonId);
    const targetPublicKey = await this.getPublicKey(targetHolonId);
    if (
      String(sourceHolonId) === String(targetHolonId) ||
      sourcePublicKey === targetPublicKey
    ) {
      throw new Error('Cannot federate a holon with itself');
    }

    const source = String(sourceHolonId);
    const target = String(targetHolonId);
    const items = (await this.masterHolosphere.getAll(source, lensName)) || [];

    let published = 0;
    const errors = [];
    for (const item of items) {
      if (!item || item.id == null) continue;
      try {
        const outcome = await publishToFederation(
          {
            holosphere: this.masterHolosphere,
            holonId: source,
            lens: lensName,
            item,
          },
          { kind: 'partner', holonId: target },
          { useHolograms: true, includeSettingsHex: false }
        );
        published += outcome.publishedTo;
        errors.push(...outcome.errors);
      } catch (err) {
        errors.push(String(err?.message ?? err));
      }
    }
    return { success: errors.length === 0, published, errors };
  }

  /**
   * Setup federation relationship between two holons with lensConfig.
   *
   * Delegates to holosphere's native `federate()` API which writes the
   * canonical `{federated, inbound, outbound, lensConfig, partnerNames}`
   * shape and mirrors the relationship onto the partner with inverted
   * directions when bidirectional.
   *
   * @param {string} sourceHolonId - Source holon ID
   * @param {string} targetHolonId - Target holon ID
   * @param {Object} options - Federation options
   * @param {Object} [options.lensConfig] - Lens configuration {inbound: [], outbound: []}
   * @param {string} [options.partnerName] - Human-readable name for the partner
   * @returns {Promise<Object>} Federation result
   */
  async setupFederation(sourceHolonId, targetHolonId, options = {}) {
    const { lensConfig = { inbound: [], outbound: [] }, partnerName = null } =
      options;

    // Get public keys (used for capability-based access and self-federation check).
    const sourcePubKey = await this.getPublicKey(sourceHolonId);
    const targetPubKey = await this.getPublicKey(targetHolonId);

    if (sourcePubKey === targetPubKey) {
      throw new Error('Cannot federate a holon with itself');
    }

    const source = String(sourceHolonId);
    // PUBKEY-ONLY: store target pubkey, not telegram ID.
    const target = targetPubKey;

    // Delegate to the unified core write path (validation + federateHolon,
    // which records the link bidirectionally and stores the partner name).
    const success = await setFederationPartner(
      this.masterHolosphere,
      source,
      target,
      {
        inbound: Array.isArray(lensConfig.inbound) ? lensConfig.inbound : [],
        outbound: Array.isArray(lensConfig.outbound) ? lensConfig.outbound : [],
        ...(partnerName ? { partnerName } : {}),
      }
    );

    this.masterHolosphere.clearCache?.('federation');

    const federationData = await this.masterHolosphere.getGlobal(
      'federation',
      source
    );
    return { success, federationData };
  }

  /**
   * Remove entire federation relationship between two holons
   * Uses master holosphere for consistent metadata access
   *
   * @param {string} sourceHolonId - Source holon ID
   * @param {string} targetHolonId - Target holon ID
   * @returns {Promise<boolean>} Success indicator
   */
  async teardownFederation(sourceHolonId, targetHolonId) {
    const sourcePubKey = await this.getPublicKey(sourceHolonId);
    const targetPubKey = await this.getPublicKey(targetHolonId);

    if (sourcePubKey === targetPubKey) {
      return true;
    }

    const source = String(sourceHolonId);
    const target = targetPubKey;

    // Delegate to the unified core write path — handles federated/inbound/
    // outbound + lensConfig cleanup, and mirrors the removal onto the partner.
    const success = await removeFederationPartner(
      this.masterHolosphere,
      source,
      target
    );
    this.masterHolosphere.clearCache?.('federation');

    return success;
  }

  /**
   * Issue a capability from master key to a holon's key
   * This allows the bot to delegate write access to holon keys
   *
   * @param {string} holonId - Holon to delegate to
   * @param {Object} options - Delegation options
   * @param {string[]} [options.permissions=['read','write']] - Permissions to grant
   * @param {string} [options.lensName='*'] - Lens scope (wildcard for all)
   * @returns {Promise<string>} Issued capability token
   */
  async delegateAccessToHolon(holonId, options = {}) {
    const { permissions = ['read', 'write'], lensName = '*' } = options;

    const holonPublicKey = await this.getPublicKey(holonId);

    // Issue capability from master to holon
    const capability = await this.masterHolosphere.issueCapability(
      permissions,
      { holonId, lensName, dataId: '*' },
      holonPublicKey,
      { expiresIn: 365 * 24 * 60 * 60 * 1000 } // 1 year
    );

    return capability;
  }

  /**
   * Close all HoloSphere instances
   * Call this during graceful shutdown
   */
  async shutdown() {
    for (const [holonId, holosphere] of this.holonInstances) {
      try {
        if (holosphere.disconnect) {
          await holosphere.disconnect();
        }
      } catch (err) {
        console.warn(
          `[KeyManager] Error closing holosphere for ${holonId}:`,
          err.message
        );
      }
    }
    this.holonInstances.clear();
    this.publicKeyCache.clear();
    this.telegramIdCache.clear();
  }
}

export default KeyManager;
