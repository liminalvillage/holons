// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { potAccount, potAccountSegments } from './pot-account.js';

const E18 = 10n ** 18n;
const labels = { collected: 'Collected', collectable: 'To collect', accruing: 'Accruing' };

describe('potAccount', () => {
  it('is only what is accruing before any table is committed', () => {
    const a = potAccount({ sharePct: 25, decimals: 18, received: 400n * E18, declared: 0n, cumulative: null, released: null });
    expect(a).toEqual({ collected: 0, collectable: 0, accruing: 100, total: 100 });
  });

  it('splits a committed row into what was collected and what still can be', () => {
    const a = potAccount({ sharePct: 10, decimals: 18, received: 1000n * E18, declared: 600n * E18, cumulative: 60n * E18, released: 20n * E18 });
    expect(a).toEqual({ collected: 20, collectable: 40, accruing: 40, total: 100 });
    const done = potAccount({ sharePct: 10, decimals: 18, received: 600n * E18, declared: 600n * E18, cumulative: 60n * E18, released: 60n * E18 });
    expect(done).toEqual({ collected: 60, collectable: 0, accruing: 0, total: 60 });
  });

  it('owes nothing when more was released than the table says, or the counters run backward', () => {
    const a = potAccount({ sharePct: 50, decimals: 6, received: 5_000_000n, declared: 9_000_000n, cumulative: 1_000_000n, released: 3_000_000n });
    expect(a).toEqual({ collected: 3, collectable: 0, accruing: 0, total: 3 });
  });

  it('accrues nothing to a party with no share, and reads a share out of range as its bound', () => {
    const base = { decimals: 18, received: 100n * E18, declared: 0n, cumulative: null, released: 0n };
    expect(potAccount({ ...base, sharePct: 0 }).accruing).toBe(0);
    expect(potAccount({ ...base, sharePct: 250 }).accruing).toBe(100);
    expect(potAccount({ ...base, sharePct: Number.NaN }).accruing).toBe(0);
  });

  it('stacks as collected, collectable, accruing, without the empty slices', () => {
    const a = potAccount({ sharePct: 10, decimals: 18, received: 1000n * E18, declared: 600n * E18, cumulative: 60n * E18, released: 0n });
    expect(potAccountSegments(a, labels)).toEqual([
      { kind: 'claimed', label: 'To collect', value: 60 },
      { kind: 'available', label: 'Accruing', value: 40 },
    ]);
    expect(potAccountSegments({ collected: 0, collectable: 0, accruing: 0, total: 0 }, labels)).toEqual([]);
  });
});
