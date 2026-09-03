// Namespace + relays are resolved LAZILY (on first getHoloSphere/getApp call),
// never at module load. ES module imports are hoisted, so this module is
// evaluated before src/index.ts runs its dotenv loader — reading these at the
// top level would miss the monorepo root .env entirely and always fall back to
// 'HolonsDebug'. Resolving on demand makes the root .env the single source of
// truth (HOLONS_APP / HOLOSPHERE_RELAYS, with the legacy APPNAME as a
// fallback), matching how the bot and web read it.
import { createHoloSphere, resolveRelays } from '@holons/core/holosphere';
import { projectionOptionsFor } from '@holons/core/nostr';
import { randomBytes } from 'node:crypto';

function resolveApp(): string {
  return process.env.HOLONS_APP || process.env.APPNAME || 'HolonsDebug';
}

let hs: any;
// The app the live instance was built with — frozen at construction so getApp()
// always agrees with the connected store even if env changes afterwards.
let resolvedApp: string | undefined;

/**
 * The relays are the wire: every read syncs the touched (holon, lens) from
 * HOLOSPHERE_RELAYS (default: the production relays) into a local store, and
 * every write is published back as a signed kind-30078 event.
 *
 * The store is in memory by default (a fresh sync per process — right for a
 * short-lived stdio server). Set HOLOSPHERE_STORE_DIR to a writable directory
 * to keep a warm file-backed store across restarts; a long-running SSE server
 * then only catches up from its cursor. Every write is signed and published;
 * there is no signing mode.
 */
export async function getHoloSphere(): Promise<any> {
  if (hs) return hs;
  resolvedApp = resolveApp();
  const dir = (process.env.HOLOSPHERE_STORE_DIR || '').trim();
  // HOLOSPHERE_PRIVATE_KEY signs every write; without it a throwaway key is
  // generated here (rather than inside holosphere) so the standard-kind
  // projections are addressed to the same pubkey.
  const privateKey =
    (process.env.HOLOSPHERE_PRIVATE_KEY || '').trim() || randomBytes(32).toString('hex');
  hs = await createHoloSphere({
    appName: resolvedApp,
    privateKey,
    relays: resolveRelays(process.env.HOLOSPHERE_RELAYS),
    store: dir ? { adapter: 'file', dir } : { adapter: 'memory' },
    // Standard-kind projections for every lens (HOLOSPHERE_PROJECTIONS=off opts out).
    nostr: projectionOptionsFor({ appName: resolvedApp, privateKey, lenses: process.env.HOLOSPHERE_PROJECTIONS }),
    awaitReady: true,
  });
  return hs;
}

export function getApp(): string {
  return resolvedApp ?? resolveApp();
}
