// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { FLOW_GRAPH_LENS } from './flow-graph-doc.js';
import { crawlFlowGraph, loadFlowGraph, publishFlowGraph } from './flow-graph-load.js';

/** Settings by holon, federation records, and a lens store that takes writes. */
function fakeHolosphere(settings: Record<string, any>, federation: Record<string, any> = {}, failing: string[] = []) {
  const lenses: Record<string, Record<string, any>> = {};
  const writes: string[] = [];
  return {
    writes,
    lenses,
    async get(holon: string, lens: string, _key: string) {
      if (failing.includes(holon)) throw new Error('relay is quiet');
      return lens === 'settings' ? (settings[holon] ?? null) : null;
    },
    async getFederation(holon: string) {
      return federation[holon] ?? null;
    },
    async getAll(holon: string, lens: string) {
      return Object.values(lenses[`${holon}/${lens}`] ?? {});
    },
    async put(holon: string, lens: string, data: any) {
      writes.push(data.id);
      (lenses[`${holon}/${lens}`] ??= {})[data.id] = structuredClone(data);
      return true;
    },
    async delete(holon: string, lens: string, key: string) {
      writes.push(`-${key}`);
      delete lenses[`${holon}/${lens}`]?.[key];
      return true;
    },
  };
}

const POT = 'holon_pot';
const WALLET = '0x' + 'a'.repeat(40);

const world = () => ({
  [POT]: {
    name: 'The Pot',
    pot: { address: '0x' + '9'.repeat(40), chainId: 100 },
    allocation: {
      interiorPercent: 100,
      interiorMode: 'custom',
      shares: { holon_f1: 1, holon_j: 2, holon_old: 1 },
      aliases: { holon_old: '-100' },
      claimWindow: { until: 9_000_000_000_000, keep: ['holon_f1'] },
    },
  },
  holon_f1: { name: 'Fund One', allocation: { interiorPercent: 0, steepness: 50, nzones: 2, zones: { holon_j: 1 } } },
  holon_f2: { name: 'Fund Two', allocation: { interiorPercent: 0, steepness: 50, nzones: 2, zones: { holon_j: 1 } } },
  holon_j: { name: 'Project J', allocation: { interiorPercent: 100, interiorMode: 'custom', shares: { '111': 3, 'artisan:9': 1 } } },
  '-100': { name: 'Claimed', allocation: { interiorPercent: 100, interiorMode: 'custom', shares: { '111': 1 } } },
  '111': { name: 'Ada', payout: { address: WALLET } },
});

const federation = {
  [POT]: { federated: ['holon_f1', 'holon_f2'] },
  holon_f1: { federated: ['holon_j'] },
  holon_f2: { federated: ['holon_j'] },
};

