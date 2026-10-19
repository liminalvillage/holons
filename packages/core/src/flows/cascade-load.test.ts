// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { childResolver, loadAllocationInputs, loadCascadeChildren } from './cascade-load.js';
import { resolveCascade } from './cascade.js';
import { hasAllocationConfig } from './settings.js';

/** Settings documents and federation records by holon id, with a read log. */
function fakeHolosphere(
  settings: Record<string, any>,
  federation: Record<string, any> = {},
  failing: string[] = [],
) {
  const reads: string[] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    reads,
    get peak() {
      return peak;
    },
    async get(holon: string, lens: string, key: string) {
      reads.push(`${lens}/${holon}/${key}`);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      if (failing.includes(holon)) throw new Error('relay is quiet');
      return settings[holon] ?? null;
    },
    async getFederation(holon: string) {
      reads.push(`federation/${holon}`);
      return federation[holon] ?? null;
    },
  };
}

const passesOn = (interiorPercent: number, people: Record<string, number>) => ({
  allocation: { interiorPercent, steepness: 50, nzones: 3, people },
});

describe('hasAllocationConfig', () => {
  it('is true only when an allocation was stored — defaults are not a config', () => {
    expect(hasAllocationConfig(null)).toBe(false);
    expect(hasAllocationConfig({ name: 'Casa' })).toBe(false);
    expect(hasAllocationConfig({ allocation: null })).toBe(false);
    expect(hasAllocationConfig({ allocation: { interiorPercent: 60 } })).toBe(true);
  });
});

describe('loadCascadeChildren', () => {
  it('a holon with no stored allocation is not a child: defaults do not cascade', async () => {
    const hs = fakeHolosphere({ u1: { name: 'Una' } });
    const { children } = await loadCascadeChildren(hs, ['u1', 'u2']);
    expect(children).toEqual({});
  });

  it('a split that sends nothing onward is pruned', async () => {
    const hs = fakeHolosphere({
      u1: { allocation: { interiorPercent: 100 } },
      u2: { allocation: { interiorPercent: 40, interiorMode: 'custom', shares: { u2: 1 } } },
    });
    const { children } = await loadCascadeChildren(hs, ['u1', 'u2']);
    expect(children).toEqual({});
  });

  it('reads people on rings and follows them down', async () => {
    const hs = fakeHolosphere({
      u1: { name: 'Una', ...passesOn(60, { u3: 1 }) },
      u3: passesOn(0, { u4: 2 }),
    });
    const { children, visited } = await loadCascadeChildren(hs, ['u1', 'u2'], {
      nameOf: (id) => (id === 'u3' ? 'Tre' : undefined),
    });
    expect(Object.keys(children).sort()).toEqual(['u1', 'u3']);
    expect(children.u1.name).toBe('Una');
    expect(children.u1.members).toEqual([]);
    expect(children.u1.zoned).toEqual([{ id: 'u3', name: 'Tre', zone: 1, kind: 'person' }]);
    expect(visited).toBe(4); // u1, u2, u3, u4
  });

  it('custom shares become the roster; equation mode yields none unless a scorer is given', async () => {
    const hs = fakeHolosphere({
      g1: { allocation: { interiorPercent: 100, interiorMode: 'custom', shares: { a: 3, b: 1 } } },
      g2: { allocation: { interiorPercent: 50, interiorMode: 'equation', people: { z: 1 } } },
    });
    const plain = await loadCascadeChildren(hs, ['g1', 'g2']);
    expect(plain.children.g1.members.map((m) => [m.id, m.percentage])).toEqual([['a', 3], ['b', 1]]);
    expect(plain.children.g2.members).toEqual([]);

    const scored = await loadCascadeChildren(hs, ['g2'], {
      scoreOf: async () => [{ id: 'm', name: 'Em', percentage: 100 }],
    });
    expect(scored.children.g2.members).toEqual([{ id: 'm', name: 'Em', percentage: 100 }]);
  });

  it('reads federation only for a holon that placed partners, and drops unlinked ghosts', async () => {
    const hs = fakeHolosphere(
      {
        u1: { allocation: { interiorPercent: 0, zones: { p1: 1, ghost: 2 } } },
        u2: passesOn(0, { u9: 1 }),
      },
      { u1: { federated: ['p1'], partnerNames: { p1: 'Partner' } } },
    );
    const { children } = await loadCascadeChildren(hs, ['u1', 'u2']);
    expect(children.u1.zoned).toEqual([{ id: 'p1', name: 'Partner', zone: 1, kind: 'holon' }]);
    expect(hs.reads.filter((r) => r.startsWith('federation/'))).toEqual(['federation/u1']);
  });

  it('reads each holon once, even when reached twice or in a loop', async () => {
    const hs = fakeHolosphere({
      u1: passesOn(50, { u3: 1, u2: 1 }),
      u2: passesOn(50, { u3: 1, u1: 1 }),
      u3: passesOn(50, { u1: 1 }),
    });
    await loadCascadeChildren(hs, ['u1', 'u2', 'u1']);
    const settingsReads = hs.reads.filter((r) => r.startsWith('settings/'));
    expect(settingsReads.sort()).toEqual(['settings/u1/u1', 'settings/u2/u2', 'settings/u3/u3']);
  });

  it('never reads the root as a child of itself', async () => {
    const hs = fakeHolosphere({ u1: passesOn(0, { C: 1 }) });
    await loadCascadeChildren(hs, ['u1'], { rootId: 'C' });
    expect(hs.reads).not.toContain('settings/C/C');
  });

  it('respects maxHolons, maxDepth and the concurrency bound', async () => {
    const settings: Record<string, any> = {};
    for (let i = 0; i < 12; i++) settings[`u${i}`] = passesOn(0, { [`d${i}`]: 1 });
    const ids = Object.keys(settings);

    const bounded = fakeHolosphere(settings);
    const capped = await loadCascadeChildren(bounded, ids, { maxHolons: 5, concurrency: 2 });
    expect(capped.visited).toBe(5);
    expect(capped.truncated).toBe(true);
    expect(bounded.peak).toBeLessThanOrEqual(2);

    const shallow = fakeHolosphere({ a: passesOn(0, { b: 1 }), b: passesOn(0, { c: 1 }), c: passesOn(0, { d: 1 }) });
    const cut = await loadCascadeChildren(shallow, ['a'], { maxDepth: 2 });
    expect(Object.keys(cut.children).sort()).toEqual(['a', 'b']);
  });

  it('a failed read is a terminal, not a throw', async () => {
    const hs = fakeHolosphere({ u1: passesOn(0, { u3: 1 }), u2: passesOn(0, { u3: 1 }) }, {}, ['u1']);
    const { children } = await loadCascadeChildren(hs, ['u1', 'u2']);
    expect(Object.keys(children)).toEqual(['u2']);
  });

  it('feeds resolveCascade end to end', async () => {
    const hs = fakeHolosphere({ u1: passesOn(60, { u3: 1 }) });
    const { children } = await loadCascadeChildren(hs, ['u1', 'u2'], { rootId: 'C' });
    const result = resolveCascade({
      holonId: 'C',
      total: 1000,
      root: {
        config: { interiorPercent: 100, steepness: 50, nzones: 3, interiorMode: 'custom' },
        members: [
          { id: 'u1', name: 'Una', percentage: 1 },
          { id: 'u2', name: 'Due', percentage: 1 },
        ],
        zoned: [],
      },
      resolveChild: childResolver(children),
    });
    expect(result.leaves.u1.amount).toBeCloseTo(300);
    expect(result.leaves.u3.amount).toBeCloseTo(200);
    expect(result.leaves.u2.amount).toBeCloseTo(500);
  });
});

