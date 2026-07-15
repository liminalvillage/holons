// SPDX-License-Identifier: AGPL-3.0-or-later
// Import the regen.earth projects KML into the map's `projects` lens.
//
// The web map lights a hex when getAll(hex, 'projects') is non-empty at the
// CURRENT zoom resolution, so each project is written to every cell of its
// H3 scalespace (res 14 down to 0 — holosphere getScalespace) to be visible
// at any zoom. Items follow the Murmurations projects_schema-v0.1.0 shape the
// MapSidebar declares for this lens.
//
// SAFETY
//   - DRY RUN BY DEFAULT: parses + reports, writes nothing. Set WRITE=1 to persist.
//   - Idempotent: ids are stable slugs (regen-earth-<name>), re-runs update in place.
//
// HOW TO RUN (holosphere must resolve from cwd, same recipe as the backfill script)
//   cd packages/telegram-ui
//   node ../../scripts/import-projects-kml.mjs                    # dry run
//   WRITE=1 node ../../scripts/import-projects-kml.mjs            # write to prod
//
//   Full import, chunked (fresh process per chunk so GUN's graph can't OOM):
//     for s in $(seq 0 50 400); do
//       WRITE=1 START=$s COUNT=50 node ../../scripts/import-projects-kml.mjs || break
//     done
//
//   Optional env: HOLONS_APP (default Holons), HOLONS_PEER, KML=/path/to/file.kml,
//                 START/COUNT (project slice), CONCURRENCY, SETTLE_MS

import { readFileSync } from "fs";

const APP = process.env.HOLONS_APP || "Holons";
const PEER = process.env.HOLONS_PEER || "https://gun.holons.io/gun";
const WRITE = process.env.WRITE === "1";
const KML =
  process.env.KML ||
  "/Users/robertovalenti/Desktop/REGENERATIVA/To organize/Regenerative Project Documentaries.kml";
