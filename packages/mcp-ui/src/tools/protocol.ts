// Thin MCP wrappers around @holons/core/protocol rules — the holon's policy
// per append-only lens (`_policy`, admin-signed, folded as-of-time) and the
// partners it pins. A policy set with the MCP key counts only when that key
// is an admin of the holon (the signed `_members` log, or the holon key /
// settings.admin before founding); otherwise the entry is recorded and
// ignored, and `protocol_policy_get` keeps showing the rule in force.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MEMBERS_LENS,
  POLICY_LENS,
  POLICY_ROLES,
  importPartnerLog,
  lensContext,
  normalizePolicy,
  pinnedPartners,
  policyRecord,
  readMembersLog,
  readPartnerLogs,
  samePolicy,
} from '@holons/core/protocol';
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

/** Who counts and the rules in force, from the instance. */
async function rulesContext(hs: any, holon: string) {
  const [policy, settings, users, dir] = await Promise.all([
    hs.getLog(holon, POLICY_LENS).catch(() => []),
    hs.get(holon, 'settings', holon).catch(() => null),
    hs.getAll(holon, 'users').catch(() => []),
    hs.getAllGlobal(SHIFT_IDENTITY_LENS).catch(() => []),
  ]);
  await hs.getAll(holon, MEMBERS_LENS).catch(() => []);
  const membersLog = await readMembersLog(hs, holon);
  return lensContext({ holonId: holon, policyEntries: policy, membersLog, settings, users, attestations: attestationsFrom(dir || []) });
}

const roleEnum = z.enum(POLICY_ROLES as unknown as [string, ...string[]]);

export function registerProtocolTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'protocol_policy_get',
    {
      description:
        'The rule in force for an append-only lens (flow_claims, governance_votes): who may author, who attests, the quorum, the conflict rule and the partners pinned (holon → genesis pubkey). Folded from the admin-signed _policy log; DEFAULT_POLICY when none. Also says whether this MCP key is an admin.',
      inputSchema: { holon: z.string(), lens: z.string().describe('The log lens the rule governs.') },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const ctx = await rulesContext(hs, args.holon);
        const policy = ctx.policyFor(args.lens);
        return ok({
          success: true,
          lens: args.lens,
          policy,
          explicit: ctx.policies.has(args.lens),
          source: ctx.actors.source,
          myPubkey: hs.currentPubkey,
          myRole: ctx.actors.roleAt(hs.currentPubkey, Math.floor(Date.now() / 1000)),
          lensesWithRules: [...ctx.policies.keys()],
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'protocol_policy_set',
    {
      description:
        'Append a policy record for a lens to the _policy log, signed with this MCP key — counts only when the key is an admin as of now. Fields left out keep the rule in force; `partners` replaces the pinned set (pass {} to unpin all). Refuses a no-op. Wraps @holons/core/protocol policyRecord.',
      inputSchema: {
        holon: z.string(),
        lens: z.string(),
        authors: z.array(roleEnum).optional().describe('Roles whose actions count.'),
        attesters: z.array(roleEnum).optional().describe('Roles whose attestations and disputes count.'),
        quorum: z.number().int().min(0).optional().describe('Attestations an action needs. 0 = none.'),
        conflict: z.enum(['earliest', 'quorum']).optional().describe('Two actions on one basis: the first wins, or a human decides.'),
        partners: z.record(z.string(), z.string()).optional().describe('Partner holon id → its genesis pubkey (hex, 64). Their accepted entries fold in.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const ctx = await rulesContext(hs, args.holon);
        const inForce = ctx.policyFor(args.lens);
        const next = normalizePolicy({
          authors: (args.authors as never) ?? inForce.authors,
          attesters: (args.attesters as never) ?? inForce.attesters,
          quorum: args.quorum ?? inForce.quorum,
          conflict: args.conflict ?? inForce.conflict,
          partners: args.partners ?? inForce.partners,
        });
        if (samePolicy(next, inForce)) return fail('These are the rules already in force.', { policy: inForce });
        const myRole = ctx.actors.roleAt(hs.currentPubkey, Math.floor(Date.now() / 1000));
        const a = policyRecord(args.lens, next);
        const event = await hs.append(args.holon, POLICY_LENS, a.item, { refs: a.refs });
        return ok({
          success: true,
          id: event.id,
          pubkey: event.pubkey,
          policy: next,
          counts: myRole === 'admin',
          ...(myRole === 'admin' ? {} : { warning: 'This key is not an admin of the holon: the record is kept but does not set the rule.' }),
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'protocol_partner_import',
    {
      description:
        "Read a partner's log of a lens and judge it by the PARTNER's own rules (its membership log pinned to a genesis key, its policy): what the partner accepted, pending and rejected. Uses the pins in this holon's policy for the lens, or one explicit partner + genesis. This is the read every fold runs before letting a partner's entries in.",
      inputSchema: {
        holon: z.string().describe('The importing holon.'),
        lens: z.string(),
        partner: z.string().optional().describe('One partner holon id (else every pinned partner).'),
        genesis: z.string().optional().describe("The partner's genesis pubkey, when not pinned in the policy."),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const ctx = await rulesContext(hs, args.holon);
        const policy = ctx.policyFor(args.lens);
        let pins = pinnedPartners(policy);
        if (args.partner) {
          const pinned = policy.partners[args.partner];
          const genesis = args.genesis ?? pinned;
          if (!genesis) return fail(`${args.partner} is not pinned in the policy; pass its genesis pubkey.`);
          pins = [[args.partner, genesis]];
        }
        const logs = await readPartnerLogs(hs, args.lens, pins);
        const imports = logs.map((p) => importPartnerLog(p, args.lens));
        return ok({
          success: true,
          lens: args.lens,
          partners: imports.map((im) => ({
            holon: im.holon,
            genesis: im.genesis,
            source: im.source,
            policy: im.policy,
            accepted: im.accepted.map((e) => ({ id: e.id, pubkey: e.pubkey, created_at: e.created_at, refs: e.refs, item: e.item })),
            pending: im.pending,
            rejected: im.rejected,
          })),
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