describe('crawlFlowGraph', () => {
  it('reads the Pot, everyone downstream, and the funds it does not seat', async () => {
    const hs = fakeHolosphere(world(), federation);
    const g = await crawlFlowGraph(hs, POT, { now: 1000, epoch: 7 });
    const node = (id: string) => g.nodes.find((n) => n.id === id);

    expect(g).toMatchObject({ root: POT, at: 1000, epoch: 7, complete: true, problems: [] });
    expect(node(POT)).toMatchObject({ kind: 'pot', label: 'The Pot', pot: { chainId: 100 } });
    expect(node('holon_f1')).toMatchObject({ kind: 'fund', label: 'Fund One' });
    expect(node('holon_f1')!.share).toBeCloseTo(25);
    // Its own seat and the fund's ring.
    expect(node('holon_j')!.share).toBeCloseTo(75);
    expect(node('holon_j')).toMatchObject({ kind: 'project', unclaimedUntil: 9_000_000_000_000 });
    expect(node('111')).toMatchObject({ kind: 'person', label: 'Ada', payout: WALLET });
    expect(node('artisan:9')).toMatchObject({ kind: 'placeholder' });
    // The claimed seat is drawn under its claimant.
    expect(node('holon_old')).toBeUndefined();
    expect(node('-100')).toMatchObject({ kind: 'project', label: 'Claimed' });
    expect(g.aliases).toContainEqual({ at: POT, from: 'holon_old', to: '-100' });
    // Federated, unseated: on the map by its own split.
    expect(node('holon_f2')).toMatchObject({ kind: 'fund', share: 0, label: 'Fund Two' });
    expect(g.links.find((l) => l.source === 'holon_f2' && l.target === 'holon_j')).toMatchObject({ share: 0, via: 'exterior' });

    const without = await crawlFlowGraph(fakeHolosphere(world(), federation), POT, { includeFederated: false });
    expect(without.nodes.some((n) => n.id === 'holon_f2')).toBe(false);
  });

  it('says so when a bound stops the walk', async () => {
    const g = await crawlFlowGraph(fakeHolosphere(world(), federation), POT, { maxHolons: 2 });
    expect(g.complete).toBe(false);
    expect(g.problems[0]).toMatch(/stopped at 2 holons/);
  });

  it('reads the walk bounds the Pot record sets', async () => {
    const w = world();
    (w[POT].pot as any).walk = { holons: 1 };
    const g = await crawlFlowGraph(fakeHolosphere(w, federation), POT);
    expect(g.complete).toBe(false);
  });

  it('takes an unreadable document for a terminal and a missing split for a problem', async () => {
    const quiet = await crawlFlowGraph(fakeHolosphere(world(), federation, ['holon_j']), POT);
    expect(quiet.complete).toBe(true);
    expect(quiet.nodes.find((n) => n.id === 'holon_j')!.rest).toBeCloseTo(75);
    expect(quiet.nodes.some((n) => n.id === '111')).toBe(true); // through the claimed project

    const none = await crawlFlowGraph(fakeHolosphere({}), POT);
    expect(none).toMatchObject({ complete: false, problems: ['the holon has no allocation'] });
    expect(none.nodes).toHaveLength(1);
  });
});

describe('publishFlowGraph', () => {
  it('writes parts then the head, and loads back the same graph', async () => {
    const hs = fakeHolosphere(world(), federation);
    const g = await crawlFlowGraph(hs, POT, { now: 1000 });
    const out = await publishFlowGraph(hs, POT, g, { partBytes: 500 });
    expect(out.parts).toBeGreaterThan(1);
    expect(out.largest).toBeLessThanOrEqual(500);
    expect(hs.writes[hs.writes.length - 1]).toBe('head');
    expect(hs.writes.slice(0, -1)).toEqual(Array.from({ length: out.parts }, (_, i) => `p${i}`));

    const back = await loadFlowGraph(hs, POT);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.graph.nodes.map((n) => n.id).sort()).toEqual(g.nodes.map((n) => n.id).sort());
    expect(back.graph.links).toHaveLength(g.links.length);
  });

  it('clears the parts a smaller graph no longer needs', async () => {
    const hs = fakeHolosphere(world(), federation);
    const g = await crawlFlowGraph(hs, POT, { now: 1000 });
    const first = await publishFlowGraph(hs, POT, g, { partBytes: 400 });
    const second = await publishFlowGraph(hs, POT, { ...g, at: 2000 });
    expect(second.parts).toBeLessThan(first.parts);
    const ids = Object.keys(hs.lenses[`${POT}/${FLOW_GRAPH_LENS}`]).sort();
    expect(ids).toEqual(['head', ...Array.from({ length: second.parts }, (_, i) => `p${i}`)].sort());
    expect(await loadFlowGraph(hs, POT)).toMatchObject({ ok: true, graph: { at: 2000 } });
  });

  it('is missing where nothing was published', async () => {
    expect(await loadFlowGraph(fakeHolosphere({}), POT)).toEqual({ ok: false, reason: 'missing' });
    expect(await loadFlowGraph(null, POT)).toEqual({ ok: false, reason: 'missing' });
  });
});
