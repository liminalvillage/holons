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
