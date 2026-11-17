#!/usr/bin/env node
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pull the artizen.fyi leaderboard and matching catalog as they stand now, in
// the shape scripts/artizen-fyi-to-graph.mjs reads.
//
//   node scripts/artizen-fyi-fetch.mjs --out artizen-fyi.json \
//     [--catalog-out match-index.json] [--seasons 6,7] [--compare old.json]
//
// The leaderboard has no data endpoint: each season's projects and funds are
// tables on artizen.fyi/projects?season=<n> and /funds?season=<n>, so this
// reads the tables (each figure's exact value is the cell's `data-order`).
// The catalog (fund ↔ project relationships, descriptions) is the site's
// own JSON at /match/index.json.
//
// With --compare, prints what moved since an earlier export: projects and
// funds that appeared or left, and the ones whose raised or available
// changed. Nothing is sent anywhere.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = opt("out", "artizen-fyi.json");
const CATALOG_OUT = opt("catalog-out");
const SEASONS = String(opt("seasons", "6,7"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const COMPARE = opt("compare");
const SITE = "https://artizen.fyi";

async function page(path) {
  const res = await fetch(`${SITE}${path}`, { redirect: "follow" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return new TextDecoder("utf-8", { fatal: false }).decode(await res.arrayBuffer());
}

/** Tags out, entities decoded, kept exactly as published otherwise. */
const plain = (html) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .trim();
const text = (html) => plain(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

/** Header labels → our column keys (the names the earlier export used). */
const PROJECT_KEYS = {
  Sales: "sales",
  "Venus sales": "venus_sales",
  "S+VS": "sales_plus_venus",
  Match: "match",
  "S+VS+M": "sales_venus_match",
  "Venus extras": "venus_extras",
  Prize: "prize",
  Bonus: "bonus",
  Raised: "raised",
  "V/S": "v_s",
  "M/S": "m_s",
  "P/S": "p_s",
  "B/S": "b_s",
  "R/S": "r_s",
};
const FUND_KEYS = { Created: "created", Contributions: "contributions", Unlocked: "unlocked", Available: "available", Raised: "raised" };

/** One table: its header labels and, per row, the link, the lead line and each cell. */
function table(html, id) {
  const start = id ? html.indexOf(`id="${id}"`) : html.indexOf("<table");
  if (start < 0) throw new Error(`no table ${id ?? ""}`);
  const body = html.slice(start, html.indexOf("</table>", start));
  const head = body.slice(body.indexOf("<thead>"), body.indexOf("</thead>"));
  const labels = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]));
  const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ attrs: c[1], html: c[2] })))
    .filter((cells) => cells.length === labels.length);
  return { labels, rows };
}

const orderOf = (cell) => {
  const m = cell.attrs.match(/data-order="([^"]*)"/);
  return m ? m[1] : text(cell.html);
};
const money = (cell) => {
  const n = Number(orderOf(cell));
  return Number.isFinite(n) ? n : 0;
};
const round = (n) => Math.round(n);
const ratio = (n) => Math.round(n * 10) / 10;

