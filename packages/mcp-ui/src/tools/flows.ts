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
  FLOW_MINTS_LENS,
  allocate,
  buildClaim,
  buildClaimVerdict,
  buildMint,
  buildPayout,
  buildTransfer,
  childResolver,
  claimHeadroom,
  fitsHeadroom,
  foldClaimsFromLenses,
  inboundTotal,
  loadAllocationInputs,
  loadClaimCeilings,
  loadWallet,
  loadInboundRights,
  loadMints,
  potTotal,
  potUnits,
  scoreAllocationMembers,
  loadCascadeChildren,
  resolveCascade,
  saveAllocationConfig,
  summarizeCascade,
  type CascadeNode,
  type ClaimCeilings,
  type RightsLookup,
} from '@holons/core/flows';
import { MEMBERS_LENS, POLICY_LENS, importPartnerLogs, lensContext, readMembersLog } from '@holons/core/protocol';
import { attestationsFrom, SHIFT_IDENTITY_LENS } from '@holons/core/shifts';
import type { ToolDeps } from './index.js';
import { gate } from './standing.js';
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

const zoneMap = z.record(z.string(), z.number());

/** The equation's roster, the way every Flows board scores it (core). */
const scoreOf = (hs: any) => (id: string) => scoreAllocationMembers(hs, id);

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

/**
 * The pot a holon holds in `unit` (or its first unit): what attesters minted
 * plus what reaches it from upstream. Null when nothing feeds it. Rights
 * already drawn are not read here (no expenses/claims fold), so this is the
 * pot BEFORE usage — the number to divide when nothing was taken yet.
 */
async function potOf(hs: any, holon: string, unit?: string): Promise<{ unit: string; total: number; minted: number; inbound: number } | null> {
  const [mints, inbound] = await Promise.all([
    loadMints(hs, holon).then((c) => c.folded).catch(() => null),
    loadInboundRights(hs, holon, { scoreOf: scoreOf(hs) }).then((r) => r.inbound).catch(() => []),
  ]);
  const sources = { mints, inbound };
  const units = potUnits(sources);
  const want = unit ? units.find((u) => u === unit.toLowerCase()) ?? unit.toLowerCase() : units[0];
  if (!want) return null;
  const total = potTotal(want, sources, null);
  if (!(total > 0)) return null;
  return { unit: want, total, minted: mints?.byUnit[want.toUpperCase()] ?? 0, inbound: inboundTotal(inbound, want) };
}

/** Everything the fold reads, straight from the instance. */
async function claimsBase(hs: any, holon: string) {
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
  return { ...base, entries, imports };
}

/**
 * The claims log judged the way every board judges it: folded once for the
 * shape, then again under the ceilings that shape, the pot and the usage
 * give (core `loadClaimCeilings`), so a claim past a right is held as `over`.
 */
async function judgedClaims(hs: any, holon: string) {
  const base = await claimsBase(hs, holon);
  const shape = foldClaimsFromLenses(base);
  const loaded = await loadClaimCeilings(hs, holon, { claims: shape.folded, scoreOf: scoreOf(hs) });
  const ctx = foldClaimsFromLenses({ ...base, rights: loaded.ceilings as RightsLookup });
  return { ctx, ceilings: loaded.ceilings, pots: loaded.pots, truncated: loaded.truncated };
}

