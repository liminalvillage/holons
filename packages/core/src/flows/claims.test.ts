// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bootstrapActors } from '../protocol/membership.js';
import { membershipOp, shuffled, signedEntry, testKey } from '../protocol/testing.js';
import { importPartnerLog } from '../protocol/federation.js';
import type { LogEvent } from '../protocol/types.js';
import { buildClaim, buildClaimVerdict, buildPayout, claimTotalsOf, foldClaims, foldClaimsFromLenses } from './claims.js';
import { lunationAt } from './lunation.js';
import { buildFundUsage, fundAccount } from './usage.js';
import { allocate } from './allocation.js';

const T0 = 1_760_000_000;
const holon = testKey();
const ada = testKey();
const adaPhone = testKey(); // a second key linked to ada
const bob = testKey();
const treasurer = testKey();
const stranger = testKey();

const parties = new Map<string, string>([[ada.pk, 'ada'], [adaPhone.pk, 'ada'], [bob.pk, 'bob'], [treasurer.pk, 'tre']]);
const partyOf = (pk: string) => parties.get(pk) ?? null;
const actors = () => bootstrapActors({ members: [ada.pk, adaPhone.pk, bob.pk], admins: [treasurer.pk, holon.pk], genesis: holon.pk });
const rights = { ada: { EUR: 100 }, bob: { EUR: 50 } };

const entry = <T extends Record<string, unknown>>(sk: Uint8Array, a: { item: T; refs?: Record<string, string | string[]> }, at: number) =>
  signedEntry<T>({ sk, item: a.item, refs: a.refs as never, created_at: at, lens: 'flow_claims' });

