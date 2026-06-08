// Read-only: inspect the global registry tables the web's GlobalHolons view uses.
//   cd packages/mcp-ui && HOLONS_APP=Holons node ../../scripts/check-global-registry.mjs

const APP = process.env.HOLONS_APP || 'HolonsDebug';
const PEER = process.env.HOLONS_PEER || 'https://gun.holons.io/gun';

const mod = await import('holosphere');
const HoloSphere = mod.HoloSphere || mod.default;
const hs = new HoloSphere(APP, false, null, { peers: [PEER] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2000); // let the peer connection settle

async function count(table) {
  try {
    const data = await hs.getAllGlobal(table);
    if (!data) return { table, type: 'null', n: 0 };
    if (Array.isArray(data)) return { table, type: 'array', n: data.length, sample: data.slice(0, 3) };
    const keys = Object.keys(data).filter((k) => k !== '_' && k !== '#');
    return { table, type: 'object', n: keys.length, sample: keys.slice(0, 5) };
  } catch (e) {
    return { table, type: 'error', err: e?.message || String(e) };
  }
}

for (const t of ['holons_registry', 'communities']) {
  console.log(JSON.stringify(await count(t)));
}
process.exit(0);
