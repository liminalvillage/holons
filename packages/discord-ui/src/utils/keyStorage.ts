/**
 * Filesystem-based Nostr private-key storage (Node only). Ported from
 * telegram-ui's `utils/key-storage.js` so the Discord bot persists a stable
 * holosphere identity across restarts.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function getKeyDir(): string {
  const configDir =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === 'win32'
      ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : path.join(os.homedir(), '.config'));
  return path.join(configDir, 'holosphere', 'keys');
}

function getKeyPath(appName: string): string {
  const safeName = appName.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(getKeyDir(), `${safeName}.key`);
}

export function loadKey(appName: string): string | null {
  const keyPath = getKeyPath(appName);
  if (fs.existsSync(keyPath)) {
    const key = fs.readFileSync(keyPath, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(key)) return key;
  }
  return null;
}

export function saveKey(appName: string, privateKey: string): string {
  if (!/^[0-9a-f]{64}$/i.test(privateKey)) {
    throw new Error('Invalid private key format');
  }
  const keyPath = getKeyPath(appName);
  const dir = path.dirname(keyPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  return keyPath;
}

export function getOrCreateKey(
  appName: string,
  generateFn: () => string
): string {
  const existing = loadKey(appName);
  if (existing) return existing;
  const newKey = generateFn();
  saveKey(appName, newKey);
  return newKey;
}