describe('foldClaims', () => {
  it('approves a member\'s claim within their right, in any arrival order', () => {
    const c1 = entry(ada.sk, buildClaim({ party: 'ada', amount: 30, unit: 'eur', memo: 'seeds', at: T0 * 1000 }) as never, T0);
    const c2 = entry(adaPhone.sk, buildClaim({ party: 'ada', amount: 20, unit: 'eur', at: T0 * 1000 }) as never, T0 + 1);
    const c3 = entry(bob.sk, buildClaim({ party: 'bob', amount: 10, unit: 'eur', at: T0 * 1000 }) as never, T0 + 2);
    const f = foldClaims({ entries: shuffled([c1, c2, c3]), actors: actors(), partyOf, rights });
    expect(f.claims.map((c) => [c.party, c.amount, c.status])).toEqual([['ada', 30, 'approved'], ['ada', 20, 'approved'], ['bob', 10, 'approved']]);
    expect(f.claims[0]).toMatchObject({ memo: 'seeds', unit: 'EUR', epoch: lunationAt(T0 * 1000).index, delegated: false });
    expect(claimTotalsOf(f, 'ada', 'eur')).toEqual({ claimed: 50, settled: 0, pending: 0, over: 0 });
    expect(f.source).toBe('bootstrap');
  });

  it('rejects a claim for someone else, or from a key nobody claims; the holon key may act on behalf', () => {
    const forBob = entry(ada.sk, buildClaim({ party: 'bob', amount: 5, unit: 'eur', at: T0 * 1000 }) as never, T0);
    const nobody = entry(stranger.sk, buildClaim({ party: 'ada', amount: 5, unit: 'eur', at: T0 * 1000 }) as never, T0 + 1);
    const viaBot = entry(holon.sk, buildClaim({ party: 'bob', amount: 5, unit: 'eur', onBehalfOf: 'bob', at: T0 * 1000 }) as never, T0 + 2);
    const botMismatch = entry(holon.sk, buildClaim({ party: 'bob', amount: 5, unit: 'eur', onBehalfOf: 'ada', at: T0 * 1000 }) as never, T0 + 3);
    const f = foldClaims({ entries: [forBob, nobody, viaBot, botMismatch], actors: actors(), partyOf, rights, holonPubkey: holon.pk });
    expect(f.claims.map((c) => [c.status, c.reason ?? null, c.delegated])).toEqual([
      ['rejected', 'party-mismatch', false],
      ['rejected', 'unaccepted-signer', false],
      ['approved', null, true],
      ['rejected', 'party-mismatch', true],
    ]);
  });

  it('holds a claim past the right as over — kept, shown, not counted', () => {
    const a = entry(bob.sk, buildClaim({ party: 'bob', amount: 40, unit: 'eur', at: T0 * 1000 }) as never, T0);
    const b = entry(bob.sk, buildClaim({ party: 'bob', amount: 20, unit: 'eur', at: T0 * 1000 }) as never, T0 + 1);
    const c = entry(bob.sk, buildClaim({ party: 'bob', amount: 10, unit: 'eur', at: T0 * 1000 }) as never, T0 + 2);
    const f = foldClaims({ entries: [a, b, c], actors: actors(), partyOf, rights });
    expect(f.claims.map((x) => x.status)).toEqual(['approved', 'over', 'approved']);
    expect(claimTotalsOf(f, 'bob', 'EUR')).toEqual({ claimed: 50, settled: 0, pending: 0, over: 20 });
    // No right known → no ceiling.
    expect(foldClaims({ entries: [a, b, c], actors: actors(), partyOf }).claims.every((x) => x.status === 'approved')).toBe(true);
  });

  it('quorum, dispute, payout: a claim is pending until attested, and a payout settles it once', () => {
    const claim = entry(ada.sk, buildClaim({ party: 'ada', amount: 30, unit: 'eur', at: T0 * 1000 }) as never, T0);
    const base = { actors: actors(), partyOf, rights, policy: { quorum: 1 } };
    expect(foldClaims({ entries: [claim], ...base }).claims[0]).toMatchObject({ status: 'pending', reason: 'quorum' });

    const memberAttest = entry(bob.sk, buildClaimVerdict(claim.id, 'attest') as never, T0 + 1);
    expect(foldClaims({ entries: [claim, memberAttest], ...base }).claims[0].status).toBe('pending');

    const ok = entry(treasurer.sk, buildClaimVerdict(claim.id, 'attest') as never, T0 + 2);
    expect(foldClaims({ entries: [claim, ok], ...base }).claims[0]).toMatchObject({ status: 'approved', attests: 1 });

    const no = entry(treasurer.sk, buildClaimVerdict(claim.id, 'dispute', 'receipt?') as never, T0 + 3);
    expect(foldClaims({ entries: [claim, ok, no], ...base }).claims[0]).toMatchObject({ status: 'disputed', disputes: 1 });

    const yes = entry(treasurer.sk, buildClaimVerdict(claim.id, 'attest') as never, T0 + 4);
    const paid = entry(treasurer.sk, buildPayout({ claimId: claim.id, party: 'ada', amount: 30, unit: 'eur', memo: 'bank' }) as never, T0 + 5);
    const again = entry(treasurer.sk, buildPayout({ claimId: claim.id, party: 'ada', amount: 30, unit: 'eur' }) as never, T0 + 6);
    const f = foldClaims({ entries: shuffled([claim, ok, no, yes, paid, again]), ...base });
    expect(f.claims[0]).toMatchObject({ status: 'settled', settledBy: paid.id });
    expect(f.payouts).toHaveLength(1);
    expect(f.payouts[0]).toMatchObject({ claimId: claim.id, amount: 30, memo: 'bank', pubkey: treasurer.pk });
    expect(claimTotalsOf(f, 'ada', 'eur')).toEqual({ claimed: 0, settled: 30, pending: 0, over: 0 });

    // Paying out is attester work: a member's payout does not count, nor does one naming no approved claim.
    const byMember = entry(bob.sk, buildPayout({ claimId: claim.id, party: 'ada', amount: 30, unit: 'eur' }) as never, T0 + 7);
    const orphan = entry(treasurer.sk, buildPayout({ claimId: 'nope', party: 'ada', amount: 1, unit: 'eur' }) as never, T0 + 8);
    const g = foldClaims({ entries: [claim, ok, byMember, orphan], ...base });
    expect(g.payouts).toHaveLength(0);
    expect(g.claims[0].status).toBe('approved');
  });

  it('a settled claim frees the right for a new one', () => {
    const c1 = entry(bob.sk, buildClaim({ party: 'bob', amount: 50, unit: 'eur', at: T0 * 1000 }) as never, T0);
    const paid = entry(treasurer.sk, buildPayout({ claimId: c1.id, party: 'bob', amount: 50, unit: 'eur' }) as never, T0 + 1);
    const c2 = entry(bob.sk, buildClaim({ party: 'bob', amount: 10, unit: 'eur', at: T0 * 1000 }) as never, T0 + 2);
    // Rights are cumulative: settled money is still drawn, so c2 is over. The
    // caller passes the remaining right when it wants a per-epoch ceiling.
    expect(foldClaims({ entries: [c1, paid, c2], actors: actors(), partyOf, rights }).claims[1].status).toBe('over');
    expect(foldClaims({ entries: [c1, paid, c2], actors: actors(), partyOf, rights: () => 60 }).claims[1].status).toBe('approved');
  });
});

