// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading, publishing and loading the flow graph of a Pot.
 *
 * `crawlFlowGraph` is the walk a cut makes (`rights-cut.ts`) without the
 * table: the root's split, everyone downstream, one cascade — folded by
 * `buildFlowGraph`, with what each read said about the party kept beside it.
 * The store is eventually consistent and so is this: a document that has not
 * arrived is a terminal, and a walk a bound cut short says so on the graph.
 *
 * `publishFlowGraph` writes the parts, then the head that makes them the
 * current generation, then clears parts a smaller graph no longer needs.
 */

import { getFederationSnapshot } from '../federation/snapshot.js';
import { DEFAULT_CASCADE_NODES, resolveCascade, type CascadeInputs } from './cascade.js';
import { childResolver, loadAllocationInputs, loadCascadeChildren, type AllocationInputs, type LoadCascadeOptions } from './cascade-load.js';
import { buildFlowGraph, type FlowGraph, type FlowPartyMeta } from './flow-graph.js';
import { decodeFlowGraph, encodeFlowGraph, FLOW_GRAPH_LENS, type DecodedFlowGraph, type FlowGraphHead } from './flow-graph-doc.js';
import { payoutAddressOf, readPayoutAddress } from './payout.js';
import { readPotRecord } from './pot-record.js';
import { capitalCounts, capitalsFromCounts } from './resources.js';

export const DEFAULT_FLOW_GRAPH_HOLONS = 5000;
export const DEFAULT_FLOW_GRAPH_DEPTH = 6;
/** People a holon is given room to seat when the node bound follows the holon bound. */
const NODES_PER_HOLON = 20;

