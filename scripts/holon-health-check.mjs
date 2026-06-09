// Holon health check — find and (optionally) remove BROKEN hologram nodes.
//
// THE PROBLEM
// Federation/reflect propagation can leave a quest key whose stored value is a
// hologram pointing at ITS OWN path:
//   {"id":"mp57ko2xf4u","soul":"Holons/-1001652773351/quests/mp57ko2xf4u",...}
// The original record was deleted, but this self-pointer survived. It can never
// resolve — every lens enumeration (e.g. the maxTasks count on task creation,
// Quests.ts) walks it, the resolver detects the loop, logs
//   !!! CIRCULAR hologram detected … Breaking loop
// and skips it. Pure noise that recurs forever until the node is tombstoned.
// A join also mirrors such a quest into the joiner's personal holon, so the
// dead pointer shows up there too (a "dead mirror").
//
// WHY THIS IS SAFE WHERE A BLANKET "dangling" SWEEP IS NOT
// A cold peer misclassifies real, un-synced records as "dangling" (resolves to
// null right now) — deleting those destroys live data. This check NEVER uses
// "resolves to null" as the signal. It removes a node ONLY when its stored
// `soul` is provably circular:
//   • SELF_REF   — soul === the node's own canonical path.
//   • DEAD_MIRROR — soul points at a node that is itself SELF_REF.
// Both are deterministic from the stored bytes, independent of sync state, so a
// completed quest that simply hasn't synced is never a candidate.
//
// HOW TO RUN  (best on the bot host: warm radisk + the tombstone propagates)
//   cd packages/telegram-ui            # any package that depends on holosphere
//   # one or more holons, comma-separated; lens defaults to `quests`.
//   HOLONS_APP=Holons node ../../scripts/holon-health-check.mjs -1001652773351,235114395
//   # then, to actually tombstone what it found:
//   HOLONS_APP=Holons WRITE=1 node ../../scripts/holon-health-check.mjs -1001652773351,235114395
//   # other lens:  LENS=library …
//
// DRY RUN by default. Idempotent. Re-verifies each node is still broken
// immediately before deleting.

