// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bootstrapActors } from '../protocol/membership.js';
import { attestation } from '../protocol/events.js';
import { shuffled, signedEntry, testKey } from '../protocol/testing.js';
import { lunationAt } from './lunation.js';
import { buildMint, foldMints, foldMintsFromLenses, isMint, mintedTotal, mintedUnits } from './mints.js';

const T0 = 1_760_000_000;
const holon = testKey();
const ada = testKey(); // a member
const treasurer = testKey(); // an admin
const steward = testKey(); // another admin
const stranger = testKey();

const actors = () => bootstrapActors({ members: [ada.pk], admins: [treasurer.pk, steward.pk, holon.pk], genesis: holon.pk });

const entry = <T extends Record<string, unknown>>(sk: Uint8Array, a: { item: T; refs?: Record<string, string | string[]> }, at: number) =>
  signedEntry<T>({ sk, item: a.item, refs: a.refs as never, created_at: at, lens: 'flow_mints' });

describe('buildMint', () => {
  it('rounds, uppercases the unit and stamps the lunar epoch', () => {
    const m = buildMint({ amount: 120.456, unit: ' l ', memo: 'first pressing', source: '-100', at: T0 * 1000 });
    expect(isMint(m.item)).toBe(true);
    expect(m.item).toMatchObject({ kind: 'mint', amount: 120.46, unit: 'L', memo: 'first pressing', source: '-100', epoch: lunationAt(T0 * 1000).index });
  });
});

describe('foldMints', () => {
  it('issues an attester\'s mints per unit, in any arrival order; a member\'s is rejected', () => {
    const oil1 = entry(treasurer.sk, buildMint({ amount: 120, unit: 'l', at: T0 * 1000 }) as never, T0);
    const oil2 = entry(steward.sk, buildMint({ amount: 80, unit: 'L', memo: 'casa selva lot', at: T0 * 1000 }) as never, T0 + 1);
    const eur = entry(treasurer.sk, buildMint({ amount: 300, unit: 'eur', at: T0 * 1000 }) as never, T0 + 2);
    const byMember = entry(ada.sk, buildMint({ amount: 999, unit: 'l', at: T0 * 1000 }) as never, T0 + 3);
    const byNobody = entry(stranger.sk, buildMint({ amount: 5, unit: 'l', at: T0 * 1000 }) as never, T0 + 4);
    const f = foldMints({ entries: shuffled([oil1, oil2, eur, byMember, byNobody]), actors: actors() });
    expect(f.mints.map((m) => [m.amount, m.unit, m.status, m.reason ?? null])).toEqual([
      [120, 'L', 'issued', null],
      [80, 'L', 'issued', null],
      [300, 'EUR', 'issued', null],
      [999, 'L', 'rejected', 'not-attester'],
      [5, 'L', 'rejected', 'unaccepted-signer'],
    ]);
    expect(f.byUnit).toEqual({ L: 200, EUR: 300 });
    expect(mintedTotal(f, 'l')).toBe(200);
    expect(mintedTotal(f, 'usd')).toBe(0);
    expect(mintedUnits(f)).toEqual(['EUR', 'L']);
    expect(f.mints[1].memo).toBe('casa selva lot');
    expect(f.source).toBe('bootstrap');
  });

  it('refuses a bad amount or a missing unit', () => {
    const zero = entry(treasurer.sk, { item: { t: 'action', kind: 'mint', amount: 0, unit: 'L', epoch: 1 } }, T0);
    const noUnit = entry(treasurer.sk, { item: { t: 'action', kind: 'mint', amount: 10, unit: '', epoch: 1 } }, T0 + 1);
    const other = entry(treasurer.sk, { item: { t: 'action', kind: 'claim', amount: 10, unit: 'L', epoch: 1, party: 'x' } }, T0 + 2);
    const f = foldMints({ entries: [zero, noUnit, other], actors: actors() });
    expect(f.mints.map((m) => [m.status, m.reason])).toEqual([['rejected', 'bad-amount'], ['rejected', 'no-unit']]);
    expect(f.byUnit).toEqual({});
  });

  it('a dispute voids a mint without rewriting it; quorum holds one until a second attester agrees', () => {
    const lot = entry(treasurer.sk, buildMint({ amount: 100, unit: 'l', at: T0 * 1000 }) as never, T0);
    const no = entry(steward.sk, attestation(lot.id, 'dispute', 'that was 10, not 100') as never, T0 + 1);
    const disputed = foldMints({ entries: [lot, no], actors: actors() });
    expect(disputed.mints[0]).toMatchObject({ status: 'disputed', disputes: 1 });
    expect(disputed.byUnit).toEqual({});
    expect(disputed.pendingByUnit).toEqual({ L: 100 });

    const strict = { actors: actors(), policy: { quorum: 2 } };
    expect(foldMints({ entries: [lot], ...strict }).mints[0]).toMatchObject({ status: 'pending', reason: 'quorum' });
    const yes = entry(steward.sk, attestation(lot.id, 'attest') as never, T0 + 2);
    const agreed = foldMints({ entries: [lot, yes], ...strict });
    expect(agreed.mints[0]).toMatchObject({ status: 'issued', attests: 2 });
    expect(agreed.byUnit).toEqual({ L: 100 });
    expect(agreed.epochs).toEqual([lunationAt(T0 * 1000).index]);
  });

  it('folds from lenses with the holon key as the bootstrap admin', () => {
    const lot = entry(holon.sk, buildMint({ amount: 40, unit: 'L', at: T0 * 1000 }) as never, T0);
    const ctx = foldMintsFromLenses({
      holonId: 'h1',
      entries: [lot],
      settings: { holonPubkey: holon.pk },
      users: [],
    });
    expect(ctx.folded.byUnit).toEqual({ L: 40 });
    expect(ctx.policy.attesters).toContain('admin');
  });
});
