// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bootstrapActors } from '../protocol/membership.js';
import { shuffled, signedEntry, testKey } from '../protocol/testing.js';
import {
  APPLICATION_NOTE_MAX,
  buildApplication,
  buildApplicationVerdict,
  buildWithdrawal,
  foldApplications,
} from './applications.js';
import { lunationAt } from './lunation.js';

const T0 = 1_760_000_000;
const admin = testKey();
const member = testKey();
const ada = testKey(); // speaks for project "alder"
const mallory = testKey();

const actors = () => bootstrapActors({ members: [member.pk], admins: [admin.pk], genesis: admin.pk });
const actsFor = (pk: string, party: string) => pk === ada.pk && party === 'alder';
const entry = <T extends Record<string, unknown>>(sk: Uint8Array, a: { item: T; refs?: Record<string, string | string[]> }, at: number) =>
  signedEntry<T>({ sk, item: a.item, refs: a.refs as never, created_at: at, lens: 'flow_applications' });
const fold = (entries: unknown[]) => foldApplications({ entries: shuffled(entries as never[]), actors: actors(), actsFor });

describe('buildApplication', () => {
  it('names the party, stamps the cycle and clips the note', () => {
    const a = buildApplication({ party: ' alder ', name: 'Alder', note: 'x'.repeat(900), at: T0 * 1000 });
    expect(a.item).toMatchObject({ t: 'action', kind: 'apply', party: 'alder', name: 'Alder', epoch: lunationAt(T0 * 1000).index });
    expect(a.item.note).toHaveLength(APPLICATION_NOTE_MAX);
    expect(() => buildApplication({ party: ' ' })).toThrow();
  });
});

describe('foldApplications', () => {
  it('an outsider may ask: the ask is pending, and says whether its signer speaks for the party', () => {
    const mine = entry(ada.sk, buildApplication({ party: 'alder', note: 'we plant trees', at: T0 * 1000 }) as never, T0);
    const forged = entry(mallory.sk, buildApplication({ party: 'birch', at: T0 * 1000 }) as never, T0 + 1);
    const f = fold([mine, forged]);
    expect(f.applications.map((a) => [a.party, a.status, a.verified])).toEqual([['birch', 'pending', false], ['alder', 'pending', true]]);
    expect(f.byParty.alder.note).toBe('we plant trees');
    expect(f.pending).toHaveLength(2);
  });

  it('only an admin of the fund decides; a member or the applicant cannot', () => {
    const ask = entry(ada.sk, buildApplication({ party: 'alder', at: T0 * 1000 }) as never, T0);
    const self = entry(ada.sk, buildApplicationVerdict(ask.id, 'attest') as never, T0 + 1);
    const mem = entry(member.sk, buildApplicationVerdict(ask.id, 'attest') as never, T0 + 2);
    expect(fold([ask, self, mem]).byParty.alder.status).toBe('pending');
    const yes = entry(admin.sk, buildApplicationVerdict(ask.id, 'attest') as never, T0 + 3);
    expect(fold([ask, self, mem, yes]).byParty.alder).toMatchObject({ status: 'approved', decidedBy: admin.pk, decidedAt: T0 + 3 });
  });

  it('a decline carries its reason, and the latest admin word stands', () => {
    const ask = entry(ada.sk, buildApplication({ party: 'alder', at: T0 * 1000 }) as never, T0);
    const no = entry(admin.sk, buildApplicationVerdict(ask.id, 'dispute', 'not this round') as never, T0 + 1);
    expect(fold([ask, no]).byParty.alder).toMatchObject({ status: 'declined', reason: 'not this round' });
    const yes = entry(admin.sk, buildApplicationVerdict(ask.id, 'attest') as never, T0 + 2);
    const after = fold([ask, no, yes]).byParty.alder;
    expect(after.status).toBe('approved');
    expect(after).not.toHaveProperty('reason');
  });

  it('asking again after a decline reopens it: only the latest ask counts', () => {
    const first = entry(ada.sk, buildApplication({ party: 'alder', at: T0 * 1000 }) as never, T0);
    const no = entry(admin.sk, buildApplicationVerdict(first.id, 'dispute', 'later') as never, T0 + 1);
    const again = entry(ada.sk, buildApplication({ party: 'alder', note: 'now with a budget', at: T0 * 1000 }) as never, T0 + 2);
    const f = fold([first, no, again]);
    expect(f.applications).toHaveLength(1);
    expect(f.byParty.alder).toMatchObject({ id: again.id, status: 'pending', note: 'now with a budget' });
  });

  it('the applicant takes it back; a stranger cannot, and a withdrawn ask is closed to verdicts', () => {
    const ask = entry(ada.sk, buildApplication({ party: 'alder', at: T0 * 1000 }) as never, T0);
    const theirs = entry(mallory.sk, buildWithdrawal({ applicationId: ask.id, party: 'alder' }) as never, T0 + 1);
    expect(fold([ask, theirs]).byParty.alder.status).toBe('pending');
    const mine = entry(ada.sk, buildWithdrawal({ applicationId: ask.id, party: 'alder' }) as never, T0 + 2);
    const late = entry(admin.sk, buildApplicationVerdict(ask.id, 'attest') as never, T0 + 3);
    const f = fold([ask, theirs, mine, late]);
    expect(f.byParty.alder).toMatchObject({ status: 'withdrawn', decidedAt: T0 + 2 });
    expect(f.pending).toEqual([]);
  });

  it('an unverified asker may still withdraw its own ask', () => {
    const ask = entry(mallory.sk, buildApplication({ party: 'birch', at: T0 * 1000 }) as never, T0);
    const back = entry(mallory.sk, buildWithdrawal({ applicationId: ask.id, party: 'birch' }) as never, T0 + 1);
    expect(fold([ask, back]).byParty.birch.status).toBe('withdrawn');
  });

  it('with no fund authority nobody decides, and an empty log is empty', () => {
    const ask = entry(ada.sk, buildApplication({ party: 'alder', at: T0 * 1000 }) as never, T0);
    const yes = entry(admin.sk, buildApplicationVerdict(ask.id, 'attest') as never, T0 + 1);
    expect(foldApplications({ entries: [ask, yes], actors: null }).byParty.alder).toMatchObject({ status: 'pending', verified: false });
    expect(foldApplications({ entries: [], actors: actors() })).toEqual({ applications: [], byParty: {}, pending: [] });
  });
});
