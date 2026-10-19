// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading the splits a cascade runs through.
 *
 * `resolveCascade` is pure and asks, for every recipient, "does this party
 * divide what it receives?". This is where that answer comes from: the
 * recipient's own settings document, read off the same lens every other
 * surface reads — a member's id is their personal holon's id, a partner's id
 * is the partner holon's, so one keyed read covers both.
 *
 * The walk is breadth-first and bounded: each holon is read once however many
 * paths reach it, a level at a time, a few reads in flight at once, and never
 * beyond `maxDepth` hops or `maxHolons` reads. The store is eventually
 * consistent and so is this: a settings document that has not arrived (or a
 * read that fails) means the party is a terminal for now, never an error and
 * never a retry. The caller awaits one snapshot, resolves against it
 * synchronously, and re-runs on its own reload events.
 *
 * A child's contributors roster is its custom split when it has one. Running
 * the whole scoring pipeline for every holon downstream would mean reading
 * each one's ledger, so an equation-mode child gets no roster unless the
 * caller injects `scoreOf`: its contributors share then stays with the holon
 * (`retained`) — for a personal holon that is the owner keeping it, and for a
 * partner group it is what the leaf already said before cascades existed.
 */

import { getFederationSnapshot } from '../federation/snapshot.js';
import { allocate, resolveInteriorMembers, type AllocationMember, type InteriorShares } from './allocation.js';
import { applyStanding, applyStandingToRings, composeInterior, lapsedSeats, type Aliases, type AllocationBucket, type ClaimWindow } from './buckets.js';
import { DEFAULT_CASCADE_DEPTH, type CascadeInputs, type ResolveChild } from './cascade.js';
import {
  hasAllocationConfig,
  readAllocationAliases,
  readAllocationBuckets,
  readAllocationConfig,
  readAllocationClaimWindow,
  readAllocationGenesis,
  readInteriorShares,
  readZoneAssignments,
  readZonePeople,
  toAllocationPartners,
  type AllocationGenesis,
} from './settings.js';
import type { ResourceBase } from './resources.js';
import type { Standing } from './standing.js';

export const DEFAULT_CASCADE_HOLONS = 50;
export const DEFAULT_CASCADE_CONCURRENCY = 4;

export interface LoadCascadeOptions {
  /** The holon the cascade starts from; never read as a child of itself. */
  rootId?: string;
  /** Hops followed below the root. Matches `resolveCascade`'s `maxDepth`. */
  maxDepth?: number;
  /** Settings reads allowed in total. */
  maxHolons?: number;
  /** Settings reads in flight at once. */
  concurrency?: number;
  /** A display name for a person placed on someone's ring. */
  nameOf?: (id: string) => string | undefined;
  /** Optional scorer for equation-mode children. Absent: no roster (see above). */
  scoreOf?: (holonId: string) => Promise<AllocationMember[]>;
  /**
   * Optional standing reader — who exited, who is in need (`standing-load.ts`).
   * Absent: nobody has exited and nobody is in need, as far as this walk knows.
   */
  standingOf?: (holonId: string) => Promise<Standing>;
  /**
   * Optional resource reader — a holon's resource base (`resources-load.ts`).
   * Read for the partners of a `resourced` split only. Absent: nobody is
   * resourced, and such a split follows its zones alone.
   */
  resourcesOf?: (holonId: string) => Promise<ResourceBase>;
  /** The clock a claim window is read against. Default: now. */
  now?: number;
  /**
   * Called once for every party read, configured or not, with everything the
   * read found — what a map of the walk keeps and the cascade itself drops.
   */
  onRead?: (holonId: string, read: AllocationInputs) => void;
}

export interface LoadedCascade {
  /** Holon id → its split, for every holon that passes something on. */
  children: Record<string, CascadeInputs>;
  /** Settings reads made. */
  visited: number;
  /** `maxHolons` stopped the walk before it ran out of holons to read. */
  truncated: boolean;
}

