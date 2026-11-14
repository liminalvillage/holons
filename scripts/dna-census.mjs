// SPDX-License-Identifier: AGPL-3.0-or-later
// READ-ONLY census of the legacy holon DNA data (WP0 of the Holon DNA blueprint).
//
// For every holon in the global `holons_registry` it reports:
//   - `chromosome_library` and `dna_sequence` lenses (counts + ids)
//   - settings.purpose / values / description / onboarding (enabled? steps)
//   - the group `dna` lens (`dna.community`, any other keys)
//   - the bot's `applications` lens (count + ids)
//   - an `isTelegramGroup` hint (negative numeric id)
// plus a top-level summary of which holons need the purpose/values copy (WP5)
// and which have chromosome data to convert.
//
// ZERO WRITES. The instance is built with ledger/rosterMirror/registry off and
// every write method on it is replaced by a function that throws. Reads use
// enforce:false (the open graph), so the census sees what the relays hold.
//
// RUN (core dist must be built: pnpm --filter @holons/core build)
//   ENV_FILE=/path/to/root/.env OUT=/path/report.json node scripts/dna-census.mjs
//   Only HOLONS_APP and HOLOSPHERE_RELAYS are read from ENV_FILE; no key is
//   loaded and nothing secret is printed. Optional: HOLONS_APP, HOLOSPHERE_RELAYS,
//   EXTRA=<id,id> probes holons the registry lacks; CONCURRENCY (default 4), HOLON_TIMEOUT_MS (default 25000), ONLY=<id,id>.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const requireFromHere = createRequire(import.meta.url);

/** Pull only the two non-secret keys we need out of a dotenv file. */
function readEnvKeys(file, keys) {
  const out = {};
  if (!file) return out;
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m || !keys.includes(m[1])) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const fileEnv = readEnvKeys(process.env.ENV_FILE, ['HOLONS_APP', 'HOLOSPHERE_RELAYS']);
const APP = process.env.HOLONS_APP || fileEnv.HOLONS_APP || 'Holons';
const RELAYS_ENV = process.env.HOLOSPHERE_RELAYS || fileEnv.HOLOSPHERE_RELAYS || undefined;
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const HOLON_TIMEOUT_MS = Number(process.env.HOLON_TIMEOUT_MS || 25000);
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = process.env.OUT || '';
// Holons that should be probed even if the registry lacks them (EXTRA=<id,id>).
const EXTRA = (process.env.EXTRA || '').split(',').map((s) => s.trim()).filter(Boolean);

const core = await import(new URL('../packages/core/dist/holosphere/index.js', import.meta.url).href);
const { createHoloSphere, resolveRelays } = core;
const RELAYS = resolveRelays(RELAYS_ENV);

const hs = await createHoloSphere({
  appName: APP,
  relays: RELAYS,
  store: { adapter: 'memory' },
  awaitReady: true,
  enforce: false,
  ledger: false,
  rosterMirror: false,
  registry: false,
});

// Belt and braces: this process must never write.
for (const m of ['put', 'delete', 'deleteAll', 'writeGlobal', 'deleteGlobal', 'publish', 'putGlobal', 'propagate', 'federate']) {
  if (typeof hs[m] === 'function') {
    hs[m] = () => { throw new Error(`dna-census is read-only: ${m}() blocked`); };
  }
}

const withTimeout = (p, ms, what) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${what} after ${ms}ms`)), ms)),
]);

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (isObj(v)) return Object.keys(v).length > 0;
  return true;
};

/** Read a lens as a flat list of records: tries getAll, falls back to get(holon, lens). */
async function readLens(holon, lens) {
  let rows = [];
  try {
    const all = await hs.getAll(holon, lens);
    if (Array.isArray(all)) rows = all.filter((r) => r && typeof r === 'object');
    else if (isObj(all)) rows = Object.values(all).filter((r) => r && typeof r === 'object');
  } catch { /* fall through */ }
  if (rows.length === 0) {
    try {
      const one = await hs.get(holon, lens);
      if (isObj(one)) {
        // chromosome_library is ONE object keyed by chromosome id (see core dna/persistence).
        const nested = Object.entries(one).filter(([k, v]) => !k.startsWith('_') && isObj(v));
        rows = nested.length ? nested.map(([k, v]) => ({ id: v.id || k, ...v })) : [one];
      }
    } catch { /* empty */ }
  }
  return rows;
}

const idOf = (r, i) => String(r?.id ?? r?.key ?? r?._key ?? `#${i}`);

