#!/usr/bin/env node
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turn an artizen.fyi leaderboard export into the graph the Artisan importer
// reads (scripts/import-artisan-graph.mjs, the declared schema).
//
//   node scripts/artizen-fyi-to-graph.mjs --in artizen-fyi.json --out graph.json \
//     [--project-owed raised|raised-sales] [--fund-owed available|none] \
//     [--catalog match-index.json] [--link-kinds funded,curated]
//
// WHAT THE LEADERBOARD HOLDS, and what it does not:
//   seasons.<n>.projects  name, slug, and what each RAISED in that season
//                         (sales + venus + match + prize + bonus)
//   seasons.<n>.funds     name, slug, contributions; in season 7 also what
//                         was unlocked to projects and what is still AVAILABLE
//   — no link from a project to the fund that matched it
//   — no people, and no wallets
//   — nothing that says how much of what was raised was ever paid out
//
// SO THIS ADAPTER ASSUMES, and says so in its report:
//   a project is OWED what it raised (`--project-owed`: a numeric column, or
//     columns added and subtracted — `raised-sales` is what was raised less
//     the community sales, for a platform that passed the sales on and kept
//     the promises), never below zero in a season, added up across the
//     seasons it appears in (one project per slug);
//   a fund is OWED what it still held to give (`--fund-owed available`, the
//     newest season that reports it) — the part already unlocked is in its
//     projects' `match`, so nothing is counted twice; `none` leaves funds out;
//   with no project → fund link in the leaderboard, a project names no fund:
//     the importer seats it straight in the Pot, a holon of its own beside
//     the funds, so a seat that retires is shared by the whole Pot.
//
// WHICH FUND STOOD BEHIND WHICH PROJECT is not in the leaderboard, but the
// same site's matching catalog (artizen.fyi/match/index.json) lists it:
// `relationships` of kind funded (the fund's match reached the project),
// curated (the fund chose it) and submitted (the project applied). With
// `--catalog`, each pair of the kinds in `--link-kinds` becomes a LINK the
// importer federates — fund ↔ project, both ways. A link says who is tied to
// whom; it carries no amount (the catalog has none) and moves nobody's share.
// A fund the catalog links but the leaderboard owes nothing is added without
// a seat in the Pot, so its links have a holon to land on.
//
// Writes the graph and prints the mapping the importer needs. Nothing is
// sent anywhere.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const IN = opt("in");
const OUT = opt("out", "artizen-graph.json");
const PROJECT_OWED = opt("project-owed", "raised");
const FUND_OWED = opt("fund-owed", "available");
const CATALOG = opt("catalog");
const LINK_KINDS = String(opt("link-kinds", "funded,curated")).split(",").map((s) => s.trim()).filter(Boolean);
if (!IN) {
  console.error("usage: --in <artizen-fyi.json> [--out <graph.json>]");
  process.exit(2);
}

const data = JSON.parse(readFileSync(IN, "utf8"));
const seasons = Object.keys(data.seasons ?? {}).sort((a, b) => Number(a) - Number(b));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (v) => Math.round(v * 100) / 100;

