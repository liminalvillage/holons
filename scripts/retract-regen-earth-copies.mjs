// SPDX-License-Identifier: AGPL-3.0-or-later
// Retract the redundant regen.earth full copies from the parent hexagons and
// replace them with holograms, matching the shape import-atlas-communities.mjs
// writes.
//
// WHY
//   import-projects-kml.mjs wrote the SAME full record into all 15 cells of each
//   project's H3 scalespace. Those 14 parent copies are independent records: they
//   carry no `_federation` stamp and no soul, so `propagateDeletion` refuses to
//   touch them (isPropagatedCopyOf returns false) and every edit has to be applied
//   15 times. This converts each parent copy into a hologram pointing at the res-14
//   home cell, stamped `_federation.origin`, so the scalespace becomes retractable
//   and the record has one home again.
//
// HOW IT FINDS THEM
//   NOT by enumerating map cells — a cold getAll against the prod relay races the
//   handshake and under-reports, which would silently leave copies behind. Instead
//   the source KML is re-parsed with the exact same slug + item logic the original
//   importer used, so the ids and coordinates are re-derived deterministically,
//   then each one is confirmed by DIRECT KEY read at its home cell.
//
// SAFETY
//   - DRY RUN BY DEFAULT. Set WRITE=1 to persist.
//   - Verifies the home-cell record exists by direct key BEFORE touching parents.
//     A project whose home record is missing is reported and skipped untouched —
//     replacing its parents with pointers to nothing would erase it from the map.
//   - Idempotent: a parent that already holds a hologram is left alone.
//
// HOW TO RUN
//   cd packages/telegram-ui
//   node ../../scripts/retract-regen-earth-copies.mjs              # dry run
//   WRITE=1 node ../../scripts/retract-regen-earth-copies.mjs      # convert
//
//   Optional env: HOLONS_APP, HOLOSPHERE_RELAYS, KML=, LENS (default projects),
//                 START/COUNT, CONCURRENCY, SETTLE_MS

import { readFileSync } from "fs";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const requireFromCwd = createRequire(pathToFileURL(`${process.cwd()}/`));
const importFromCwd = (name) =>
  import(pathToFileURL(requireFromCwd.resolve(name)).href);

const APP = process.env.HOLONS_APP || "Holons";
const LENS = process.env.LENS || "projects";
const WRITE = process.env.WRITE === "1";
const KML =
  process.env.KML ||
  "/Users/robertovalenti/Desktop/REGENERATIVA/To organize/Regenerative Project Documentaries.kml";
const SETTLE_MS = Number(process.env.SETTLE_MS || 10000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const START = Number(process.env.START || 0);
const COUNT = Number(process.env.COUNT || Infinity);

// Resolve core"s built dist relative to THIS script, not the cwd: @holons/core
// is not linked into every workspace package.
const { resolveRelays } = await import(
  new URL("../packages/core/dist/holosphere/index.js", import.meta.url).href
);
const RELAYS = resolveRelays(process.env.HOLOSPHERE_RELAYS);
// Dedicated importer identity — never a person's key. A bulk import authors
// thousands of records at once; giving it its own pubkey keeps that provenance
// legible and makes the whole batch revocable/filterable without touching real
// users. Lives in the gitignored root .env.
const IMPORTER_KEY = process.env.ATLAS_IMPORTER_NOSTR_KEY || "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ parsing
// VERBATIM from import-projects-kml.mjs. These must stay byte-identical to that
// script's versions — the ids they produce are the keys already on the relay, so
// any drift here silently targets records that do not exist.

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

function parsePlacemarks(xml) {
  const out = [];
  const blocks = xml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) || [];
  for (const block of blocks) {
    const name = decodeEntities(
      (block.match(/<name>([\s\S]*?)<\/name>/) || [])[1]?.trim() || "",
    );
    const coords = (block.match(
      /<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/,
    ) || [])[1];
    if (!name || !coords) continue;
    const [lng, lat] = coords.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ name, lat, lng });
  }
  return out;
}

// Same id derivation, including the duplicate-slug suffix rule.
const xml = readFileSync(KML, "utf8");
const parsed = parsePlacemarks(xml);
const seen = new Map();
const projects = parsed.map((p) => {
  let id = `regen-earth-${slugify(p.name)}`;
  const n = seen.get(id) || 0;
  seen.set(id, n + 1);
  if (n > 0) id = `${id}-${n + 1}`;
  return { id, name: p.name, lat: p.lat, lng: p.lng };
});

console.log(`\n=== Retract regen.earth parent copies → holograms ===`);
console.log(`kml=${KML}`);
console.log(
  `app=${APP}  relays=${RELAYS.join(", ")}  lens=${LENS}  mode=${WRITE ? "WRITE" : "DRY RUN"}`,
);
console.log(`re-derived ${projects.length} projects from the KML`);

