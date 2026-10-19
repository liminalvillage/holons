#!/usr/bin/env node
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fork the Artisan graph into Holons: every fund, project and person, with
// the amount each was owed, becomes a seat in a tree of holons under one
// empty Pot. The money is not copied — only who was promised what.
//
//   node --env-file=.env scripts/import-artisan-graph.mjs \
//     --export artisan.json --map mapping.json --out artisan-map.json \
//     [--pot-name "Artisan Pot"] [--namespace artisan-2026] \
//     [--admins npub1…,npub1…] [--bot <hex pubkey>] \
//     [--pot-split legacy=100] [--fund-split legacy=100] \
//     [--project-split legacy=100] \
//     [--fund-zones funded=1,curated=1] [--fund-keep 0] [--fund-slope 50] \
//     [--claim-months 6] [--claim-until 2027-04-11] \
//     [--write] [--zones-only]
//
// DRY RUN BY DEFAULT: parses, maps, prints the graph, writes nothing. Pass
// --write to found the holons and save their splits, through the same core
// the MCP and the bot use (HOLONS_APP, HOLOSPHERE_RELAYS, HOLOSPHERE_NSEC —
// the importer key founds every holon and is its first admin).
//
// THE DECLARED SCHEMA (what --map turns the export into):
//   {
//     funds:    [{ id, name, owed? }],
//     projects: [{ id, name, fund?, owed }],
//     people:   [{ id, name, project, owed, telegram?, npub?, wallet? }],
//     links?:   [{ project, fund, kind? }]
//   }
// A `link` federates a project with a fund besides the one it is seated in —
// a fund that matched or curated it. It carries no amount and moves no share.
//
// THE STARTING CURATION: a fund splits equally across the projects it is
// linked to — one zone holding them all (`--fund-zones funded=1,curated=1`,
// the default), nothing held back. `--fund-zones funded=1,curated=2` places
// each linked project in a zone by the kind of its link instead (the
// strongest kind wins), with as many zones as the highest named, the slope of
// `--fund-slope` (each zone out weighs slope/100 of the one before) and
// `--fund-keep` percent held back for the fund's own contributors. A fund
// with no link keeps its whole share. `--fund-zones none` writes no zones and
// leaves curation to the fund. `--zones-only` (with --write) rewrites just
// these placements on a graph already imported.
//
// THE CLAIM WINDOW: project seats may be claimed for `--claim-months` (default
// 6; 0 for no window) from the first run, or until `--claim-until <date>`. It
// is written on every holon that seats projects — the Pot, where its funds are
// kept without a claim — and a seat still unclaimed when it closes is retired
// at the next cut: its share spreads over everyone left. A re-run keeps the
// date in the output file.
// `owed` is in one unit (the Pot's token); `fund` and `project` name the
// parent's id. A project that names no fund is seated straight in the Pot, a
// holon of its own beside the funds. --map is a JSON object naming, for each of the three lists,
// where it is in the export and which column holds each field:
//   {
//     "funds":    { "path": "funds",    "fields": { "id": "slug", "name": "title", "owed": "allocated" } },
//     "projects": { "path": "projects", "fields": { "id": "id", "name": "name", "fund": "fund_id", "owed": "amount_owed" } },
//     "people":   { "path": "allocations", "fields": { "id": "user_id", "name": "user.name", "project": "project_id", "owed": "amount", "telegram": "user.telegram_id", "npub": "user.npub", "wallet": "user.address" } }
//   }
// A `path` is dotted into the export (an array at the end); a field is dotted
// into each row. A CSV export is one list per file: give the path as a file
// name ("people": { "path": "./people.csv", … }). Rows with no parent or no
// positive `owed` are dropped and listed.
//
// IDS ARE DETERMINISTIC: a holon id is minted from sha256(namespace, kind,
// source id), so a re-run finds the same holons and tops them up rather than
// forking a second graph. A person with a Telegram id is seated under it
// (their personal holon); with an npub, under the hex key; otherwise under a
// placeholder `artisan:<id>` that they claim later with a credit code.
//
// WHAT IS WRITTEN per node (idempotent):
//   found the holon (importer key = genesis; --admins and --bot seated as admins)
//   settings.name
//   fund ↔ project federation link (so the fund's picker can see its seats),
//     and one more per `links` row
//   allocation: interior 100 %, buckets per --*-split, legacy weights = owed
//     pot:     buckets over the FUNDS — and the projects no fund seats — by
//              what each was owed, locked at genesis with the claim window
//     fund:    buckets over its PROJECTS
//     project: buckets over its PEOPLE, plus credit codes (one per placeholder)
//              and its own claim code (a seat claim naming the holon that seats it)
//   the Pot's walk bound (settings.pot.walk) is NOT set here: set it with
//   pot_record_set / savePotWalk once the Pot is deployed (≥ every party in the
//   tree: funds + projects + people; the walk reads each one once).
//
// THE OUTPUT FILE (--out, keep it private — it holds the plain codes):
//   { pot, funds: {srcId → holon}, projects: {srcId → {holon, fund, code, token, link}}, links,
//     people: {srcId → {party, project, code?}}, claimUntil, admins, bot, at }
//   A project's group claims it with `/claimproject <token>` (the deep link
//   carries the token); a person claims their seat there with `/claimcredit <code>`.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");

// ── arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const WRITE = args.includes("--write");
const EXPORT = opt("export");
const MAP = opt("map");
const OUT = opt("out", "artisan-map.json");
const POT_NAME = opt("pot-name", "Artisan Pot");
const NAMESPACE = opt("namespace", "artisan");
const ADMINS = (opt("admins", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const BOT = (opt("bot", "") || "").trim();
const BOT_USERNAME = (opt("bot-username", process.env.BOT_USERNAME || "") || "").replace(/^@/, "");
if (!EXPORT || !MAP) {
  console.error("usage: --export <file> --map <mapping.json> [--out <file>] [--write]");
  process.exit(2);
}

/** "legacy=40,needs=30,impact=30" → bucket list (shares filled per node). */
function parseSplit(spec, fallback) {
  const text = spec ?? fallback;
  const out = [];
  for (const part of String(text).split(",")) {
    const [id, pct] = part.split("=").map((s) => s.trim());
    const percent = Number(pct);
    if (!id || !(percent >= 0)) continue;
    const mode = id === "legacy" ? "custom" : id === "needs" ? "needs" : id === "impact" ? "equation" : id === "equal" ? "equal" : null;
    if (!mode) {
      console.error(`unknown bucket "${id}" — use legacy, needs, impact or equal`);
      process.exit(2);
    }
    out.push({ id, percent, mode });
  }
  return out;
}
const POT_SPLIT = parseSplit(opt("pot-split"), "legacy=100");
const FUND_SPLIT = parseSplit(opt("fund-split"), "legacy=100");
const PROJECT_SPLIT = parseSplit(opt("project-split"), "legacy=100");
const ZONES_ONLY = args.includes("--zones-only");
/** "funded=1,curated=2" → link kind → zone. Default: one zone, so an equal split. "none": the importer curates nothing. */
const FUND_ZONES = Object.fromEntries(
  String(opt("fund-zones", "funded=1,curated=1") || "")
    .split(",")
    .map((part) => part.split("=").map((s) => s.trim()))
    .filter(([kind, zone]) => kind && Number(zone) >= 1)
    .map(([kind, zone]) => [kind, Math.floor(Number(zone))]),
);
const FUND_KEEP = Math.min(100, Math.max(0, Number(opt("fund-keep", 0)) || 0));
const FUND_SLOPE = Math.min(100, Math.max(0, Number(opt("fund-slope", 50))));
const FUND_NZONES = Math.max(0, ...Object.values(FUND_ZONES));

// ── reading the export through the map ──────────────────────────────────────
const dig = (obj, path) => String(path ?? "").split(".").filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** A tiny CSV reader: quoted fields, commas, CRLF. Header row names the columns. */
function readCsv(file) {
  const text = readFileSync(file, "utf8");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((v) => v !== "")) rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

const exported = EXPORT.endsWith(".csv") ? null : JSON.parse(readFileSync(EXPORT, "utf8"));
const mapping = JSON.parse(readFileSync(MAP, "utf8"));

function listOf(kind) {
  const spec = mapping[kind];
  if (!spec) return { rows: [], fields: {} };
  const path = String(spec.path ?? kind);
  const rows = path.endsWith(".csv") ? readCsv(resolve(path)) : (dig(exported, path) ?? []);
  if (!Array.isArray(rows)) {
    console.error(`${kind}: "${path}" is not a list in the export`);
    process.exit(2);
  }
  return { rows, fields: spec.fields ?? {} };
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const str = (v) => (v == null ? "" : String(v).trim());

function shape(kind, required, optional = []) {
  const { rows, fields } = listOf(kind);
  const out = [];
  const dropped = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    const rec = {};
    for (const f of [...required, ...optional]) {
      const col = fields[f] ?? f;
      rec[f] = f === "owed" ? num(dig(row, col)) : str(dig(row, col));
    }
    const why = !rec.id ? "no id" : seen.has(rec.id) ? "duplicate id" : required.includes("owed") && !(rec.owed > 0) ? "nothing owed" : required.some((f) => f !== "owed" && !rec[f]) ? "missing field" : null;
    if (why) return dropped.push({ row: i + 1, id: rec.id || "?", why });
    seen.add(rec.id);
    if (!rec.name) rec.name = rec.id;
    out.push(rec);
  });
  return { list: out, dropped };
}

const funds = shape("funds", ["id", "name"], ["owed"]);
const projects = shape("projects", ["id", "name", "owed"], ["fund"]);
const people = shape("people", ["id", "name", "project", "owed"], ["telegram", "npub", "wallet"]);
const linkRows = (() => {
  const { rows, fields } = listOf("links");
  return rows.map((row) => ({ project: str(dig(row, fields.project ?? "project")), fund: str(dig(row, fields.fund ?? "fund")), kind: str(dig(row, fields.kind ?? "kind")) }));
})();

const fundIds = new Set(funds.list.map((f) => f.id));
const projectIds = new Set(projects.list.map((p) => p.id));
const orphanProjects = projects.list.filter((p) => p.fund && !fundIds.has(p.fund));
const orphanPeople = people.list.filter((p) => !projectIds.has(p.project));
projects.list = projects.list.filter((p) => !p.fund || fundIds.has(p.fund));
people.list = people.list.filter((p) => projectIds.has(p.project));
const keptProjects = new Set(projects.list.map((p) => p.id));
const seenLinks = new Set();
const links = linkRows.filter((l) => {
  const key = `${l.project}\n${l.fund}`;
  if (!keptProjects.has(l.project) || !fundIds.has(l.fund) || seenLinks.has(key)) return false;
  seenLinks.add(key);
  return true;
});

// ── ids, codes ──────────────────────────────────────────────────────────────
const sha = (s) => createHash("sha256").update(s).digest();
const hex = (b) => Buffer.from(b).toString("hex");

const { newHolonId } = await import(`${root}/packages/core/dist/protocol/index.js`);
const { normalizePubkey } = await import(`${root}/packages/core/dist/users/index.js`);
const { seatClaim } = await import(`${root}/packages/core/dist/flows/index.js`);

const holonIdFor = (kind, id) => newHolonId(() => sha(`${NAMESPACE}:${kind}:${id}`));
const POT = holonIdFor("pot", POT_NAME);

/** A person's party id: their Telegram id, their key, or a placeholder. */
function partyFor(p) {
  if (/^-?\d{1,20}$/.test(p.telegram || "")) return { party: p.telegram, placeholder: false };
  const key = p.npub ? normalizePubkey(p.npub) : null;
  if (key) return { party: key, placeholder: false };
  return { party: `artisan:${p.id}`, placeholder: true };
}

const codeAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";
const newCode = () => {
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += codeAlphabet[b % codeAlphabet.length];
  return out;
};
const codeHash = (code) => hex(sha(`holons-claim:${code}`));
/** What a group's admin hands the bot: the project the code is kept on, and the code. */
const claimToken = (projectHolon, code) => `${projectHolon}_${code}`;
const deepLink = (token) => (BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?startgroup=artisan_${token}` : `/claimproject ${token}`);

// A previous run's output keeps its codes, so re-running changes nothing.
let previous = null;
try {
  previous = JSON.parse(readFileSync(OUT, "utf8"));
} catch {
  previous = null;
}

// The claim window: a date given, the one a previous run set, or so many months from now.
const CLAIM_MONTHS = Math.max(0, Number(opt("claim-months", 6)) || 0);
const claimUntil = (() => {
  const given = opt("claim-until");
  if (given) {
    const at = Date.parse(given);
    if (!Number.isFinite(at)) {
      console.error(`--claim-until "${given}" is not a date`);
      process.exit(2);
    }
    return at;
  }
  if (!CLAIM_MONTHS) return null;
  const kept = Date.parse(previous?.claimUntil ?? "");
  if (Number.isFinite(kept)) return kept;
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + CLAIM_MONTHS);
  return d.getTime();
})();

const plan = {
  pot: { holon: POT, name: POT_NAME, split: POT_SPLIT, shares: {} },
  funds: {},
  projects: {},
  people: {},
  links: [],
  admins: ADMINS,
  bot: BOT || null,
  namespace: NAMESPACE,
  ...(claimUntil ? { claimUntil: new Date(claimUntil).toISOString() } : {}),
  at: new Date().toISOString(),
};
for (const f of funds.list) {
  const holon = holonIdFor("fund", f.id);
  plan.funds[f.id] = { holon, name: f.name, split: FUND_SPLIT, shares: {}, codes: {} };
  const owed = f.owed > 0 ? f.owed : projects.list.filter((p) => p.fund === f.id).reduce((s, p) => s + p.owed, 0);
  if (owed > 0) plan.pot.shares[holon] = owed;
}
for (const p of projects.list) {
  const holon = holonIdFor("project", p.id);
  const code = previous?.projects?.[p.id]?.code || newCode();
  // Seated in its fund, or — naming none — straight in the Pot. Either way the
  // claim code rides on the project's own holon and names where its seat is.
  const seat = p.fund ? plan.funds[p.fund] : plan.pot;
  const token = claimToken(holon, code);
  plan.projects[p.id] = { holon, name: p.name, fund: seat.holon, fundSrc: p.fund || null, owed: p.owed, code, token, link: deepLink(token), split: PROJECT_SPLIT, shares: {}, codes: { [codeHash(code)]: seatClaim(seat.holon) } };
  seat.shares[holon] = (seat.shares[holon] ?? 0) + p.owed;
}
for (const person of people.list) {
  const { party, placeholder } = partyFor(person);
  const project = plan.projects[person.project];
  const code = placeholder ? previous?.people?.[person.id]?.code || newCode() : undefined;
  plan.people[person.id] = { party, name: person.name, project: project.holon, projectSrc: person.project, owed: person.owed, ...(code ? { code } : {}), ...(person.wallet ? { wallet: person.wallet } : {}) };
  project.shares[party] = (project.shares[party] ?? 0) + person.owed;
  if (code) project.codes[codeHash(code)] = party;
}

for (const l of links) {
  const project = plan.projects[l.project];
  const fund = plan.funds[l.fund];
  if (project.fund === fund.holon) continue; // already linked as its seat
  plan.links.push({ project: project.holon, fund: fund.holon, projectSrc: l.project, fundSrc: l.fund, ...(l.kind ? { kind: l.kind } : {}) });
  const zone = FUND_ZONES[l.kind];
  if (zone) {
    fund.zones ??= {};
    fund.zones[project.holon] = Math.min(fund.zones[project.holon] ?? zone, zone);
  }
}
const zonedFunds = Object.values(plan.funds).filter((f) => f.zones);
if (FUND_NZONES) plan.curation = { zones: FUND_ZONES, nzones: FUND_NZONES, keep: FUND_KEEP, slope: FUND_SLOPE };

// ── the report ──────────────────────────────────────────────────────────────
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US");
console.log(`Pot ${POT_NAME} → ${POT}  split ${POT_SPLIT.map((b) => `${b.id}=${b.percent}`).join(",")}  (locked at genesis)`);
console.log(claimUntil ? `Project seats may be claimed until ${plan.claimUntil.slice(0, 10)}; one left unclaimed is then shared among the rest.` : "No claim window: a project seat may be claimed any time.");
const line = (pid, p) => {
  const seats = Object.keys(p.shares).length;
  const placeholders = Object.values(plan.people).filter((x) => x.projectSrc === pid && x.code).length;
  return `project ${p.name} [${pid}] → ${p.holon}  owed ${fmt(p.owed)}  people ${seats} (${placeholders} to claim)  claim: /claimproject ${p.token}`;
};
for (const [id, f] of Object.entries(plan.funds)) {
  const total = Object.values(f.shares).reduce((s, v) => s + v, 0);
  console.log(`  fund ${f.name} [${id}] → ${f.holon}  owed ${fmt(plan.pot.shares[f.holon] ?? 0)}  projects ${Object.keys(f.shares).length} (${fmt(total)})`);
  for (const [pid, p] of Object.entries(plan.projects).filter(([, p]) => p.fundSrc === id)) console.log(`    ${line(pid, p)}`);
}
for (const [pid, p] of Object.entries(plan.projects).filter(([, p]) => !p.fundSrc)) console.log(`  ${line(pid, p)}`);
const problems = [
  ...funds.dropped.map((d) => `funds row ${d.row} (${d.id}): ${d.why}`),
  ...projects.dropped.map((d) => `projects row ${d.row} (${d.id}): ${d.why}`),
  ...people.dropped.map((d) => `people row ${d.row} (${d.id}): ${d.why}`),
  ...orphanProjects.map((p) => `project ${p.id}: fund ${p.fund} is not in the export`),
  ...orphanPeople.map((p) => `person ${p.id}: project ${p.project} is not in the export`),
];
if (problems.length) {
  console.log(`\nDropped (${problems.length}):`);
  for (const p of problems) console.log("  " + p);
}
if (linkRows.length) console.log(`\n${plan.links.length} fund ↔ project links to federate (${linkRows.length - links.length} rows named a project or fund that is not in the graph).`);
if (FUND_NZONES) {
  const placed = zonedFunds.reduce((s, f) => s + Object.keys(f.zones).length, 0);
  console.log(`${zonedFunds.length} funds start curated: ${placed} placements over ${FUND_NZONES} zones (${Object.entries(FUND_ZONES).map(([k, z]) => `${k} → zone ${z}`).join(", ")}), slope ${FUND_SLOPE}, ${FUND_KEEP} % kept by the fund.`);
}
const noWallet = Object.values(plan.people).filter((p) => !p.wallet).length;
console.log(`\n${Object.keys(plan.funds).length} funds, ${Object.keys(plan.projects).length} projects, ${Object.keys(plan.people).length} people (${noWallet} without a wallet in the export).`);
// The walk reads every party once — people too — to ask whether they pass anything on.
console.log(`Set the Pot's walk bound to at least ${1 + Object.keys(plan.funds).length + Object.keys(plan.projects).length + Object.keys(plan.people).length} holons once it is deployed (more as groups seat their members).`);

writeFileSync(OUT, JSON.stringify(plan, null, 2));
console.log(`\nMap written to ${OUT} — it holds the plain claim codes; keep it private.`);
if (!WRITE) {
  console.log("Dry run: nothing written to the relays. Pass --write to found the holons.");
  process.exit(0);
}

// ── writing ─────────────────────────────────────────────────────────────────
const { getHoloSphere } = await import(`${root}/packages/mcp-ui/dist/holosphere.js`);
const { foundHolon } = await import(`${root}/packages/core/dist/protocol/index.js`);
const { saveAllocationConfig, savePayoutAddress } = await import(`${root}/packages/core/dist/flows/index.js`);
const { setFederationPartner, getFederationSnapshot } = await import(`${root}/packages/core/dist/federation/index.js`);

const hs = await getHoloSphere();
const members = [...ADMINS.map((k) => [k, "admin"]), ...(BOT ? [[BOT, "admin"]] : [])];

const link = async (holon, partner, partnerName) => {
  const before = await getFederationSnapshot(hs, holon).catch(() => ({ federated: [] }));
  if (before.federated.includes(partner)) return;
  await setFederationPartner(hs, holon, partner, { partnerName, inbound: [], outbound: [] });
};

/** Buckets for a node: the legacy bucket carries its owed weights. */
const bucketsFor = (split, shares) => split.map((b) => (b.mode === "custom" ? { ...b, shares } : b));

const seat = async (holon, name, split, shares, extra) => {
  const r = await foundHolon(hs, holon, { name, members });
  await saveAllocationConfig(hs, holon, { interiorPercent: 100, interiorMode: "custom", nzones: 0, steepness: 50 }, undefined, undefined, undefined, {
    buckets: bucketsFor(split, shares),
    ...extra,
  });
  console.log(`${r.founded ? "founded" : "updated"} ${name} (${holon})${r.added.length ? ` seated ${r.added.length}` : ""}`);
};

/** The claim window on a holon that seats projects; `keep` names the seats that are not projects. */
const windowFor = (node) => {
  if (!claimUntil) return {};
  const projectHolons = new Set(Object.values(plan.projects).map((p) => p.holon));
  const seats = Object.keys(node.shares);
  if (!seats.some((id) => projectHolons.has(id))) return {};
  return { claimWindow: { until: claimUntil, keep: seats.filter((id) => !projectHolons.has(id)) } };
};

/** A fund's starting curation: its linked projects on their zones, the rest of the split as it stands. */
const curate = async (f) => {
  await saveAllocationConfig(hs, f.holon, { interiorPercent: FUND_KEEP, nzones: FUND_NZONES, steepness: FUND_SLOPE }, f.zones);
  console.log(`curated ${f.name} (${f.holon}): ${Object.keys(f.zones).length} projects placed`);
};

try {
  if (ZONES_ONLY) {
    for (const f of zonedFunds) await curate(f);
    console.log(`\nDone: ${zonedFunds.length} funds curated; nothing else was written.`);
  } else {
  await seat(POT, POT_NAME, POT_SPLIT, plan.pot.shares, { ...windowFor(plan.pot), genesis: true, force: true });
  for (const f of Object.values(plan.funds)) {
    await seat(f.holon, f.name, f.split, f.shares, windowFor(f));
    await link(POT, f.holon, f.name);
  }
  for (const p of Object.values(plan.projects)) {
    await seat(p.holon, p.name, p.split, p.shares, { codes: p.codes });
    // A project its fund seats is linked to it. One seated straight in the Pot
    // is not: the Pot's federation record would have to name every project.
    if (p.fundSrc) await link(p.fund, p.holon, p.name);
  }
  for (const l of plan.links) await link(l.fund, l.project, plan.projects[l.projectSrc].name);
  if (plan.links.length) console.log(`federated ${plan.links.length} fund ↔ project links`);
  // Zones count only for federated partners, so they are placed after the links.
  for (const f of zonedFunds) await curate(f);
  // A person with a wallet in the export is paid there from the first table.
  for (const person of Object.values(plan.people)) {
    if (!person.wallet || person.code) continue; // a placeholder's wallet is set by whoever claims it
    try {
      await savePayoutAddress(hs, person.party, person.wallet);
    } catch (err) {
      console.warn(`payout address for ${person.party} not saved: ${err?.message || err}`);
    }
  }
  console.log("\nDone. Next: deploy the Pot on the Pot holon (owner = the genesis Safe), set its walk bound, hand each project its link.");
  }
} finally {
  await hs.close?.().catch?.(() => {});
}