/** Run `task` over `items`, at most `limit` at a time, keeping order. */
async function mapBounded<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Everything `allocate` needs for one holon, read off its settings — plus what it was read from. */
export interface AllocationInputs extends CascadeInputs {
  /** Whether an allocation was ever stored; false means `config` is the default shape. */
  configured: boolean;
  /** The settings document the split was read from (null when unreadable). */
  settings: unknown;
  /** The stored custom contributors split, by id. */
  shares: InteriorShares;
  /** Federation partner id → ring. */
  zones: Record<string, number>;
  /** Person id → ring. */
  people: Record<string, number>;
  /** The buckets the interior is divided by; empty for a single-mode split. */
  buckets: AllocationBucket[];
  /** Placeholder → the party who claimed it. */
  aliases: Aliases;
  /** The genesis lock, when the split is pinned. */
  genesis: AllocationGenesis | null;
  /** Bucket id → party → percent of the interior, when buckets divide it. */
  byBucket: Record<string, Record<string, number>>;
  /** Buckets with nobody in them this read. */
  emptyBuckets: string[];
  /** What `standingOf` said, when it was asked. */
  standing: Standing | null;
  /** The claim window on this split's seats, when it has one. */
  claimWindow: ClaimWindow | null;
  /** Seats the closed window retired: unclaimed, and so in no bucket. */
  lapsed: string[];
}

/**
 * One holon's split, read the way every surface reads it: its settings
 * document, its federation record when partners are placed, and — for an
 * equation-mode split — the scored roster `scoreOf` gives. Quiet: a holon
 * whose settings cannot be read is unconfigured, never an error.
 *
 * With buckets stored, the interior is composed from every bucket's rule
 * (`composeInterior`); without, the single mode applies as before. Either
 * way the standing `standingOf` reports is applied: a placeholder resolves
 * to whoever claimed it, an exited party is in no seat — and neither is a
 * seat left unclaimed past the split's claim window.
 */
export async function loadAllocationInputs(
  holosphere: any,
  holonId: string,
  opts: Pick<LoadCascadeOptions, 'nameOf' | 'scoreOf' | 'standingOf' | 'resourcesOf' | 'now'> = {},
): Promise<AllocationInputs> {
  let settings: any = null;
  try {
    settings = holosphere ? await holosphere.get(holonId, 'settings', holonId) : null;
  } catch {
    settings = null;
  }
  const configured = hasAllocationConfig(settings);
  const config = readAllocationConfig(settings);
  const shares = readInteriorShares(settings);
  const buckets = readAllocationBuckets(settings);
  const aliases = readAllocationAliases(settings);
  const genesis = readAllocationGenesis(settings);

  let standing: Standing | null = null;
  if (configured && opts.standingOf) {
    try {
      standing = (await opts.standingOf(holonId)) ?? null;
    } catch {
      standing = null;
    }
  }
  const exits = Object.keys(standing?.exited ?? {});
  const zones = applyStandingToRings(readZoneAssignments(settings), { aliases, exits });
  const people = applyStandingToRings(readZonePeople(settings), { aliases, exits });
  // A lapsed seat leaves the interior only: a ring is its holder's curation, not the fork's.
  const claimWindow = readAllocationClaimWindow(settings);
  const lapsed = lapsedSeats({ window: claimWindow, now: opts.now ?? Date.now(), buckets, shares, aliases });
  const out = lapsed.length ? [...exits, ...lapsed] : exits;

  // Only a holon that placed partners needs its federation record: it is what
  // drops the zone entries of partners that were since unlinked.
  let federated: string[] = [];
  let partnerNames: Record<string, string> = {};
  if (Object.keys(zones).length > 0) {
    try {
      const snapshot = await getFederationSnapshot(holosphere, holonId);
      federated = snapshot.federated;
      partnerNames = snapshot.partnerNames;
    } catch {
      // No federation record to check against: nobody is placed, for now.
    }
  }

  const peopleNames: Record<string, string> = {};
  for (const id of Object.keys(people)) {
    const name = opts.nameOf?.(id);
    if (name) peopleNames[id] = name;
  }

  let scored: AllocationMember[] = [];
  const custom = config.interiorMode === 'custom' && Object.keys(shares).length > 0;
  const needsScore = buckets.length ? buckets.some((b) => b.mode === 'equation') : !custom;
  if (configured && needsScore && opts.scoreOf) {
    try {
      scored = (await opts.scoreOf(holonId)) ?? [];
    } catch {
      scored = [];
    }
  }

  let members: AllocationMember[];
  let byBucket: Record<string, Record<string, number>> = {};
  let emptyBuckets: string[] = [];
  if (buckets.length) {
    const composed = composeInterior({
      buckets,
      scored,
      needs: Object.keys(standing?.inNeed ?? {}),
      exits: out,
      aliases,
      nameOf: opts.nameOf,
    });
    members = composed.members;
    byBucket = composed.byBucket;
    emptyBuckets = composed.empty;
  } else {
    members = applyStanding(resolveInteriorMembers({ config, scored, shares, nameOf: opts.nameOf }), { aliases, exits: out });
  }

  let zoned = toAllocationPartners(federated, partnerNames, zones, people, peopleNames);
  if (configured && (config.resourced ?? 0) > 0 && opts.resourcesOf) {
    const resourcesOf = opts.resourcesOf;
    zoned = await Promise.all(
      zoned.map(async (p) => {
        if (p.zone < 1) return p;
        try {
          const base = await resourcesOf(p.id);
          return base?.count > 0 ? { ...p, resources: base.count } : p;
        } catch {
          return p;
        }
      }),
    );
  }

  return {
    configured,
    settings,
    shares,
    zones,
    people,
    buckets,
    aliases,
    genesis,
    byBucket,
    emptyBuckets,
    standing,
    claimWindow,
    lapsed,
    config,
    members,
    zoned,
    ...(typeof settings?.name === 'string' && settings.name ? { name: settings.name } : {}),
  };
}

