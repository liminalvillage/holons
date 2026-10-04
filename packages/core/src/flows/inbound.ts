// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Inbound rights — what reaches a holon from the funds upstream of it.
 *
 * `resolveCascade` looks DOWN: from a pot, through every split, to the leaves.
 * A holon on one of those paths needs the same fact looked at from below:
 * "of what the collective minted, this much is mine to divide". That is an
 * `InboundRight` (`usage.ts`), and this module says where it comes from —
 * an upstream holon whose split seats this one, on its contributors side or
 * on a ring, times the pot that upstream holds.
 *
 * Which holons are upstream is not stored anywhere; it is read off the
 * federation record (a partner that seats us) — the same link the upstream
 * used to place us. The walk climbs `maxHops` levels so a collective that is
 * itself fed still resolves, and it is bounded, breadth-first and quiet
 * about what has not arrived, like `cascade-load.ts`.
 *
 * Only the pure rule (`inboundRightFrom`) knows the math; the loader knows
 * the lenses.
 */

import { getFederationSnapshot } from '../federation/snapshot.js';
import { myHolons } from '../holons/list.js';
import { allocate, resolveInteriorMembers, type AllocationMember } from './allocation.js';
import { loadMints } from './mints-load.js';
import {
  hasAllocationConfig,
  readAllocationConfig,
  readInteriorShares,
  readZoneAssignments,
  readZonePeople,
  toAllocationPartners,
} from './settings.js';
import type { InboundRight } from './usage.js';

/** One pot an upstream holon holds. */
export interface UpstreamPot {
  unit: string;
  total: number;
}

