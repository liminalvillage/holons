/**
 * Simple Key Storage for Node.js
 * Basic filesystem-based key management
 *
 * NOTE: This only works in Node.js, not browsers
 * For browsers, keys are managed in localStorage
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Get key storage directory
 */
function getKeyDir() {
  const configDir = process.env.XDG_CONFIG_HOME ||
    (process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
      : path.join(os.homedir(), '.config'));

  return path.join(configDir, 'holosphere', 'keys');
}

/**
 * Get key file path for an app
 */
function getKeyPath(appName) {
  const safeName = appName.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(getKeyDir(), `${safeName}.key`);
}

/**
 * Load private key
 */
export function loadKey(appName) {
  const keyPath = getKeyPath(appName);
  if (fs.existsSync(keyPath)) {
    const key = fs.readFileSync(keyPath, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(key)) {
      return key;
    }
  }
  return null;
}

/**
 * Save private key
 */
export function saveKey(appName, privateKey) {
  if (!/^[0-9a-f]{64}$/i.test(privateKey)) {
    throw new Error('Invalid private key format');
  }

  const keyPath = getKeyPath(appName);
  const dir = path.dirname(keyPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  return keyPath;
}

/**
 * Get or create key
 */
export function getOrCreateKey(appName, generateFn) {
  const existing = loadKey(appName);
  if (existing) return existing;

  const newKey = generateFn();
  saveKey(appName, newKey);
  return newKey;
}

// ============================================
// Per-Holon Key Management
// ============================================

/**
 * Get key storage directory for a specific holon
 * @param {string} appName - Application name
 * @returns {string} Path to holon keys directory
 */
function getHolonKeyDir(appName) {
  const safeName = appName.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(getKeyDir(), safeName, 'holons');
}

/**
 * Get key file path for a specific holon
 * @param {string} appName - Application name
 * @param {string} holonId - Holon identifier (e.g., Telegram chat ID)
 * @returns {string} Path to holon key file
 */
function getHolonKeyPath(appName, holonId) {
  // Sanitize holonId (can be negative for Telegram groups)
  const safeHolonId = String(holonId).replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(getHolonKeyDir(appName), `${safeHolonId}.key`);
}

/**
 * Load private key for a specific holon
 * @param {string} appName - Application name
 * @param {string} holonId - Holon identifier
 * @returns {string|null} Private key or null if not found
 */
export function loadHolonKey(appName, holonId) {
  const keyPath = getHolonKeyPath(appName, holonId);
  if (fs.existsSync(keyPath)) {
    const key = fs.readFileSync(keyPath, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(key)) {
      return key;
    }
  }
  return null;
}

/**
 * Save private key for a specific holon
 * @param {string} appName - Application name
 * @param {string} holonId - Holon identifier
 * @param {string} privateKey - 64-char hex private key
 * @returns {string} Path where key was saved
 */
export function saveHolonKey(appName, holonId, privateKey) {
  if (!/^[0-9a-f]{64}$/i.test(privateKey)) {
    throw new Error('Invalid private key format');
  }

  const keyPath = getHolonKeyPath(appName, holonId);
  const dir = path.dirname(keyPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  return keyPath;
}

/**
 * Get or create key for a specific holon
 * @param {string} appName - Application name
 * @param {string} holonId - Holon identifier
 * @param {Function} generateFn - Function to generate new key
 * @returns {string} Private key (existing or newly generated)
 */
export function getOrCreateHolonKey(appName, holonId, generateFn) {
  const existing = loadHolonKey(appName, holonId);
  if (existing) return existing;

  const newKey = generateFn();
  saveHolonKey(appName, holonId, newKey);
  return newKey;
}

/**
 * List all holon IDs that have stored keys
 * @param {string} appName - Application name
 * @returns {string[]} Array of holon IDs
 */
export function listHolonKeys(appName) {
  const dir = getHolonKeyDir(appName);

  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.key'))
    .map(file => file.replace('.key', ''));
}

/**
 * Delete a holon's private key
 * @param {string} appName - Application name
 * @param {string} holonId - Holon identifier
 * @returns {boolean} True if key was deleted, false if not found
 */
export function deleteHolonKey(appName, holonId) {
  const keyPath = getHolonKeyPath(appName, holonId);

  if (fs.existsSync(keyPath)) {
    fs.unlinkSync(keyPath);
    return true;
  }

  return false;
}
