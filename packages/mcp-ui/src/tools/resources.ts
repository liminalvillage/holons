// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Thin MCP wrappers around @holons/core/flows resources — gifts of any of the
// eight forms of capital, on the RECIPIENT's signed "flow_resources" log, and
// the offers a holon makes on public terms. Giving is open to anyone; a gift
// counts once the recipient's admin receives it. Every write is signed with
// the MCP instance key. Every rule lives in core.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CAPITALS,
  disputeGift,
  giveResource,
  indexFlowGraph,
  loadFlowGraph,
  loadResources,
  rankByResources,
  receiveGift,
  removeResourceOffer,
  saveResourceOffer,
  traceAmount,
} from '@holons/core/flows';
import type { ToolDeps } from './index.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }, null, 2) }] };
}

const capital = z.enum(CAPITALS as unknown as [string, ...string[]]);

export function registerResourcesTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'resource_give',
    {
      description:
        'Give a holon a resource — any of the eight forms of capital (material, living, social, intellectual, experiential, cultural, spiritual, financial) — at any level: the Pot, a fund, a project, a person\'s holon. Appends a `give` to the RECIPIENT\'s signed resources log (lens "flow_resources", kind 1808). Anyone may give; it counts in the resource base once the recipient\'s admin receives it (an admin\'s own gift counts as written). Wraps @holons/core/flows giveResource.',
      inputSchema: {
        holon: z.string().describe('Who receives it.'),
        from: z.string().describe('Who gave it: a holon id, a person\'s id, or a name.'),
        name: z.string().optional().describe('How the giver is called.'),
        capital,
        amount: z.number().positive(),
        unit: z.string().describe('What the amount counts: hours, m², kg, EUR, desks.'),
        what: z.string().optional().describe('In a few words: "workspace", "design hours".'),
        note: z.string().optional(),
        proof: z.string().optional().describe('Evidence anyone can open: a photo, a receipt, a booking.'),
        offer: z.string().optional().describe("The recipient's offer id this answers."),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const { holon, ...gift } = args;
        const r = await giveResource(hs, holon, gift);
        return ok({ success: true, id: r.id });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'resources_get',
    {
      description:
        "A holon's resources: every gift (pending | received | disputed, with giver, capital, amount, proof and who received it), its resource base (received non-financial gifts, counted — what sets financial bandwidth for a `resourced` fund) and the offers it makes with their terms of access. Read-only. Wraps @holons/core/flows loadResources.",
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const ctx = await loadResources(hs, args.holon);
        return ok({ success: true, holon: args.holon, base: ctx.base, offers: ctx.offers, gifts: ctx.gifts });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'resource_verdict',
    {
      description:
        "The recipient admin's word on a gift: `receive` puts it in the holon's resource base; `dispute` (with a reason everyone can read) takes it out. The latest admin word stands. Admin only. Wraps @holons/core/flows receiveGift / disputeGift.",
      inputSchema: {
        holon: z.string(),
        gift: z.string().describe('The gift entry id.'),
        verdict: z.enum(['receive', 'dispute']),
        reason: z.string().optional().describe('Required for a dispute.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const g = args.verdict === 'receive' ? await receiveGift(hs, args.holon, args.gift) : await disputeGift(hs, args.holon, args.gift, args.reason ?? '');
        return ok({ success: true, gift: g });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'resource_offer_save',
    {
      description:
        "Add or replace (by id, default from the title) a resource the holon offers, with its terms of access — when, for whom, how — stored on its public settings so the terms are visible to everyone. `remove: true` takes the offer down. Admin only. Wraps @holons/core/flows saveResourceOffer / removeResourceOffer.",
      inputSchema: {
        holon: z.string(),
        id: z.string().optional(),
        capital: capital.optional(),
        title: z.string().optional(),
        quantity: z.number().positive().optional(),
        unit: z.string().optional(),
        when: z.string().optional().describe('When it can be had.'),
        who: z.string().optional().describe('For whom.'),
        how: z.string().optional().describe('How to ask for it.'),
        note: z.string().optional(),
        remove: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        if (args.remove) {
          if (!args.id) return fail('Say which offer to remove (id)');
          return ok({ success: true, offers: await removeResourceOffer(hs, args.holon, args.id) });
        }
        const { holon, when, who, how, remove: _r, ...offer } = args;
        const offers = await saveResourceOffer(hs, holon, { ...offer, terms: { when, who, how } });
        return ok({ success: true, offers });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'resource_ranking',
    {
      description:
        "The most resourced rise: the parties on a Pot's published flow graph ranked by resource base (received non-financial gifts), each with its count per capital; the top two are starred. Read-only. Wraps @holons/core/flows loadFlowGraph + rankByResources.",
      inputSchema: {
        pot: z.string(),
        kind: z.enum(['project', 'fund', 'person', 'all']).optional().describe('Default project.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const loaded = await loadFlowGraph(hs, args.pot);
        if (!loaded.ok) return fail(`No flow graph published for ${args.pot} (${loaded.reason})`);
        const kind = args.kind ?? 'project';
        const ranked = rankByResources(loaded.graph.nodes.filter((n) => kind === 'all' || n.kind === kind));
        return ok({ success: true, at: loaded.graph.at, ranked });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'flow_trace',
    {
      description:
        "Every flow, traceable: follow an amount put in at one party (default the Pot) down the published flow graph to another, path by path — each hop with the percent its split passes on and what reaches it. The paths sum to what the map says reaches the target. Read-only. Wraps @holons/core/flows traceAmount.",
      inputSchema: {
        pot: z.string(),
        to: z.string().describe('The party traced to.'),
        amount: z.number().positive(),
        from: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const loaded = await loadFlowGraph(hs, args.pot);
        if (!loaded.ok) return fail(`No flow graph published for ${args.pot} (${loaded.reason})`);
        const trace = traceAmount(indexFlowGraph(loaded.graph), args.to, args.amount, args.from ? { from: args.from } : {});
        return ok({ success: true, ...trace });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
