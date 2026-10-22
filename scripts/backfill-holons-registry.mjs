// Backfill the global `holons_registry` from the holons that already exist.
//
// WHY THIS RUNS ON THE BOT HOST
// -----------------------------
// The relays have no "list all holons" query. A cold client only knows the
// (holon, lens) pairs it has synced. The COMPLETE set of holons lives in the
// long-running bot's warm local store — the bot is a member of every group
// holon, so every holon it has ever touched has records under its
// HOLOSPHERE_STORE_DIR. Enumerating that store is exhaustive; enumerating a
// cold in-memory store is not. So this must run where that store lives: the
// bot/prod host.
//
// WHAT IT DOES
//   1. Enumerate candidate ids from the local store  hs.store.listHolons()
//   2. Drop known system tables and malformed keys
//   3. Confirm each candidate is a holon by reading its own settings record
//   4. Write a registry record per holon (same shape as core `registerHolon`)
//
// SAFETY
//   - DRY RUN BY DEFAULT. It only reports. Set WRITE=1 to actually persist.
//   - Idempotent: registry rows are keyed by holon id, so re-running just
//     refreshes existing rows — never duplicates.
//   - Refuses to act on a cold store (0 holons) — that means the store dir
//     wasn't the bot's, not that there are no holons.
//
// HOW TO RUN (on the bot host)
//   The file store is one process per directory: stop the bot, or point
//   HOLOSPHERE_STORE_DIR at a COPY of its store dir.
//
//   cd packages/telegram-ui                 # so ./holosphere-store resolves like the bot
//   HOLONS_APP=Holons node ../../scripts/backfill-holons-registry.mjs        # dry run
//   HOLONS_APP=Holons WRITE=1 node ../../scripts/backfill-holons-registry.mjs # write
//
//   # or against a copied store dir, with the bot left running:
//   HOLONS_APP=Holons HOLOSPHERE_STORE_DIR=/path/to/holosphere-store-copy WRITE=1 \
//     node ../../scripts/backfill-holons-registry.mjs

const APP = process.env.HOLONS_APP || 'Holons';
const STORE_DIR = process.env.HOLOSPHERE_STORE_DIR || './holosphere-store';
const KEY = process.env.HOLOSPHERE_NSEC || undefined; // the bot's key signs the rows
const WRITE = process.env.WRITE === '1';
const REGISTRY_TABLE = 'holons_registry';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve `holosphere` from the CURRENT WORKING DIR, not this file's location.
// The script lives in scripts/ which has no node_modules; the operator runs it
// from a package that depends on holosphere (e.g. packages/telegram-ui), so
// resolve against cwd to pick that up.
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

// Mirror the bot's construction so we open the same store (hydrated from its
// JSONL log + snapshot before ready() resolves).
const hs = new HoloSphere({
  appName: APP,
  privateKey: KEY,
  relays: RELAYS,
  store: { adapter: 'file', dir: STORE_DIR },
});
await hs.ready();

console.log(`\n=== Backfill holons_registry ===`);
console.log(`app=${APP}  relays=${RELAYS.join(', ')}  store=${STORE_DIR}  mode=${WRITE ? 'WRITE' : 'DRY RUN'}`);

// System tables / index nodes that live at the graph root alongside holons but
// are NOT holons. Kept in sync with apps/web GlobalHolons.svelte.
const SYSTEM_ENTRIES = new Set([
  'federation', 'federationMeta', 'federation_messages', 'fedInfo2',
  'chats', 'checklists', 'expenses', 'quests', 'shopping', 'users', 'roles',
  'announcements', 'recurring', 'recurringlookup', 'reminders', 'reminderslookup',
  'settings', 'tags', 'user_private_quest_messages', 'hubs', 'library',
  'quest', 'Holons', '/federate',
  'holons_registry', 'communities', 'telegram_mappings', 'schemas',
  'hns', '_dm', 'cell', 'global',
]);