export interface CrawlFlowGraphOptions extends Pick<LoadCascadeOptions, 'nameOf' | 'scoreOf' | 'standingOf' | 'resourcesOf' | 'now' | 'concurrency'> {
  maxHolons?: number;
  maxDepth?: number;
  maxNodes?: number;
  epoch?: number;
  /** Also draw the root's federation partners the cascade does not reach. Default true. */
  includeFederated?: boolean;
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

const cascadeInputs = (read: AllocationInputs): CascadeInputs => ({
  config: read.config,
  members: read.members,
  zoned: read.zoned,
  ...(read.name ? { name: read.name } : {}),
});

/** What one read says about the party, beyond its split. */
function metaOf(read: AllocationInputs, chainId: number | null): FlowPartyMeta {
  const pot = readPotRecord(read.settings);
  const seats = read.buckets.length
    ? [...new Set(read.buckets.flatMap((b) => Object.keys(b.shares ?? {})))]
    : Object.keys(read.shares);
  return {
    ...(read.name ? { name: read.name } : {}),
    payout: chainId != null ? payoutAddressOf(read.settings, chainId) : readPayoutAddress(read.settings),
    pot: pot ? { chainId: pot.chainId, address: pot.address } : null,
    aliases: read.aliases,
    claimWindow: read.claimWindow,
    seats,
  };
}

/** The flow graph of `potId`, read from the store. */
export async function crawlFlowGraph(holosphere: any, potId: string, opts: CrawlFlowGraphOptions = {}): Promise<FlowGraph> {
  const holon = String(potId ?? '');
  const at = opts.now ?? Date.now();
  const read = { nameOf: opts.nameOf, scoreOf: opts.scoreOf, standingOf: opts.standingOf, resourcesOf: opts.resourcesOf, now: opts.now };

  const inputs = await loadAllocationInputs(holosphere, holon, read);
  const pot = readPotRecord(inputs.settings);
  const chainId = pot?.chainId ?? null;
  const maxHolons = opts.maxHolons ?? pot?.walk?.holons ?? DEFAULT_FLOW_GRAPH_HOLONS;
  const maxDepth = opts.maxDepth ?? pot?.walk?.depth ?? DEFAULT_FLOW_GRAPH_DEPTH;
  const maxNodes = opts.maxNodes ?? pot?.walk?.nodes ?? Math.max(DEFAULT_CASCADE_NODES, maxHolons * NODES_PER_HOLON);

  const meta: Record<string, FlowPartyMeta> = { [holon]: metaOf(inputs, chainId) };
  const problems: string[] = [];
  if (!inputs.configured) problems.push('the holon has no allocation');

  const root = cascadeInputs(inputs);
  const rootPartyIds = [...new Set([...inputs.members.map((m) => m.id), ...inputs.zoned.filter((p) => p.zone >= 1).map((p) => p.id)])];
  const loaded = await loadCascadeChildren(holosphere, rootPartyIds, {
    ...read,
    rootId: holon,
    maxDepth,
    maxHolons,
    concurrency: opts.concurrency,
    onRead: (id, found) => {
      meta[id] = metaOf(found, chainId);
    },
  });
  const cascade = resolveCascade({ holonId: holon, total: null, root, resolveChild: childResolver(loaded.children), maxDepth, maxNodes });
  if (loaded.truncated) problems.push(`the walk stopped at ${loaded.visited} holons`);
  if (cascade.truncated) problems.push('the cascade reached its depth or node bound');

  // A fund the Pot is federated with but does not seat pays nothing from here,
  // and still curates: it belongs on the map by its own split.
  const extra: Record<string, CascadeInputs> = {};
  if (opts.includeFederated !== false && inputs.configured) {
    let federated: string[] = [];
    try {
      federated = (await getFederationSnapshot(holosphere, holon)).federated;
    } catch {
      federated = [];
    }
    for (const id of federated) {
      if (id === holon || meta[id]) continue;
      const found = await loadAllocationInputs(holosphere, id, read);
      meta[id] = metaOf(found, chainId);
      if (found.configured) extra[id] = cascadeInputs(found);
    }
  }

  const graph = buildFlowGraph({
    cascade,
    meta,
    extra,
    at,
    ...(opts.epoch != null ? { epoch: opts.epoch } : {}),
    complete: problems.length === 0,
    problems,
  });

  // What reached each party besides its share: its received resource gifts.
  if (opts.resourcesOf) {
    const resourcesOf = opts.resourcesOf;
    const nodes = graph.nodes.filter((n) => n.kind !== 'placeholder');
    const found = await mapBounded(nodes, Math.max(1, opts.concurrency ?? 4), async (n) => {
      try {
        return capitalsFromCounts(capitalCounts((await resourcesOf(n.id))?.byCapital));
      } catch {
        return {};
      }
    });
    nodes.forEach((n, i) => {
      if (Object.keys(found[i]).length) n.resources = found[i];
    });
  }
  return graph;
}

const quiet = async <T>(promise: Promise<T>, fallback: T): Promise<T> => {
  try {
    return (await promise) ?? fallback;
  } catch {
    return fallback;
  }
};

/** Write `graph` as the Pot's current snapshot. */
export async function publishFlowGraph(
  holosphere: any,
  potId: string,
  graph: FlowGraph,
  opts: { partBytes?: number } = {},
): Promise<{ head: FlowGraphHead; parts: number; bytes: number; largest: number }> {
  const holon = String(potId ?? '');
  if (!holosphere || !holon) throw new Error('A Pot holon is required');
  const { head, parts } = encodeFlowGraph(graph, opts);
  const before = await quiet<any[]>(holosphere.getAll(holon, FLOW_GRAPH_LENS), []);

  let bytes = 0;
  let largest = 0;
  for (const part of parts) {
    const size = new TextEncoder().encode(JSON.stringify(part)).length;
    bytes += size;
    largest = Math.max(largest, size);
    await holosphere.put(holon, FLOW_GRAPH_LENS, part);
  }
  // The head last: until it lands, readers still hold the generation before.
  await holosphere.put(holon, FLOW_GRAPH_LENS, head);

  for (const doc of Array.isArray(before) ? before : []) {
    const match = /^p(\d+)$/.exec(String(doc?.id ?? ''));
    if (match && Number(match[1]) >= parts.length) await quiet(holosphere.delete(holon, FLOW_GRAPH_LENS, doc.id), false);
  }
  return { head, parts: parts.length, bytes, largest };
}

/** The Pot's published snapshot, or why there is none to show. */
export async function loadFlowGraph(holosphere: any, potId: string): Promise<DecodedFlowGraph> {
  const holon = String(potId ?? '');
  if (!holosphere || !holon) return { ok: false, reason: 'missing' };
  return decodeFlowGraph(await quiet<any[]>(holosphere.getAll(holon, FLOW_GRAPH_LENS), []));
}
