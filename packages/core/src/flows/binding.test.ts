// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { resolveInteriorMembers, type AllocationConfig } from './allocation.js';
import { resolveCascade, type CascadeInputs } from './cascade.js';
import {
  DEEP_CASCADE_HOPS,
  LARGE_CASCADE_NODES,
  bindingAuthority,
  bindingPreflight,
  readBoundAddress,
} from './binding.js';

const cfg = (interiorPercent: number): AllocationConfig => ({
  interiorPercent,
  steepness: 50,
  nzones: 3,
  interiorMode: 'custom',
});

const collective = (...ids: string[]): CascadeInputs => ({
  config: cfg(100),
  members: resolveInteriorMembers({
    config: { interiorMode: 'custom' },
    scored: [],
    shares: Object.fromEntries(ids.map((id) => [id, 1])),
  }),
  zoned: [],
});

const personal = (keep: number, ...onward: string[]): CascadeInputs => ({
  config: cfg(keep),
  members: [],
  zoned: onward.map((id) => ({ id, name: id, zone: 1, kind: 'person' as const })),
});

const cascadeOf = (root: CascadeInputs, children: Record<string, CascadeInputs>, maxDepth = 3) =>
  resolveCascade({
    holonId: 'C',
    total: 100,
    root,
    resolveChild: (id) => children[id] ?? null,
    maxDepth,
  });

describe('bindingPreflight', () => {
  it('is empty for a wallet: nothing lies below a plain address', () => {
    const cascade = cascadeOf(collective('a', 'b'), { a: personal(50, 'x') });
    expect(bindingPreflight(cascade, 'a', { toContract: false })).toEqual({
      loops: [],
      nodes: 0,
      depth: 0,
      warnings: [],
    });
  });

  it('is empty without a cascade, a party, or a seat under the root', () => {
    const cascade = cascadeOf(collective('a'), {});
    expect(bindingPreflight(null, 'a').warnings).toEqual([]);
    expect(bindingPreflight(cascade, '').nodes).toBe(0);
    expect(bindingPreflight(cascade, 'nobody').nodes).toBe(0);
  });

  it('measures the subtree below the party, the party included', () => {
    // a keeps 50 and passes to x, who passes to y
    const cascade = cascadeOf(collective('a', 'b'), {
      a: personal(50, 'x'),
      x: personal(50, 'y'),
    });
    const pre = bindingPreflight(cascade, 'a');
    expect(pre.nodes).toBe(3); // a, x, y
    expect(pre.depth).toBe(2);
    expect(pre.warnings).toEqual([]);
    // b has no split of its own: a subtree of one
    expect(bindingPreflight(cascade, 'b')).toMatchObject({ nodes: 1, depth: 0, warnings: [] });
  });

  it('warns on a loop that runs through the party, not on one elsewhere', () => {
    const cascade = cascadeOf(collective('a', 'b'), {
      a: personal(50, 'x'),
      x: personal(50, 'a'),
      b: personal(50, 'y'),
    });
    const pre = bindingPreflight(cascade, 'a');
    expect(pre.warnings).toContain('loop');
    expect(pre.loops).toEqual([['C', 'a', 'x', 'a']]);
    expect(bindingPreflight(cascade, 'b').warnings).not.toContain('loop');
  });

  it('does not mind a holon keeping part of what it gets: the sync seats it for that', () => {
    const cascade = cascadeOf(collective('a'), { a: personal(50, 'x'), x: personal(30, 'y') });
    expect(bindingPreflight(cascade, 'a').warnings).toEqual([]);
  });

  it('warns on a large or deep subtree', () => {
    const wide = Array.from({ length: LARGE_CASCADE_NODES + 1 }, (_, i) => `m${i}`);
    const large = cascadeOf(collective('a'), { a: personal(0, ...wide) });
    expect(bindingPreflight(large, 'a').warnings).toContain('large');

    const chain: Record<string, CascadeInputs> = { a: personal(0, 'h1') };
    for (let i = 1; i <= DEEP_CASCADE_HOPS + 1; i++) chain[`h${i}`] = personal(0, `h${i + 1}`);
    const deep = cascadeOf(collective('a'), chain, DEEP_CASCADE_HOPS + 3);
    const pre = bindingPreflight(deep, 'a');
    expect(pre.depth).toBeGreaterThan(DEEP_CASCADE_HOPS);
    expect(pre.warnings).toContain('deep');
  });
});

describe('bindingAuthority', () => {
  const owner = '0x1CAE687b6a5F587A9936E4a4218a54da7e2FCcCf';
  const bound = '0x9d1A39eedCd6EEF29eB341AC9AeC8464964ED9A8';

  it('is the owner, case-insensitively', () => {
    expect(bindingAuthority({ wallet: owner.toLowerCase(), owner, bound: null })).toBe('owner');
  });

  it('is the bound wallet', () => {
    expect(bindingAuthority({ wallet: bound, owner, bound })).toBe('bound');
  });

  it('is nobody else — and never the zero address', () => {
    expect(bindingAuthority({ wallet: '0x' + '2'.repeat(40), owner, bound })).toBe('none');
    expect(bindingAuthority({ wallet: null, owner, bound })).toBe('none');
    const zero = '0x' + '0'.repeat(40);
    expect(bindingAuthority({ wallet: zero, owner, bound: zero })).toBe('none');
  });
});

describe('readBoundAddress', () => {
  it('reads an address and turns the zero address into unbound', () => {
    expect(readBoundAddress('0x' + '0'.repeat(40))).toBeNull();
    expect(readBoundAddress(undefined)).toBeNull();
    expect(readBoundAddress('0x9d1A39eedCd6EEF29eB341AC9AeC8464964ED9A8')).toBe(
      '0x9d1a39eedcd6eef29eb341ac9aec8464964ed9a8',
    );
  });
});
