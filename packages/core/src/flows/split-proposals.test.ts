// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bootstrapActors } from '../protocol/membership.js';
import { shuffled, signedEntry, testKey } from '../protocol/testing.js';
import {
  buildSplitMark,
  buildSplitProposal,
  buildSplitVerdict,
  foldSplitProposals,
  splitQuorum,
  splitSaveHash,
  storedSplit,
} from './split-proposals.js';

const T0 = 1_760_000_000;
const a = testKey();
const b = testKey();
const c = testKey();
const member = testKey();

const SPLIT = { config: { interiorPercent: 40, steepness: 50, nzones: 2, resourced: 0 }, zones: { p1: 1, p2: 2 }, people: {} };
const BASE = splitSaveHash(storedSplit({ config: { interiorPercent: 50, steepness: 50, nzones: 2 }, zones: { p1: 1 } }));

const actors = (admins: string[]) => bootstrapActors({ members: [member.pk], admins, genesis: admins[0] });
const entry = <T extends Record<string, unknown>>(sk: Uint8Array, x: { item: T; refs?: Record<string, string | string[]> }, at: number) =>
  signedEntry<T>({ sk, item: x.item, refs: x.refs as never, created_at: at, lens: 'flow_split_proposals' });
const propose = (sk: Uint8Array, at = T0) => entry(sk, buildSplitProposal({ split: SPLIT, base: BASE, note: 'more to ring 1' }) as never, at);
const say = (sk: Uint8Array, id: string, v: 'attest' | 'dispute', at: number, reason?: string) => entry(sk, buildSplitVerdict(id, v, reason) as never, at);
const fold = (entries: unknown[], admins: string[]) =>
  foldSplitProposals({ entries: shuffled(entries as never[]), actors: actors(admins), admins: admins.length });

describe('splitQuorum', () => {
  it('is more than half the admins, at least one', () => {
    expect([0, 1, 2, 3, 4, 5].map(splitQuorum)).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe('splitSaveHash', () => {
  it('is the same for the same split, whatever order its keys came in, and differs when anything moves', () => {
    const one = storedSplit({ config: { nzones: 2, steepness: 50 }, zones: { a: 1, b: 2 } });
    const two = storedSplit({ config: { steepness: 50, nzones: 2 }, zones: { b: 2, a: 1 } });
    expect(splitSaveHash(one)).toBe(splitSaveHash(two));
    expect(splitSaveHash(one)).not.toBe(splitSaveHash(storedSplit({ config: { nzones: 2, steepness: 50 }, zones: { a: 2, b: 2 } })));
  });
});

describe('foldSplitProposals', () => {
  it('with one admin, what it proposes has passed', () => {
    const p = propose(a.sk);
    const f = fold([p], [a.pk]);
    expect(f.proposals[0]).toMatchObject({ status: 'passed', yes: [a.pk], needed: 1, note: 'more to ring 1' });
    expect(f.open).toHaveLength(1);
  });

  it('with three admins it waits for a second yes, then passes', () => {
    const p = propose(a.sk);
    expect(fold([p], [a.pk, b.pk, c.pk]).proposals[0]).toMatchObject({ status: 'pending', needed: 2 });
    expect(fold([p, say(b.sk, p.id, 'attest', T0 + 5)], [a.pk, b.pk, c.pk]).proposals[0].status).toBe('passed');
  });

  it('is rejected once too many said no, and keeps their reasons', () => {
    const p = propose(a.sk);
    const f = fold([p, say(b.sk, p.id, 'dispute', T0 + 5, 'ring 2 is too thin'), say(c.sk, p.id, 'dispute', T0 + 6)], [a.pk, b.pk, c.pk]);
    expect(f.proposals[0]).toMatchObject({ status: 'rejected', no: expect.arrayContaining([b.pk, c.pk]) });
    expect(f.proposals[0].reasons[b.pk]).toBe('ring 2 is too thin');
    expect(f.open).toHaveLength(0);
  });

  it("counts each admin's latest word once, and nobody else's", () => {
    const p = propose(a.sk);
    const f = fold(
      [p, say(b.sk, p.id, 'dispute', T0 + 5), say(b.sk, p.id, 'attest', T0 + 9), say(member.sk, p.id, 'attest', T0 + 6)],
      [a.pk, b.pk, c.pk],
    );
    expect(f.proposals[0].yes.sort()).toEqual([a.pk, b.pk].sort());
    expect(f.proposals[0].no).toEqual([]);
    expect(f.proposals[0].status).toBe('passed');
  });

  it('ignores a proposal by a key that is not an admin', () => {
    expect(fold([propose(member.sk)], [a.pk]).proposals).toEqual([]);
  });

  it('the proposer withdraws it; an admin marks it applied', () => {
    const p = propose(a.sk);
    const q = propose(a.sk, T0 + 1);
    const f = fold([p, q, entry(a.sk, buildSplitMark(p.id, 'withdraw') as never, T0 + 2), entry(a.sk, buildSplitMark(q.id, 'applied') as never, T0 + 3)], [a.pk]);
    const by = Object.fromEntries(f.proposals.map((x) => [x.id, x]));
    expect(by[p.id].status).toBe('withdrawn');
    expect(by[q.id]).toMatchObject({ status: 'applied', appliedAt: T0 + 3 });
    expect(f.open).toEqual([]);
  });

  it('refuses a proposal without a split or a base', () => {
    expect(() => buildSplitProposal({ split: SPLIT, base: '' })).toThrow();
    expect(() => buildSplitProposal({ split: null as never, base: BASE })).toThrow();
  });
});