describe('buildFundUsage with the claims log', () => {
  const usageParties = [{ id: 'ada', name: 'Ada' }, { id: 'bob', name: 'Bob' }];
  const NOW = T0 * 1000 + 10_000;

  it('takes claimed from the log, moves the expenses-inferred claims to a footnote, and counts payouts as spent', () => {
    const claim = entry(ada.sk, buildClaim({ party: 'ada', amount: 30, unit: 'eur', at: T0 * 1000 }) as never, T0);
    const bobClaim = entry(bob.sk, buildClaim({ party: 'bob', amount: 10, unit: 'eur', at: T0 * 1000 }) as never, T0 + 1);
    const paid = entry(treasurer.sk, buildPayout({ claimId: bobClaim.id, party: 'bob', amount: 10, unit: 'eur' }) as never, T0 + 2);
    const claims = foldClaims({ entries: [claim, bobClaim, paid], actors: actors(), partyOf, rights });
    const expenses = [{
      id: 'e1', created: new Date(NOW - 86400_000).toISOString(), amount: 12, currency: 'eur',
      paidBy: 'ada', splitWith: ['-100'], description: 'fronted', participants: [],
    }] as never[];
    const usage = buildFundUsage({ holonId: '-100', unit: 'eur', parties: usageParties, expenses, claims, now: NOW });
    expect(usage.claimsSource).toBe('bootstrap');
    expect(usage.parties.ada.eur).toEqual({ spent: 0, claimed: 30 });
    expect(usage.legacyClaimed.ada.eur).toBe(12);
    expect(usage.parties.bob.eur).toEqual({ spent: 10, claimed: 0 });
    expect(usage.lifetime.bob.eur).toEqual({ spent: 10, claimed: 0 });

    const without = buildFundUsage({ holonId: '-100', unit: 'eur', parties: usageParties, expenses, now: NOW });
    expect(without.claimsSource).toBe('expenses');
    expect(without.parties.ada.eur).toEqual({ spent: 0, claimed: 12 });

    const allocation = allocate({ total: 200, unit: 'eur', config: { interiorPercent: 100, steepness: 50, nzones: 1 }, members: [{ id: 'ada', name: 'Ada', percentage: 50 }, { id: 'bob', name: 'Bob', percentage: 50 }], zoned: [] });
    const account = fundAccount(allocation, usage, 'ada')!;
    expect(account.claimed).toBe(30);
    expect(account.available).toBe(70);
  });
});

describe('foldClaimsFromLenses', () => {
  it('folds with the signer set and party map the lenses give, provisional until founded', () => {
    const c = entry(ada.sk, buildClaim({ party: '7', amount: 5, unit: 'eur', at: T0 * 1000 }) as never, T0);
    const ctx = foldClaimsFromLenses({
      holonId: '-100',
      entries: [c],
      settings: { holonPubkey: holon.pk, admin: '7' },
      users: [{ id: 7, linkedKeys: [ada.pk] }],
    });
    expect(ctx.actors.source).toBe('bootstrap');
    expect(ctx.parties.partyOf(ada.pk)).toBe('7');
    expect(ctx.folded.claims[0].status).toBe('approved');
    expect(ctx.actors.roleAt(ada.pk, T0)).toBe('admin');
    expect(ctx.policy.quorum).toBe(0);
    // Nobody vouches for the key → rejected, and the statement says why.
    const nobody = foldClaimsFromLenses({ holonId: '-100', entries: [c], settings: { holonPubkey: holon.pk } });
    expect(nobody.folded.claims[0]).toMatchObject({ status: 'rejected', reason: 'unaccepted-signer' });
  });
});