const SETTLE_MS = Number(process.env.SETTLE_MS || 10000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
// GUN's in-memory graph grows with every soul touched — a single process
// doing all ~5.8k puts OOMs. Chunk with START/COUNT and a fresh process per
// chunk (see the driver loop in the header comment).
const START = Number(process.env.START || 0);
const COUNT = Number(process.env.COUNT || Infinity);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- KML parse

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const stripHtml = (s) =>
  decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<img[^>]*>/gi, "")
      .replace(/<a[^>]*>/gi, "")
      .replace(/<\/a>/gi, "")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

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

    const rawDesc =
      (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
        [])[1] ||
      (block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] ||
      "";
    // Drop leading video-link lines (the KML opens each description with the
    // YouTube anchor text); the videos land in `urls` instead.
    const description = stripHtml(rawDesc)
      .replace(
        /^(?:https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\S*\s*)+/i,
        "",
      )
      .trim();

    const media =
      (block.match(
        /<Data name="gx_media_links">\s*<value>([\s\S]*?)<\/value>/,
      ) || [])[1]?.trim() || "";
    const videos = media
      ? media.split(/\s+/).filter((u) => u.startsWith("http"))
      : [];

    // Thumbnail from the first YouTube video, if any.
    const ytId = (videos[0] || "").match(
      /(?:embed\/|v=|youtu\.be\/)([\w-]{6,})/,
    )?.[1];
    const image = ytId
      ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`
      : undefined;

    // Primary URL: last non-YouTube link in the description text (the
    // project's own site, by regen.earth convention), else the video.
    const urlsInText = (
      description.match(/https?:\/\/[^\s<>"')\]]+/g) || []
    ).filter((u) => !/youtube\.com|youtu\.be|img\.youtube/.test(u));
    const primary_url = urlsInText[urlsInText.length - 1] || videos[0] || "";

    // "Region: Project Name" prefix convention of the regen.earth map.
    const region = name.includes(": ") ? name.split(": ")[0] : undefined;

    out.push({
      name,
      lat,
      lng,
      description,
      videos,
      image,
      primary_url,
      region,
    });
  }
  return out;
}

// ---------------------------------------------------------------- item shape

function toProjectItem(p) {
  const item = {
    id: `regen-earth-${slugify(p.name)}`,
    linked_schemas: ["projects_schema-v0.1.0"],
    name: p.name,
    title: p.name, // generic card components read `title`
    primary_url: p.primary_url,
    description: p.description,
    geolocation: { lat: p.lat, lon: p.lng },
    tags: ["regen.earth", "documentary"],
    source: "regen.earth",
  };
  if (p.region) item.region = p.region;
  if (p.image) item.image = p.image;
  if (p.videos.length) item.urls = p.videos;
  return item;
}

// ---------------------------------------------------------------- main

const xml = readFileSync(KML, "utf8");
const projects = parsePlacemarks(xml);

// Duplicate slugs would silently overwrite each other — disambiguate.
const seen = new Map();
const items = projects.map((p) => {
  const item = toProjectItem(p);
  const n = seen.get(item.id) || 0;
  seen.set(item.id, n + 1);
  if (n > 0) item.id = `${item.id}-${n + 1}`;
  return { item, lat: p.lat, lng: p.lng };
});

console.log(`\n=== Import regen.earth projects ===`);
console.log(`kml=${KML}`);
console.log(`app=${APP}  peer=${PEER}  mode=${WRITE ? "WRITE" : "DRY RUN"}`);
console.log(`parsed ${items.length} projects`);
const slice = items.slice(START, START + COUNT);
console.log(`slice: START=${START} COUNT=${slice.length}`);
console.log(`sample:`, JSON.stringify(items[0]?.item, null, 2)?.slice(0, 800));

if (!WRITE) {
  const bad = items.filter(({ item }) => !item.primary_url || !item.name);
  console.log(`\nprojects missing name/primary_url: ${bad.length}`);
  for (const { item } of bad.slice(0, 10)) console.log("  -", item.id);
  console.log(
    `\nDry run only. Re-run with WRITE=1 to persist ${items.length} projects`,
  );
  console.log(
    `(${items.length} x 15 scalespace cells = ${items.length * 15} puts).`,
  );
  process.exit(0);
}

// Resolve `holosphere` from the CURRENT WORKING DIR (run from a package that
// depends on it, e.g. packages/telegram-ui) — same recipe as the backfill.
const { createRequire } = await import("module");
const { pathToFileURL } = await import("url");
const requireFromCwd = createRequire(pathToFileURL(`${process.cwd()}/`));
const mod = await import(
  pathToFileURL(requireFromCwd.resolve("holosphere")).href
);
const HoloSphere = mod.HoloSphere || mod.default;

// radisk:false — we only push over the wire; a local radata copy of every
// touched soul both wastes disk and reloads into memory on the next chunk.
const hs = new HoloSphere(APP, false, null, {
  peers: [PEER],
  radisk: false,
  localStorage: false,
});
if (typeof hs.ready === "function") await hs.ready();

if (typeof hs.getScalespace !== "function") {
  console.error("holosphere instance has no getScalespace(); aborting.");
  process.exit(1);
}

let done = 0;
let failed = 0;

// holosphere's default put resolves `{queued:true}` after a 5s ack timeout —
// under load that means the write is still in Gun's outbound queue when the
// process exits, and it silently never reaches the relay. So: wait for the
// real relay ack (`timeout: 0`) under our own generous deadline, and retry
// anything that doesn't ack.
async function ackedPut(cell, item) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await Promise.race([
        hs.put(cell, "projects", item, null, { timeout: 0 }),
        sleep(60000).then(() => ({ queued: true, _deadline: true })),
      ]);
      if (!res?.queued) return true;
    } catch {
      // fall through to retry
    }
  }
  return false;
}

async function importProject({ item, lat, lng }) {
  const cells = hs.getScalespace(lat, lng); // res 14 → 0
  for (const cell of cells) {
    if (!(await ackedPut(cell, item))) {
      failed++;
      console.error(`put not acked ${item.id} @ ${cell}`);
    }
  }
  done++;
  if (done % 10 === 0)
    console.log(`  ${done}/${slice.length} projects written…`);
}

const queue = [...slice];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await importProject(queue.shift());
  }),
);

console.log(`\nwrote ${done}/${slice.length} projects (${failed} failed puts)`);
console.log(`letting GUN sync for ${SETTLE_MS}ms before exit…`);
await sleep(SETTLE_MS);
process.exit(failed ? 1 : 0);
