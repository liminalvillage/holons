// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { childResolver, loadCascadeChildren } from './cascade-load.js';
import { resolveCascade } from './cascade.js';
import { hasAllocationConfig } from './settings.js';
import { loadBundleRecord } from './bundle.js';

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

describe('loadBundleRecord', () => {
  it('reads the bundle off the canonical settings document', async () => {
    const hs = fakeHolosphere({ h1: { bundle: { address: '0x' + 'a'.repeat(40), chainId: 11155111 } } });
    expect((await loadBundleRecord(hs, 'h1'))?.address).toBe('0x' + 'a'.repeat(40));
  });

  it('is null for a missing holosphere, an unset holon or a failed read', async () => {
    expect(await loadBundleRecord(null, 'h1')).toBeNull();
    expect(await loadBundleRecord(fakeHolosphere({}), 'h1')).toBeNull();
    expect(await loadBundleRecord(fakeHolosphere({}, {}, ['h1']), 'h1')).toBeNull();
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

  it("rail 'chain' only follows holons that deployed a bundle, and reports the addresses", async () => {
    const address = '0x' + 'b'.repeat(40);
    const hs = fakeHolosphere({
      u1: { ...passesOn(0, { u3: 1 }), bundle: { address, chainId: 11155111 } },
      u2: passesOn(0, { u3: 1 }),
    });
    const { children, bundles } = await loadCascadeChildren(hs, ['u1', 'u2'], { rail: 'chain' });
    expect(Object.keys(children)).toEqual(['u1']);
    expect(bundles).toEqual({ u1: address });
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
