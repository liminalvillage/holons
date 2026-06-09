// Enumerate raw keys under <holon>/<lens> and flag dangling holograms
// (raw node present but resolves to null). Read-only unless DELETE=1.
//
// Must run from a package that depends on holosphere, e.g.:
//   cd packages/mcp-ui && HOLONS_APP=Holons node ../../scripts/find-dangling-holograms.mjs demo123 quests
//   ... add DELETE=1 to tombstone the dangling keys it finds.
//
// Reliability: GUN cold reads are flaky. We use a persistent radisk cache, warm
// the node with getAll() before enumerating, and REFUSE to act if the raw read
// comes back empty (treated as a cold miss, not "clean").

const APP = process.env.HOLONS_APP || 'HolonsDebug';
const PEER = process.env.HOLONS_PEER || 'https://gun.holons.io/gun';
const HOLON = process.argv[2] || 'demo123';
const LENS = process.argv[3] || 'quests';
const WARMUP_MS = Number(process.env.WARMUP_MS || 6000);
const SETTLE_MS = Number(process.env.SETTLE_MS || 6000);

// Resolve `holosphere` from the CWD (scripts/ has no node_modules of its own);
// run from a package that depends on it, e.g. packages/telegram-ui.
const { createRequire } = await import('module');
const { pathToFileURL } = await import('url');
const requireFromCwd = createRequire(pathToFileURL(`${process.cwd()}/`));
const mod = await import(pathToFileURL(requireFromCwd.resolve('holosphere')).href);
const HoloSphere = mod.HoloSphere || mod.default;
// Persistent cache (in /tmp, outside the repo) so repeated runs warm up.
const hs = new HoloSphere(APP, false, null, {
  peers: [PEER],
  radisk: true,
  file: `/tmp/holons-dangle-cache/${APP}`,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Warm the node: getAll subscribes + pulls the lens so the raw map sees keys.
try { await hs.getAll(HOLON, LENS); } catch { /* best-effort warmup */ }
await sleep(WARMUP_MS);

// 1. Raw-enumerate every key in <holon>/<lens> (incl. unresolvable ones).
const rawKeys = new Map();
await new Promise((resolve) => {
  let timer;
  const reset = () => { clearTimeout(timer); timer = setTimeout(resolve, SETTLE_MS); };
  reset();
  hs.gun.get(APP).get(HOLON).get(LENS).map().once((data, key) => {
    // Skip GUN metadata keys (`_` node meta, `#` soul-reference marker).
    if (key && key !== '_' && key !== '#') { rawKeys.set(key, data); reset(); }
  });
});

console.log(`\nRaw keys under ${APP}/${HOLON}/${LENS}: ${rawKeys.size}`);
if (rawKeys.size === 0) {
  console.log('COLD READ — 0 keys returned; treating as inconclusive, NOT acting.');
  process.exit(2);
}

// 2. Classify each key.
const dangling = [];
const tombstones = [];
const resolved = [];
for (const [key, raw] of rawKeys) {
  if (raw == null) { tombstones.push(key); continue; }
  const soul = typeof raw === 'object' ? raw.soul : undefined;
  let value = null;
  try { value = await hs.get(HOLON, LENS, key); } catch { value = null; }
  if (value == null) dangling.push({ key, soul: soul ?? '(no top-level soul on raw node)' });
  else resolved.push(key);
}

console.log(`Resolved OK : ${resolved.length}`);
console.log(`Tombstones  : ${tombstones.length}`);
console.log(`DANGLING    : ${dangling.length}`);
if (dangling.length) {
  console.log('\n--- dangling (raw node present, resolves to null) ---');
  for (const d of dangling) console.log(`  ${d.key}  ->  ${d.soul}`);
}

// Opt-in delete: tombstone each dangling key so the janitor can GC any forwards.
// Don't re-get a just-deleted key — the network-aware resolver blocks on it.
if (process.env.DELETE === '1' && dangling.length) {
  console.log(`\nDELETE=1 → tombstoning ${dangling.length} dangling node(s) …`);
  for (const d of dangling) {
    try { await hs.delete(HOLON, LENS, d.key); console.log(`  deleted ${d.key} ✓`); }
    catch (err) { console.log(`  FAILED ${d.key}: ${err?.message || err}`); }
  }
  await sleep(3000); // flush tombstones to the relay before exit
}
process.exit(0);
