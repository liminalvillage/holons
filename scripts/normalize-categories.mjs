// Normalise near-duplicate `category` spellings on a holon's `quests` lens to
// one canonical form — the spelling on the OLDEST quest of each normalised
// group (on casaselva that's the bot's original spelling). This is what makes
// the kiosk wall paint same-meaning cards the same colour.
//
// DRY-RUN by default: prints the quests it WOULD rewrite and exits without
// touching anything. Pass --apply to actually write.
//
// HOW TO RUN
//   cd packages/telegram-ui
//   # see the plan:
//   HOLONS_APP=Holons node ../../scripts/normalize-categories.mjs -1002964866719
//   # do it:
//   HOLONS_APP=Holons node ../../scripts/normalize-categories.mjs -1002964866719 --apply

const HOLON = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!HOLON) {
  console.error('usage: node normalize-categories.mjs <holonId> [--apply]   (env: HOLONS_APP, HOLONS_PEER)');
  process.exit(64);
}
const APP = process.env.HOLONS_APP || 'Holons';
const PEER = process.env.HOLONS_PEER || 'https://gun.holons.io/gun';

const { createRequire } = await import('module');
const { pathToFileURL } = await import('url');
const requireFromCwd = createRequire(pathToFileURL(`${process.cwd()}/`));
const mod = await import(pathToFileURL(requireFromCwd.resolve('holosphere')).href);
const HoloSphere = mod.HoloSphere || mod.default;

const hs = new HoloSphere(APP, false, null, { peers: [PEER] });

console.log(`\n=== normalize categories: ${APP}/${HOLON}/quests  (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
console.log(`peer=${PEER}\n`);

let quests = [];
try {
  quests = (await hs.getAll(HOLON, 'quests')) || [];
} catch (err) {
  console.error(`getAll failed: ${err?.message || err}`);
  process.exit(1);
}

const rank = (q) => {
  const n = Number(q?.id);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};
const norm = (s) => String(s ?? '').trim().toLowerCase();

// Build normalised groups; canonical = spelling on the oldest quest in the group.
const groups = new Map(); // normalised -> { canonical, oldestRank, members:[{q,raw}] }
for (const q of quests) {
  const raw = q?.category;
  if (raw == null || String(raw).trim() === '') continue;
  const key = norm(raw);
  if (!groups.has(key)) groups.set(key, { canonical: raw, oldestRank: rank(q), members: [] });
  const g = groups.get(key);
  if (rank(q) < g.oldestRank) { g.oldestRank = rank(q); g.canonical = raw; }
  g.members.push({ q, raw });
}

// Collect the quests whose category string differs from their group's canonical.
const edits = [];
for (const [, g] of groups) {
  for (const { q, raw } of g.members) {
    if (raw !== g.canonical) edits.push({ q, from: raw, to: g.canonical });
  }
}

if (edits.length === 0) {
  console.log('Nothing to normalise — every category is already consistent.');
  process.exit(0);
}

console.log(`${edits.length} quest(s) to rewrite:\n`);
for (const e of edits) {
  console.log(`  id=${e.q.id}  ${JSON.stringify(e.from)} → ${JSON.stringify(e.to)}   "${e.q.title ?? ''}"`);
}

if (!APPLY) {
  console.log('\n(dry-run — pass --apply to write these changes)');
  process.exit(0);
}

console.log('\nApplying…');
let ok = 0;
for (const e of edits) {
  const updated = { ...e.q, category: e.to };
  try {
    await hs.put(HOLON, 'quests', updated);
    ok++;
    console.log(`  ✓ id=${e.q.id}`);
  } catch (err) {
    console.log(`  ✗ id=${e.q.id}: ${err?.message || err}`);
  }
}
console.log(`\nWrote ${ok}/${edits.length}.`);
await new Promise((r) => setTimeout(r, 1500));
process.exit(0);