const slice = projects.slice(START, START + COUNT);
console.log(`slice: START=${START} COUNT=${slice.length}`);

// ---------------------------------------------------------------- connect

const h3 = await importFromCwd("h3-js");
const mod = await importFromCwd("holosphere");
const HoloSphere = mod.HoloSphere || mod.default;

// Every write is signed by the importer key and published to the relays as
// its own event — the import has exactly the same provenance trail as the
// bot/web/kiosk. Memory store: nothing needs to survive the process.
if (!IMPORTER_KEY) {
  console.error(
    "FATAL: ATLAS_IMPORTER_NOSTR_KEY is not set — refusing to write under a throwaway key.\n" +
      "It lives in the gitignored root .env; run with `env $(grep -v '^#' ../../.env | xargs)` or export it.",
  );
  process.exit(1);
}
const hs = new HoloSphere({
  appName: APP,
  privateKey: IMPORTER_KEY,
  relays: RELAYS,
  store: { adapter: "memory" },
});
await hs.ready();
console.log(`relays -> ${RELAYS.join(", ")}`);


// A cold get races the relay handshake and returns null on a key that exists.
// Retry before believing an absence — the whole point of this script is to not
// act on a phantom "missing".
async function getByKey(cell, id, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const rec = await hs.get(cell, LENS, id, null, {
        resolveHolograms: false,
        _skipAuthorize: true,
      });
      if (rec) return rec;
    } catch {
      // retry
    }
    if (i < attempts - 1) await sleep(1500);
  }
  return null;
}

async function ackedPut(cell, item) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ok = await Promise.race([
        hs.put(cell, LENS, item).then(() => true),
        sleep(60000).then(() => false),
      ]);
      if (ok) return true;
    } catch {
      // retry
    }
  }
  return false;
}

const stats = {
  homeOk: 0,
  homeMissing: 0,
  parentsConverted: 0,
  parentsAlreadyHologram: 0,
  parentsAbsent: 0,
  failed: 0,
};
const missing = [];

async function convert(p) {
  const [homeCell, ...parents] = hs.getScalespace(p.lat, p.lng);

  // The home record is the hologram target. If it is not there, pointing 14
  // parents at it would remove the project from the map entirely.
  const home = await getByKey(homeCell, p.id);
  if (!home || hs.isHologram(home)) {
    stats.homeMissing++;
    missing.push({ id: p.id, homeCell, reason: home ? "home is a hologram" : "no home record" });
    return;
  }
  stats.homeOk++;

  for (const cell of parents) {
    const existing = await getByKey(cell, p.id, 1);
    if (existing && hs.isHologram(existing)) {
      stats.parentsAlreadyHologram++;
      continue;
    }
    if (!existing) stats.parentsAbsent++;

    if (!WRITE) {
      if (existing) stats.parentsConverted++;
      continue;
    }
    const hologram = {
      ...hs.createHologram(homeCell, LENS, home),
      _federation: {
        origin: homeCell,
        sourceLens: LENS,
        propagatedAt: Date.now(),
        originalId: p.id,
        propagationType: "parent",
        parentLevel: 14 - h3.getResolution(cell),
      },
    };
    if (await ackedPut(cell, hologram)) stats.parentsConverted++;
    else {
      stats.failed++;
      console.error(`hologram not acked ${p.id} @ ${cell}`);
    }
  }
}

const queue = [...slice];
let processed = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      await convert(queue.shift());
      if (++processed % 10 === 0)
        console.log(`  ${processed}/${slice.length} projects…`);
    }
  }),
);

console.log(`\n--- results ---`);
console.log(`home records confirmed by direct key: ${stats.homeOk}`);
console.log(`home records MISSING (skipped untouched): ${stats.homeMissing}`);
for (const m of missing.slice(0, 15))
  console.log(`    - ${m.id} @ ${m.homeCell}: ${m.reason}`);
console.log(
  `parent copies ${WRITE ? "converted to holograms" : "that WOULD be converted"}: ${stats.parentsConverted}`,
);
console.log(`parents already holograms (left alone): ${stats.parentsAlreadyHologram}`);
console.log(`parents with no record at all (coverage gap): ${stats.parentsAbsent}`);
console.log(`failed puts: ${stats.failed}`);

if (!WRITE) {
  console.log(`\nDry run only. Re-run with WRITE=1 to convert.`);
  process.exit(0);
}

console.log(`letting the relay publishes drain for ${SETTLE_MS}ms before exit…`);
await sleep(SETTLE_MS);
await hs.close();
process.exit(stats.failed ? 1 : 0);
