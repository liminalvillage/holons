// Thin MCP wrappers around @holons/core/flows claims — the fund's signed,
// append-only claims log (`flow_claims`, kind 1808). Every reader folds the
// same log to the same statement; these tools append entries signed with the
// MCP instance key and read the fold. Whether an entry COUNTS is the
// reducer's call from the holon's signer set and policy: an MCP key that no
// holon lists (settings.nostrTrustedPubkeys, or the signed _members log)
// records entries that fold as `rejected: unaccepted-signer` — visible, not
// counted, and retroactively counted once the key is trusted.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  FLOW_CLAIMS_LENS,
  buildClaim,
  buildClaimVerdict,
  buildPayout,
  foldClaimsFromLenses,
} from '@holons/core/flows';
import { MEMBERS_LENS, POLICY_LENS, readMembersLog } from '@holons/core/protocol';
import { attestationsFrom, SHIFT_IDENTITY_LENS } from '@holons/core/shifts';
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

/** Everything the fold reads, straight from the instance. */
async function claimsContext(hs: any, holon: string) {
  const [entries, policy, settings, users, dir] = await Promise.all([
    hs.getLog(holon, FLOW_CLAIMS_LENS),
    hs.getLog(holon, POLICY_LENS).catch(() => []),
    hs.get(holon, 'settings', holon).catch(() => null),
    hs.getAll(holon, 'users').catch(() => []),
    hs.getAllGlobal(SHIFT_IDENTITY_LENS).catch(() => []),
  ]);
  await hs.getAll(holon, MEMBERS_LENS).catch(() => []);
  const membersLog = await readMembersLog(hs, holon);
  return foldClaimsFromLenses({
    holonId: holon,
    entries,
    policyEntries: policy,
    membersLog,
    settings,
    users,
    attestations: attestationsFrom(dir || []),
  });
}

export function registerFlowsTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'flow_claim_record',
    {
      description:
        'Append a fund CLAIM to the holon\'s signed claims log (lens "flow_claims", kind 1808). Signed with this MCP instance key; counts only if the holon accepts that key for the party. Wraps @holons/core/flows buildClaim.',
      inputSchema: {
        holon: z.string().describe('Holon id.'),
        party: z.string().describe('The rights-holder claiming (member id or partner holon id).'),
        amount: z.number().positive(),
        unit: z.string().describe('Currency code, e.g. EUR.'),
        memo: z.string().optional(),
        onBehalfOf: z.string().optional().describe('Only the holon key may claim for a party; sets the delegated flag.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const a = buildClaim({ party: args.party, amount: args.amount, unit: args.unit, memo: args.memo, onBehalfOf: args.onBehalfOf });
        const event = await hs.append(args.holon, FLOW_CLAIMS_LENS, a.item, { refs: a.refs });
        return ok({ success: true, id: event.id, pubkey: event.pubkey, created_at: event.created_at, item: a.item });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'flow_claim_verdict',
    {
      description: 'Attest or dispute a claim (an attester\'s word; the policy\'s quorum decides). Wraps buildClaimVerdict.',
      inputSchema: {
        holon: z.string(),
        claimId: z.string().describe('The claim entry id (event id).'),
        verdict: z.enum(['attest', 'dispute']),
        reason: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const a = buildClaimVerdict(args.claimId, args.verdict, args.reason);
        const event = await hs.append(args.holon, FLOW_CLAIMS_LENS, a.item, { refs: a.refs });
        return ok({ success: true, id: event.id, pubkey: event.pubkey });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'flow_payout_record',
    {
      description: 'Record that an approved claim was paid; consumes the claim (a second payout for it is a double-consume). Attesters only. Wraps buildPayout.',
      inputSchema: {
        holon: z.string(),
        claimId: z.string(),
        party: z.string(),
        amount: z.number().positive(),
        unit: z.string(),
        memo: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const a = buildPayout({ claimId: args.claimId, party: args.party, amount: args.amount, unit: args.unit, memo: args.memo });
        const event = await hs.append(args.holon, FLOW_CLAIMS_LENS, a.item, { refs: a.refs });
        return ok({ success: true, id: event.id, pubkey: event.pubkey });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'flow_claims_state',
    {
      description:
        'Fold the holon\'s claims log: every claim judged (approved | pending | disputed | over | conflict | settled | rejected), payouts, totals per party and unit, the policy in force and whether the signer set is founded (log) or provisional (bootstrap). Wraps foldClaimsFromLenses.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const ctx = await claimsContext(hs, args.holon);
        return ok({
          success: true,
          source: ctx.actors.source,
          genesis: ctx.actors.genesis,
          policy: ctx.policy,
          myPubkey: hs.currentPubkey,
          myRole: ctx.actors.roleAt(hs.currentPubkey, Math.floor(Date.now() / 1000)),
          claims: ctx.folded.claims,
          payouts: ctx.folded.payouts,
          byParty: ctx.folded.byParty,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'protocol_log',
    {
      description: 'Every verified entry of an append-only lens (flow_claims, _policy, _checkpoints), oldest first, with author, time and refs. Raw — nothing judged.',
      inputSchema: {
        holon: z.string(),
        lens: z.string().describe('An append-only lens name.'),
        since: z.number().optional().describe('Unix seconds.'),
        until: z.number().optional(),
        authors: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const entries = await hs.getLog(args.holon, args.lens, { since: args.since, until: args.until, authors: args.authors });
        return ok({ success: true, count: entries.length, entries: entries.map((e: any) => ({ id: e.id, pubkey: e.pubkey, created_at: e.created_at, refs: e.refs, item: e.item })) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