/** The parties a split pays something to, the holon itself excepted. */
export function onwardParties(inputs: CascadeInputs, holonId: string): string[] {
  const split = allocate({ total: null, config: inputs.config, members: inputs.members, zoned: inputs.zoned });
  const onward = new Set<string>();
  for (const member of split.interior) if (member.percentage > 0) onward.add(member.id);
  for (const zone of split.exterior) {
    for (const partner of zone.members ?? []) if (partner.percentage > 0) onward.add(partner.id);
  }
  onward.delete(holonId);
  return [...onward];
}

/** One holon's split, or null when it has none or sends nothing onward. */
async function readChild(
  holosphere: any,
  holonId: string,
  opts: LoadCascadeOptions,
): Promise<{ inputs: CascadeInputs; onward: string[] } | null> {
  const read = await loadAllocationInputs(holosphere, holonId, opts);
  opts.onRead?.(holonId, read);
  if (!read.configured) return null;
  const {
    configured: _c,
    settings: _s,
    shares: _sh,
    zones: _z,
    people: _p,
    buckets: _b,
    aliases: _a,
    genesis: _g,
    byBucket: _bb,
    emptyBuckets: _e,
    standing: _st,
    claimWindow: _w,
    lapsed: _l,
    ...inputs
  } = read;

  const onward = onwardParties(inputs, holonId);
  if (onward.length === 0) return null;
  return { inputs, onward };
}

/**
 * The splits of everyone downstream of `rootPartyIds` — the parties the root
 * pays — as one snapshot to resolve a cascade against.
 */
export async function loadCascadeChildren(
  holosphere: any,
  rootPartyIds: readonly string[],
  opts: LoadCascadeOptions = {},
): Promise<LoadedCascade> {
  const maxDepth = Math.max(0, Math.floor(opts.maxDepth ?? DEFAULT_CASCADE_DEPTH));
  const maxHolons = Math.max(0, Math.floor(opts.maxHolons ?? DEFAULT_CASCADE_HOLONS));
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? DEFAULT_CASCADE_CONCURRENCY));

  const children: Record<string, CascadeInputs> = {};
  const seen = new Set<string>(opts.rootId ? [String(opts.rootId)] : []);
  let visited = 0;
  let truncated = false;
  if (!holosphere) return { children, visited, truncated };

  const fresh = (ids: readonly string[]): string[] => {
    const out: string[] = [];
    for (const raw of ids) {
      const id = String(raw ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };

  let frontier = fresh(rootPartyIds);
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const room = maxHolons - visited;
    if (frontier.length > room) {
      truncated = true;
      frontier = frontier.slice(0, Math.max(0, room));
    }
    visited += frontier.length;

    const level = frontier;
    const read = await mapBounded(level, concurrency, (id) => readChild(holosphere, id, opts));
    const next: string[] = [];
    read.forEach((child, index) => {
      if (!child) return;
      const id = level[index];
      children[id] = child.inputs;
      next.push(...child.onward);
    });
    frontier = fresh(next);
  }

  return { children, visited, truncated };
}

/** A loaded snapshot as the synchronous lookup `resolveCascade` takes. */
export const childResolver =
  (children: Record<string, CascadeInputs>): ResolveChild =>
  (partyId) =>
    children[partyId] ?? null;