describe('foldClaims with partner imports', () => {
  const partnerKey = testKey();
  const pam = testKey();
  const partnerLog = () => [
    membershipOp({ sk: partnerKey.sk, op: 'genesis', created_at: T0 - 100, holon: 'P' }),
    membershipOp({ sk: partnerKey.sk, op: 'add', pubkey: pam.pk, role: 'member', created_at: T0 - 90, holon: 'P' }),
  ];
  const pEntry = (sk: Uint8Array, a: { item: unknown; refs?: Record<string, string | string[]> }, at: number) =>
    signedEntry({ sk, item: a.item as Record<string, unknown>, refs: a.refs as never, created_at: at, holon: 'P', lens: 'flow_claims' });
  const imported = (entries: LogEvent<unknown>[]) =>
    importPartnerLog({ holon: 'P', genesis: partnerKey.pk, entries, membersLog: partnerLog() }, 'flow_claims');

  it("folds a partner's accepted claims as the partner party, within the partner's right, under our attesters", () => {
    const own = entry(ada.sk, buildClaim({ party: 'ada', amount: 10, unit: 'eur', at: T0 * 1000 }) as never, T0);
    const theirs = pEntry(pam.sk, buildClaim({ party: 'P', amount: 30, unit: 'eur', at: T0 * 1000 }), T0 + 1);
    const tooMuch = pEntry(pam.sk, buildClaim({ party: 'P', amount: 30, unit: 'eur', at: T0 * 1000 }), T0 + 2);
    const forAda = pEntry(pam.sk, buildClaim({ party: 'ada', amount: 1, unit: 'eur', at: T0 * 1000 }), T0 + 3);
    const theirPayout = pEntry(partnerKey.sk, buildPayout({ claimId: theirs.id, party: 'P', amount: 30, unit: 'eur' }) as never, T0 + 4);
    const f = foldClaims({
      entries: [own],
      actors: actors(),
      partyOf,
      rights: { ...rights, P: { EUR: 50 } },
      imports: [imported([theirs, tooMuch, forAda, theirPayout])],
    });
    expect(f.imports).toEqual([{ holon: 'P', source: 'log', accepted: 4, pending: 0, rejected: 0 }]);
    expect(f.claims.map((c) => [c.party, c.status, c.reason ?? null, c.origin ?? null])).toEqual([
      ['ada', 'approved', null, null],
      ['P', 'approved', null, 'P'],
      ['P', 'over', null, 'P'],
      ['ada', 'rejected', 'party-mismatch', 'P'],
    ]);
    // A partner key is a member here, never an attester: its payout does not settle anything.
    expect(f.payouts).toEqual([]);
    expect(f.claims[1].status).toBe('approved');
    expect(claimTotalsOf(f, 'P', 'EUR')).toEqual({ claimed: 30, settled: 0, pending: 0, over: 30 });
    // Our attester pays the partner's claim out.
    const paid = entry(treasurer.sk, buildPayout({ claimId: theirs.id, party: 'P', amount: 30, unit: 'eur' }) as never, T0 + 5);
    const g = foldClaims({ entries: [own, paid], actors: actors(), partyOf, rights: { ...rights, P: { EUR: 50 } }, imports: [imported([theirs])] });
    expect(g.claims.find((c) => c.id === theirs.id)?.status).toBe('settled');
  });

  it('under quorum, only our attesters approve an imported claim', () => {
    const theirs = pEntry(pam.sk, buildClaim({ party: 'P', amount: 5, unit: 'eur', at: T0 * 1000 }), T0);
    const partnerWord = pEntry(partnerKey.sk, buildClaimVerdict(theirs.id, 'attest'), T0 + 1);
    const base = { entries: [] as LogEvent<unknown>[], actors: actors(), partyOf, policy: { quorum: 1 } };
    const held = foldClaims({ ...base, imports: [imported([theirs, partnerWord])] });
    expect(held.claims[0]).toMatchObject({ status: 'pending', reason: 'quorum', origin: 'P' });
    const ours = entry(treasurer.sk, buildClaimVerdict(theirs.id, 'attest') as never, T0 + 2);
    const ok = foldClaims({ ...base, entries: [ours], imports: [imported([theirs, partnerWord])] });
    expect(ok.claims[0].status).toBe('approved');
  });

  it('foldClaimsFromLenses passes imports through', () => {
    const theirs = pEntry(pam.sk, buildClaim({ party: 'P', amount: 5, unit: 'eur', at: T0 * 1000 }), T0);
    const ctx = foldClaimsFromLenses({
      holonId: 'H',
      entries: [],
      settings: { holonPubkey: holon.pk },
      imports: [imported([theirs])],
    });
    expect(ctx.folded.claims.map((c) => [c.party, c.status, c.origin])).toEqual([['P', 'approved', 'P']]);
  });
});
