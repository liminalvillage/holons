// Why does the kiosk show different items than the bot for the same holon?
//
// The two surfaces read the SAME lens (`quests` / `library`) two different
// ways, and the kiosk filters what it shows:
//
//   • bot   → holosphere.getAll(holon, lens)   — one-shot enumeration after the
//             relay sync; shows essentially everything.
//   • kiosk → holosphere.subscribe(holon, lens) — accumulates live `map` events
//             into a Map keyed by id, THEN drops done/cancelled/completed/
//             _deleted, and the task backlog also hides `type === "event"`.
//
// So a divergence can come from (a) the read path returning different raw sets
// (dangling/hologram nodes resolve under one path but not the other), or
// (b) the kiosk's display filters, or (c) the two pointing at different app
// namespaces (kiosk defaults to prod "Holons"; the dev bot uses "HolonsDebug").
//
// This script reads a holon's lens BOTH ways and prints the diff, so you can
// see exactly which of those is responsible. Read-only — it never writes.
//
// HOW TO RUN
//   cd packages/telegram-ui            # any package that depends on holosphere
//   # holon id is required; app/relays default to the kiosk's prod target.
//   HOLONS_APP=Holons node ../../scripts/kiosk-vs-bot-items.mjs -1001652773351
//   # other lens, or the dev namespace the bot writes to:
//   LENS=library HOLONS_APP=HolonsDebug node ../../scripts/kiosk-vs-bot-items.mjs <holon>

const HOLON = process.argv[2];
if (!HOLON) {
  console.error('usage: node kiosk-vs-bot-items.mjs <holonId>   (env: HOLONS_APP, HOLOSPHERE_RELAYS, LENS)');
  process.exit(64);
}
const APP = process.env.HOLONS_APP || 'Holons';
const LENS = process.env.LENS || 'quests';
const WARMUP_MS = Number(process.env.WARMUP_MS || 8000);
const SETTLE_MS = Number(process.env.SETTLE_MS || 6000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve `holosphere` from the cwd (scripts/ has no node_modules of its own).
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

console.log(`\n=== kiosk vs bot: ${APP}/${HOLON}/${LENS} ===`);
console.log(`relays=${RELAYS.join(', ')}\n`);

// ── kiosk display filters (mirrored from apps/kiosk/src/lib/data.ts) ─────────
function isDone(q) {
  const s = String(q?.status ?? '').toLowerCase();
  return s === 'completed' || s === 'cancelled' || q?.completed === true || q?._deleted === true;
}
function isEvent(q) {
  return String(q?.type ?? '').toLowerCase() === 'event';
}
const idOf = (rec, key) => String((rec && (rec.id ?? key)) ?? key ?? '');

// ── BOT path: one-shot getAll ────────────────────────────────────────────────
let botItems = [];
try {
  botItems = (await hs.getAll(HOLON, LENS)) || [];
} catch (err) {
  console.error(`getAll failed: ${err?.message || err}`);
}
const botIds = new Map();
for (const it of botItems) {
  const id = idOf(it, undefined);
  if (id) botIds.set(id, it);
}

// ── KIOSK path: subscribe + accumulate (exactly subscribeLens's logic) ───────
const kioskIds = new Map();
const sub = hs.subscribe(HOLON, LENS, (data, key) => {
  const id = idOf(data, key);
  if (!id) return;
  if (data == null || data._deleted) kioskIds.delete(id);
  else kioskIds.set(id, data);
});
// Give the live subscription time to drain the lens, then settle.
await sleep(WARMUP_MS);
let lastSize = -1;
while (kioskIds.size !== lastSize) {
  lastSize = kioskIds.size;
  await sleep(SETTLE_MS);
}
try { (sub && (sub.unsubscribe?.() ?? (await sub)?.unsubscribe?.())); } catch { /* ignore */ }

// ── Compare RAW sets (read-path difference) ──────────────────────────────────
const onlyBot = [...botIds.keys()].filter((id) => !kioskIds.has(id));
const onlyKiosk = [...kioskIds.keys()].filter((id) => !botIds.has(id));

console.log(`RAW counts:   bot(getAll)=${botIds.size}   kiosk(subscribe)=${kioskIds.size}`);
console.log(`  only in bot getAll      : ${onlyBot.length}${onlyBot.length ? '  ' + onlyBot.slice(0, 20).join(', ') : ''}`);
console.log(`  only in kiosk subscribe : ${onlyKiosk.length}${onlyKiosk.length ? '  ' + onlyKiosk.slice(0, 20).join(', ') : ''}`);

// ── Compare what the KIOSK actually DISPLAYS after its filters ───────────────
// Use the union of raw records so the filter accounting is apples-to-apples.
const union = new Map([...botIds, ...kioskIds]);
let done = 0, events = 0, shownBacklog = 0, shownCalendar = 0;
const droppedDone = [];
for (const [id, q] of union) {
  if (isDone(q)) { done++; droppedDone.push(id); continue; }
  if (isEvent(q)) { events++; }            // hidden from backlog, shown on calendar
  else shownBacklog++;
  if (q?.when) shownCalendar++;
}

if (LENS === 'quests') {
  console.log(`\nKIOSK display filters over ${union.size} unique quests:`);
  console.log(`  hidden — done/cancelled/completed/_deleted : ${done}${done ? '  ' + droppedDone.slice(0, 20).join(', ') : ''}`);
  console.log(`  type==="event" (hidden from backlog)        : ${events}`);
  console.log(`  → backlog cards (open, non-event)           : ${shownBacklog}`);
  console.log(`  → calendar events (open, dated)             : ${shownCalendar}`);
  console.log(`\nSo the bot's list of ${botIds.size} becomes ${shownBacklog} backlog card(s) in the kiosk —`);
  console.log(`the gap is ${done} done/deleted + ${events} event-typed + any read-path delta above.`);
}

await hs.close();
process.exit(0);
