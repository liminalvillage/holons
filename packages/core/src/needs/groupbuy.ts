// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Solidarity purchase groups (docs/needs-offers-network.md §7) — the Italian
 * Gruppi di Acquisto Solidale tradition, made ambient.
 *
 * Because hex cells are real holons, aggregation needs no new
 * infrastructure: open needs visible at a cell are clustered by category
 * into a **group-buy quest living on the cell holon itself**. The record is
 * an ordinary `type:'need'` (tagged) so the whole existing machinery
 * applies: it lights the map through a cross-lens hologram at the cell's
 * `needs` lens, providers respond to it like any need, members join through
 * the participant operations, and one provider response serves the whole
 * aggregate.
 *
 * Event-driven rather than periodic: callers re-aggregate a cell after
 * publishing to it (`upsertGroupBuys`). Idempotent — ids are stable per
 * (cell, category), so concurrent aggregators converge; an existing group
 * buy keeps its participants, responses, and lifecycle state, and one whose
 * cluster shrank below the threshold is cancelled so no ghost stays lit.
 */

import type { HoloSphere } from 'holosphere';
import { NEED_RECORD_LENS, NEEDS_LENS, OPEN_NEED_STATUSES, type PublishedNeed } from './types.js';
import { normalizeNeed } from './transform.js';

export const GROUP_BUY_TAG = 'group-buy';

/** A member need folded into a group buy — enough to trace it back. */
export interface GroupBuyMember {
  needId: string;
  /** The holon that owns the member need (from its read-side envelope). */
  holonId?: string;
  title: string;
}

export interface GroupBuyCluster {
  /** Cluster key — the category, normalized. */
  key: string;
  /** Human label (the most common original spelling). */
  label: string;
  members: GroupBuyMember[];
}

/** Stable id: one group buy per (cell, category). */
export function groupBuyId(cell: string, key: string): string {
  return `groupbuy-${cell}-${key}`;
}

export function isGroupBuy(rec: unknown): boolean {
  const r = rec as { tags?: unknown } | null;
  return Boolean(r && Array.isArray(r.tags) && r.tags.includes(GROUP_BUY_TAG));
}

