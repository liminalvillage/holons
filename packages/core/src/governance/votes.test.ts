// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { importPartnerLog } from '../protocol/federation.js';
import { bootstrapActors } from '../protocol/membership.js';
import { membershipOp, shuffled, signedEntry, testKey } from '../protocol/testing.js';
import type { LogEvent } from '../protocol/types.js';
import { tallyBallots, tallyProposal } from './tally.js';
import { ballotsFor, buildVote, buildVoteVerdict, foldVotes, foldVotesFromLenses, voteOf } from './votes.js';

const T0 = 1_760_000_000;
const holon = testKey();
const ada = testKey();
const adaPhone = testKey();
const bob = testKey();
const admin = testKey();
const stranger = testKey();

const parties = new Map<string, string>([[ada.pk, 'ada'], [adaPhone.pk, 'ada'], [bob.pk, 'bob'], [admin.pk, 'adm']]);
const partyOf = (pk: string) => parties.get(pk) ?? null;
const actors = () => bootstrapActors({ members: [ada.pk, adaPhone.pk, bob.pk], admins: [admin.pk, holon.pk], genesis: holon.pk });

const entry = (sk: Uint8Array, a: { item: unknown; refs?: Record<string, string | string[]> }, at: number, holonId = 'H') =>
  signedEntry({ sk, item: a.item as Record<string, unknown>, refs: a.refs as never, created_at: at, holon: holonId, lens: 'governance_votes' });

describe('foldVotes', () => {
  it('counts one vote per party per proposal — the newest — whatever the arrival order', () => {
    const v1 = entry(ada.sk, buildVote({ proposal: 'p1', choice: 'yes', party: 'ada' }), T0);
    const v2 = entry(adaPhone.sk, buildVote({ proposal: 'p1', choice: 'no', party: 'ada', memo: 'changed my mind' }), T0 + 5);
    const v3 = entry(bob.sk, buildVote({ proposal: 'p1', choice: 'abstain', party: 'bob' }), T0 + 1);
    const v4 = entry(bob.sk, buildVote({ proposal: 'p2', choice: 'yes', party: 'bob' }), T0 + 2);
    const f = foldVotes({ entries: shuffled([v1, v2, v3, v4]), actors: actors(), partyOf });
    expect(f.votes.map((v) => [v.party, v.proposal, v.choice, v.status])).toEqual([
      ['ada', 'p1', 'yes', 'superseded'],
      ['bob', 'p1', 'abstain', 'counted'],
      ['bob', 'p2', 'yes', 'counted'],
      ['ada', 'p1', 'no', 'counted'],
    ]);
    expect(f.ballots).toEqual({ p1: { ada: 'no', bob: 'abstain' }, p2: { bob: 'yes' } });
    expect(ballotsFor(f, 'p1')).toEqual({ ada: 'no', bob: 'abstain' });
    expect(voteOf(f, 'p1', 'ada')).toBe('no');
    expect(voteOf(f, 'p3', 'ada')).toBeNull();
    expect(f.votes[3].memo).toBe('changed my mind');
    expect(f.accepted).toHaveLength(4);
    expect(f.source).toBe('bootstrap');
  });

  it('rejects a vote for someone else, from a key nobody claims, a bad choice, or after the close; the holon key may act on behalf', () => {
    const forBob = entry(ada.sk, buildVote({ proposal: 'p1', choice: 'yes', party: 'bob' }), T0);
    const nobody = entry(stranger.sk, buildVote({ proposal: 'p1', choice: 'yes', party: 'ada' }), T0 + 1);
    const junk = entry(bob.sk, { item: { t: 'action', kind: 'vote', proposal: 'p1', choice: 'maybe', party: 'bob' } }, T0 + 2);
    const late = entry(bob.sk, buildVote({ proposal: 'p1', choice: 'yes', party: 'bob' }), T0 + 100);
    const viaBot = entry(holon.sk, buildVote({ proposal: 'p1', choice: 'no', party: 'bob', onBehalfOf: 'bob' }), T0 + 3);
    const botMismatch = entry(holon.sk, buildVote({ proposal: 'p1', choice: 'no', party: 'bob', onBehalfOf: 'ada' }), T0 + 4);
    const f = foldVotes({
      entries: [forBob, nobody, junk, late, viaBot, botMismatch],
      actors: actors(),
      partyOf,
      holonPubkey: holon.pk,
      closesAt: (p) => (p === 'p1' ? T0 + 50 : null),
    });
    expect(f.votes.map((v) => [v.status, v.reason ?? null, v.delegated])).toEqual([
      ['rejected', 'party-mismatch', false],
      ['rejected', 'unaccepted-signer', false],
      ['rejected', 'bad-choice', false],
      ['counted', null, true],
      ['rejected', 'party-mismatch', true],
      ['rejected', 'late', false],
    ]);
    expect(f.ballots).toEqual({ p1: { bob: 'no' } });
    expect(() => buildVote({ proposal: 'p1', choice: 'maybe' as never, party: 'bob' })).toThrow();
  });

  it('a dispute by an attester holds the vote; the earlier vote counts again meanwhile', () => {
    const v1 = entry(ada.sk, buildVote({ proposal: 'p1', choice: 'yes', party: 'ada' }), T0);
    const v2 = entry(ada.sk, buildVote({ proposal: 'p1', choice: 'no', party: 'ada' }), T0 + 1);
    const dispute = entry(admin.sk, buildVoteVerdict(v2.id, 'dispute', 'coerced'), T0 + 2);
    const memberWord = entry(bob.sk, buildVoteVerdict(v1.id, 'dispute'), T0 + 3); // a member is not an attester
    const f = foldVotes({ entries: [v1, v2, dispute, memberWord], actors: actors(), partyOf });
    expect(f.votes.map((v) => [v.choice, v.status])).toEqual([['yes', 'counted'], ['no', 'disputed']]);
    expect(f.ballots).toEqual({ p1: { ada: 'yes' } });
    const withdrawn = entry(admin.sk, buildVoteVerdict(v2.id, 'attest'), T0 + 4);
    expect(foldVotes({ entries: [v1, v2, dispute, withdrawn], actors: actors(), partyOf }).ballots).toEqual({ p1: { ada: 'no' } });
  });

  it('under a quorum a vote is pending until attested', () => {
    const v = entry(ada.sk, buildVote({ proposal: 'p1', choice: 'yes', party: 'ada' }), T0);
    const base = { actors: actors(), partyOf, policy: { quorum: 1 } };
    expect(foldVotes({ entries: [v], ...base }).votes[0]).toMatchObject({ status: 'pending', reason: 'quorum' });
    const ok = entry(admin.sk, buildVoteVerdict(v.id, 'attest'), T0 + 1);
    expect(foldVotes({ entries: [v, ok], ...base }).ballots).toEqual({ p1: { ada: 'yes' } });
  });

  it("folds a partner's accepted votes as the partner party", () => {
    const partnerKey = testKey();
    const pam = testKey();
    const partnerLog = [
      membershipOp({ sk: partnerKey.sk, op: 'genesis', created_at: T0 - 100, holon: 'P' }),
      membershipOp({ sk: partnerKey.sk, op: 'add', pubkey: pam.pk, role: 'member', created_at: T0 - 90, holon: 'P' }),
    ];
    const theirs = entry(pam.sk, buildVote({ proposal: 'p1', choice: 'yes', party: 'P' }), T0, 'P');
    const asAda = entry(pam.sk, buildVote({ proposal: 'p1', choice: 'yes', party: 'ada' }), T0 + 1, 'P');
    const imported = importPartnerLog({ holon: 'P', genesis: partnerKey.pk, entries: [theirs, asAda], membersLog: partnerLog }, 'governance_votes');
    const f = foldVotes({ entries: [], actors: actors(), partyOf, imports: [imported] });
    expect(f.imports).toEqual([{ holon: 'P', source: 'log', accepted: 2, pending: 0, rejected: 0 }]);
    expect(f.votes.map((v) => [v.party, v.status, v.reason ?? null, v.origin])).toEqual([
      ['P', 'counted', null, 'P'],
      ['ada', 'rejected', 'party-mismatch', 'P'],
    ]);
    expect(f.ballots).toEqual({ p1: { P: 'yes' } });
  });

  it('foldVotesFromLenses folds with the signer set and party map the lenses give', () => {
    const v = entry(holon.sk, buildVote({ proposal: 'p1', choice: 'yes', party: 'bob', onBehalfOf: 'bob' }), T0);
    const ctx = foldVotesFromLenses({ holonId: 'H', entries: [v], settings: { holonPubkey: holon.pk } });
    expect(ctx.policy.quorum).toBe(0);
    expect(ctx.folded.ballots).toEqual({ p1: { bob: 'yes' } });
    expect(ctx.folded.votes[0].delegated).toBe(true);
  });
});