describe('buckets and standing in the walk', () => {
  const buckets = [
    { id: 'legacy', percent: 50, mode: 'custom', shares: { 'artisan:ada': 3, 'artisan:bo': 1 } },
    { id: 'needs', percent: 50, mode: 'needs' },
  ];

  it('composes a bucketed roster and reads the equation only when a bucket asks for it', async () => {
    const hs = fakeHolosphere({ p1: { allocation: { interiorPercent: 100, interiorMode: 'custom', buckets, aliases: { 'artisan:ada': 'ada' } } } });
    let scored = 0;
    const read = await loadAllocationInputs(hs, 'p1', {
      scoreOf: async () => {
        scored += 1;
        return [{ id: 'cy', name: 'Cy', percentage: 100 }];
      },
      standingOf: async () => ({ exited: {}, inNeed: { bo: { id: 'x', epoch: 1, createdAt: 1 } } }),
    });
    expect(scored).toBe(0);
    expect(read.buckets).toEqual(buckets);
    expect(read.aliases).toEqual({ 'artisan:ada': 'ada' });
    expect(read.members.map((m) => [m.id, m.percentage])).toEqual([
      ['ada', 37.5],
      ['artisan:bo', 12.5],
      ['bo', 50],
    ]);
    expect(read.byBucket.needs).toEqual({ bo: 50 });
    expect(read.emptyBuckets).toEqual([]);
  });

  it('without a standing reader nobody has exited; with one, an exit empties every seat, rings included', async () => {
    const doc = { allocation: { interiorPercent: 60, steepness: 50, nzones: 2, interiorMode: 'custom', shares: { ada: 1, bo: 1 }, people: { bo: 1, cy: 2 } } };
    const plain = await loadAllocationInputs(fakeHolosphere({ p1: doc }), 'p1');
    expect(plain.members.map((m) => m.id)).toEqual(['ada', 'bo']);
    expect(plain.standing).toBeNull();
    const gone = await loadAllocationInputs(fakeHolosphere({ p1: doc }), 'p1', {
      standingOf: async () => ({ exited: { bo: { id: 'x', epoch: 1, createdAt: 1 } }, inNeed: {} }),
    });
    expect(gone.members.map((m) => m.id)).toEqual(['ada']);
    expect(gone.zoned.map((p) => p.id)).toEqual(['cy']);
    const quiet = await loadAllocationInputs(fakeHolosphere({ p1: doc }), 'p1', {
      standingOf: async () => {
        throw new Error('relay is quiet');
      },
    });
    expect(quiet.members.map((m) => m.id)).toEqual(['ada', 'bo']);
  });

  it('a fund alias descends into the chat holon that claimed the project', async () => {
    const hs = fakeHolosphere({
      fund: { allocation: { interiorPercent: 100, interiorMode: 'custom', shares: { 'holon_proj': 1 }, aliases: { holon_proj: '-100' } } },
      '-100': { allocation: { interiorPercent: 100, interiorMode: 'custom', shares: { ada: 1, bo: 1 } } },
      holon_proj: { allocation: { interiorPercent: 100, interiorMode: 'custom', shares: { 'artisan:x': 1 } } },
    });
    const root = await loadAllocationInputs(hs, 'fund');
    expect(root.members.map((m) => m.id)).toEqual(['-100']);
    const loaded = await loadCascadeChildren(hs, root.members.map((m) => m.id), { rootId: 'fund' });
    const cascade = resolveCascade({ holonId: 'fund', total: 100, root: { config: root.config, members: root.members, zoned: root.zoned }, resolveChild: childResolver(loaded.children) });
    expect(Object.keys(cascade.leaves).sort()).toEqual(['ada', 'bo']);
    expect(hs.reads).not.toContain('settings/holon_proj/holon_proj');
  });

  it('tells onRead about every party it reads, the unconfigured and the pruned included', async () => {
    const hs = fakeHolosphere({
      u1: { name: 'Una', ...passesOn(60, { u3: 1 }) },
      u2: { name: 'Due', payout: { address: '0x' + '1'.repeat(40) } },
      u3: { allocation: { interiorPercent: 100, aliases: { 'artisan:x': 'u9' } } },
    });
    const seen: Record<string, { configured: boolean; name?: string; aliases: Record<string, string> }> = {};
    const { children } = await loadCascadeChildren(hs, ['u1', 'u2'], {
      onRead: (id, read) => {
        seen[id] = { configured: read.configured, name: read.name, aliases: read.aliases };
      },
    });
    expect(Object.keys(children)).toEqual(['u1']);
    expect(Object.keys(seen).sort()).toEqual(['u1', 'u2', 'u3']);
    expect(seen.u2).toEqual({ configured: false, name: 'Due', aliases: {} });
    expect(seen.u3.aliases).toEqual({ 'artisan:x': 'u9' });
  });
});

