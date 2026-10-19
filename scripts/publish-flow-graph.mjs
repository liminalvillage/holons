#!/usr/bin/env node
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Publish the flow graph of a Pot: every fund, project and person its income
// reaches, each once, with the share that travels each edge — the snapshot
// the Flows explorer loads in one read.
//
//   node --env-file=.env scripts/publish-flow-graph.mjs --pot <holon> \
//     [--holons 5000] [--depth 6] [--nodes N] [--concurrency 8] \
//     [--no-standing] [--no-federated] [--out flow-graph.json] [--write]
//
// DRY RUN BY DEFAULT: walks the Pot, prints what it found, writes nothing to
// the relays. Pass --write to publish, through the same core the MCP and the
// bot use (HOLONS_APP, HOLOSPHERE_RELAYS, HOLOSPHERE_NSEC — the key must be
// one the Pot holon accepts writes from; the importer key is).
//
// THE WALK reads the settings of every holon under the Pot once, and with
// standing (the default) its exits and needs too — minutes on a Pot with a
// couple of thousand seats. `--no-standing` is for a quick look only: what
// is published should be what the cut pays, and the cut reads standing.
// The bounds default to the Pot record's walk (`settings.pot.walk`), then to
// 5000 holons, 6 hops. A walk a bound cut short is published as partial and
// says so.
//
// THE SNAPSHOT is a head and numbered parts on the Pot's "flow_graph" lens,
// each part well under a relay's 64 KB event limit. Parts are written first
// and the head last; after a --write the lens is read back to confirm the
// whole generation landed.
//
// `--out` saves the graph as read, for a look. It holds ids, names and payout
// addresses — all public on the relays already — and no claim codes: this
// script never reads the importer's artisan-map file.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");

// ── arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const int = (name) => {
  const raw = opt(name);
  if (raw == null) return undefined;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) {
    console.error(`--${name} takes a whole number`);
    process.exit(2);
  }
  return n;
};
const WRITE = args.includes("--write");
const POT = opt("pot");
const OUT = opt("out");
const STANDING = !args.includes("--no-standing");
const FEDERATED = !args.includes("--no-federated");

if (!POT) {
  console.error("usage: --pot <holon> [--holons N] [--depth N] [--nodes N] [--concurrency N] [--no-standing] [--no-federated] [--out <file>] [--write]");
  process.exit(2);
}

const { getHoloSphere, getApp } = await import(`${root}/packages/mcp-ui/dist/holosphere.js`);
const {
  crawlFlowGraph,
  encodeFlowGraph,
  publishFlowGraph,
  loadFlowGraph,
  scoreAllocationMembers,
  standingOf,
  resourcesOf,
  lunationAt,
  FLOW_GRAPH_PART_BYTES,
} = await import(`${root}/packages/core/dist/flows/index.js`);

const hs = await getHoloSphere();
try {
  const app = typeof getApp === "function" ? getApp() : process.env.HOLONS_APP;
  console.log(`Reading the flow graph of ${POT} in "${app}"${STANDING ? "" : " (no standing)"}…`);
  const started = Date.now();
  const graph = await crawlFlowGraph(hs, POT, {
    maxHolons: int("holons"),
    maxDepth: int("depth"),
    maxNodes: int("nodes"),
    concurrency: int("concurrency") ?? 8,
    scoreOf: (id) => scoreAllocationMembers(hs, id),
    ...(STANDING ? { standingOf: standingOf(hs) } : {}),
    resourcesOf: resourcesOf(hs),
    includeFederated: FEDERATED,
    epoch: lunationAt(Date.now()).index,
  });
  console.log(`Read in ${Math.round((Date.now() - started) / 1000)} s.\n`);

  // ── what was found ────────────────────────────────────────────────────────
  const kinds = {};
  for (const n of graph.nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
  const pct = (n) => `${n.toFixed(n >= 10 ? 1 : 2)}%`;
  const top = (kind) =>
    graph.nodes
      .filter((n) => n.kind === kind)
      .sort((a, b) => b.share - a.share)
      .slice(0, 10)
      .map((n) => `    ${pct(n.share).padStart(7)}  ${n.label}  (${n.id})`)
      .join("\n");

  console.log(`Parties: ${graph.nodes.length}  (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")})`);
  console.log(`Links:   ${graph.links.length}`);
  console.log(`Claimed seats: ${graph.aliases.length}   Unclaimed: ${graph.nodes.filter((n) => n.unclaimedUntil).length}   With a payout address: ${graph.nodes.filter((n) => n.payout).length}`);
  console.log(`Unseated (on the map, no share): ${graph.nodes.filter((n) => !(n.share > 0)).length}`);
  if (graph.cycles.length) console.log(`Loops: ${graph.cycles.length}  e.g. ${graph.cycles[0].join(" → ")}`);
  const rested = graph.nodes.reduce((s, n) => s + n.rest, 0);
  console.log(`Rests somewhere: ${pct(rested)} of the Pot`);
  console.log(graph.complete ? "Complete." : `PARTIAL — ${graph.problems.join("; ") || "a bound cut the walk"}`);
  if (kinds.fund) console.log(`\nLargest funds:\n${top("fund")}`);
  if (kinds.project) console.log(`\nLargest projects:\n${top("project")}`);

  const { head, parts } = encodeFlowGraph(graph);
  const sizes = parts.map((p) => Buffer.byteLength(JSON.stringify(p)));
  console.log(`\nSnapshot: ${parts.length} parts, ${sizes.reduce((s, n) => s + n, 0)} bytes, largest ${Math.max(0, ...sizes)} (bound ${FLOW_GRAPH_PART_BYTES}), generation ${head.gen}`);

  if (OUT) {
    writeFileSync(resolve(OUT), JSON.stringify(graph, null, 1));
    console.log(`Graph saved to ${OUT}`);
  }

  if (!WRITE) {
    console.log("\nDry run: nothing written to the relays. Pass --write to publish.");
  } else {
    const out = await publishFlowGraph(hs, POT, graph);
    const back = await loadFlowGraph(hs, POT);
    if (!back.ok || back.head.gen !== out.head.gen) {
      console.error(`\nPublished ${out.parts} parts, but the lens does not read back whole (${back.ok ? "another generation" : back.reason}). A relay may have dropped a part: check its event size limit.`);
      process.exitCode = 1;
    } else {
      console.log(`\nPublished generation ${out.head.gen}: ${out.parts} parts, read back whole (${back.graph.nodes.length} parties, ${back.graph.links.length} links).`);
    }
  }
} finally {
  await hs.close?.().catch?.(() => {});
}