describe('tallyBallots', () => {
  const reputation = { alice: { count: 2, average: 5 }, bob: { count: 1, average: 3 } }; // 11, 4
  const members = ['alice', 'bob', 'carol', 'dave']; // 17

  it('weights each choice and passes on a strict majority of every member', () => {
    const t = tallyBallots({ alice: 'yes', bob: 'no', carol: 'abstain' }, members, { reputation });
    expect(t).toMatchObject({ yes: 11, no: 4, abstain: 1, total: 17, direct: 16, delegated: 0, passed: true });
    expect(tallyBallots({ bob: 'yes', carol: 'yes' }, members, { reputation }).passed).toBe(false);
    expect(tallyBallots({}, [], {}).total).toBe(0);
  });

  it("a non-voter's weight follows the delegation chain to the voter's choice", () => {
    const t = tallyBallots({ alice: 'no' }, members, { reputation, delegations: { dave: 'carol', carol: 'alice' } });
    expect(t).toMatchObject({ yes: 0, no: 13, delegated: 2, direct: 11 });
  });

  it('agrees with tallyProposal when every vote is a yes', () => {
    const p = { participants: [{ id: 'alice' }, { id: 'zed' }] };
    const viaBallot = tallyBallots({ alice: 'yes', zed: 'yes' }, members, { reputation });
    const { no: _n, abstain: _a, ...rest } = viaBallot;
    expect(tallyProposal(p, members, { reputation })).toEqual(rest);
    expect(viaBallot.total).toBe(18); // zed voted from outside the list
  });
});