describe('resource base → financial bandwidth', () => {
  const fund = { allocation: { interiorPercent: 0, steepness: 50, nzones: 1, resourced: 50, zones: { a: 1, b: 1 } } };
  const federation = { f: { federated: ['a', 'b'], partnerNames: { a: 'Alder', b: 'Birch' } } };
  const base = (count: number) => ({ count, byCapital: { material: count }, amounts: {}, givers: 1 });

  it('a resourced fund carries each placed partner\'s resource base, and the split follows it', async () => {
    const hs = fakeHolosphere({ f: fund }, federation);
    const asked: string[] = [];
    const read = await loadAllocationInputs(hs, 'f', {
      resourcesOf: async (id) => {
        asked.push(id);
        return base(id === 'a' ? 3 : 1);
      },
    });
    expect(asked.sort()).toEqual(['a', 'b']);
    expect(read.zoned.map((p) => [p.id, p.resources])).toEqual([
      ['a', 3],
      ['b', 1],
    ]);
    const { children } = await loadCascadeChildren(hs, ['f'], { resourcesOf: async (id) => base(id === 'a' ? 3 : 1) });
    const cascade = resolveCascade({ holonId: 'root', total: 100, root: { config: { interiorPercent: 0, steepness: 50, nzones: 1 }, members: [], zoned: [{ id: 'f', name: 'F', zone: 1 }] }, resolveChild: childResolver(children) });
    // Half by zones (25 each), half by base (37.5 / 12.5).
    expect(Math.round(cascade.leaves.a.percentage * 100) / 100).toBe(62.5);
    expect(Math.round(cascade.leaves.b.percentage * 100) / 100).toBe(37.5);
  });

  it('a split that is not resourced never asks', async () => {
    const hs = fakeHolosphere({ f: { allocation: { ...fund.allocation, resourced: 0 } } }, federation);
    let asked = 0;
    const read = await loadAllocationInputs(hs, 'f', { resourcesOf: async () => (asked++, base(1)) });
    expect(asked).toBe(0);
    expect(read.zoned.every((p) => p.resources == null)).toBe(true);
  });
});
