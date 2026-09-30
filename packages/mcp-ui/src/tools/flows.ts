// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Thin MCP wrappers around @holons/core/flows — a holon's fund allocation
// split (the same `settings/<holon>.allocation` mirror the kiosk and the
// dashboard read and write) and the cascade that follows each share down
// through its recipients' own splits — and the fund's signed, append-only
// claims log (`flow_claims`, kind 1808). Every reader folds the same log to
// the same statement; the claim tools append entries signed with the MCP
// instance key and read the fold. Whether an entry COUNTS is the reducer's
// call from the holon's signer set and policy: a key no holon lists records
// entries that fold as `rejected: unaccepted-signer` — visible, not counted,
// and retroactively counted once the key is trusted. Every rule lives in
// core; this file only reads, calls and returns.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  FLOW_CLAIMS_LENS,
  allocate,
  buildClaim,
  buildClaimVerdict,
  buildPayout,
  childResolver,
  foldClaimsFromLenses,
  hasAllocationConfig,
  loadCascadeChildren,
  readAllocationConfig,
  readInteriorShares,
  readZoneAssignments,
  readZonePeople,
  resolveCascade,
  resolveInteriorMembers,
  saveAllocationConfig,
  summarizeCascade,
  toAllocationPartners,
  type AllocationMember,
  type CascadeNode,
} from '@holons/core/flows';
import { getFederationSnapshot } from '@holons/core/federation';
import { MEMBERS_LENS, POLICY_LENS, importPartnerLogs, lensContext, readMembersLog } from '@holons/core/protocol';
import { attestationsFrom, SHIFT_IDENTITY_LENS } from '@holons/core/shifts';
import { REAEventStore } from '@holons/core/rea';
import { REAAggregator, computeHolonUserScores, extractReaUsers, loadEquation } from '@holons/core/scoring';
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

const zoneMap = z.record(z.string(), z.number());

/** The equation's roster, scored the way the Flows boards score it. */
async function scoredMembers(hs: any, holon: string): Promise<AllocationMember[]> {
  const events: any[] = (await hs.getAll(holon, 'rea_events')) ?? [];
  const users: any[] = (await hs.getAll(holon, 'users')) ?? [];
  const roster = new Map<string, { id: string; name?: string }>();
  for (const u of extractReaUsers(events)) roster.set(String(u.id), u as { id: string; name?: string });
  for (const u of users) {
    const id = String(u?.id ?? '');
    if (id) roster.set(id, { id, name: u?.first_name ?? u?.username ?? id });
  }
  if (roster.size === 0) return [];
  const aggregator = new REAAggregator(new REAEventStore({ getAll: async () => events } as any));
  const equation = await loadEquation(hs, holon);
  const scored = await computeHolonUserScores(aggregator, holon, [...roster.values()] as never, equation);
  return scored
    .filter((s) => s.percentage > 0)
    .map((s) => ({
      id: String(s.userId),
      name: roster.get(String(s.userId))?.name ?? String(s.userId),
      percentage: s.percentage,
    }));
}

/** Everything `allocate` needs for one holon, read off its settings. */
async function allocationInputs(hs: any, holon: string) {
  const settings = await hs.get(holon, 'settings', holon);
  const config = readAllocationConfig(settings);
  const shares = readInteriorShares(settings);
  const zones = readZoneAssignments(settings);
  const people = readZonePeople(settings);
  const federation = await getFederationSnapshot(hs, holon).catch(() => null);
  const custom = config.interiorMode === 'custom' && Object.keys(shares).length > 0;
  const members = resolveInteriorMembers({
    config,
    scored: custom ? [] : await scoredMembers(hs, holon),
    shares,
  });
  const zoned = toAllocationPartners(federation?.federated ?? [], federation?.partnerNames ?? {}, zones, people);
  return { configured: hasAllocationConfig(settings), config, shares, zones, people, members, zoned };
}

