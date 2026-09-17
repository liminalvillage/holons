// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Thin MCP wrappers around @holons/core/flows — a holon's fund allocation
// split (the same `settings/<holon>.allocation` mirror the kiosk and the
// dashboard read and write) and the cascade that follows each share down
// through its recipients' own splits. Every rule lives in core; this file
// only reads, calls and returns.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  allocate,
  childResolver,
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
import { REAEventStore } from '@holons/core/rea';
import { REAAggregator, computeHolonUserScores, extractReaUsers, loadEquation } from '@holons/core/scoring';
import type { ToolDeps } from './index.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }, null, 2) }],
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
}