async function censusHolon(entry) {
  const id = String(entry.id);
  const row = { id, name: entry.name || null, type: entry.type || null, registryPurpose: entry.purpose || '' };
  const errors = [];
  const tryStep = async (label, fn) => {
    try { return await withTimeout(fn(), HOLON_TIMEOUT_MS, label); }
    catch (e) { errors.push(`${label}: ${e?.message || e}`); return undefined; }
  };

  const settings = await tryStep('settings', () => hs.get(id, 'settings', id));
  row.hasSettings = isObj(settings);
  const s = isObj(settings) ? settings : {};
  row.settings = {
    purpose: nonEmpty(s.purpose) ? s.purpose : null,
    values: nonEmpty(s.values) ? s.values : null,
    description: nonEmpty(s.description) ? s.description : null,
    onboarding: isObj(s.onboarding)
      ? {
          enabled: s.onboarding.enabled === true,
          steps: Array.isArray(s.onboarding.steps) ? s.onboarding.steps : s.onboarding.steps ?? null,
          keys: Object.keys(s.onboarding),
        }
      : null,
  };

  const lib = await tryStep('chromosome_library', () => readLens(id, 'chromosome_library'));
  const seq = await tryStep('dna_sequence', () => readLens(id, 'dna_sequence'));
  const dna = await tryStep('dna', () => readLens(id, 'dna'));
  const apps = await tryStep('applications', () => readLens(id, 'applications'));
  const genes = await tryStep('genes', () => readLens(id, 'genes'));

  row.chromosome_library = { count: (lib || []).length, ids: (lib || []).map(idOf), records: lib || [] };
  row.dna_sequence = {
    count: (seq || []).length,
    ids: (seq || []).map(idOf),
    chromosomeIds: (seq || []).flatMap((r) => (Array.isArray(r.chromosomeIds) ? r.chromosomeIds : [])),
    records: seq || [],
  };
  const community = (dna || []).find((r) => r && ('community' in r)) ?? null;
  row.dna = {
    count: (dna || []).length,
    keys: [...new Set((dna || []).flatMap((r) => Object.keys(r)))].filter((k) => !k.startsWith('_')),
    community: community ? community.community : null,
  };
  row.applications = { count: (apps || []).length, ids: (apps || []).map(idOf) };
  row.genesAlready = (genes || []).length;
  row.isTelegramGroup = /^-\d+$/.test(id);
  row.errors = errors;
  row.failed = errors.length > 0 && !row.hasSettings;
  return row;
}

console.error(`dna-census app=${APP} relays=${RELAYS.length} (read-only)`);

// Enumerate the registry.
let registry = [];
try {
  const reg = await withTimeout(hs.getAllGlobal('holons_registry'), 60000, 'registry');
  registry = Array.isArray(reg) ? reg : isObj(reg) ? Object.values(reg) : [];
} catch (e) {
  console.error(`FATAL registry read failed: ${e?.message || e}`);
  process.exit(2);
}
registry = registry.filter((r) => r && r.id);
const seen = new Set();
registry = registry.filter((r) => (seen.has(String(r.id)) ? false : seen.add(String(r.id))));
for (const x of EXTRA) if (!seen.has(x)) registry.push({ id: x, name: null, notInRegistry: true });
if (ONLY.length) registry = registry.filter((r) => ONLY.includes(String(r.id)));
console.error(`registry holons: ${registry.length}`);
if (registry.length === 0) { console.error('empty registry; refusing to report'); process.exit(2); }

const results = new Array(registry.length);
let next = 0, done = 0;
async function worker() {
  while (next < registry.length) {
    const i = next++;
    try { results[i] = await censusHolon(registry[i]); }
    catch (e) { results[i] = { id: String(registry[i].id), failed: true, errors: [String(e?.message || e)] }; }
    done++;
    if (done % 10 === 0) console.error(`  ${done}/${registry.length}`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, registry.length) }, worker));

const ok = results.filter((r) => !r.failed);
const slim = (r) => ({ id: r.id, name: r.name });
const summary = {
  app: APP,
  scanned: results.length,
  failed: results.filter((r) => r.failed).map((r) => ({ id: r.id, errors: r.errors })),
  withChromosomeLibrary: ok.filter((r) => r.chromosome_library.count > 0).map((r) => ({ ...slim(r), count: r.chromosome_library.count })),
  withDnaSequence: ok.filter((r) => r.dna_sequence.count > 0).map((r) => ({ ...slim(r), chromosomeIds: r.dna_sequence.chromosomeIds.length })),
  withSettingsPurpose: ok.filter((r) => r.settings.purpose).map((r) => ({ ...slim(r), purpose: r.settings.purpose })),
  withSettingsValues: ok.filter((r) => r.settings.values).map((r) => ({ ...slim(r), values: r.settings.values })),
  withSettingsDescription: ok.filter((r) => r.settings.description).map(slim),
  onboardingEnabled: ok.filter((r) => r.settings.onboarding?.enabled).map((r) => ({ ...slim(r), steps: r.settings.onboarding.steps })),
  onboardingConfigured: ok.filter((r) => r.settings.onboarding).map(slim),
  withDnaCommunity: ok.filter((r) => nonEmpty(r.dna.community)).map((r) => ({ ...slim(r), community: r.dna.community })),
  withDnaLens: ok.filter((r) => r.dna.count > 0).map((r) => ({ ...slim(r), keys: r.dna.keys })),
  withApplications: ok.filter((r) => r.applications.count > 0).map((r) => ({ ...slim(r), count: r.applications.count })),
  withGenesAlready: ok.filter((r) => r.genesAlready > 0).map(slim),
  needPurposeValuesCopy: ok.filter((r) => r.settings.purpose || r.settings.values).map(slim),
  // Consumers of dna.community: grep the repo (atlas import writes it into `communities`).
  dnaCommunityConsumers: 'see repo grep: packages/telegram-ui/src/dna.js (person `dna` lens), apps/web DNAEditor; atlas import writes `communities`, not `dna`',
};

const report = { generatedAt: new Date().toISOString(), summary, holons: results };
const json = JSON.stringify(report, null, 2);
if (OUT) { writeFileSync(OUT, json); console.error(`wrote ${OUT}`); } else { console.log(json); }
try { await hs.close(); } catch { /* ignore */ }
process.exit(0);
