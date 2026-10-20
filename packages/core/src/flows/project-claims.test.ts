// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bootstrapActors } from '../protocol/membership.js';
import { shuffled, signedEntry, testKey } from '../protocol/testing.js';
import { lunationAt } from './lunation.js';
import {
  PROJECT_CLAIM_NOTE_MAX,
  buildProjectClaim,
  buildProjectClaimVerdict,
  buildProjectClaimWithdrawal,
  cleanEvidence,
  foldProjectClaims,
} from './project-claims.js';

const T0 = 1_760_000_000;
const master = testKey();
const member = testKey();
const ada = testKey(); // speaks for person "ada"
const bo = testKey();

const actors = () => bootstrapActors({ members: [member.pk], admins: [master.pk], genesis: master.pk });
const actsFor = (pk: string, party: string) => pk === ada.pk && party === 'ada';
const entry = <T extends Record<string, unknown>>(sk: Uint8Array, a: { item: T; refs?: Record<string, string | string[]> }, at: number) =>
  signedEntry<T>({ sk, item: a.item, refs: a.refs as never, created_at: at, lens: 'flow_project_claims' });
const fold = (entries: unknown[]) => foldProjectClaims({ entries: shuffled(entries as never[]), actors: actors(), actsFor });
const ask = (sk: Uint8Array, party: string, project: string, at: number, extra: Record<string, string> = {}) =>
  entry(sk, buildProjectClaim({ project, party, at: at * 1000, ...extra }) as never, at);

describe('buildProjectClaim', () => {
  it('names the project and the claimant, stamps the cycle, clips the note', () => {
    const c = buildProjectClaim({ project: ' holon_alder ', party: 'ada', name: 'Ada', role: 'founder', evidence: 'https://alder.example/team', note: 'x'.repeat(900), at: T0 * 1000 });
    expect(c.item).toMatchObject({ t: 'action', kind: 'request', project: 'holon_alder', party: 'ada', name: 'Ada', role: 'founder', evidence: 'https://alder.example/team', epoch: lunationAt(T0 * 1000).index });
    expect(c.item.note).toHaveLength(PROJECT_CLAIM_NOTE_MAX);
  });

  it('refuses a claim without a project or claimant, a project claiming itself, and evidence that is not a web link', () => {
    expect(() => buildProjectClaim({ project: ' ', party: 'ada' })).toThrow();
    expect(() => buildProjectClaim({ project: 'holon_alder', party: '' })).toThrow();
    expect(() => buildProjectClaim({ project: 'holon_alder', party: 'holon_alder' })).toThrow();
    expect(() => buildProjectClaim({ project: 'holon_alder', party: 'ada', evidence: 'javascript:alert(1)' })).toThrow(/web link/);
    expect(cleanEvidence('call me +39 333')).toBeUndefined();
  });
});

describe('foldProjectClaims', () => {
  it('anyone may ask: the request is pending and says whether its signer speaks for the claimant', () => {
    const mine = ask(ada.sk, 'ada', 'holon_alder', T0, { evidence: 'https://alder.example' });
    const forged = ask(bo.sk, 'ada', 'holon_birch', T0 + 1);
    const f = fold([mine, forged]);
    expect(f.pending.map((c) => [c.project, c.party, c.pubkey, c.verified])).toEqual([
      ['holon_birch', 'ada', bo.pk, false],
      ['holon_alder', 'ada', ada.pk, true],
    ]);
    expect(f.approved).toEqual({});
  });

  it('only a master key decides; the latest word stands, and a decline keeps its reason', () => {
    const req = ask(ada.sk, 'ada', 'holon_alder', T0);
    const byMember = entry(member.sk, buildProjectClaimVerdict(req.id, 'attest') as never, T0 + 1);
    expect(fold([req, byMember]).pending).toHaveLength(1);

    const no = entry(master.sk, buildProjectClaimVerdict(req.id, 'dispute', 'no link to the project') as never, T0 + 2);
    expect(fold([req, no]).claims[0]).toMatchObject({ status: 'declined', reason: 'no link to the project', decidedBy: master.pk });

    const yes = entry(master.sk, buildProjectClaimVerdict(req.id, 'attest') as never, T0 + 3);
    const f = fold([req, no, yes]);
    expect(f.claims[0]).toMatchObject({ status: 'approved', decidedAt: T0 + 3 });
    expect(f.claims[0].reason).toBeUndefined();
    expect(f.approved.holon_alder?.id).toBe(req.id);
  });

  it('a claimant\'s latest request per project counts: asking again reopens it', () => {
    const first = ask(ada.sk, 'ada', 'holon_alder', T0);
    const no = entry(master.sk, buildProjectClaimVerdict(first.id, 'dispute', 'show us') as never, T0 + 1);
    const again = ask(ada.sk, 'ada', 'holon_alder', T0 + 2, { evidence: 'https://alder.example/about' });
    const other = ask(ada.sk, 'ada', 'holon_birch', T0 + 3);
    const f = fold([first, no, again, other]);
    expect(f.claims.map((c) => [c.id, c.status])).toEqual([
      [other.id, 'pending'],
      [again.id, 'pending'],
    ]);
  });

  it('the claimant takes it back; a later verdict does not reopen it, and a stranger cannot withdraw it', () => {
    const req = ask(bo.sk, 'bo', 'holon_alder', T0);
    const stranger = entry(ada.sk, buildProjectClaimWithdrawal({ claimId: req.id, party: 'bo' }) as never, T0 + 1);
    expect(fold([req, stranger]).claims[0].status).toBe('pending');

    const back = entry(bo.sk, buildProjectClaimWithdrawal({ claimId: req.id, party: 'bo' }) as never, T0 + 2);
    const late = entry(master.sk, buildProjectClaimVerdict(req.id, 'attest') as never, T0 + 3);
    const f = fold([req, back, late]);
    expect(f.claims[0]).toMatchObject({ status: 'withdrawn', decidedAt: T0 + 2 });
    expect(f.approved).toEqual({});
  });

  it('with no authority nobody decides, and an empty log is empty', () => {
    const req = ask(ada.sk, 'ada', 'holon_alder', T0);
    const yes = entry(master.sk, buildProjectClaimVerdict(req.id, 'attest') as never, T0 + 1);
    expect(foldProjectClaims({ entries: [req, yes], actors: null }).claims[0]).toMatchObject({ status: 'pending', verified: false });
    expect(foldProjectClaims({ entries: [], actors: actors() })).toEqual({ claims: [], pending: [], approved: {} });
  });
});