/** "raised-sales" → row → raised − sales; an unknown column is a mistake, not a zero. */
function columnSum(spec) {
  const terms = [...String(spec).matchAll(/([+-]?)\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => ({ sign: m[1] === "-" ? -1 : 1, column: m[2] }));
  if (!terms.length) {
    console.error(`--project-owed "${spec}" names no column`);
    process.exit(2);
  }
  const known = new Set(seasons.flatMap((s) => (data.seasons[s].projects ?? []).flatMap((p) => Object.keys(p))));
  for (const t of terms) {
    if (!known.has(t.column)) {
      console.error(`--project-owed: no project has a column "${t.column}"`);
      process.exit(2);
    }
  }
  return (row) => Math.max(0, terms.reduce((sum, t) => sum + t.sign * num(row[t.column]), 0));
}
const projectOwed = columnSum(PROJECT_OWED);

// Projects: one per slug, owed added up across seasons, newest name kept.
const projects = new Map();
for (const s of seasons) {
  for (const p of data.seasons[s].projects ?? []) {
    const slug = String(p.slug ?? "").trim();
    if (!slug) continue;
    const seen = projects.get(slug) ?? { id: slug, name: slug, owed: 0, seasons: [] };
    seen.name = String(p.name ?? slug).trim() || slug;
    seen.owed += projectOwed(p);
    seen.seasons.push(s);
    projects.set(slug, seen);
  }
}

const funds = [];

// Funds: the newest season that reports the column, one per slug.
let fundTotal = 0;
if (FUND_OWED !== "none") {
  const seenFunds = new Set();
  for (const s of [...seasons].reverse()) {
    for (const f of data.seasons[s].funds ?? []) {
      const slug = String(f.slug ?? "").trim();
      const owed = num(f[FUND_OWED]);
      if (!slug || seenFunds.has(slug) || !(owed > 0)) continue;
      seenFunds.add(slug);
      funds.push({ id: `fund:${slug}`, name: String(f.name ?? slug).trim() || slug, owed: round(owed) });
      fundTotal += owed;
    }
  }
}

const projectRows = [...projects.values()]
  .filter((p) => p.owed > 0)
  .sort((a, b) => (a.id < b.id ? -1 : 1))
  .map((p) => ({ id: p.id, name: p.name, owed: round(p.owed) }));

// Links: the catalog's project ↔ fund pairs, one per pair, the strongest kind kept.
const links = [];
let unseated = 0;
if (CATALOG) {
  const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
  const projectSlug = new Map((catalog.projects ?? []).map((p) => [p.id, String(p.slug ?? "")]));
  const fundOf = new Map((catalog.funds ?? []).map((f) => [f.id, f]));
  const seated = new Set(projectRows.map((p) => p.id));
  const fundIds = new Set(funds.map((f) => f.id));
  const rank = (kind) => LINK_KINDS.indexOf(kind);
  const pairs = new Map();
  for (const r of catalog.relationships ?? []) {
    if (rank(r.kind) < 0) continue;
    const project = projectSlug.get(r.projectId);
    const fund = fundOf.get(r.fundId);
    if (!project || !seated.has(project) || !fund?.slug) continue;
    const id = `fund:${fund.slug}`;
    if (!fundIds.has(id)) {
      fundIds.add(id);
      funds.push({ id, name: String(fund.name ?? fund.slug).trim() || fund.slug, linked: true });
      unseated++;
    }
    const key = `${project}\n${id}`;
    const seen = pairs.get(key);
    if (!seen || rank(r.kind) < rank(seen.kind)) pairs.set(key, { project, fund: id, kind: r.kind });
  }
  links.push(...[...pairs.values()].sort((a, b) => (a.project + a.fund < b.project + b.fund ? -1 : 1)));
}
const graph = {
  source: data.source,
  extracted: data.extracted,
  assumptions: { projectOwed: PROJECT_OWED, fundOwed: FUND_OWED, seasons, ...(CATALOG ? { linkKinds: LINK_KINDS } : {}) },
  funds: funds.filter((f) => f.owed > 0 || f.linked).map(({ linked: _l, ...f }) => f),
  projects: projectRows,
  people: [],
  links,
};
writeFileSync(OUT, JSON.stringify(graph, null, 1));

const projectTotal = projectRows.reduce((s, p) => s + p.owed, 0);
const fmt = (n) => Math.round(n).toLocaleString("en-US");
console.log(`Seasons ${seasons.join(", ")} · ${data.source ?? ""} · extracted ${data.extracted ?? "?"}`);
console.log(`${projectRows.length} projects owed ${fmt(projectTotal)} (column "${PROJECT_OWED}", added across seasons; ${[...projects.values()].filter((p) => p.seasons.length > 1).length} appear in more than one)`);
console.log(`${graph.funds.length - unseated} funds owed ${fmt(fundTotal)} (column "${FUND_OWED}")`);
if (CATALOG) {
  const linkedProjects = new Set(links.map((l) => l.project));
  const byKind = LINK_KINDS.map((k) => `${links.filter((l) => l.kind === k).length} ${k}`).join(", ");
  console.log(`${links.length} links (${byKind}) tie ${linkedProjects.size} projects to ${new Set(links.map((l) => l.fund)).size} funds; ${projectRows.length - linkedProjects.size} projects have none`);
  console.log(`${unseated} funds are linked but owed nothing — founded without a seat in the Pot`);
}
console.log(`every project is seated straight in the Pot — the leaderboard has no project → fund link`);
console.log(`0 people — the export names none`);
console.log(`\nGraph written to ${OUT}. Import it with this mapping:`);
console.log(JSON.stringify({ funds: { path: "funds" }, projects: { path: "projects" }, people: { path: "people" }, ...(CATALOG ? { links: { path: "links" } } : {}) }));
