// Namespace + peer are resolved LAZILY (on first getHoloSphere/getApp call),
// never at module load. ES module imports are hoisted, so this module is
// evaluated before src/index.ts runs its dotenv loader — reading these at the
// top level would miss the monorepo root .env entirely and always fall back to
// 'HolonsDebug'. Resolving on demand makes the root .env the single source of
// truth (HOLONS_APP / HOLONS_PEER, with the legacy APPNAME as a fallback),
// matching how the bot and web read it.
function resolveApp(): string {
  return process.env.HOLONS_APP || process.env.APPNAME || 'HolonsDebug';
}

function resolvePeer(): string {
  return process.env.HOLONS_PEER || 'https://gun.holons.io/gun';
}

// Nostr backend opt-in: HOLOSPHERE_BACKEND=nostr + HOLOSPHERE_RELAYS=wss://…
// promotes the relay(s) to the wire (Gun runs peerless as the local cache —
// see packages/holosphere/relay-transport.js). Without both, the classic gun
// peer path below is used.
function resolveRelays(): string[] {
  return (process.env.HOLOSPHERE_RELAYS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
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
  }
  return hs;
}

export function getApp(): string {
  return resolvedApp ?? resolveApp();
}