export interface InboundRightInput {
  /** The upstream holon and its settings document. */
  upstreamId: string;
  upstreamSettings: unknown;
  /** Its pot in one unit. */
  pot: UpstreamPot;
  /** The holon asking what reaches it. */
  holonId: string;
  /** The upstream's federation record, for who is really placed; defaults to whoever its zones name. */
  federated?: readonly string[] | null;
  partnerNames?: Record<string, string> | null;
  /** The upstream's scored roster, when its contributors share is by equation. */
  scored?: readonly AllocationMember[] | null;
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The right `holonId` holds over `upstreamId`'s pot, or null when the upstream
 * has no stored split, does not seat this holon, or its share comes to nothing.
 *
 * A holon may hold two seats upstream — a contributor row and a ring — and
 * both are its right; they are summed, as the cascade sums them.
 */
export function inboundRightFrom(input: InboundRightInput): InboundRight | null {
  const settings = input.upstreamSettings;
  if (!hasAllocationConfig(settings)) return null;
  const total = Number(input.pot?.total);
  if (!Number.isFinite(total) || total <= 0) return null;
  const holonId = String(input.holonId ?? '');
  if (!holonId || holonId === String(input.upstreamId)) return null;

  const config = readAllocationConfig(settings);
  const shares = readInteriorShares(settings);
  const zones = readZoneAssignments(settings);
  const people = readZonePeople(settings);
  const custom = config.interiorMode === 'custom' && Object.keys(shares).length > 0;
  const members = resolveInteriorMembers({
    config,
    scored: custom ? [] : [...(input.scored ?? [])],
    shares,
  });
  const federated = input.federated ? [...input.federated] : Object.keys(zones);
  const zoned = toAllocationPartners(federated, input.partnerNames ?? {}, zones, people);

  const result = allocate({ total, unit: input.pot.unit, config, members, zoned });
  let percentage = 0;
  for (const slice of result.interior) if (slice.id === holonId) percentage += slice.percentage;
  for (const zone of result.exterior) {
    for (const partner of zone.members ?? []) if (partner.id === holonId) percentage += partner.percentage;
  }
  if (!(percentage > 0)) return null;
  return {
    from: String(input.upstreamId),
    unit: input.pot.unit,
    right: round((percentage / 100) * total),
    percentage,
    pot: total,
  };
}

export const DEFAULT_INBOUND_HOPS = 2;
export const DEFAULT_INBOUND_HOLONS = 20;

export interface LoadInboundOptions {
  /** How many levels up the walk climbs. */
  maxHops?: number;
  /** Settings reads allowed in total. */
  maxHolons?: number;
  /** An upstream's pots; default reads its `flow_mints` log. */
  potsOf?: (upstreamId: string) => Promise<UpstreamPot[]>;
  /** The scored roster of an equation-mode upstream; absent: no contributor seats resolve there. */
  scoreOf?: (holonId: string) => Promise<AllocationMember[]>;
  /**
   * Who might seat `id`. Default: its federation partners and the holons it
   * keeps in its own `holons` lens (`myHolons`) — a person's hubs as much as
   * a group's partners. Whether a candidate really is upstream is decided by
   * its split, not by the list.
   */
  upstreamsOf?: (id: string) => Promise<string[]>;
}

export interface LoadedInbound {
  /** Every right reaching the holon, one per upstream and unit. */
  inbound: InboundRight[];
  /** The upstreams that seat the holon, nearest first. */
  upstreams: string[];
  /** Settings reads made. */
  visited: number;
  truncated: boolean;
}

/**
 * Who might seat `id`: its federation partners and the holons it keeps.
 *
 * Neither list is read as truth — a kept hub may seat nobody, a partner may
 * have no split — and both are read quietly, each on its own, so a person
 * with no federation record still finds their hubs. Deduplicated, in order:
 * partners first, then the kept holons newest first.
 */
export async function defaultUpstreams(holosphere: any, id: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: unknown) => {
    const v = String(raw ?? '');
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  try {
    for (const p of (await getFederationSnapshot(holosphere, id)).federated) add(p);
  } catch {
    // No federation record: nothing to add from it.
  }
  try {
    for (const h of await myHolons(holosphere, id)) add(h.id);
  } catch {
    // No list kept: nothing to add from it.
  }
  return out;
}

/** The mints an upstream issued, as pots, one per unit. */
async function mintedPots(holosphere: any, upstreamId: string): Promise<UpstreamPot[]> {
  try {
    const ctx = await loadMints(holosphere, upstreamId);
    return Object.entries(ctx.folded.byUnit)
      .filter(([, total]) => total > 0)
      .map(([unit, total]) => ({ unit, total }));
  } catch {
    return [];
  }
}

/**
 * What reaches `holonId` from the partners that seat it, and from theirs.
 *
 * An upstream's pot is what it minted plus what reaches IT (one hop further
 * up), so a collective fed by a federation of collectives still resolves.
 * Nothing is converted: a right is in the unit its pot is in.
 */
export async function loadInboundRights(
  holosphere: any,
  holonId: string,
  opts: LoadInboundOptions = {},
): Promise<LoadedInbound> {
  const maxHops = Math.max(0, Math.floor(opts.maxHops ?? DEFAULT_INBOUND_HOPS));
  const maxHolons = Math.max(0, Math.floor(opts.maxHolons ?? DEFAULT_INBOUND_HOLONS));
  const potsOf = opts.potsOf ?? ((id: string) => mintedPots(holosphere, id));
  const out: LoadedInbound = { inbound: [], upstreams: [], visited: 0, truncated: false };
  const self = String(holonId ?? '');
  if (!holosphere || !self) return out;

  // Total pots per holon, memoised: minted here plus inbound from above.
  const potCache = new Map<string, Promise<UpstreamPot[]>>();
  const potsFor = (id: string, hop: number, path: readonly string[]): Promise<UpstreamPot[]> => {
    const key = `${id}#${hop}`;
    const cached = potCache.get(key);
    if (cached) return cached;
    const p = (async () => {
      const own = await potsOf(id).catch(() => [] as UpstreamPot[]);
      const totals = new Map<string, number>();
      for (const pot of own) if (pot.total > 0) totals.set(pot.unit, (totals.get(pot.unit) ?? 0) + pot.total);
      if (hop < maxHops) {
        const above = await rightsInto(id, hop + 1, [...path, id]);
        for (const r of above) totals.set(r.unit, (totals.get(r.unit) ?? 0) + r.right);
      }
      return [...totals.entries()].map(([unit, total]) => ({ unit, total: round(total) }));
    })();
    potCache.set(key, p);
    return p;
  };

  const upstreamsOf = opts.upstreamsOf ?? ((id: string) => defaultUpstreams(holosphere, id));

  /** Rights reaching `target` from whoever might seat it, `hop` levels above the root. */
  const rightsInto = async (target: string, hop: number, path: readonly string[]): Promise<InboundRight[]> => {
    let candidates: string[] = [];
    try {
      candidates = (await upstreamsOf(target)).map(String);
    } catch {
      return [];
    }
    const rights: InboundRight[] = [];
    for (const upstreamId of candidates) {
      if (!upstreamId || path.includes(upstreamId) || upstreamId === target) continue;
      if (out.visited >= maxHolons) {
        out.truncated = true;
        break;
      }
      out.visited += 1;
      let settings: unknown = null;
      let snapshot: { federated: string[]; partnerNames: Record<string, string> } | null = null;
      try {
        settings = await holosphere.get(upstreamId, 'settings', upstreamId);
      } catch {
        continue;
      }
      if (!hasAllocationConfig(settings)) continue;
      try {
        snapshot = await getFederationSnapshot(holosphere, upstreamId);
      } catch {
        snapshot = null;
      }
      const config = readAllocationConfig(settings);
      const custom = config.interiorMode === 'custom' && Object.keys(readInteriorShares(settings)).length > 0;
      let scored: AllocationMember[] = [];
      if (!custom && opts.scoreOf) {
        try {
          scored = (await opts.scoreOf(upstreamId)) ?? [];
        } catch {
          scored = [];
        }
      }
      const pots = await potsFor(upstreamId, hop, path);
      for (const pot of pots) {
        const right = inboundRightFrom({
          upstreamId,
          upstreamSettings: settings,
          pot,
          holonId: target,
          federated: snapshot?.federated ?? null,
          partnerNames: snapshot?.partnerNames ?? null,
          scored,
        });
        if (right) rights.push(right);
      }
      if (rights.some((r) => r.from === upstreamId) && target === self && !out.upstreams.includes(upstreamId)) {
        out.upstreams.push(upstreamId);
      }
    }
    return rights;
  };

  out.inbound = maxHops > 0 ? await rightsInto(self, 1, [self]) : [];
  return out;
}
