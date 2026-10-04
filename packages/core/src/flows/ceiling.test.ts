// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bootstrapActors } from '../protocol/membership.js';
import { signedEntry, testKey } from '../protocol/testing.js';
import { allocate } from './allocation.js';
import { ceilingOf, claimCeilings, claimHeadroom, fitsHeadroom, partyShares } from './ceiling.js';
import { buildClaim, buildClaimVerdict, buildPayout, foldClaims } from './claims.js';
import { buildFundUsage, fundAccount } from './usage.js';

const T0 = 1_760_000_000;
const NOW = T0 * 1000 + 10_000;
const holon = testKey();
const ada = testKey();
const bob = testKey();
const treasurer = testKey();
const HOLON = '-100';

const parties = new Map<string, string>([[ada.pk, 'ada'], [bob.pk, 'bob'], [treasurer.pk, 'tre']]);
const partyOf = (pk: string) => parties.get(pk) ?? null;
const actors = () => bootstrapActors({ members: [ada.pk, bob.pk], admins: [treasurer.pk, holon.pk], genesis: holon.pk });
const entry = <T extends Record<string, unknown>>(sk: Uint8Array, a: { item: T; refs?: Record<string, string | string[]> }, at: number) =>
  signedEntry<T>({ sk, item: a.item, refs: a.refs as never, created_at: at, lens: 'flow_claims' });

const usageParties = [{ id: 'ada', name: 'Ada' }, { id: 'bob', name: 'Bob' }];
// Half each, as percentages: the same shape serves every unit the pot is in.
const shares = allocate({
  total: null,
  config: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'custom' },
  members: [{ id: 'ada', name: 'Ada', percentage: 50 }, { id: 'bob', name: 'Bob', percentage: 50 }],
  zoned: [],
});
const fold = (entries: unknown[], rights?: unknown) =>
  foldClaims({ entries: entries as never, actors: actors(), partyOf, rights: rights as never });
const usageOf = (claims: ReturnType<typeof foldClaims> | null, extra: { expenses?: unknown[]; unit?: string } = {}) =>
  buildFundUsage({
    holonId: HOLON,
    unit: extra.unit ?? 'L',
    parties: usageParties,
    expenses: (extra.expenses ?? []) as never,
    claims,
    now: NOW,
  });

describe('claimCeilings', () => {
  it('is the share of the pot when nothing was drawn outside the log, keyed the way the fold keys units', () => {
    const c = claimCeilings({ shares, pots: { l: 200 }, usage: usageOf(fold([])), claims: fold([]) });
    expect(c).toEqual({ ada: { L: 100 }, bob: { L: 100 } });
    expect(ceilingOf(c, 'ada', 'l')).toBe(100);
    expect(ceilingOf(c, 'ada', 'EUR')).toBeNull();
    expect(partyShares(shares).get('bob')).toBe(50);
  });

  it('one ceiling per unit the pot is in; a unit with no pot has none', () => {
    const c = claimCeilings({ shares, pots: { L: 200, eur: 40, kg: 0 }, usage: null, claims: null });
    expect(c.ada).toEqual({ L: 100, EUR: 20 });
    expect(ceilingOf(c, 'ada', 'KG')).toBeNull();
  });

  it("the log's own draws are the fold's to subtract: a payout leaves the ceiling where it was", () => {
    const c1 = entry(bob.sk, buildClaim({ party: 'bob', amount: 40, unit: 'L', at: T0 * 1000 }) as never, T0);
    const paid = entry(treasurer.sk, buildPayout({ claimId: c1.id, party: 'bob', amount: 40, unit: 'L' }) as never, T0 + 1);
    const c2 = entry(ada.sk, buildClaim({ party: 'ada', amount: 10, unit: 'L', at: T0 * 1000 }) as never, T0 + 2);
    const claims = fold([c1, paid, c2]);
    const usage = usageOf(claims);
    expect(usage.lifetime.bob.l).toEqual({ spent: 40, claimed: 0 });
    expect(usage.lifetime.ada.l).toEqual({ spent: 0, claimed: 10 });
    const c = claimCeilings({ shares, pots: { L: 200 }, usage, claims });
    expect(c).toEqual({ ada: { L: 100 }, bob: { L: 100 } });
  });

  it('a draw outside the log — the fund paying on the expenses lens — lowers the ceiling', () => {
    const expenses = [
      // The holon paid 30 L worth, shared with bob alone: bob spent it from the fund.
      { id: 'e1', created: new Date(NOW - 86_400_000).toISOString(), amount: 30, currency: 'L', paidBy: HOLON, splitWith: ['bob'], description: 'jugs', participants: [] },
    ];
    const claims = fold([]);
    const c = claimCeilings({ shares, pots: { L: 200 }, usage: usageOf(claims, { expenses }), claims });
    expect(c.bob.L).toBe(70);
    expect(c.ada.L).toBe(100);
  });

  it('comes out the same whether the usage was built from a capped or an uncapped fold', () => {
    const big = entry(bob.sk, buildClaim({ party: 'bob', amount: 150, unit: 'L', at: T0 * 1000 }) as never, T0);
    const small = entry(bob.sk, buildClaim({ party: 'bob', amount: 20, unit: 'L', at: T0 * 1000 }) as never, T0 + 1);
    const uncapped = fold([big, small]);
    const first = claimCeilings({ shares, pots: { L: 200 }, usage: usageOf(uncapped), claims: uncapped });
    const capped = fold([big, small], first);
    expect(capped.claims.map((c) => c.status)).toEqual(['over', 'approved']);
    const second = claimCeilings({ shares, pots: { L: 200 }, usage: usageOf(capped), claims: capped });
    expect(second).toEqual(first);
  });
});

