// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Thin MCP wrappers around @holons/core/flows standing — a party's word
// about their own seat: the EXIT that retires it (`flow_exits`, the party's
// own signature counts) and the NEEDS flag that puts them on the needs floor
// (`flow_needs`, attested like a claim). Entries are signed with the MCP
// instance key; whether they COUNT is the reducer's call from the holon's
// signer set and policy. Every rule lives in core.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FLOW_EXITS_LENS, FLOW_NEEDS_LENS, buildExit, buildNeeds, buildStandingVerdict, loadStanding } from '@holons/core/flows';
import type { ToolDeps } from './index.js';
import { namesFor } from './names.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message, ...(extra ?? {}) }, null, 2) }],
  };
}

export function registerStandingTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'standing_state',
    {
      description:
        "A holon's standing: who exited their seat (they keep what the table already owes them and take no new income from the next new moon) and who is flagged in need (the needs floor of a bucketed split divides equally among them). Every entry of both logs is listed, judged. Wraps @holons/core/flows loadStanding.",
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const ctx = await loadStanding(hs, args.holon);
        const ids = [...ctx.exits.entries.map((e) => e.party), ...ctx.needs.entries.map((e) => e.party)];
        return ok({
          success: true,
          holon: args.holon,
          exited: ctx.standing.exited,
          inNeed: ctx.standing.inNeed,
          exits: ctx.exits.entries,
          needs: ctx.needs.entries,
          policy: ctx.policy,
          source: ctx.actors.source,
          names: await namesFor(hs, args.holon, ids),
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'standing_exit_record',
    {
      description:
        "Retire a party's seat: append an `exit` to the holon's \"flow_exits\" log, signed with this MCP key. It counts when the key acts for the party (or is the holon key naming `onBehalfOf`); no attestation is needed by default, an attester may dispute it. From the next new-moon cut the party is in no bucket of this node; what the table already owes them stays collectable. Said once: a second exit is invalid. Wraps @holons/core/flows buildExit.",
      inputSchema: {
        holon: z.string(),
        party: z.string().describe('The party leaving — a user id, a holon id.'),
        memo: z.string().optional(),
        onBehalfOf: z.string().optional().describe('Set to the party id when the holon key signs for them.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const a = buildExit({ party: args.party, memo: args.memo, onBehalfOf: args.onBehalfOf });
        const event = await hs.append(args.holon, FLOW_EXITS_LENS, a.item, { refs: a.refs });
        const ctx = await loadStanding(hs, args.holon);
        const mine = ctx.exits.entries.find((e) => e.id === event.id) ?? null;
        return ok({ success: true, holon: args.holon, id: event.id, entry: mine, exited: ctx.standing.exited });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'standing_needs_record',
    {
      description:
        "Flag a party in need (or no longer): append a `needs` entry to the holon's \"flow_needs\" log, signed with this MCP key. Attested like a claim (quorum 1 by default; an attester's own flag self-attests); the latest accepted word per party wins. A bucketed split's needs floor divides equally among the flagged. Wraps @holons/core/flows buildNeeds.",
      inputSchema: {
        holon: z.string(),
        party: z.string(),
        on: z.boolean().describe('true: in need; false: no longer.'),
        memo: z.string().optional(),
        onBehalfOf: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const a = buildNeeds({ party: args.party, on: args.on, memo: args.memo, onBehalfOf: args.onBehalfOf });
        const event = await hs.append(args.holon, FLOW_NEEDS_LENS, a.item, { refs: a.refs });
        const ctx = await loadStanding(hs, args.holon);
        const mine = ctx.needs.entries.find((e) => e.id === event.id) ?? null;
        return ok({ success: true, holon: args.holon, id: event.id, entry: mine, inNeed: ctx.standing.inNeed });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'standing_verdict',
    {
      description:
        "An attester's word on an exit or a needs flag: `attest` or `dispute` the entry, signed with this MCP key. Counts when the key holds an attester role under the lens's policy. Wraps @holons/core/flows buildStandingVerdict.",
      inputSchema: {
        holon: z.string(),
        lens: z.enum([FLOW_EXITS_LENS, FLOW_NEEDS_LENS]),
        id: z.string().describe('The entry id.'),
        verdict: z.enum(['attest', 'dispute']),
        reason: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const a = buildStandingVerdict(args.id, args.verdict, args.reason);
        const event = await hs.append(args.holon, args.lens, a.item, { refs: a.refs });
        const ctx = await loadStanding(hs, args.holon);
        const list = args.lens === FLOW_EXITS_LENS ? ctx.exits.entries : ctx.needs.entries;
        return ok({ success: true, holon: args.holon, id: event.id, target: list.find((e) => e.id === args.id) ?? null });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
