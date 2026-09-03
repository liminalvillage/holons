// Read-only scan of a holon's `quests` lens: report the distinct `category`
// strings in use, grouped by their normalised (trim + lowercase) form, so
// near-duplicate spellings (case / whitespace / EN-IT) that paint the kiosk
// wall different colours become visible.
//
// For each variant we show how many quests carry it and the OLDEST quest that
// does (lowest numeric id ≈ earliest created, which on casaselva is the bot's
// own spelling) — that's the canonical form a normaliser should converge on.
//
// HOW TO RUN
//   cd packages/telegram-ui      # any package that depends on holosphere
//   HOLONS_APP=Holons node ../../scripts/scan-categories.mjs -1002964866719

const HOLON = process.argv[2];
if (!HOLON) {
  console.error('usage: node scan-categories.mjs <holonId>   (env: HOLONS_APP, HOLOSPHERE_RELAYS)');
  process.exit(64);
}
const APP = process.env.HOLONS_APP || 'Holons';

const { createRequire } = await import('module');
const { pathToFileURL } = await import('url');
const requireFromCwd = createRequire(pathToFileURL(`${process.cwd()}/`));
const mod = await import(pathToFileURL(requireFromCwd.resolve('holosphere')).href);
const HoloSphere = mod.HoloSphere || mod.default;
// Resolve core's built dist relative to THIS script, not the cwd: @holons/core
// is not linked into every workspace package.
const { resolveRelays } = await import(
  new URL('../packages/core/dist/holosphere/index.js', import.meta.url).href
);
const RELAYS = resolveRelays(process.env.HOLOSPHERE_RELAYS);

const hs = new HoloSphere({ appName: APP, relays: RELAYS, store: { adapter: 'memory' } });
await hs.ready();

console.log(`\n=== category scan: ${APP}/${HOLON}/quests ===`);
console.log(`relays=${RELAYS.join(', ')}\n`);

let quests = [];
try {
  quests = (await hs.getAll(HOLON, 'quests')) || [];
} catch (err) {
  console.error(`getAll failed: ${err?.message || err}`);
  process.exit(1);
}

// id → numeric rank for "oldest first" (Telegram-ish ids are ascending ints;
// fall back to +Infinity for non-numeric so they sort last).
const rank = (q) => {
  const n = Number(q?.id);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};
const norm = (s) => String(s ?? '').trim().toLowerCase();

const groups = new Map(); // normalised -> Map(rawVariant -> {count, oldest})
let blank = 0;
for (const q of quests) {
  const raw = q?.category;
  if (raw == null || String(raw).trim() === '') { blank++; continue; }
  const key = norm(raw);
  if (!groups.has(key)) groups.set(key, new Map());
  const variants = groups.get(key);
  const v = variants.get(raw) || { count: 0, oldest: null };
  v.count++;
  if (!v.oldest || rank(q) < rank(v.oldest)) v.oldest = q;
  variants.set(raw, v);
}

console.log(`total quests: ${quests.length}   (blank/no category: ${blank})`);
console.log(`distinct normalised categories: ${groups.size}\n`);

// Sort groups by total count desc.
const sorted = [...groups.entries()].sort(
  (a, b) => total(b[1]) - total(a[1]),
);
function total(variants) {
  let t = 0;
  for (const v of variants.values()) t += v.count;
  return t;
}

for (const [key, variants] of sorted) {
  const multi = variants.size > 1;
  console.log(`${multi ? '⚠ ' : '  '}"${key}"  —  ${total(variants)} quest(s), ${variants.size} spelling(s)`);
  // Within a normalised group, the canonical = the spelling on the oldest quest.
  const byOldest = [...variants.entries()].sort(
    (a, b) => rank(a[1].oldest) - rank(b[1].oldest),
  );
  for (const [raw, v] of byOldest) {
    const oid = v.oldest?.id ?? '?';
    console.log(`      ${JSON.stringify(raw)}  ×${v.count}   oldest id=${oid}`);
  }
  if (multi) {
    const canonical = byOldest[0][0];
    console.log(`      → canonical (oldest): ${JSON.stringify(canonical)}`);
  }
}

await hs.close();
process.exit(0);