function nameCell(cell) {
  const link = cell.html.match(/href="\/(?:projects|funds)\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  const lead = cell.html.match(/<small[^>]*>([\s\S]*?)<\/small>/);
  return {
    name: link ? plain(link[2]) : text(cell.html),
    slug: link ? decodeURIComponent(link[1]) : "",
    description: lead ? text(lead[1]) : "",
    inactive: /inactive/i.test(cell.html),
  };
}

async function season(n) {
  const [projectsHtml, fundsHtml] = await Promise.all([page(`/projects?season=${n}`), page(`/funds?season=${n}`)]);
  const p = table(projectsHtml, "artizen-projects-table");
  const projects = p.rows.map((cells, i) => {
    const row = { rank: i + 1, ...(({ name, slug, description }) => ({ name, slug, description }))(nameCell(cells[0])) };
    p.labels.slice(1).forEach((label, j) => {
      const key = PROJECT_KEYS[label];
      if (!key) return;
      const v = money(cells[j + 1]);
      row[key] = key.endsWith("_s") ? ratio(v) : round(v);
    });
    return row;
  });
  const f = table(fundsHtml);
  const funds = f.rows.map((cells) => {
    const row = nameCell(cells[0]);
    f.labels.slice(1).forEach((label, j) => {
      const key = FUND_KEYS[label];
      if (!key) return;
      row[key] = key === "created" ? text(cells[j + 1].html) : round(money(cells[j + 1]));
    });
    return row;
  });
  return {
    season: Number(n),
    total_raised: round(projects.reduce((s, x) => s + (x.raised ?? 0), 0)),
    counts: { Projects: projects.length, Funds: funds.length },
    columns: p.labels,
    projects,
    funds,
  };
}

const seasons = {};
for (const n of SEASONS) {
  seasons[n] = await season(n);
  console.log(`season ${n}: ${seasons[n].projects.length} projects, ${seasons[n].funds.length} funds, raised ${seasons[n].total_raised.toLocaleString("en-US")}`);
}
const doc = {
  source: `${SITE} (unofficial Artizen leaderboard by Stephen Reid; github.com/stephenreid321/artizen-fyi)`,
  extracted: new Date().toISOString().slice(0, 10),
  column_definitions: {
    sales: "Community Artifact buys (excludes Venus)",
    venus_sales: "Venus (Artizen AI cofounder) Artifact purchases",
    match: "Match unlocked from Funds + Endowment",
    venus_extras: "Extra Venus contributions",
    prize: "Drive prizes",
    bonus: "Share of drive boost bonus pot (Season 7+)",
    raised: "sales + venus + match + prize + bonus",
  },
  seasons,
};
writeFileSync(OUT, JSON.stringify(doc, null, 2));
console.log(`leaderboard → ${OUT}`);

if (CATALOG_OUT) {
  const res = await fetch(`${SITE}/match/index.json`);
  if (!res.ok) throw new Error(`/match/index.json: HTTP ${res.status}`);
  const catalog = await res.json();
  writeFileSync(CATALOG_OUT, JSON.stringify(catalog));
  console.log(`catalog ${catalog.indexVersion} (generated ${catalog.generatedAt}): ${catalog.projects?.length} projects, ${catalog.funds?.length} funds, ${catalog.relationships?.length} relationships → ${CATALOG_OUT}`);
}

if (COMPARE) {
  const old = JSON.parse(readFileSync(COMPARE, "utf8"));
  for (const n of SEASONS) {
    const was = old.seasons?.[n];
    if (!was) {
      console.log(`season ${n}: not in ${COMPARE}`);
      continue;
    }
    for (const [kind, figure] of [
      ["projects", "raised"],
      ["funds", n === "7" ? "available" : "contributions"],
    ]) {
      const before = new Map((was[kind] ?? []).map((x) => [x.slug, x]));
      const after = new Map((seasons[n][kind] ?? []).map((x) => [x.slug, x]));
      const added = [...after.keys()].filter((s) => !before.has(s));
      const gone = [...before.keys()].filter((s) => !after.has(s));
      const moved = [...after.values()].filter((x) => before.has(x.slug) && Math.round(before.get(x.slug)[figure] ?? 0) !== Math.round(x[figure] ?? 0));
      const renamed = [...after.values()].filter((x) => before.has(x.slug) && before.get(x.slug).name !== x.name);
      console.log(`season ${n} ${kind}: ${added.length} new, ${gone.length} gone, ${moved.length} with a different ${figure}, ${renamed.length} renamed`);
      for (const x of moved.slice(0, 10)) console.log(`  ${x.slug}: ${figure} ${before.get(x.slug)[figure]} → ${x[figure]}`);
      for (const s of added.slice(0, 10)) console.log(`  + ${s}`);
      for (const s of gone.slice(0, 10)) console.log(`  - ${s}`);
    }
  }
}
