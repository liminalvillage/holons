/**
 * Builds the bot's HoloSphere instance. Thin Node wrapper around
 * `@holons/core/holosphere` that resolves a persistent private key
 * (env -> stored -> generated), mirroring telegram-ui's `createHoloSphere.js`.
 */
import { createHoloSphere as coreCreateHoloSphere } from '@holons/core/holosphere';
import { generateSecretKey } from 'nostr-tools';
import { getOrCreateKey } from './utils/keyStorage.js';

function generatePrivateKey(): string {
  return Buffer.from(generateSecretKey()).toString('hex');
}

export interface CreateHoloSphereOptions {
  privateKey?: string;
  backend?: string;
  logLevel?: string;
}

/**
 * Create a configured HoloSphere instance.
 *
 * Private key priority:
 *   1. `options.privateKey`
 *   2. `process.env.HOLOSPHERE_PRIVATE_KEY`
 *   3. stored key (or a freshly generated + persisted one)
 */
export function createHoloSphere(
  appName = process.env.HOLONS_APP || process.env.APPNAME || 'Holons',
  options: CreateHoloSphereOptions = {}
) {
  const privateKey =
    options.privateKey ||
    process.env.HOLOSPHERE_PRIVATE_KEY ||
    getOrCreateKey(appName, generatePrivateKey);

  return coreCreateHoloSphere({
    appName,
    privateKey,
    backend: options.backend || 'nostr',
    logLevel: options.logLevel || 'INFO',
  });
}

export default createHoloSphere;