/** What every party may still claim, per unit, under `ceilings`. */
function headroomOf(ceilings: ClaimCeilings, folded: Parameters<typeof claimHeadroom>[1]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  // Every seat, and every party a give reached: they have access with no ceiling of their own.
  const pairs = new Set<string>();
  for (const [party, perUnit] of Object.entries(ceilings)) for (const unit of Object.keys(perUnit)) pairs.add(`${party}|${unit}`);
  for (const [party, perUnit] of Object.entries(folded?.byParty ?? {})) {
    for (const [unit, t] of Object.entries(perUnit)) if (t.received > 0) pairs.add(`${party}|${unit}`);
  }
  for (const pair of pairs) {
    const [party, unit] = pair.split('|');
    const h = claimHeadroom(ceilings, folded, party, unit);
    if (h != null) (out[party] ??= {})[unit] = h;
  }
  return out;
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
        const { configured, config, shares, zones, people, members, zoned } = await loadAllocationInputs(hs, args.holon, { scoreOf: scoreOf(hs) });
        // With no total given, the pot the holon holds (mints + inbound) is
        // the honest one — the same rule the boards draw by (`potTotal`).
        const pot = args.total == null ? await potOf(hs, args.holon, args.unit) : null;
        const total = args.total ?? pot?.total ?? null;
        const unit = args.unit ?? pot?.unit;
        const result = allocate({ total, unit, config, members, zoned });
        return ok({ success: true, holon: args.holon, configured, config, shares, zones, people, ...(pot ? { pot } : {}), allocation: result });
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
        const g = await gate(hs, holon, 'settings.guarded');
        if (g.refusal) return fail(g.refusal, { standing: g.standing });
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
        "Follow a holon's fund allocation down through its recipients' OWN splits: a member's id is their personal holon's id, so a member who configured an allocation there passes part of what they receive further. Returns the tree, where the pot finally rests per party (`leaves`, summing to 100% / to `total`), any loops, and a pre-flight summary (`stuck` = holons whose split names nobody for part of what they receive). Read-only. Wraps @holons/core/flows: loadCascadeChildren + resolveCascade.",
      inputSchema: {
        holon: z.string(),
        total: z.number().positive().optional().describe('The pot to divide; omit for percentages only.'),
        unit: z.string().optional(),
        maxDepth: z.number().int().min(0).max(6).optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const { config, members, zoned } = await loadAllocationInputs(hs, args.holon, { scoreOf: scoreOf(hs) });
        const rootPartyIds = [
          ...members.map((m) => m.id),
          ...zoned.filter((p) => p.zone >= 1).map((p) => p.id),
        ];
        const loaded = await loadCascadeChildren(hs, rootPartyIds, {
          rootId: args.holon,
          maxDepth: args.maxDepth,
          scoreOf: scoreOf(hs),
        });
        const pot = args.total == null ? await potOf(hs, args.holon, args.unit) : null;
        const cascade = resolveCascade({
          holonId: args.holon,
          total: args.total ?? pot?.total ?? null,
          unit: args.unit ?? pot?.unit,
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
          ...(pot ? { pot } : {}),
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
        'Append a fund CLAIM to the holon\'s signed claims log (lens "flow_claims", kind 1808). Refused with `over-right` (and the party\'s `headroom`) when the amount is more than what is left of the party\'s right in that unit — their share of the pot less what was already claimed, paid or awaiting attestation; `force` records it anyway, and the fold holds it as `over`. Signed with this MCP instance key; counts only if the holon accepts that key for the party. Wraps @holons/core/flows buildClaim + claimHeadroom.',
      inputSchema: {
        holon: z.string().describe('Holon id.'),
        party: z.string().describe('The rights-holder claiming (member id or partner holon id).'),
        amount: z.number().positive(),
        unit: z.string().describe('Currency code, e.g. EUR.'),
        memo: z.string().optional(),
        onBehalfOf: z.string().optional().describe('Only the holon key may claim for a party; sets the delegated flag.'),
        force: z.boolean().optional().describe('Record the claim even past the headroom; it folds as `over`.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const unit = String(args.unit).trim().toUpperCase();
        const { ctx, ceilings } = await judgedClaims(hs, args.holon);
        const headroom = claimHeadroom(ceilings, ctx.folded, args.party, unit);
        if (!args.force && !fitsHeadroom(headroom, args.amount)) {
          return fail('over-right', { party: args.party, unit, headroom, amount: args.amount });
        }
        const a = buildClaim({ party: args.party, amount: args.amount, unit, memo: args.memo, onBehalfOf: args.onBehalfOf });
        const event = await hs.append(args.holon, FLOW_CLAIMS_LENS, a.item, { refs: a.refs });
        return ok({
          success: true,
          id: event.id,
          pubkey: event.pubkey,
          created_at: event.created_at,
          item: a.item,
          headroom,
          headroomAfter: headroom == null ? null : Math.max(0, Math.round((headroom - args.amount) * 100) / 100),
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'flow_transfer_record',
    {
      description:
        'GIVE part of a party\'s access to another party: append a `transfer` to the holon\'s signed claims log (lens "flow_claims", kind 1808). It burns the giver\'s access in that unit and opens the same amount for the receiver, who may then claim it or pass it on — a receiver with no seat on the allocation has exactly what reached them. Judged like a claim (signer, quorum, disputes; held `over` past the access), never settled or taken back. Refused with `over-right` (and the giver\'s `headroom`) past what is left of their access; `force` records it anyway. Signed with this MCP instance key; counts only if the holon accepts that key for the giver. Wraps @holons/core/flows buildTransfer + claimHeadroom.',
      inputSchema: {
        holon: z.string().describe('Holon id.'),
        party: z.string().describe('The giver (member id or partner holon id).'),
        to: z.string().describe('The receiver: a member id, a partner holon id, or any party id the holon can name. Never the giver.'),
        amount: z.number().positive(),
        unit: z.string().describe('Unit, e.g. L or EUR.'),
        memo: z.string().optional(),
        onBehalfOf: z.string().optional().describe('Only the holon key may give for a party; sets the delegated flag.'),
        force: z.boolean().optional().describe('Record the give even past the headroom; it folds as `over`.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const unit = String(args.unit).trim().toUpperCase();
        const { ctx, ceilings } = await judgedClaims(hs, args.holon);
        const headroom = claimHeadroom(ceilings, ctx.folded, args.party, unit);
        if (!args.force && !fitsHeadroom(headroom, args.amount)) {
          return fail('over-right', { party: args.party, unit, headroom, amount: args.amount });
        }
        const a = buildTransfer({ party: args.party, to: args.to, amount: args.amount, unit, memo: args.memo, onBehalfOf: args.onBehalfOf });
        const event = await hs.append(args.holon, FLOW_CLAIMS_LENS, a.item, { refs: a.refs });
        return ok({
          success: true,
          id: event.id,
          pubkey: event.pubkey,
          created_at: event.created_at,
          item: a.item,
          headroom,
          headroomAfter: headroom == null ? null : Math.max(0, Math.round((headroom - args.amount) * 100) / 100),
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'flow_claim_verdict',
    {
      description: 'Attest or dispute a claim or a give (an attester\'s word; the policy\'s quorum decides). Wraps buildClaimVerdict.',
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
        'Fold the holon\'s claims log under its ceilings: every claim judged (approved | pending | disputed | over | conflict | settled | rejected), every give (`transfers`, same statuses but settled), payouts, totals per party and unit (claimed, settled, pending, over, given, received), the `ceilings` each party holds per unit (their share of the pot less draws outside the log) and the `headroom` left to each — their access: ceiling plus received less given, less what the log holds — the policy in force and whether the signer set is founded (log) or provisional (bootstrap). Wraps foldClaimsFromLenses + loadClaimCeilings.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const { ctx, ceilings, pots, truncated } = await judgedClaims(hs, args.holon);
        const names = await namesFor(hs, args.holon, [
          ...Object.keys(ceilings),
          ...Object.keys(ctx.folded.byParty),
          ...ctx.folded.claims.map((c) => c.party),
          ...ctx.folded.claims.map((c) => c.pubkey),
          ...ctx.folded.transfers.flatMap((t) => [t.party, t.to]),
          ...ctx.folded.imports.map((i) => i.holon),
        ]);
        return ok({
          success: true,
          source: ctx.actors.source,
          genesis: ctx.actors.genesis,
          policy: ctx.policy,
          myPubkey: hs.currentPubkey,
          myRole: ctx.actors.roleAt(hs.currentPubkey, Math.floor(Date.now() / 1000)),
          names,
          imports: ctx.folded.imports,
          claims: ctx.folded.claims,
          transfers: ctx.folded.transfers,
          payouts: ctx.folded.payouts,
          byParty: ctx.folded.byParty,
          pots,
          ceilings,
          headroom: headroomOf(ceilings, ctx.folded),
          ...(truncated ? { truncated } : {}),
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'flow_wallet',
    {
      description:
        "A party's balances over the holon, every unit at once — one line per unit they hold anything in: `account` (their statement over the fund: right, paid, claimed, received, given, available, over), `claimable` (what the next claim or give may be), `credit` (their mutual-credit position on the expenses lens: net, owedToYou, youOwe), `pot`, `sources` (collective | pot | mint | inbound | credit) and `held` (collected from the Pot, not claimable in the log). Nothing is converted across units. Defaults to the acting user. Wraps @holons/core/flows loadWallet.",
      inputSchema: {
        holon: z.string(),
        party: z.string().optional().describe('A user id or a holon id; omit for the acting user.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const party = String(args.party ?? deps.resolveActor().id ?? '');
        if (!party) return fail('No party given and no acting user.');
        const { ctx } = await judgedClaims(hs, args.holon);
        const wallet = await loadWallet(hs, args.holon, party, { claims: ctx.folded, scoreOf: scoreOf(hs) });
        const names = await namesFor(hs, args.holon, [party]);
        return ok({ success: true, holon: args.holon, party, names, ...wallet });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'flow_mint_record',
    {
      description:
        'Bring value into the fund: append a MINT to the holon\'s signed mints log (lens "flow_mints", kind 1808) — a harvest in L, a grant in EUR, anything the allocation should divide. Attesters only (the lens policy; admins by default): signed with this MCP instance key, it counts only if the holon accepts that key as an attester. Wraps @holons/core/flows buildMint.',
      inputSchema: {
        holon: z.string(),
        amount: z.number().positive(),
        unit: z.string().describe('The unit: L, KG, EUR …'),
        memo: z.string().optional().describe('What it is (e.g. "first pressing 2026").'),
        source: z.string().optional().describe('Where it came from, when it matters: a partner holon id (the trees), a lot name.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const a = buildMint({ amount: args.amount, unit: args.unit, memo: args.memo, source: args.source });
        const event = await hs.append(args.holon, FLOW_MINTS_LENS, a.item, { refs: a.refs });
        return ok({ success: true, id: event.id, pubkey: event.pubkey, created_at: event.created_at, item: a.item });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'flow_mints_state',
    {
      description:
        'What the fund holds: the holon\'s mints log folded (each mint judged: issued | pending | disputed | conflict | rejected), totals per unit, and what reaches the holon from upstream funds — its federation partners and the holons it keeps (`holons` lens) whose split seats it. Works for a personal holon (id = user id or pubkey): the rights reaching that person from every hub they are in. Wraps @holons/core/flows loadMints + loadInboundRights.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const [ctx, inbound] = await Promise.all([
          loadMints(hs, args.holon),
          loadInboundRights(hs, args.holon, { scoreOf: scoreOf(hs) }),
        ]);
        const names = await namesFor(hs, args.holon, [
          ...ctx.folded.mints.map((m) => m.pubkey),
          ...ctx.folded.mints.map((m) => m.source),
          ...inbound.inbound.map((r) => r.from),
        ]);
        return ok({
          success: true,
          holon: args.holon,
          source: ctx.actors.source,
          policy: ctx.policy,
          myPubkey: hs.currentPubkey,
          myRole: ctx.actors.roleAt(hs.currentPubkey, Math.floor(Date.now() / 1000)),
          names,
          byUnit: ctx.folded.byUnit,
          pendingByUnit: ctx.folded.pendingByUnit,
          mints: ctx.folded.mints,
          inbound: inbound.inbound,
          upstreams: inbound.upstreams,
          units: potUnits({ mints: ctx.folded, inbound: inbound.inbound }),
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
        const names = await namesFor(hs, args.holon, entries.map((e: any) => e.pubkey));
        return ok({ success: true, count: entries.length, names, entries: entries.map((e: any) => ({ id: e.id, pubkey: e.pubkey, created_at: e.created_at, refs: e.refs, item: e.item })) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
