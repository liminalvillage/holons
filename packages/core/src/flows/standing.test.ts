// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { attestation } from '../protocol/events.js';
import { bootstrapActors } from '../protocol/membership.js';
import { defaultPolicyFor } from '../protocol/policy.js';
import { shuffled, signedEntry, testKey } from '../protocol/testing.js';
import { lunationAt } from './lunation.js';
import {
  FLOW_EXITS_LENS,
  FLOW_NEEDS_LENS,
  buildExit,
  buildNeeds,
  buildStandingVerdict,
  foldExits,
  foldNeeds,
  foldStandingFromLenses,
  isExit,
  isNeeds,
} from './standing.js';

const T0 = 1_760_000_000;
const holon = testKey();
const ada = testKey(); // a member
const bo = testKey(); // another member
const steward = testKey(); // an admin
const stranger = testKey();

const actors = () => bootstrapActors({ members: [ada.pk, bo.pk], admins: [steward.pk, holon.pk], genesis: holon.pk });
const partyOf = (pk: string) => ({ [ada.pk]: 'ada', [bo.pk]: 'bo', [steward.pk]: 'steward', [holon.pk]: 'holon' })[pk] ?? null;

const entry = <T extends Record<string, unknown>>(sk: Uint8Array, a: { item: T; refs?: Record<string, string | string[]> }, at: number, lens = FLOW_EXITS_LENS) =>
  signedEntry<T>({ sk, item: a.item, refs: a.refs as never, created_at: at, lens });

describe('builders', () => {
  it('stamp the party and the lunar epoch', () => {
    const x = buildExit({ party: ' ada ', memo: 'moving on', at: T0 * 1000 });
    expect(isExit(x.item)).toBe(true);
    expect(x.item).toMatchObject({ kind: 'exit', party: 'ada', memo: 'moving on', epoch: lunationAt(T0 * 1000).index });
    const n = buildNeeds({ party: 'bo', on: true, at: T0 * 1000, onBehalfOf: 'bo' });
    expect(isNeeds(n.item)).toBe(true);
    expect(n.item).toMatchObject({ kind: 'needs', party: 'bo', on: true, onBehalfOf: 'bo' });
    expect(() => buildExit({ party: '' })).toThrow(/names the party/);
    expect(buildStandingVerdict('abc', 'dispute', 'not yours').refs).toEqual({ disputes: ['abc'] });
  });
});

describe('foldExits', () => {
  it('a party\'s own exit counts with no attestation; a second one, a stranger\'s and someone else\'s do not', () => {
    const mine = entry(ada.sk, buildExit({ party: 'ada', at: T0 * 1000 }) as never, T0);
    const again = entry(ada.sk, buildExit({ party: 'ada', at: T0 * 1000 }) as never, T0 + 5);
    const forBo = entry(ada.sk, buildExit({ party: 'bo', at: T0 * 1000 }) as never, T0 + 1);
    const nobody = entry(stranger.sk, buildExit({ party: 'ada', at: T0 * 1000 }) as never, T0 + 2);
    const f = foldExits({ entries: shuffled([mine, again, forBo, nobody]), actors: actors(), partyOf, policy: defaultPolicyFor(FLOW_EXITS_LENS) });
    expect(f.entries.map((e) => [e.party, e.status, e.reason ?? null])).toEqual([
      ['ada', 'accepted', null],
      ['bo', 'rejected', 'party-mismatch'],
      ['ada', 'rejected', 'unaccepted-signer'],
      ['ada', 'rejected', 'already-exited'],
    ]);
    expect(f.exited).toEqual({ ada: { id: mine.id, epoch: lunationAt(T0 * 1000).index, createdAt: T0 } });
    expect(f.accepted.map((e) => e.id)).toEqual([mine.id]);
  });

  it('the holon key may exit for a party; an admin may not, and a dispute holds it', () => {
    const delegated = entry(holon.sk, buildExit({ party: 'bo', onBehalfOf: 'bo', at: T0 * 1000 }) as never, T0);
    const byAdmin = entry(steward.sk, buildExit({ party: 'ada', onBehalfOf: 'ada', at: T0 * 1000 }) as never, T0 + 1);
    const f = foldExits({ entries: [delegated, byAdmin], actors: actors(), partyOf, holonPubkey: holon.pk });
    expect(f.entries.map((e) => [e.party, e.status, e.delegated, e.reason ?? null])).toEqual([
      ['bo', 'accepted', true, null],
      ['ada', 'rejected', false, 'party-mismatch'],
    ]);

    const no = entry(steward.sk, attestation(delegated.id, 'dispute', 'bo did not say that') as never, T0 + 2);
    const held = foldExits({ entries: [delegated, no, byAdmin], actors: actors(), partyOf, holonPubkey: holon.pk });
    expect(held.entries[0]).toMatchObject({ status: 'disputed', disputes: 1 });
    expect(held.exited).toEqual({});
  });
});