/** Same id sanity filter the web view uses, so both agree on what's a holon. */
function looksLikeHolonId(id) {
  if (!id || typeof id !== 'string') return false;
  const t = id.trim();
  if (t === '' || t === 'undefined' || t === '-' || t.includes('\n')) return false;
  if (SYSTEM_ENTRIES.has(t)) return false;
  if (t.includes('/')) return false;
  // Long hex blobs are internal keys, not holon ids.
  if (t.length > 15 && /^[0-9a-f]+$/i.test(t)) return false;
  if (/^8[0-9a-f]{15,}$/i.test(t)) return false;
  return true;
}

/** Coerce settings created/createdAt into a canonical ISO string. */
function toCreatedIso(settings) {
  if (settings && typeof settings.created === 'string' && settings.created) return settings.created;
  if (settings && typeof settings.createdAt === 'number' && Number.isFinite(settings.createdAt)) {
    return new Date(settings.createdAt).toISOString();
  }
  return new Date().toISOString();
}

// 1. Enumerate every holon the local store holds records for.
const rootKeys = new Set(hs.store.listHolons());

console.log(`Holons in the local store for ${APP}: ${rootKeys.size}`);
if (rootKeys.size === 0) {
  console.log('COLD STORE — 0 holons. Not the bot\'s store; refusing to act. (Run on the bot host / point HOLOSPHERE_STORE_DIR at its store dir.)');
  await hs.close();
  process.exit(2);
}

const candidates = [...rootKeys].filter(looksLikeHolonId);
console.log(`Candidate holon ids (after filter): ${candidates.length}`);

// 2. Load what's already registered so we can report new vs refreshed.
let existing = new Set();
try {
  const reg = await hs.getAllGlobal(REGISTRY_TABLE);
  if (Array.isArray(reg)) reg.forEach((r) => r && r.id && existing.add(String(r.id)));
  else if (reg && typeof reg === 'object') {
    Object.values(reg).forEach((r) => r && r.id && existing.add(String(r.id)));
  }
} catch { /* registry may be empty */ }
console.log(`Already in registry: ${existing.size}`);

// 3. Confirm each candidate is a holon (has a settings node) and build a row.
const holons = [];
const notHolons = [];
for (const id of candidates) {
  let settings = null;
  try { settings = await hs.get(id, 'settings', id); } catch { settings = null; }
  if (!settings || typeof settings !== 'object') { notHolons.push(id); continue; }
  holons.push({
    id,
    name: (settings.name || '').toString().trim() || `Holon ${id}`,
    purpose: (settings.purpose || '').toString(),
    created: toCreatedIso(settings),
    type: id.startsWith('-') ? 'community' : 'personal',
  });
}

console.log(`\nConfirmed holons (have settings): ${holons.length}`);
console.log(`Candidates without settings (skipped): ${notHolons.length}`);

const fresh = holons.filter((h) => !existing.has(h.id));
console.log(`  → already registered: ${holons.length - fresh.length}`);
console.log(`  → new to registry   : ${fresh.length}`);

console.log('\n--- holons ---');
for (const h of holons) {
  const tag = existing.has(h.id) ? '·' : '+';
  console.log(`  ${tag} ${h.id}  ${JSON.stringify(h.name)}  [${h.type}]  ${h.created}`);
}

// 4. Write (idempotent). Refresh ALL confirmed holons so stale rows get the
//    canonical shape too; the cost is one write per holon, run rarely.
if (!WRITE) {
  console.log(`\nDRY RUN — nothing written. Re-run with WRITE=1 to persist ${holons.length} row(s).`);
  await hs.close();
  process.exit(0);
}

console.log(`\nWRITE=1 → writing ${holons.length} registry row(s) …`);
let ok = 0, failed = 0;
for (const h of holons) {
  try { await hs.writeGlobal(REGISTRY_TABLE, h); ok++; }
  catch (err) { failed++; console.log(`  FAILED ${h.id}: ${err?.message || err}`); }
}
console.log(`\nDone. wrote=${ok} failed=${failed}`);
await sleep(3000); // let the relay publishes drain before exit
await hs.close();
process.exit(failed ? 1 : 0);
