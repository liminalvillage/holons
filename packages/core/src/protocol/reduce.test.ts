// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { action, attestation } from './events.js';
import { bootstrapActors } from './membership.js';
import { collapse } from './reduce.js';
import { shuffled, signedEntry, testKey } from './testing.js';
import type { AcceptedActors, LogEvent } from './types.js';

const T0 = 1_760_000_000;
const alice = testKey();
const bob = testKey();
const clara = testKey();
const mallory = testKey();

type Body = { t: 'action'; kind: string; amount?: number; party?: string; [k: string]: unknown };

const sum = { initial: 0, fold: (s: number, e: LogEvent<Body>) => s + Number(e.item.amount ?? 0) };

function entry(k: { sk: Uint8Array }, amount: number, at: number, refs?: { prev?: string; basis?: string[] }) {
  const a = action('contribute', { amount }, refs);
  return signedEntry<Body>({ sk: k.sk, item: a.item as Body, refs: a.refs, created_at: at });
}
function attest(k: { sk: Uint8Array }, target: string, verdict: 'attest' | 'dispute', at: number) {
  const a = attestation(target, verdict);
  return signedEntry({ sk: k.sk, item: a.item as unknown as Body, refs: a.refs, created_at: at });
}

const actors = (): AcceptedActors => bootstrapActors({ members: [alice.pk, bob.pk], admins: [clara.pk] });

