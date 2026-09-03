/**
 * Builds the bot's HoloSphere instance. Thin Node wrapper around
 * `@holons/core/holosphere` that resolves a persistent private key
 * (env -> stored -> generated), mirroring telegram-ui's `createHoloSphere.js`.
 */
import {
  createHoloSphere as coreCreateHoloSphere,
  parseSigningMode,
  resolveRelays,
  signingOptionsFor,
} from '@holons/core/holosphere';
import { generateSecretKey } from 'nostr-tools';
import { getOrCreateKey } from './utils/keyStorage.js';

function generatePrivateKey(): string {
  return Buffer.from(generateSecretKey()).toString('hex');
}

export interface CreateHoloSphereOptions {
  privateKey?: string;
  relays?: string[];
  logLevel?: string;
}

/**
 * Create a configured HoloSphere instance.
 *
 * The relays are the wire (HOLOSPHERE_RELAYS, default: the production
 * relays); every touched (holon, lens) is mirrored into a file-backed store
 * under HOLOSPHERE_STORE_DIR (default `./holosphere-store`).
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
    relays: resolveRelays(options.relays || process.env.HOLOSPHERE_RELAYS),
    store: {
      adapter: 'file',
      dir: process.env.HOLOSPHERE_STORE_DIR || './holosphere-store',
    },
    signing: signingOptionsFor(
      parseSigningMode(process.env.HOLOSPHERE_SIGNING)
    ),
    extra: { logLevel: options.logLevel || 'INFO' },
  });
}

export default createHoloSphere;