/** Cluster key for a need: its category, else the title's first word. */
export function clusterKeyOf(need: PublishedNeed): string {
  const raw = String(need.category ?? '').trim() || String(need.title ?? '').trim().split(/\s+/)[0] || '';
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Group a cell's visible needs by category. Group buys themselves and
 * closed/claimed needs never cluster; clusters below `minSize` are dropped.
 */
export function clusterNeedsByCategory(
  records: unknown[],
  opts: { minSize?: number } = {}
): GroupBuyCluster[] {
  const minSize = opts.minSize ?? 2;
  const clusters = new Map<string, GroupBuyCluster>();
  for (const raw of records ?? []) {
    if (isGroupBuy(raw)) continue;
    const need = normalizeNeed(raw);
    if (!need || !OPEN_NEED_STATUSES.includes(need.status)) continue;
    const key = clusterKeyOf(need);
    if (!key) continue;
    const label = String(need.category ?? '').trim() || String(need.title ?? '').trim().split(/\s+/)[0];
    const cluster = clusters.get(key) ?? { key, label, members: [] };
    const holonId = (raw as { _hologram?: { sourceHolon?: string } })._hologram?.sourceHolon;
    cluster.members.push({
      needId: String(need.id),
      ...(holonId ? { holonId: String(holonId) } : {}),
      title: String(need.title ?? ''),
    });
    clusters.set(key, cluster);
  }
  return [...clusters.values()].filter((c) => c.members.length >= minSize);
}

/**
 * Build (or refresh) the group-buy quest for a cluster. When `existing` is
 * passed, its lifecycle state — participants, responses, status, handoff —
 * survives; only the membership and description refresh.
 */
export function buildGroupBuyQuest(
  cell: string,
  cluster: GroupBuyCluster,
  opts: { existing?: PublishedNeed | null; now?: number } = {}
): PublishedNeed {
  const now = opts.now ?? Date.now();
  const existing = opts.existing ?? null;
  const base: Record<string, unknown> = existing ? { ...existing } : {};
  return {
    ...base,
    id: groupBuyId(cell, cluster.key),
    type: 'need',
    status: existing?.status ?? 'requested',
    title: `Group buy: ${cluster.label} ×${cluster.members.length}`,
    description: `${cluster.members.length} open needs in this cell, collapsed into one order:\n${cluster.members
      .map((m) => `• ${m.title}`)
      .join('\n')}`,
    // The cell itself asks — nobody owns a hexagon, everybody may join.
    initiator: existing?.initiator ?? { id: cell, username: `Cell ${cell.slice(0, 7)}` },
    participants: existing?.participants ?? [],
    responses: existing?.responses ?? [],
    tags: [GROUP_BUY_TAG],
    members: cluster.members,
    created: (existing as { created?: string } | null)?.created ?? new Date(now).toISOString(),
    updated: new Date(now).toISOString(),
  } as unknown as PublishedNeed;
}

/** Minimal store surface (holosphere, or an identity-attributed wrapper). */
export interface GroupBuyStoreLike {
  put(holonId: string, lens: string, value: unknown): Promise<unknown>;
  get(holonId: string, lens: string, key?: string | number): Promise<unknown>;
  getAll(holonId: string, lens: string): Promise<unknown[]>;
}

export interface UpsertGroupBuysOutcome {
  cell: string;
  upserted: string[];
  cancelled: string[];
  errors: string[];
}

/**
 * Re-aggregate one cell: read its `needs` lens, cluster, upsert the group-buy
 * quests on the cell holon, and point a cross-lens hologram at each from the
 * `needs` lens so the map (and every cell subscriber) sees them live. Group
 * buys whose cluster dissolved are cancelled.
 */
export async function upsertGroupBuys(
  holosphere: HoloSphere,
  cell: string,
  opts: { minSize?: number; db?: GroupBuyStoreLike; now?: number } = {}
): Promise<UpsertGroupBuysOutcome> {
  const db: GroupBuyStoreLike = opts.db ?? (holosphere as unknown as GroupBuyStoreLike);
  const outcome: UpsertGroupBuysOutcome = { cell, upserted: [], cancelled: [], errors: [] };
  const appname = (holosphere as { appname?: string }).appname ?? '';

  let records: unknown[] = [];
  try {
    records = ((await db.getAll(cell, NEEDS_LENS)) ?? []).filter(Boolean);
  } catch (err) {
    outcome.errors.push(`read: ${(err as Error).message ?? String(err)}`);
    return outcome;
  }

  const clusters = clusterNeedsByCategory(records, { minSize: opts.minSize });
  const liveIds = new Set(clusters.map((c) => groupBuyId(cell, c.key)));

  for (const cluster of clusters) {
    const id = groupBuyId(cell, cluster.key);
    let existing: PublishedNeed | null = null;
    try {
      existing = normalizeNeed(await db.get(cell, NEED_RECORD_LENS, id));
    } catch {
      /* fresh */
    }
    // A settled group buy stays settled — don't resurrect it.
    if (existing && (existing.status === 'fulfilled' || existing.status === 'cancelled')) {
      continue;
    }
    const quest = buildGroupBuyQuest(cell, cluster, { existing, now: opts.now });
    try {
      await db.put(cell, NEED_RECORD_LENS, quest);
      // Cross-lens hologram so the cell's needs lens (what the map reads)
      // resolves the group buy live — same shape as publishNeedNearby's.
      await db.put(cell, NEEDS_LENS, {
        id,
        soul: `${appname}/${cell}/${NEED_RECORD_LENS}/${id}`,
      });
      outcome.upserted.push(id);
    } catch (err) {
      outcome.errors.push(`${id}: ${(err as Error).message ?? String(err)}`);
    }
  }

  // Dissolve group buys whose members were fulfilled/withdrawn underneath.
  for (const raw of records) {
    if (!isGroupBuy(raw)) continue;
    const gb = normalizeNeed(raw);
    if (!gb || !OPEN_NEED_STATUSES.includes(gb.status)) continue;
    const id = String(gb.id);
    if (liveIds.has(id)) continue;
    try {
      await db.put(cell, NEED_RECORD_LENS, {
        ...gb,
        status: 'cancelled',
        closedAt: new Date(opts.now ?? Date.now()).toISOString(),
      });
      outcome.cancelled.push(id);
    } catch (err) {
      outcome.errors.push(`${id}: ${(err as Error).message ?? String(err)}`);
    }
  }

  return outcome;
}