describe('collapse', () => {
  it('folds only accepted signers, and is independent of arrival order', () => {
    const entries = [entry(alice, 5, T0), entry(bob, 3, T0 + 1), entry(mallory, 100000, T0 + 2), entry(alice, -4, T0 + 3)];
    const a = collapse<Body, number>({ entries, actors: actors(), ...sum });
    const b = collapse<Body, number>({ entries: shuffled(entries), actors: actors(), ...sum });
    expect(a.state).toBe(4);
    expect(b.state).toBe(4);
    expect(a.accepted.map((e) => e.id)).toEqual(b.accepted.map((e) => e.id));
    expect(a.rejected.map((j) => j.reason)).toEqual(['unaccepted-signer']);
    expect(a.source).toBe('bootstrap');
  });

  it('accepts as of the entry time: a key removed later keeps what it signed before', () => {
    const asOf: AcceptedActors = {
      source: 'log',
      genesis: clara.pk,
      isAcceptedAt: (pub, at) => pub === alice.pk ? at < T0 + 10 : pub === clara.pk,
      roleAt: (pub, at) => (pub === clara.pk ? 'admin' : pub === alice.pk && at < T0 + 10 ? 'member' : null),
    };
    const entries = [entry(alice, 1, T0), entry(alice, 1, T0 + 20)];
    const r = collapse<Body, number>({ entries, actors: asOf, ...sum });
    expect(r.state).toBe(1);
    expect(r.rejected[0].entry.id).toBe(entries[1].id);
    expect(r.source).toBe('log');
  });

  it('honours the policy authors roles', () => {
    const entries = [entry(alice, 1, T0), entry(clara, 1, T0 + 1)];
    const r = collapse<Body, number>({ entries, actors: actors(), policy: { authors: ['admin'] }, ...sum });
    expect(r.state).toBe(1);
    expect(r.accepted[0].pubkey).toBe(clara.pk);
    expect(r.rejected[0].reason).toBe('role');
  });

  it('holds an action until the quorum of attesters is met, and a dispute holds it again', () => {
    const e = entry(alice, 10, T0);
    const base = { actors: actors(), policy: { quorum: 1 }, ...sum };
    const held = collapse<Body, number>({ entries: [e], ...base });
    expect(held.state).toBe(0);
    expect(held.pending[0].reason).toBe('quorum');

    const byMember = attest(bob, e.id, 'attest', T0 + 1); // bob is a member, not an attester
    expect(collapse<Body, number>({ entries: [e, byMember], ...base }).state).toBe(0);

    const ok = attest(clara, e.id, 'attest', T0 + 2);
    const accepted = collapse<Body, number>({ entries: [e, byMember, ok], ...base });
    expect(accepted.state).toBe(10);
    expect(accepted.judged.get(e.id)?.attests).toBe(1);

    const disputed = attest(clara, e.id, 'dispute', T0 + 3); // her latest word wins
    const r = collapse<Body, number>({ entries: shuffled([e, byMember, ok, disputed]), ...base });
    expect(r.state).toBe(0);
    expect(r.pending[0].reason).toBe('disputed');
    expect(r.judged.get(e.id)?.disputes).toBe(1);

    const withdrawn = attest(clara, e.id, 'attest', T0 + 4);
    expect(collapse<Body, number>({ entries: [e, ok, disputed, withdrawn], ...base }).state).toBe(10);
  });

  it("an attester's own action carries their attestation", () => {
    const byMember = entry(alice, 1, T0);
    const byAdmin = entry(clara, 2, T0 + 1);
    const r = collapse<Body, number>({ entries: [byMember, byAdmin], actors: actors(), policy: { quorum: 1 }, ...sum });
    expect(r.state).toBe(2);
    expect(r.judged.get(byAdmin.id)).toMatchObject({ status: 'accepted', attests: 1 });
    expect(r.judged.get(byMember.id)).toMatchObject({ status: 'pending', attests: 0 });
    // Under quorum 2 the admin still needs a second word.
    expect(collapse<Body, number>({ entries: [byMember, byAdmin], actors: actors(), policy: { quorum: 2 }, ...sum }).state).toBe(0);
  });

  it('a second consumer of the same basis is a conflict: earliest wins or a human decides', () => {
    const right = entry(alice, 10, T0);
    const spendA = entry(alice, 4, T0 + 1, { basis: [right.id] });
    const spendB = entry(alice, 4, T0 + 2, { basis: [right.id] });
    const earliest = collapse<Body, number>({ entries: shuffled([right, spendA, spendB]), actors: actors(), ...sum });
    expect(earliest.accepted.map((e) => e.id)).toEqual([right.id, spendA.id]);
    expect(earliest.rejected[0]).toMatchObject({ reason: 'double-consume' });

    const quorum = collapse<Body, number>({ entries: [right, spendA, spendB], actors: actors(), policy: { conflict: 'quorum' }, ...sum });
    expect(quorum.pending[0]).toMatchObject({ reason: 'conflict' });

    // Disputing the first spend lets the second one through — same rules, one more event.
    const dispute = attest(clara, spendA.id, 'dispute', T0 + 3);
    const resolved = collapse<Body, number>({ entries: [right, spendA, spendB, dispute], actors: actors(), policy: { conflict: 'quorum' }, ...sum });
    expect(resolved.accepted.map((e) => e.id)).toEqual([right.id, spendB.id]);
  });

  it('a chain must not fork: prev names the author\'s last counted entry', () => {
    const a = entry(alice, 1, T0);
    const b = entry(alice, 1, T0 + 1, { prev: a.id });
    const fork = entry(alice, 1, T0 + 2, { prev: a.id });
    const c = entry(alice, 1, T0 + 3, { prev: b.id });
    const r = collapse<Body, number>({ entries: shuffled([a, b, fork, c]), actors: actors(), ...sum });
    expect(r.accepted.map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(r.rejected[0]).toMatchObject({ entry: { id: fork.id }, reason: 'fork' });
    // A rejected entry does not become the head: the next one still chains from b… no, from c.
    const d = entry(alice, 1, T0 + 4, { prev: fork.id });
    expect(collapse<Body, number>({ entries: [a, b, fork, c, d], actors: actors(), ...sum }).rejected.map((j) => j.entry.id)).toEqual([fork.id, d.id]);
  });

  it('the domain validates over the running state; pending holds, a string rejects', () => {
    const entries = [entry(alice, 6, T0), entry(alice, 6, T0 + 1), entry(bob, -1, T0 + 2)];
    const r = collapse<Body, number>({
      entries,
      actors: actors(),
      ...sum,
      validate: (e, state) => {
        const amount = Number(e.item.amount);
        if (amount < 0) return 'negative';
        if (state + amount > 10) return { status: 'pending', reason: 'over-right' };
        return null;
      },
    });
    expect(r.state).toBe(6);
    expect(r.pending[0]).toMatchObject({ reason: 'held', detail: 'over-right' });
    expect(r.rejected[0]).toMatchObject({ reason: 'invalid', detail: 'negative' });
  });
});
