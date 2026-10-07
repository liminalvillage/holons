// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { advanceRights, collectable, divideExactly, rightsRegression, rightsRow, ZERO_ADDRESS } from './rights.js';

const EVO = '0x' + 'e'.repeat(40);
const ETH = ZERO_ADDRESS;
const wallets: Record<string, string> = {
  alice: '0x' + 'a'.repeat(40),
  bob: '0x' + 'b'.repeat(40),
};
const addressOf = (p: string) => wallets[p] ?? null;

const sum = (rows: Array<{ token: string; cumulative: bigint }>, token: string) =>
  rows.filter((r) => r.token === token).reduce((s, r) => s + r.cumulative, 0n);

describe('divideExactly', () => {
  it('hands out every unit, the largest remainders first, ties by id', () => {
    const parts = divideExactly(100n, [
      { party: 'a', weight: 1n },
      { party: 'b', weight: 1n },
      { party: 'c', weight: 1n },
    ]);
    expect([...parts.values()].reduce((s, v) => s + v, 0n)).toBe(100n);
    expect([...parts.entries()]).toEqual([
      ['a', 34n],
      ['b', 33n],
      ['c', 33n],
    ]);
  });

  it('is empty for no income or no weight', () => {
    expect(divideExactly(0n, [{ party: 'a', weight: 1n }]).size).toBe(0);
    expect(divideExactly(10n, []).size).toBe(0);
  });
});

describe('advanceRights', () => {
  it('divides the first lunation by share and the rows add up to the receipts', () => {
    const t = advanceRights({
      previous: null,
      epoch: 84,
      shares: { alice: 60, bob: 40 },
      received: { [EVO]: 1000n },
      addressOf,
    });
    expect(t.epoch).toBe(84);
    expect(t.rows).toEqual([
      { party: 'alice', to: wallets.alice, token: EVO, cumulative: 600n },
      { party: 'bob', to: wallets.bob, token: EVO, cumulative: 400n },
    ]);
    expect(t.totals).toEqual({ [EVO]: 1000n });
  });

  it('carries past lunations untouched when the split moves', () => {
    const first = advanceRights({ previous: null, epoch: 84, shares: { alice: 60, bob: 40 }, received: { [EVO]: 1000n }, addressOf });
    // next moon: 500 more, alice re-split to 20 %
    const second = advanceRights({ previous: first, epoch: 85, shares: { alice: 20, bob: 80 }, received: { [EVO]: 1500n }, addressOf });
    expect(rightsRow(second, 'alice', EVO)?.cumulative).toBe(700n);
    expect(rightsRow(second, 'bob', EVO)?.cumulative).toBe(800n);
    expect(second.totals[EVO]).toBe(1500n);
    expect(rightsRegression(first, second)).toEqual([]);
  });

  it('a party cut to nothing keeps what they had; a newcomer starts this moon', () => {
    const first = advanceRights({ previous: null, epoch: 84, shares: { alice: 100 }, received: { [EVO]: 100n }, addressOf });
    const second = advanceRights({ previous: first, epoch: 85, shares: { bob: 100 }, received: { [EVO]: 150n }, addressOf });
    expect(rightsRow(second, 'alice', EVO)?.cumulative).toBe(100n);
    expect(rightsRow(second, 'bob', EVO)?.cumulative).toBe(50n);
  });

  it('a lunation with no income changes no amount but refreshes the addresses', () => {
    const first = advanceRights({ previous: null, epoch: 84, shares: { alice: 50, carol: 50 }, received: { [EVO]: 100n }, addressOf });
    expect(rightsRow(first, 'carol', EVO)?.to).toBe(ZERO_ADDRESS);
    const later = (p: string) => (p === 'carol' ? '0x' + 'c'.repeat(40) : addressOf(p));
    const second = advanceRights({ previous: first, epoch: 85, shares: { alice: 50, carol: 50 }, received: { [EVO]: 100n }, addressOf: later });
    expect(rightsRow(second, 'carol', EVO)).toEqual({ party: 'carol', to: '0x' + 'c'.repeat(40), token: EVO, cumulative: 50n });
    expect(rightsRow(second, 'alice', EVO)?.cumulative).toBe(50n);
  });

  it('keeps tokens apart and rounds each to its own receipts', () => {
    const t = advanceRights({
      previous: null,
      epoch: 84,
      shares: { alice: 33.333, bob: 33.333, carol: 33.334 },
      received: { [EVO]: 1000n, [ETH]: 7n },
      addressOf,
    });
    expect(sum(t.rows, EVO)).toBe(1000n);
    expect(sum(t.rows, ETH)).toBe(7n);
    expect(t.totals).toEqual({ [EVO]: 1000n, [ETH]: 7n });
  });

  it('a sub-share is a leaf like any other: 40 % of 50 % reads as 20', () => {
    // the cascade already flattened S's 50 % to P: shares are leaves of the root pot
    const t = advanceRights({ previous: null, epoch: 84, shares: { S: 30, P: 20, Q: 50 }, received: { [EVO]: 1000n }, addressOf });
    expect(rightsRow(t, 'P', EVO)?.cumulative).toBe(200n);
    expect(rightsRow(t, 'S', EVO)?.cumulative).toBe(300n);
  });

  it('refuses an epoch that does not advance, receipts that go backwards, income with nobody to take it', () => {
    const first = advanceRights({ previous: null, epoch: 84, shares: { alice: 100 }, received: { [EVO]: 100n }, addressOf });
    expect(() => advanceRights({ previous: first, epoch: 84, shares: { alice: 100 }, received: { [EVO]: 200n }, addressOf })).toThrow(/not after/);
    expect(() => advanceRights({ previous: first, epoch: 85, shares: { alice: 100 }, received: { [EVO]: 50n }, addressOf })).toThrow(/backwards/);
    expect(() => advanceRights({ previous: first, epoch: 85, shares: {}, received: { [EVO]: 200n }, addressOf })).toThrow(/nobody/);
    // no income and no shares is fine: the table just carries forward
    expect(advanceRights({ previous: first, epoch: 85, shares: {}, received: { [EVO]: 100n }, addressOf }).rows).toHaveLength(1);
  });
});

describe('collectable and rightsRegression', () => {
  const t = advanceRights({ previous: null, epoch: 84, shares: { alice: 60, bob: 40 }, received: { [EVO]: 1000n }, addressOf });

  it('is the row less what was released', () => {
    expect(collectable(t, 'alice', EVO, 0n)).toBe(600n);
    expect(collectable(t, 'alice', EVO, 600n)).toBe(0n);
    expect(collectable(t, 'alice', EVO, 700n)).toBe(0n);
    expect(collectable(t, 'nobody', EVO, 0n)).toBe(0n);
  });

  it('names what a hand-made successor got wrong', () => {
    const bad = {
      epoch: 85,
      rows: [{ party: 'alice', to: wallets.alice, token: EVO, cumulative: 500n }],
      totals: { [EVO]: 900n },
    };
    expect(rightsRegression(t, bad)).toEqual([
      'alice decreased in ' + EVO,
      'bob lost its ' + EVO + ' row',
      'total in ' + EVO + ' decreased',
      'rows in ' + EVO + ' do not add up to the declared total',
    ]);
  });
});
