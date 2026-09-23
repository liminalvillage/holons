// Thin MCP wrappers around @holons/core/governance votes — the signed,
// append-only votes log (`governance_votes`, kind 1808). A proposal stays a
// `type:'proposal'` quest; a vote on it is an entry of its own, signed with
// the MCP instance key. Whether it COUNTS is the reducer's call from the
// holon's signer set and policy (see flows.ts for the same caveat), and the
// count itself — weights, delegation, the threshold — is core's tallyBallots.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  DELEGATIONS_LENS,
  GOVERNANCE_VOTES_LENS,
  VOTE_CHOICES,
  buildVote,
  buildVoteVerdict,
  foldDelegations,
  foldVotesFromLenses,
  tallyBallots,
} from '@holons/core/governance';
import { MEMBERS_LENS, POLICY_LENS, importPartnerLogs, lensContext, readMembersLog } from '@holons/core/protocol';
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

/** Everything the fold reads, straight from the instance — pinned partners included. */
async function votesContext(hs: any, holon: string) {
  const [entries, policy, settings, users, dir, delegations] = await Promise.all([
    hs.getLog(holon, GOVERNANCE_VOTES_LENS),
    hs.getLog(holon, POLICY_LENS).catch(() => []),
    hs.get(holon, 'settings', holon).catch(() => null),
    hs.getAll(holon, 'users').catch(() => []),
    hs.getAllGlobal(SHIFT_IDENTITY_LENS).catch(() => []),
    hs.getAll(holon, DELEGATIONS_LENS).catch(() => []),
  ]);
  await hs.getAll(holon, MEMBERS_LENS).catch(() => []);
  const membersLog = await readMembersLog(hs, holon);
  const attestations = attestationsFrom(dir || []);
  const base = { holonId: holon, policyEntries: policy, membersLog, settings, users, attestations };
  const rule = lensContext(base).policyFor(GOVERNANCE_VOTES_LENS);
  const imports = await importPartnerLogs(hs, GOVERNANCE_VOTES_LENS, rule);
  const ctx = foldVotesFromLenses({ ...base, entries, imports });
  const memberIds = (users || []).map((u: any) => (u?.id == null ? '' : String(u.id))).filter(Boolean);
  return { ctx, memberIds, delegations: foldDelegations(delegations || []) };
}

export function registerGovernanceTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'governance_vote_record',
    {
      description:
        'Cast a VOTE on a proposal in the holon\'s signed votes log (lens "governance_votes", kind 1808): yes, no or abstain. One counted vote per party per proposal — the newest. Signed with this MCP instance key; counts only if the holon accepts that key for the party. Wraps @holons/core/governance buildVote.',
      inputSchema: {
        holon: z.string().describe('Holon id.'),
        proposal: z.string().describe('The proposal quest id.'),
        party: z.string().describe('The voter (member id or partner holon id).'),
        choice: z.enum(VOTE_CHOICES as unknown as [string, ...string[]]),
        memo: z.string().optional(),
        onBehalfOf: z.string().optional().describe('Only the holon key may vote for a party; sets the delegated flag.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const a = buildVote({ proposal: args.proposal, party: args.party, choice: args.choice as never, memo: args.memo, onBehalfOf: args.onBehalfOf });
        const event = await hs.append(args.holon, GOVERNANCE_VOTES_LENS, a.item, { refs: a.refs });
        return ok({ success: true, id: event.id, pubkey: event.pubkey, created_at: event.created_at, item: a.item });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'governance_vote_verdict',
    {
      description: 'Attest or dispute a vote entry (an attester\'s word; a dispute holds the vote until withdrawn). Wraps buildVoteVerdict.',
      inputSchema: {
        holon: z.string(),
        voteId: z.string().describe('The vote entry id (event id).'),
        verdict: z.enum(['attest', 'dispute']),
        reason: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const a = buildVoteVerdict(args.voteId, args.verdict, args.reason);
        const event = await hs.append(args.holon, GOVERNANCE_VOTES_LENS, a.item, { refs: a.refs });
        return ok({ success: true, id: event.id, pubkey: event.pubkey });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'governance_votes_state',
    {
      description:
        'Fold the holon\'s votes log: every vote judged (counted | superseded | pending | disputed | rejected), the ballots per proposal, and — for one proposal, or every proposal voted on — the tally (yes/no/abstain weight, total, passed) with delegations followed. Pinned partners\' accepted votes fold in. Wraps foldVotesFromLenses + tallyBallots.',
      inputSchema: {
        holon: z.string(),
        proposal: z.string().optional().describe('Tally only this proposal.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const { ctx, memberIds, delegations } = await votesContext(hs, args.holon);
        const proposals = args.proposal ? [args.proposal] : Object.keys(ctx.folded.ballots);
        const tallies: Record<string, unknown> = {};
        for (const p of proposals) tallies[p] = tallyBallots(ctx.folded.ballots[p] ?? {}, memberIds, { delegations });
        return ok({
          success: true,
          source: ctx.actors.source,
          genesis: ctx.actors.genesis,
          policy: ctx.policy,
          myPubkey: hs.currentPubkey,
          myRole: ctx.actors.roleAt(hs.currentPubkey, Math.floor(Date.now() / 1000)),
          imports: ctx.folded.imports,
          votes: args.proposal ? ctx.folded.votes.filter((v) => v.proposal === args.proposal) : ctx.folded.votes,
          ballots: args.proposal ? { [args.proposal]: ctx.folded.ballots[args.proposal] ?? {} } : ctx.folded.ballots,
          tallies,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
