// SPDX-License-Identifier: AGPL-3.0-or-later
// Import the Heart of Ecovillages "Atlas" communities into the map's
// `communities` lens (Murmurations communities_schema-v0.1.0, the schema
// MapSidebar declares for that lens).
//
// The web map lights a hex when getAll(hex, 'communities') is non-empty at the
// CURRENT zoom resolution, so each community has to be present at every cell of
// its H3 scalespace (res 14 down to 0 — holosphere getScalespace) to be visible
// at any zoom. Unlike import-projects-kml.mjs, which wrote 15 full copies, only
// the res-14 cell holds the record; the parents hold holograms pointing at it.
//
// ATTRIBUTION — the source data is CC BY-SA 4.0 (share-alike), so every record
// carries `source`, `attribution`, `license`, `license_url` and `source_url`.
// Anything derived from this data inherits the licence; do not strip them.
//
// SAFETY
//   - DRY RUN BY DEFAULT: parses, de-duplicates, reports, writes nothing.
//     Set WRITE=1 to persist.
//   - Idempotent: ids are stable slugs (atlas-<slug>), re-runs update in place.
//   - De-duplicates three ways (see DEDUPE below).
//
// SHAPE — one real record at the res-14 home cell, plus a hologram ({id, soul})
// in each of the 14 parent cells, stamped `_federation.origin` so the whole
// scalespace is retractable with propagateDeletion(homeCell, lens, id).
//
// HOW TO RUN (holosphere must resolve from cwd, same recipe as the backfill)
//   cd packages/telegram-ui
//   node ../../scripts/import-atlas-communities.mjs                  # dry run
//   WRITE=1 node ../../scripts/import-atlas-communities.mjs          # write
//
//   Full import, chunked (fresh process per chunk so GUN's graph can't OOM):
//     for s in $(seq 0 100 6300); do
//       WRITE=1 START=$s COUNT=100 node ../../scripts/import-atlas-communities.mjs || break
//     done
//
//   Optional env: HOLONS_APP (default Holons), HOLONS_PEER, ATLAS=/path/to/atlas-data.json,
//                 LENS (default communities), COUNTRY=France (filter),
//                 START/COUNT (slice), CONCURRENCY, SETTLE_MS, SKIP_REMOTE_DEDUPE=1

import { readFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { createRequire } from "module";
import { pathToFileURL } from "url";

// This script lives in scripts/, which has no node_modules of its own — resolve
// runtime deps from the CURRENT WORKING DIR instead (run it from a package that
// depends on holosphere, e.g. packages/telegram-ui). Same recipe as the backfill.
const requireFromCwd = createRequire(pathToFileURL(`${process.cwd()}/`));
const importFromCwd = (name) =>
  import(pathToFileURL(requireFromCwd.resolve(name)).href);

const APP = process.env.HOLONS_APP || "Holons";
const PEER = process.env.HOLONS_PEER || "https://gun.holons.io/gun";
const LENS = process.env.LENS || "communities";
const WRITE = process.env.WRITE === "1";
const ATLAS =
  process.env.ATLAS ||
  "/private/tmp/claude-501/-Users-robertovalenti-Projects-harvest/24285ee2-477e-4efe-bf96-04c47ca0190e/scratchpad/atlas-data.json";
const COUNTRY = process.env.COUNTRY || "";
const SETTLE_MS = Number(process.env.SETTLE_MS || 10000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const SKIP_REMOTE_DEDUPE = process.env.SKIP_REMOTE_DEDUPE === "1";
// GUN's in-memory graph grows with every soul touched — a single process
// doing all ~93k puts OOMs. Chunk with START/COUNT and a fresh process per
// chunk (see the driver loop in the header comment).
const START = Number(process.env.START || 0);
const COUNT = Number(process.env.COUNT || Infinity);

// Resolution the de-duplication probe reads. Atlas coordinates carry ~1.1km
// of deliberate fuzz, so an exact-cell match would miss a genuine duplicate;
// res 6 (~3km edge) is the smallest cell that reliably contains both copies.
const DEDUPE_RES = Number(process.env.DEDUPE_RES || 6);

const RELAYS = (process.env.HOLOSPHERE_RELAYS || "wss://relay.holons.io")
  .split(",").map((r) => r.trim()).filter(Boolean);
const RELAY_MODE = process.env.HOLOSPHERE_SIGNING || "shadow";
// Dedicated importer identity — never a person's key. A bulk import authors
// thousands of records at once; giving it its own pubkey keeps that provenance
// legible and makes the whole batch revocable/filterable without touching real
// users. Lives in the gitignored root .env.
const IMPORTER_KEY = process.env.ATLAS_IMPORTER_NOSTR_KEY || "";

const GUN_FILE_DIR = process.env.GUN_FILE_DIR || "./.gun-import-store";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ATTRIBUTION = {
  source: "Heart of Ecovillages",
  attribution: "Heart of Ecovillages — https://heartofecovillages.org",
  license: "CC BY-SA 4.0",
  license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
};

// ---------------------------------------------------------------- taxonomy

// Both maps are lifted from the atlas bundle, which stores these as integer /
// slug codes; we write the human labels so the sidebar needs no decoder.
const SPECTRUM = {
  1: "Federation / network",
  2: "Ecovillages & land settlements",
  4: "Contemplative / faith",
  5: "Cohousing",
  6: "Care community",
  7: "Anarchist / autonomous",
  8: "Pop-up & nomadic",
  9: "Distributed networks",
};

const FORM = {
  "intentional-settlement": "Intentional settlement",
  "co-living-lab": "Co-living / co-living lab",
  "housing-cooperative": "Housing co-op",
  "care-residential": "Care residential",
  "traditional-communal": "Traditional / inherited",
  "transformed-village": "Transformed village",
  popup: "Popup / nomadic",
  doorway: "Network / doorway",
  unclassified: "Unclassified",
};

const VERIFICATION = {
  "verified-active": "Verified active",
  "network-verified": "Network-verified",
  "recovered-cohousing": "Recovered cohousing",
};

// ---------------------------------------------------------------- helpers

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

// Duplicate detection key: aggressive normalisation so "Ecovillage Sieben
// Linden", "sieben-linden e.V." and "Sieben Linden" collapse to one key.
const NOISE =
  /\b(the|le|la|les|el|los|das|der|die|het|il|de|of|and|e|y|und|et|eco|eco-?village|ecovillage|okodorf|community|comunidad|communaute|gemeinschaft|cohousing|co-?housing|association|assoc|society|foundation|stiftung|verein|ev|inc|ltd|llc|gmbh|coop|cooperative|kooperative|project|projekt|centre|center|zentrum|farm|ferme|finca|village|villaggio|dorf)\b/g;

const normName = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();

// Stable id. NOT `atlas-<source id>`: 80 upstream ids are accented or degenerate
// (`-2`, `-3`, where a CJK name slugged to empty upstream). Derive from the name,
// fall back to the source id, and disambiguate collisions with a hash of the
// source id — never with a positional counter, which would re-shuffle ids on the
// next snapshot and orphan everything written by this run.
const shortHash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 6);

function baseSlug(p) {
  return slugify(p.n) || slugify(p.id) || "community";
}

function makeId(p, ambiguous) {
  const base = baseSlug(p);
  return ambiguous.has(base) ? `atlas-${base}-${shortHash(p.id)}` : `atlas-${base}`;
}

// The sidebar renders `description` through RichDescription (html=), but the
// atlas writeups are markdown — 48 of them use **bold**, 22 use *italic*.
// Escape first, then convert only those two, so nothing upstream can inject markup.
const escapeHtml = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const renderDescription = (s) =>
  escapeHtml(s || "")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .trim();

// ---------------------------------------------------------------- item shape

function toCommunityItem(p, ambiguous) {
  const atlasUrl = `https://atlas.regencommunity.tools/community/${p.id}.html`;
  const tags = [
    ...new Set(
      [
        ...(p.tags || []),
        FORM[p.form],
        SPECTRUM[p.sc],
        SPECTRUM[p.sc2],
        "atlas",
        "intentional-community",
      ]
        .filter(Boolean)
        .map((t) => String(t).trim()),
    ),
  ];

  const item = {
    id: makeId(p, ambiguous),
    linked_schemas: ["communities_schema-v0.1.0"],
    name: p.n,
    title: p.n, // generic card components read `title`
    // Schema requires primary_url; fall back to the atlas entry so the record
    // stays valid and always points back at the source (share-alike).
    primary_url: p.url || atlasUrl,
    description: renderDescription(p.w),
    geolocation: { lat: p.lat, lon: p.lon },
    tags,
    relationships: [], // required by communities_schema-v0.1.0

    // provenance + licence — required by CC BY-SA, do not strip
    ...ATTRIBUTION,
    source_url: atlasUrl,
    source_id: p.id,
    source_group: p.sg || undefined,

    // atlas taxonomy, kept so the lens can filter without re-deriving
    community_type: FORM[p.form] || p.form || undefined,
    spectrum: SPECTRUM[p.sc] || undefined,
    verification: VERIFICATION[p.vs] || p.vs || undefined,
    verified_date: p.vd || undefined,
    // coordinates are deliberately imprecise at source; record that so nobody
    // treats them as a street address
    coordinate_precision:
      p.prec === "given" ? "given (~1.1km fuzz)" : "place centroid (~1.1km fuzz)",
    accepting_members: p.join === true ? true : undefined,
    open_to_visitors: p.adj === true ? true : undefined,
  };

  if (p.cr) item.locality = p.cr;
  if (p.rg && p.rg !== p.c) item.region = p.rg;
  if (p.c) item.country_name = p.c;

  for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
  return item;
}

// ---------------------------------------------------------------- parse

const raw = JSON.parse(readFileSync(ATLAS, "utf8"));
const points = (raw.points || []).filter(
  (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.n,
);

console.log(`\n=== Import Atlas communities ===`);
console.log(`atlas=${ATLAS}`);
console.log(
  `snapshot generated=${raw.meta?.generated} points=${raw.meta?.points} verified=${raw.meta?.verified}`,
);
console.log(
  `app=${APP}  peer=${PEER}  lens=${LENS}  mode=${WRITE ? "WRITE" : "DRY RUN"}`,
);

const filtered = COUNTRY
  ? points.filter((p) => p.c?.toLowerCase() === COUNTRY.toLowerCase())
  : points;
if (COUNTRY) console.log(`country filter=${COUNTRY} → ${filtered.length} points`);

// ------------------------------------------------- DEDUPE 1: id collisions
// Stable slugs are what make re-runs idempotent, so a collision would make two
// distinct communities overwrite each other. Any base slug claimed by more than
// one point gets the hash suffix — all of them, so the id never depends on which
// one the snapshot happened to list first.
const slugUse = new Map();
for (const p of filtered) {
  const b = baseSlug(p);
  slugUse.set(b, (slugUse.get(b) || 0) + 1);
}
const ambiguous = new Set(
  [...slugUse.entries()].filter(([, n]) => n > 1).map(([b]) => b),
);
const idCollisions = ambiguous.size;

const candidates = filtered.map((p) => ({
  item: toCommunityItem(p, ambiguous),
  lat: p.lat,
  lon: p.lon,
}));

const uniqueIds = new Set(candidates.map((c) => c.item.id));
if (uniqueIds.size !== candidates.length) {
  console.error(
    `FATAL: ${candidates.length - uniqueIds.size} id collisions survived disambiguation; aborting.`,
  );
  process.exit(1);
}

// ------------------------------- DEDUPE 2: near-duplicates within the batch
// Same normalised name inside the same ~3km cell is the same place listed
// twice by two upstream directories. Keep the first, drop the rest.
let h3 = null;
try {
  h3 = await importFromCwd("h3-js");
} catch {
  console.warn(
    "h3-js not resolvable from cwd — de-dupe falls back to a coarse lat/lon grid",
  );
}
if (WRITE && !h3) {
  // Not just de-dupe: the hologram's _federation.parentLevel needs getResolution.
  console.error(
    "FATAL: h3-js is required in WRITE mode. Run from a package that depends on it (packages/telegram-ui).",
  );
  process.exit(1);
}
const cellAt = (lat, lon, res) =>
  h3 ? h3.latLngToCell(lat, lon, res) : `${lat.toFixed(2)},${lon.toFixed(2)}`;

const seenLocal = new Map(); // `${cell}|${normName}` -> id kept
const internalDupes = [];
const deduped = [];
for (const c of candidates) {
  const key = `${cellAt(c.lat, c.lon, DEDUPE_RES)}|${normName(c.item.name)}`;
  if (normName(c.item.name) && seenLocal.has(key)) {
    internalDupes.push({ id: c.item.id, name: c.item.name, kept: seenLocal.get(key) });
    continue;
  }
  seenLocal.set(key, c.item.id);
  deduped.push(c);
}

console.log(
  `\nparsed ${points.length} points → ${candidates.length} after filter → ${deduped.length} after in-batch de-dupe`,
);
console.log(`  id collisions disambiguated: ${idCollisions}`);
console.log(`  in-batch near-duplicates dropped: ${internalDupes.length}`);
for (const d of internalDupes.slice(0, 10))
  console.log(`    - "${d.name}" (${d.id}) ≈ ${d.kept}`);

const slice = deduped.slice(START, START + COUNT);
console.log(`\nslice: START=${START} COUNT=${slice.length}`);
console.log(`sample:`, JSON.stringify(slice[0]?.item, null, 2)?.slice(0, 1200));

if (!WRITE) {
  const noUrl = deduped.filter(({ item }) => !item.primary_url).length;
  const noDesc = deduped.filter(({ item }) => !item.description).length;
  console.log(`\nrecords missing primary_url: ${noUrl}`);
  console.log(`records missing description: ${noDesc}`);
  console.log(
    `\nDry run only. Re-run with WRITE=1 to persist ${deduped.length} communities`,
  );
  console.log(
    `(${deduped.length} real records at res 14 + ${deduped.length * 14} parent holograms = ${deduped.length * 15} puts).`,
  );
  console.log(
    `Remote de-dupe (against what is already on the '${LENS}' lens) runs in WRITE mode.`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------- connect

const mod = await importFromCwd("holosphere");
const HoloSphere = mod.HoloSphere || mod.default;

// radisk:false — we only push over the wire; a local radata copy of every
// touched soul both wastes disk and reloads into memory on the next chunk.
// Gun's node build keeps a local file store even with radisk:false, and its
// default (holosphere's `file: './holosphere'`) does not exist in the cwd we run
// from — every put then acks `ENOENT rename ./holosphere-!-xxx.tmp -> ./holosphere/!`,
// and putCallback rejects on ack.err, so the whole import fails while looking like
// a network problem. Point it at a scratch dir we know exists.
mkdirSync(GUN_FILE_DIR, { recursive: true });

const hs = new HoloSphere(APP, false, null, {
  peers: [PEER],
  radisk: false,
  localStorage: false,
  // Gun's node build auto-discovers LAN peers on 233.255.255.255:8765; any other
  // local Gun process would then join the write path. We only want the prod relay.
  multicast: false,
  file: GUN_FILE_DIR,
});
if (typeof hs.ready === "function") await hs.ready();

// Mirror every write to the Nostr relay as a signed NIP-01 event, exactly as
// the bot/web/kiosk do (gun stays the wire; the relay is the backup). Without
// this an import is the ONE writer in the monorepo with no relay copy — the
// worst thing to be when gun.holons.io is throwing ENOENT on its own radisk.
// The v1 positional constructor builds no identity, hence the explicit key.
if (!IMPORTER_KEY) {
  console.error(
    "FATAL: ATLAS_IMPORTER_NOSTR_KEY is not set — refusing to write unmirrored.\n" +
      "It lives in the gitignored root .env; run with `env $(grep -v '^#' ../../.env | xargs)` or export it.",
  );
  process.exit(1);
}
// Resolve core's built dist relative to THIS script, not the cwd: @holons/core
// is not linked into every workspace package, and require.resolve would hand
// back the .ts source (the "require" condition), which node cannot import.
const { enableRelayBackup } = await import(
  new URL("../packages/core/dist/holosphere/index.js", import.meta.url).href
);
const mirrored = await enableRelayBackup(hs, {
  relays: RELAYS,
  mode: RELAY_MODE,
  privateKey: IMPORTER_KEY,
  backend: "gun",
});
console.log(
  mirrored
    ? `relay backup ON (${RELAY_MODE}) -> ${RELAYS.join(", ")}`
    : `relay backup OFF — writes land on gun only`,
);
if (!mirrored) {
  console.error("FATAL: relay backup could not be enabled; refusing to write unmirrored.");
  process.exit(1);
}


if (typeof hs.getScalespace !== "function") {
  console.error("holosphere instance has no getScalespace(); aborting.");
  process.exit(1);
}

// ------------------------------- DEDUPE 3: against what is already on the lens
// Read the ~3km cell once per distinct cell (cached — communities cluster, so
// this is far fewer reads than points) and index what is already there by
// normalised name. A name match under a different id means some other source
// already put this community on the map: skip it rather than list it twice.
// Our own ids are expected and simply update in place.
const cellIndex = new Map(); // cell -> Map(normName -> existing id)

async function existingAt(cell) {
  if (cellIndex.has(cell)) return cellIndex.get(cell);
  const index = new Map();
  try {
    const items = await hs.getAll(cell, LENS);
    for (const it of items || []) {
      const nn = normName(it?.name || it?.title);
      if (nn) index.set(nn, it.id || it._key || "(unknown)");
    }
  } catch (e) {
    console.warn(`  dedupe probe failed for ${cell}: ${e?.message || e}`);
  }
  cellIndex.set(cell, index);
  return index;
}

async function isForeignDuplicate({ item, lat, lon }) {
  if (SKIP_REMOTE_DEDUPE || !h3) return null;
  const index = await existingAt(cellAt(lat, lon, DEDUPE_RES));
  const hit = index.get(normName(item.name));
  return hit && hit !== item.id ? hit : null;
}

// ---------------------------------------------------------------- write

let done = 0;
let failed = 0;
let skipped = 0;
let enoent = 0;

// holosphere's default put resolves `{queued:true}` after a 5s ack timeout —
// under load that means the write is still in Gun's outbound queue when the
// process exits, and it silently never reaches the relay. So: wait for the
// real relay ack (`timeout: 0`) under our own generous deadline, and retry
// anything that doesn't ack.
// The prod relay intermittently acks with `ENOENT ./holosphere/!` (its own radisk
// store failing to rename its temp file), and putCallback rejects on ack.err — so
// a put that is perfectly well-formed fails for reasons on the far side. The
// failures are per-write and not sticky, so back off and retry rather than giving
// up after three fast attempts: it takes the loss rate from ~35% to near zero.
// This does NOT make the write durable — see the relay-side ENOENT problem — it
// only stops a transient server fault from silently dropping records.
const PUT_ATTEMPTS = Number(process.env.PUT_ATTEMPTS || 6);

async function ackedPut(cell, item) {
  let lastErr = null;
  for (let attempt = 1; attempt <= PUT_ATTEMPTS; attempt++) {
    try {
      const res = await Promise.race([
        hs.put(cell, LENS, item, null, { timeout: 0 }),
        sleep(60000).then(() => ({ queued: true, _deadline: true })),
      ]);
      if (!res?.queued) return true;
      lastErr = "queued (no ack)";
    } catch (e) {
      lastErr = e?.message || String(e);
    }
    if (attempt < PUT_ATTEMPTS) await sleep(Math.min(500 * 2 ** (attempt - 1), 8000));
  }
  if (lastErr) enoent += /ENOENT/.test(lastErr) ? 1 : 0;
  return false;
}

// The record exists ONCE, at its res-14 home cell. The 14 parent cells get a
// hologram — `{id, soul}` pointing back at the home cell — carrying the same
// `_federation.origin` stamp holosphere's own parent propagation writes. That
// stamp is what makes the copies retractable: `propagateDeletion(home, lens, id)`
// recognises them via isPropagatedCopyOf and pulls the whole scalespace.
// (holosphere's propagate() would do this itself, but its parent-hexagon walk
// is nested inside `if (fedInfo.outbound.length > 0)` — a bare hexagon holon
// with no federation partners never reaches it. So we write the pointers here.)
function hologramFor(item, homeCell, parentCell) {
  return {
    ...hs.createHologram(homeCell, LENS, item),
    _federation: {
      origin: homeCell,
      sourceLens: LENS,
      propagatedAt: Date.now(),
      originalId: item.id,
      propagationType: "parent",
      parentLevel: 14 - h3.getResolution(parentCell),
    },
  };
}

async function importCommunity(entry) {
  const dupe = await isForeignDuplicate(entry);
  if (dupe) {
    skipped++;
    console.log(`  skip "${entry.item.name}" — already on lens as ${dupe}`);
    return;
  }
  const [homeCell, ...parents] = hs.getScalespace(entry.lat, entry.lon); // res 14 → 0

  // Home cell first: a hologram whose target does not exist yet resolves to
  // nothing, and holosphere's resolver treats a persistently unresolvable
  // pointer as deleted. The real record has to land before the pointers.
  if (!(await ackedPut(homeCell, entry.item))) {
    failed++;
    console.error(`put not acked ${entry.item.id} @ ${homeCell} (home)`);
    return; // no point scattering pointers at a record that never landed
  }

  // The 14 pointers are independent of each other and all target a record that
  // has already landed, so they go out together. Sequentially they cost 14 relay
  // round trips per community (~22s), which is the difference between a ~38-hour
  // import and a few hours.
  const acks = await Promise.all(
    parents.map(async (cell) => ({
      cell,
      ok: await ackedPut(cell, hologramFor(entry.item, homeCell, cell)),
    })),
  );
  for (const { cell, ok } of acks) {
    if (!ok) {
      failed++;
      console.error(`hologram not acked ${entry.item.id} @ ${cell}`);
    }
  }
  done++;
  if (done % 10 === 0)
    console.log(`  ${done}/${slice.length} communities written…`);
}

const queue = [...slice];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await importCommunity(queue.shift());
  }),
);

console.log(
  `\nwrote ${done}/${slice.length} communities (${skipped} skipped as duplicates, ${failed} failed puts, ${enoent} of them relay ENOENT)`,
);
console.log(`letting GUN sync for ${SETTLE_MS}ms before exit…`);
await sleep(SETTLE_MS);
process.exit(failed ? 1 : 0);