describe('foldNeeds', () => {
  it('a member\'s flag waits for an attester; the latest accepted word wins; off clears it', () => {
    const on = entry(ada.sk, buildNeeds({ party: 'ada', on: true, at: T0 * 1000 }) as never, T0, FLOW_NEEDS_LENS);
    const policy = defaultPolicyFor(FLOW_NEEDS_LENS);
    expect(policy.quorum).toBe(1);
    const pending = foldNeeds({ entries: [on], actors: actors(), partyOf, policy });
    expect(pending.entries[0]).toMatchObject({ status: 'pending', reason: 'quorum', on: true });
    expect(pending.inNeed).toEqual({});

    const yes = entry(steward.sk, attestation(on.id, 'attest') as never, T0 + 1, FLOW_NEEDS_LENS);
    const flagged = foldNeeds({ entries: [on, yes], actors: actors(), partyOf, policy });
    expect(flagged.inNeed).toEqual({ ada: { id: on.id, epoch: lunationAt(T0 * 1000).index, createdAt: T0 } });

    const off = entry(ada.sk, buildNeeds({ party: 'ada', on: false, at: T0 * 1000 }) as never, T0 + 2, FLOW_NEEDS_LENS);
    const offYes = entry(steward.sk, attestation(off.id, 'attest') as never, T0 + 3, FLOW_NEEDS_LENS);
    const cleared = foldNeeds({ entries: shuffled([on, yes, off, offYes]), actors: actors(), partyOf, policy });
    expect(cleared.inNeed).toEqual({});
    expect(cleared.entries.map((e) => [e.on, e.status])).toEqual([[true, 'accepted'], [false, 'accepted']]);

    const bad = entry(ada.sk, { item: { t: 'action', kind: 'needs', party: 'ada', on: 'yes', epoch: 1 } }, T0 + 4, FLOW_NEEDS_LENS);
    expect(foldNeeds({ entries: [bad], actors: actors(), partyOf, policy }).entries[0]).toMatchObject({ status: 'rejected', reason: 'bad-flag' });
  });

  it('an attester\'s own flag self-attests', () => {
    const on = entry(steward.sk, buildNeeds({ party: 'steward', on: true, at: T0 * 1000 }) as never, T0, FLOW_NEEDS_LENS);
    const f = foldNeeds({ entries: [on], actors: actors(), partyOf, policy: defaultPolicyFor(FLOW_NEEDS_LENS) });
    expect(f.inNeed.steward).toBeDefined();
  });
});

describe('foldStandingFromLenses', () => {
  it('folds both logs with the holon key as the bootstrap admin and the lens defaults', () => {
    const exit = entry(ada.sk, buildExit({ party: 'ada', at: T0 * 1000 }) as never, T0);
    const needs = entry(bo.sk, buildNeeds({ party: 'bo', on: true, at: T0 * 1000 }) as never, T0, FLOW_NEEDS_LENS);
    const yes = entry(holon.sk, attestation(needs.id, 'attest') as never, T0 + 1, FLOW_NEEDS_LENS);
    const ctx = foldStandingFromLenses({
      holonId: 'h1',
      exits: [exit],
      needs: [needs, yes],
      settings: { holonPubkey: holon.pk },
      extraKeyToParty: [
        [ada.pk, 'ada'],
        [bo.pk, 'bo'],
      ],
      holonPubkey: holon.pk,
    });
    expect(ctx.policy.exits.quorum).toBe(0);
    expect(ctx.policy.needs.quorum).toBe(1);
    expect(Object.keys(ctx.standing.exited)).toEqual(['ada']);
    expect(Object.keys(ctx.standing.inNeed)).toEqual(['bo']);
    expect(ctx.exits.source).toBe('bootstrap');
  });
});
