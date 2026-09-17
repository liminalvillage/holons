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
import { allocate, resolveInteriorMembers, type AllocationMember } from './allocation.js';
import { readBundleRecord } from './bundle.js';
import { DEFAULT_CASCADE_DEPTH, type CascadeInputs, type ResolveChild } from './cascade.js';
import {
  hasAllocationConfig,
  readAllocationConfig,
  readInteriorShares,
  readZoneAssignments,
  readZonePeople,
  toAllocationPartners,
} from './settings.js';

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
  /**
   * `rights` (default) follows every configured split. `chain` follows only
   * holons that deployed a bundle — the ones value can actually be pushed
   * into on-chain — and reports their addresses.
   */
  rail?: 'rights' | 'chain';
  /** A display name for a person placed on someone's ring. */
  nameOf?: (id: string) => string | undefined;
  /** Optional scorer for equation-mode children. Absent: no roster (see above). */
  scoreOf?: (holonId: string) => Promise<AllocationMember[]>;
}

export interface LoadedCascade {
  /** Holon id → its split, for every holon that passes something on. */
  children: Record<string, CascadeInputs>;
  /** Holon id → bundle address, for the children that deployed one. */
  bundles: Record<string, string>;
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

/** One holon's split, or null when it has none or sends nothing onward. */
async function readChild(
  holosphere: any,
  holonId: string,
  opts: LoadCascadeOptions,
): Promise<{ inputs: CascadeInputs; onward: string[]; bundle: string | null } | null> {
  let settings: any = null;
  try {
    settings = await holosphere.get(holonId, 'settings', holonId);
  } catch {
    return null;
  }
  if (!hasAllocationConfig(settings)) return null;

  const bundle = readBundleRecord(settings)?.address ?? null;
  if (opts.rail === 'chain' && !bundle) return null;

  const config = readAllocationConfig(settings);
  const shares = readInteriorShares(settings);
  const zones = readZoneAssignments(settings);
  const people = readZonePeople(settings);

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
  if (!custom && opts.scoreOf) {
    try {
      scored = (await opts.scoreOf(holonId)) ?? [];
    } catch {
      scored = [];
    }
  }

  const inputs: CascadeInputs = {
    config,
    members: resolveInteriorMembers({ config, scored, shares, nameOf: opts.nameOf }),
    zoned: toAllocationPartners(federated, partnerNames, zones, people, peopleNames),
    ...(typeof settings?.name === 'string' && settings.name ? { name: settings.name } : {}),
  };

  const split = allocate({ total: null, ...inputs });
  const onward = new Set<string>();
  for (const member of split.interior) if (member.percentage > 0) onward.add(member.id);
  for (const zone of split.exterior) {
    for (const partner of zone.members ?? []) if (partner.percentage > 0) onward.add(partner.id);
  }
  onward.delete(holonId);
  if (onward.size === 0) return null;

  return { inputs, onward: [...onward], bundle };
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
  const bundles: Record<string, string> = {};
  const seen = new Set<string>(opts.rootId ? [String(opts.rootId)] : []);
  let visited = 0;
  let truncated = false;
  if (!holosphere) return { children, bundles, visited, truncated };

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
      if (child.bundle) bundles[id] = child.bundle;
      next.push(...child.onward);
    });
    frontier = fresh(next);
  }

  return { children, bundles, visited, truncated };
}

/** A loaded snapshot as the synchronous lookup `resolveCascade` takes. */
export const childResolver =
  (children: Record<string, CascadeInputs>): ResolveChild =>
  (partyId) =>
    children[partyId] ?? null;