const HOLON_ARG = process.argv[2];
if (!HOLON_ARG) {
  console.error('usage: node holon-health-check.mjs <holonId[,holonId2,...]>   (env: HOLONS_APP, HOLONS_PEER, LENS, WRITE=1)');
  process.exit(64);
}
const HOLONS = HOLON_ARG.split(',').map((s) => s.trim()).filter(Boolean);
const APP = process.env.HOLONS_APP || 'Holons';
const PEER = process.env.HOLONS_PEER || 'https://gun.holons.io/gun';
const LENS = process.env.LENS || 'quests';
const WRITE = process.env.WRITE === '1';
const WARMUP_MS = Number(process.env.WARMUP_MS || 8000);
const SETTLE_MS = Number(process.env.SETTLE_MS || 6000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve `holosphere` from the cwd (scripts/ has no node_modules of its own).
const { createRequire } = await import('module');
const { pathToFileURL } = await import('url');
const requireFromCwd = createRequire(pathToFileURL(`${process.cwd()}/`));
const mod = await import(pathToFileURL(requireFromCwd.resolve('holosphere')).href);
const HoloSphere = mod.HoloSphere || mod.default;

const hs = new HoloSphere(APP, false, null, { peers: [PEER] });

console.log(`\n=== holon health check — ${APP} / [${HOLONS.join(', ')}] / ${LENS} ===`);
console.log(`peer=${PEER}  mode=${WRITE ? 'WRITE (will tombstone)' : 'DRY RUN'}\n`);

/** Canonical soul path for a node: `<APP>/<holon>/<lens>/<key>`. */
const canonicalSoul = (holon, key) => `${APP}/${holon}/${LENS}/${key}`;

/** Parse a raw GUN value (JSON string or object) into a plain object, or null. */
function parseRaw(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

/** Read one raw node directly (no hologram resolution), waiting for the relay. */
async function readRaw(holon, key) {
  return new Promise((resolve) => {
    let v;
    hs.gun.get(APP).get(holon).get(LENS).get(key).once((d) => { v = d; });
    setTimeout(() => resolve(parseRaw(v)), 3500);
  });
}

/** Enumerate every key under a holon's lens (raw, incl. unresolvable). */
async function enumerate(holon) {
  const keys = new Map(); // key -> parsed raw
  await new Promise((resolve) => {
    let timer;
    const reset = () => { clearTimeout(timer); timer = setTimeout(resolve, SETTLE_MS); };
    reset();
    hs.gun.get(APP).get(holon).get(LENS).map().once((data, key) => {
      if (key && key !== '_' && key !== '#') { keys.set(key, parseRaw(data)); reset(); }
    });
  });
  return keys;
}

// ── Warm, then enumerate every holon's lens ──────────────────────────────────
console.log(`Warming (${WARMUP_MS}ms) …`);
for (const holon of HOLONS) hs.gun.get(APP).get(holon).get(LENS).map().once(() => {});
await sleep(WARMUP_MS);

const lensKeys = new Map(); // holon -> Map(key -> parsed)
let totalKeys = 0;
for (const holon of HOLONS) {
  const keys = await enumerate(holon);
  lensKeys.set(holon, keys);
  totalKeys += keys.size;
  console.log(`  ${holon}/${LENS}: ${keys.size} raw key(s)`);
}
if (totalKeys === 0) {
  console.log('\nCOLD READ — 0 keys across all holons. Radisk not warm; refusing to act.');
  process.exit(2);
}

// ── Pass 1: self-referential holograms (soul === own path) ───────────────────
const selfRefSouls = new Set();
const broken = []; // { holon, key, class, soul }
for (const [holon, keys] of lensKeys) {
  for (const [key, parsed] of keys) {
    const soul = parsed && typeof parsed.soul === 'string' ? parsed.soul : null;
    if (!soul) continue;
    const own = canonicalSoul(holon, parsed.id ?? key);
    if (soul === own) {
      selfRefSouls.add(soul);
      broken.push({ holon, key, cls: 'SELF_REF', soul });
    }
  }
}

// ── Pass 2: dead mirrors (soul points at a known self-referential node) ──────
for (const [holon, keys] of lensKeys) {
  for (const [key, parsed] of keys) {
    const soul = parsed && typeof parsed.soul === 'string' ? parsed.soul : null;
    if (!soul) continue;
    if (broken.some((b) => b.holon === holon && b.key === key)) continue; // already SELF_REF
    if (selfRefSouls.has(soul)) {
      broken.push({ holon, key, cls: 'DEAD_MIRROR', soul });
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\nScanned ${totalKeys} node(s). Broken (provably circular): ${broken.length}`);
for (const b of broken) {
  console.log(`  [${b.cls}] ${b.holon}/${LENS}/${b.key}  →  soul=${b.soul}`);
}
if (broken.length === 0) {
  console.log('\nHealthy — no self-referential or dead-mirror holograms. Nothing to do.');
  process.exit(0);
}

if (!WRITE) {
  console.log(`\nDRY RUN — nothing deleted. Re-run with WRITE=1 to tombstone the ${broken.length} node(s) above.`);
  await sleep(500);
  process.exit(0);
}

// ── Delete (re-verify each node is STILL broken right before tombstoning) ────
console.log(`\nWRITE=1 → tombstoning ${broken.length} node(s) …`);
let ok = 0, skipped = 0, failed = 0;
for (const b of broken) {
  const fresh = await readRaw(b.holon, b.key);
  const soul = fresh && typeof fresh.soul === 'string' ? fresh.soul : null;
  const stillBroken =
    soul && (soul === canonicalSoul(b.holon, fresh.id ?? b.key) || selfRefSouls.has(soul));
  if (!stillBroken) {
    skipped++;
    console.log(`  ~ skip ${b.holon}/${b.key} — no longer self-referential (soul=${soul ?? 'none'})`);
    continue;
  }
  try {
    await hs.delete(b.holon, LENS, b.key);
    ok++;
    console.log(`  ✓ tombstoned ${b.holon}/${LENS}/${b.key}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ FAILED ${b.holon}/${b.key}: ${err?.message || err}`);
  }
}
console.log(`\nDone. tombstoned=${ok} skipped=${skipped} failed=${failed}`);
await sleep(3000); // flush tombstones to the relay before exit
process.exit(failed ? 1 : 0);
