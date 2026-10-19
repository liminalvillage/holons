// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Thin MCP wrappers around @holons/core/flows applications — a party asking
// a fund to seat it, on the fund's signed "flow_applications" log. Asking is
// open to anyone; answering is the fund's admins'. Every write is signed
// with the MCP instance key, so an approval only counts when that key is an
// admin of the fund. Every rule lives in core.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  applyToFund,
  approveApplication,
  declineApplication,
  loadApplications,
  setApplicationsOpen,
  withdrawApplication,
} from '@holons/core/flows';
import type { ToolDeps } from './index.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }, null, 2) }] };
}

export function registerApplicationsTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'fund_apply',
    {
      description:
        'Ask a fund to seat a party: append an `apply` to the FUND\'s signed applications log (lens "flow_applications", kind 1808). Anyone may ask; it moves no value and binds nobody. Refused when the fund closed applications or the party already has one waiting. `withdraw: true` takes the party\'s waiting application back instead. Wraps @holons/core/flows applyToFund / withdrawApplication.',
      inputSchema: {
        fund: z.string().describe('The fund (any holon with a split) being asked.'),
        party: z.string().describe('Who asks to be seated: a holon id or a person\'s id.'),
        name: z.string().optional().describe('How the party is called, for a fund that cannot know.'),
        note: z.string().optional().describe('Why — up to 500 characters.'),
        withdraw: z.boolean().optional().describe('Take the waiting application back.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const r = args.withdraw
          ? await withdrawApplication(hs, args.fund, args.party)
          : await applyToFund(hs, args.fund, { party: args.party, name: args.name, note: args.note });
        return ok({ success: true, id: r.id, withdrawn: !!args.withdraw });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'fund_applications',
    {
      description:
        'A fund\'s applications: each party\'s latest ask with its status (pending | approved | declined | withdrawn), note, whether its signer was seen to speak for the party (`verified`), and whether the fund is taking applications (`open`). `open` given: an admin opens or closes the fund to applications first. Wraps loadApplications / setApplicationsOpen.',
      inputSchema: {
        fund: z.string(),
        status: z.enum(['pending', 'approved', 'declined', 'withdrawn']).optional().describe('Only applications in this state.'),
        open: z.boolean().optional().describe('Set whether the fund takes applications (admin key).'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        if (args.open !== undefined) await setApplicationsOpen(hs, args.fund, args.open);
        const ctx = await loadApplications(hs, args.fund);
        const applications = args.status ? ctx.applications.filter((a) => a.status === args.status) : ctx.applications;
        return ok({ success: true, open: ctx.open, pending: ctx.pending.length, applications });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'fund_application_verdict',
    {
      description:
        'Answer an application as an admin of the fund. `approve` federates the applicant with the fund (a holon; a person needs no link), places it on the fund\'s OUTERMOST ring (or `ring`) unless it already sits on one, and attests the application — safe to repeat. `decline` records the reason and touches neither the link nor the split. Refused unless the MCP instance key is an admin of the fund. Wraps approveApplication / declineApplication.',
      inputSchema: {
        fund: z.string(),
        applicationId: z.string().describe('The `apply` entry id, from fund_applications.'),
        verdict: z.enum(['approve', 'decline']),
        ring: z.number().int().min(1).max(10).optional().describe('Approve onto this ring instead of the outermost.'),
        reason: z.string().optional().describe('Decline: what the applicant will read.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        if (args.verdict === 'approve') {
          return ok({ success: true, verdict: 'approve', ...(await approveApplication(hs, args.fund, args.applicationId, { ring: args.ring })) });
        }
        const r = await declineApplication(hs, args.fund, args.applicationId, args.reason);
        return ok({ success: true, verdict: 'decline', id: r.id });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
