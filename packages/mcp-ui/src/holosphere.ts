// Namespace + peer are resolved LAZILY (on first getHoloSphere/getApp call),
// never at module load. ES module imports are hoisted, so this module is
// evaluated before src/index.ts runs its dotenv loader — reading these at the
// top level would miss the monorepo root .env entirely and always fall back to
// 'HolonsDebug'. Resolving on demand makes the root .env the single source of
// truth (HOLONS_APP / HOLONS_PEER, with the legacy APPNAME as a fallback),
// matching how the bot and web read it.
import {
  enableRelayBackup,
  parseRelayBackupMode,
  parseRelayList,
} from '@holons/core/holosphere';

function resolveApp(): string {
  return process.env.HOLONS_APP || process.env.APPNAME || 'HolonsDebug';
}

function resolvePeer(): string {
  return process.env.HOLONS_PEER || 'https://gun.holons.io/gun';
}

// HOLOSPHERE_RELAYS=wss://… feeds either of two arrangements:
//   HOLOSPHERE_BACKEND=nostr  → the relay is the WIRE (Gun peerless as a local
//     cache — see packages/holosphere/relay-transport.js).
//   HOLOSPHERE_SIGNING=shadow → the gun peer stays the wire and the relay is a
//     BACKUP: writes are mirrored as signed NIP-01 events.
// Without either, the classic gun peer path below is used unchanged.
function resolveRelays(): string[] {
  return parseRelayList(process.env.HOLOSPHERE_RELAYS);
}

let hs: any;
// The app the live instance was built with — frozen at construction so getApp()
// always agrees with the connected graph even if env changes afterwards.
let resolvedApp: string | undefined;

export async function getHoloSphere(): Promise<any> {
  if (hs) return hs;
  resolvedApp = resolveApp();
  const mod: any = await import('holosphere');
  const HoloSphere = mod.HoloSphere || mod.default;
  const relays = resolveRelays();
  if ((process.env.HOLOSPHERE_BACKEND || '').toLowerCase() === 'nostr' && relays.length) {
    hs = new HoloSphere({
      appName: resolvedApp,
      backend: 'nostr',
      privateKey: process.env.HOLOSPHERE_PRIVATE_KEY || null,
      nostr: { relays },
    });
    await hs.ready();
  } else {
    hs = new HoloSphere(resolvedApp, false, null, { peers: [resolvePeer()] });
    await new Promise((r) => setTimeout(r, 1500));
    // This constructor takes no key, so signing has no identity of its own —
    // hand it HOLOSPHERE_PRIVATE_KEY explicitly. Without one the backup stays
    // off rather than publishing under a throwaway key nobody can verify.
    const key = process.env.HOLOSPHERE_PRIVATE_KEY;
    const mode = parseRelayBackupMode(process.env.HOLOSPHERE_SIGNING);
    if (mode !== 'off' && relays.length && !key) {
      console.error('[holosphere] HOLOSPHERE_SIGNING set but HOLOSPHERE_PRIVATE_KEY is missing — relay backup off');
    } else if (
      await enableRelayBackup(hs, { relays, mode, privateKey: key })
    ) {
      console.error(`[holosphere] relay backup on → ${relays.join(', ')}`);
    }
  }
  return hs;
}

export function getApp(): string {
  return resolvedApp ?? resolveApp();
}
