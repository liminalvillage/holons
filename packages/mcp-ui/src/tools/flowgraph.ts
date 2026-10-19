// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Thin MCP wrappers around @holons/core/flows flow graph — a whole Pot as one
// node per party, published in parts on its "flow_graph" lens for the
// explorer to load in one read. Reading the graph walks every holon under
// the Pot; publishing writes the parts with the MCP instance key. Every rule
// lives in core.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  crawlFlowGraph,
  encodeFlowGraph,
  indexFlowGraph,
  loadFlowGraph,
  membershipsOf,
  publishFlowGraph,
  resolveParty,
  scoreAllocationMembers,
  seatersOf,
  resourcesOf,
  standingOf,
  upstreamShares,
  type FlowGraph,
} from '@holons/core/flows';
import type { ToolDeps } from './index.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message, ...(extra ?? {}) }, null, 2) }],
  };
}

/** What a graph holds, without the graph. */
function summary(graph: FlowGraph) {
  const kinds: Record<string, number> = {};
  for (const node of graph.nodes) kinds[node.kind] = (kinds[node.kind] ?? 0) + 1;
  return {
    root: graph.root,
    at: graph.at,
    ...(graph.epoch != null ? { epoch: graph.epoch } : {}),
    complete: graph.complete,
    problems: graph.problems,
    nodes: graph.nodes.length,
    links: graph.links.length,
    kinds,
    aliases: graph.aliases.length,
    cycles: graph.cycles.length,
    withPayout: graph.nodes.filter((n) => n.payout).length,
  };
}

export function registerFlowgraphTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'flow_graph_publish',
    {
      description:
        "Read a Pot's whole flow graph — every fund, project and person its income reaches, each once, with the share that travels each edge — and, with `write`, publish it as the Pot's snapshot on its \"flow_graph\" lens (parts under the relay size limit, the head last). Without `write` it is a dry run: the summary and the part sizes, nothing written. The walk reads every holon under the Pot once, so it can take minutes on a large one. Wraps @holons/core/flows crawlFlowGraph + publishFlowGraph.",
      inputSchema: {
        holon: z.string().describe('The Pot holon.'),
        write: z.boolean().optional().describe('Publish the snapshot. Default: dry run.'),
        maxHolons: z.number().int().min(1).max(20000).optional().describe("Settings reads allowed (default: the Pot record's walk, else 5000)."),
        maxDepth: z.number().int().min(0).max(8).optional(),
        standing: z.boolean().optional().describe('Read exits and needs for every holon (default true; false is faster and not what the cut pays).'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const graph = await crawlFlowGraph(hs, args.holon, {
          maxHolons: args.maxHolons,
          maxDepth: args.maxDepth,
          scoreOf: (id) => scoreAllocationMembers(hs, id),
          ...(args.standing === false ? {} : { standingOf: standingOf(hs) }),
          resourcesOf: resourcesOf(hs),
        });
        const encoded = encodeFlowGraph(graph);
        const sizes = encoded.parts.map((p) => new TextEncoder().encode(JSON.stringify(p)).length);
        const parts = { count: sizes.length, bytes: sizes.reduce((s, n) => s + n, 0), largest: Math.max(0, ...sizes) };
        if (!args.write) return ok({ success: true, holon: args.holon, written: false, ...summary(graph), parts });
        const out = await publishFlowGraph(hs, args.holon, graph);
        return ok({ success: true, holon: args.holon, written: true, gen: out.head.gen, ...summary(graph), parts });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'flow_graph_get',
    {
      description:
        "A Pot's published flow graph: its summary, or — with `party` (an id, an npub, a claimed seat or a 0x payout address) — that party's node, the holons that seat it, everyone its income passes through and what it pays on. Read-only; says why when there is no whole snapshot to read. Wraps @holons/core/flows loadFlowGraph + indexFlowGraph.",
      inputSchema: {
        holon: z.string().describe('The Pot holon.'),
        party: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const loaded = await loadFlowGraph(hs, args.holon);
        if (!loaded.ok) return ok({ success: true, holon: args.holon, published: false, reason: loaded.reason });
        const head = { gen: loaded.head.gen, parts: loaded.head.parts };
        if (!args.party) return ok({ success: true, holon: args.holon, published: true, ...head, ...summary(loaded.graph) });

        const index = indexFlowGraph(loaded.graph);
        const found = resolveParty(index, args.party);
        if (!found) return fail('The graph knows no party by that id, seat or address', { holon: args.holon, party: args.party });
        return ok({
          success: true,
          holon: args.holon,
          published: true,
          ...head,
          resolved: found,
          node: index.byId.get(found.id),
          claimed: index.aliasFrom.get(found.id) ?? [],
          seatedBy: seatersOf(index, found.id),
          memberships: membershipsOf(index, found.id),
          upstream: upstreamShares(index, found.id),
          paysOn: index.out.get(found.id) ?? [],
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