describe('claimHeadroom', () => {
  it('agrees with the account card: headroom equals what fundAccount says is available', () => {
    const c1 = entry(ada.sk, buildClaim({ party: 'ada', amount: 30, unit: 'L', at: T0 * 1000 }) as never, T0);
    const paid = entry(treasurer.sk, buildPayout({ claimId: c1.id, party: 'ada', amount: 30, unit: 'L' }) as never, T0 + 1);
    const c2 = entry(ada.sk, buildClaim({ party: 'ada', amount: 25, unit: 'L', at: T0 * 1000 }) as never, T0 + 2);
    const claims = fold([c1, paid, c2]);
    const usage = usageOf(claims);
    const ceilings = claimCeilings({ shares, pots: { L: 200 }, usage, claims });
    const sized = allocate({ total: 200, unit: 'L', config: shares.config, members: [{ id: 'ada', name: 'Ada', percentage: 50 }, { id: 'bob', name: 'Bob', percentage: 50 }], zoned: [] });
    const account = fundAccount(sized, usage, 'ada')!;
    expect(account.available).toBe(45);
    expect(claimHeadroom(ceilings, claims, 'ada', 'l')).toBe(45);
    expect(claimHeadroom(ceilings, claims, 'ada', 'EUR')).toBeNull();
  });

  it('a claim still awaiting attestation is already spoken for', () => {
    const c1 = entry(ada.sk, buildClaim({ party: 'ada', amount: 60, unit: 'L', at: T0 * 1000 }) as never, T0);
    const claims = foldClaims({ entries: [c1], actors: actors(), partyOf, policy: { quorum: 1 } });
    expect(claims.claims[0].status).toBe('pending');
    const ceilings = claimCeilings({ shares, pots: { L: 200 }, usage: usageOf(claims), claims });
    expect(claimHeadroom(ceilings, claims, 'ada', 'L')).toBe(40);
    expect(fitsHeadroom(40, 40.004)).toBe(true);
    expect(fitsHeadroom(40, 40.01)).toBe(false);
    expect(fitsHeadroom(null, 1_000_000)).toBe(true);
  });

  it('floors at zero past an overrun right', () => {
    const expenses = [
      { id: 'e1', created: new Date(NOW - 86_400_000).toISOString(), amount: 130, currency: 'L', paidBy: HOLON, splitWith: ['bob'], description: 'all of it', participants: [] },
    ];
    const claims = fold([]);
    const ceilings = claimCeilings({ shares, pots: { L: 200 }, usage: usageOf(claims, { expenses }), claims });
    expect(ceilings.bob.L).toBe(-30);
    expect(claimHeadroom(ceilings, claims, 'bob', 'L')).toBe(0);
  });
});

describe('the fold under the ceiling', () => {
  it('holds what the headroom said was too big, approves exactly the headroom, and caps later claims by earlier approved ones', () => {
    const base = fold([]);
    const ceilings = claimCeilings({ shares, pots: { L: 200 }, usage: usageOf(base), claims: base });
    expect(claimHeadroom(ceilings, base, 'bob', 'L')).toBe(100);

    const exact = entry(bob.sk, buildClaim({ party: 'bob', amount: 100, unit: 'L', at: T0 * 1000 }) as never, T0);
    const more = entry(bob.sk, buildClaim({ party: 'bob', amount: 0.01, unit: 'L', at: T0 * 1000 }) as never, T0 + 1);
    const f = fold([exact, more], ceilings);
    expect(f.claims.map((c) => c.status)).toEqual(['approved', 'over']);
    expect(claimHeadroom(ceilings, f, 'bob', 'L')).toBe(0);

    // Attested or not, the fold judges on accepted entries only; the headroom
    // tells the form what is really left, pending included.
    const first = entry(ada.sk, buildClaim({ party: 'ada', amount: 70, unit: 'L', at: T0 * 1000 }) as never, T0);
    const second = entry(ada.sk, buildClaim({ party: 'ada', amount: 50, unit: 'L', at: T0 * 1000 }) as never, T0 + 1);
    const quorum = { quorum: 1 };
    const pendingBoth = foldClaims({ entries: [first, second], actors: actors(), partyOf, rights: ceilings, policy: quorum });
    expect(pendingBoth.claims.map((c) => c.status)).toEqual(['pending', 'pending']);
    expect(claimHeadroom(ceilings, pendingBoth, 'ada', 'L')).toBe(0);
    const ok = entry(treasurer.sk, buildClaimVerdict(first.id, 'attest') as never, T0 + 2);
    const afterAttest = foldClaims({ entries: [first, second, ok], actors: actors(), partyOf, rights: ceilings, policy: quorum });
    expect(afterAttest.claims.map((c) => c.status)).toEqual(['approved', 'over']);
  });
});
