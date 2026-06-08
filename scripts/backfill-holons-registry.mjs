// Backfill the global `holons_registry` from the holons that already exist.
//
// WHY THIS RUNS ON THE BOT HOST
// -----------------------------
// GUN has no "list all holons" operation. A fresh peer only sees what the
// relay happens to expose (~21). The COMPLETE set of holons lives in the
// long-running bot's warm radisk — the bot is a member of every group holon,
// so every holon it has ever touched has a settings node persisted under its
// local `holosphere/` radata dir. Enumerating the graph root there is
// exhaustive; enumerating it from a cold peer is not. So this must run where
// that radisk lives: the bot/prod host.
//
// WHAT IT DOES
//   1. Enumerate candidate ids from the graph root  gun.get(APP).map()
//   2. Drop known system tables and malformed keys
//   3. Confirm each candidate is a holon by reading its own settings node
//   4. Write a registry record per holon (same shape as core `registerHolon`)
//
// SAFETY
//   - DRY RUN BY DEFAULT. It only reports. Set WRITE=1 to actually persist.
//   - Idempotent: registry rows are keyed by holon id, so re-running just
//     refreshes existing rows — never duplicates.
//   - Refuses to act on a cold read (0 root keys) — that means the radisk
//     wasn't warm, not that there are no holons.
//
// HOW TO RUN (on the bot host)
//   Safest: stop the bot (or point HOLONS_RADISK at a COPY of its holosphere/
//   dir) so two processes don't write the same radisk concurrently.
//
//   cd packages/telegram-ui                 # so ./holosphere resolves like the bot
//   HOLONS_APP=Holons node ../../scripts/backfill-holons-registry.mjs        # dry run
//   HOLONS_APP=Holons WRITE=1 node ../../scripts/backfill-holons-registry.mjs # write
//
//   # or against a copied radata dir, with the bot left running:
//   HOLONS_APP=Holons HOLONS_RADISK=/path/to/holosphere-copy WRITE=1 \
//     node ../../scripts/backfill-holons-registry.mjs

const APP = process.env.HOLONS_APP || 'Holons';
const PEER = process.env.HOLONS_PEER || 'https://gun.holons.io/gun';
const RADISK = process.env.HOLONS_RADISK || null; // null → HoloSphere default (./holosphere)
const WRITE = process.env.WRITE === '1';
const WARMUP_MS = Number(process.env.WARMUP_MS || 8000);
const SETTLE_MS = Number(process.env.SETTLE_MS || 6000);
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

// Mirror the bot's construction so we read the same graph. When HOLONS_RADISK
// is set we point at that dir explicitly; otherwise we let HoloSphere use its
// default radata location (./holosphere relative to cwd — same as the bot).
const opts = RADISK ? { peers: [PEER], radisk: true, file: RADISK } : { peers: [PEER] };
const hs = new HoloSphere(APP, false, null, opts);

console.log(`\n=== Backfill holons_registry ===`);
console.log(`app=${APP}  peer=${PEER}  radisk=${RADISK || '(default ./holosphere)'}  mode=${WRITE ? 'WRITE' : 'DRY RUN'}`);

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
  // Long hex blobs are internal souls, not holon ids.
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

// 1. Warm the root, then enumerate every key under it.
//    (Root warmup: a map().once pass primes radisk before we trust the count.)
console.log(`\nWarming radisk (${WARMUP_MS}ms) …`);
hs.gun.get(APP).map().once(() => {});
await sleep(WARMUP_MS);

const rootKeys = new Set();
await new Promise((resolve) => {
  let timer;
  const reset = () => { clearTimeout(timer); timer = setTimeout(resolve, SETTLE_MS); };
  reset();
  hs.gun.get(APP).map().once((_data, key) => {
    if (key && key !== '_' && key !== '#') { rootKeys.add(key); reset(); }
  });
});

console.log(`Root keys under ${APP}: ${rootKeys.size}`);
if (rootKeys.size === 0) {
  console.log('COLD READ — 0 root keys. Radisk not warm; refusing to act. (Run on the bot host / point HOLONS_RADISK at its radata.)');
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
  await sleep(1000);
  process.exit(0);
}

console.log(`\nWRITE=1 → writing ${holons.length} registry row(s) …`);
let ok = 0, failed = 0;
for (const h of holons) {
  try { await hs.writeGlobal(REGISTRY_TABLE, h); ok++; }
  catch (err) { failed++; console.log(`  FAILED ${h.id}: ${err?.message || err}`); }
}
console.log(`\nDone. wrote=${ok} failed=${failed}`);
await sleep(3000); // flush to the relay before exit
process.exit(failed ? 1 : 0);