/** A cascade node without the fields that only repeat its parent. */
function slim(node: CascadeNode): Record<string, unknown> {
  return {
    id: node.id,
    label: node.label,
    percentage: node.percentage,
    ...(node.amount != null ? { amount: node.amount } : {}),
    via: node.via,
    ...(node.zone != null ? { zone: node.zone } : {}),
    ...(node.reason ? { reason: node.reason } : {}),
    ...(node.children.length ? { children: node.children.map(slim) } : {}),
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
  const base = { holonId: holon, policyEntries: policy, membersLog, settings, users, attestations: attestationsFrom(dir || []) };
  // The partners the policy pins claim in their own logs; read them by
  // their own rules, then fold them in under this holon's.
  const imports = await importPartnerLogs(hs, FLOW_CLAIMS_LENS, lensContext(base).policyFor(FLOW_CLAIMS_LENS));
  return foldClaimsFromLenses({ ...base, entries, imports });
}

export function registerFlowsTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'allocation_get',
    {
      description:
        "Read a holon's fund allocation split: the Contributors share (interiorPercent) and how it is divided (equation or custom shares), and the Reciprocity zones (steepness, nzones, partners and people placed on rings). Returns the resolved split as percentages, or amounts when `total` is given. Works for a personal holon (holon id = user id). Wraps @holons/core/flows.",
      inputSchema: {
        holon: z.string(),
        total: z.number().positive().optional().describe('The pot to divide; omit for percentages only.'),
        unit: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const { configured, config, shares, zones, people, members, zoned } = await allocationInputs(hs, args.holon);
        const result = allocate({ total: args.total ?? null, unit: args.unit, config, members, zoned });
        return ok({ success: true, holon: args.holon, configured, config, shares, zones, people, allocation: result });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'allocation_save',
    {
      description:
        "Save a holon's fund allocation split, merged onto its settings document (the off-chain mirror every surface reads; nothing is sent on-chain). Only the fields given change; `zones`, `people` and `shares` each REPLACE their whole map when given. An equal split is `interiorMode: 'custom'` with equal `shares` (e.g. {\"u1\":1,\"u2\":1}). Wraps @holons/core/flows: saveAllocationConfig.",
      inputSchema: {
        holon: z.string(),
        interiorPercent: z.number().min(0).max(100).optional().describe('Contributors share, 0-100; the zones get the rest.'),
        steepness: z.number().min(0).max(100).optional(),
        nzones: z.number().int().min(0).max(10).optional(),
        interiorMode: z.enum(['equation', 'custom']).optional(),
        zones: zoneMap.optional().describe('Federation partner holon id → ring (1-based).'),
        people: zoneMap.optional().describe('User id → ring (1-based).'),
        shares: zoneMap.optional().describe('Custom contributors split: user id → weight.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const { holon, zones, people, shares, ...config } = args;
        const saved = await saveAllocationConfig(hs, holon, config, zones, people, shares);
        return ok({ success: true, holon, config: saved });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'allocation_cascade',
    {
      description:
        "Follow a holon's fund allocation down through its recipients' OWN splits: a member's id is their personal holon's id, so a member who configured an allocation there passes part of what they receive further. Returns the tree, where the pot finally rests per party (`leaves`, summing to 100% / to `total`), any loops, and a pre-flight summary (`stuck` = holons where an on-chain Bundle would strand funds). Read-only. Wraps @holons/core/flows: loadCascadeChildren + resolveCascade.",
      inputSchema: {
        holon: z.string(),
        total: z.number().positive().optional().describe('The pot to divide; omit for percentages only.'),
        unit: z.string().optional(),
        maxDepth: z.number().int().min(0).max(6).optional(),
        rail: z.enum(['rights', 'chain']).optional().describe("'chain' follows only holons that deployed a Bundle."),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const { config, members, zoned } = await allocationInputs(hs, args.holon);
        const rootPartyIds = [
          ...members.map((m) => m.id),
          ...zoned.filter((p) => p.zone >= 1).map((p) => p.id),
        ];
        const loaded = await loadCascadeChildren(hs, rootPartyIds, {
          rootId: args.holon,
          maxDepth: args.maxDepth,
          rail: args.rail,
        });
        const cascade = resolveCascade({
          holonId: args.holon,
          total: args.total ?? null,
          unit: args.unit,
          root: { config, members, zoned },
          resolveChild: childResolver(loaded.children),
          maxDepth: args.maxDepth,
        });
        return ok({
          success: true,
          holon: args.holon,
          total: cascade.total,
          unit: cascade.unit,
          leaves: cascade.leaves,
          tree: slim(cascade.root),
          summary: summarizeCascade(cascade),
          truncated: cascade.truncated || loaded.truncated,
          holonsRead: loaded.visited,
          ...(args.rail === 'chain' ? { bundles: loaded.bundles } : {}),
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

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
          imports: ctx.folded.imports,
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
      description: 'Every verified entry of an append-only lens (flow_claims, governance_votes, _policy, _checkpoints), oldest first, with author, time and refs. Raw — nothing judged.',
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
