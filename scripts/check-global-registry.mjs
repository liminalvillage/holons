// Read-only: inspect the global registry tables the web's GlobalHolons view uses.
//   cd packages/mcp-ui && HOLONS_APP=Holons node ../../scripts/check-global-registry.mjs

const APP = process.env.HOLONS_APP || 'HolonsDebug';
// Resolve core's built dist relative to THIS script, not the cwd: @holons/core
// is not linked into every workspace package.
const { resolveRelays } = await import(
  new URL('../packages/core/dist/holosphere/index.js', import.meta.url).href
);
const RELAYS = resolveRelays(process.env.HOLOSPHERE_RELAYS);

const mod = await import('holosphere');
const HoloSphere = mod.HoloSphere || mod.default;
// Read-only: an in-memory store synced from the relays for this process only.
const hs = new HoloSphere({ appName: APP, relays: RELAYS, store: { adapter: 'memory' } });
await hs.ready();

async function count(table) {
  try {
    const data = await hs.getAllGlobal(table);
    if (!data) return { table, type: 'null', n: 0 };
    if (Array.isArray(data)) return { table, type: 'array', n: data.length, sample: data.slice(0, 3) };
    const keys = Object.keys(data);
    return { table, type: 'object', n: keys.length, sample: keys.slice(0, 5) };
  } catch (e) {
    return { table, type: 'error', err: e?.message || String(e) };
  }
}

for (const t of ['holons_registry', 'communities']) {
  console.log(JSON.stringify(await count(t)));
}
await hs.close();
process.exit(0);
