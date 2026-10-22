// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { action, attestation } from './events.js';
import { federatedActors, importPartnerLog, pinnedPartners } from './federation.js';
import { bootstrapActors } from './membership.js';
import { policyRecord } from './policy.js';
import { collapse } from './reduce.js';
import { membershipOp, shuffled, signedEntry, testKey } from './testing.js';
import type { LogEvent } from './types.js';

const T0 = 1_760_000_000;
const partnerKey = testKey(); // the partner holon's key (its genesis)
const pam = testKey(); // a partner member
const pat = testKey(); // a partner admin
const outsider = testKey();
const ourAdmin = testKey();
const ourMember = testKey();

type Body = { t: 'action'; kind: string; [k: string]: unknown };
const entry = (sk: Uint8Array, a: { item: unknown; refs?: Record<string, string | string[]> }, at: number) =>
  signedEntry<Body>({ sk, item: a.item as Body, refs: a.refs as never, created_at: at, holon: 'P', lens: 'flow_claims' });

/** The partner's membership log: founded by its key, pam a member, pat an admin. */
const partnerMembers = () => [
  membershipOp({ sk: partnerKey.sk, op: 'genesis', created_at: T0 - 100, holon: 'P' }),
  membershipOp({ sk: partnerKey.sk, op: 'add', pubkey: pam.pk, role: 'member', created_at: T0 - 90, holon: 'P' }),
  membershipOp({ sk: partnerKey.sk, op: 'add', pubkey: pat.pk, role: 'admin', created_at: T0 - 90, holon: 'P' }),
];

describe('importPartnerLog', () => {
  it("judges the partner's log by the partner's own signers and policy, pinned to its genesis", () => {
    const claim = entry(pam.sk, action('claim', { party: 'P', amount: 5 }), T0);
    const stranger = entry(outsider.sk, action('claim', { party: 'P', amount: 5 }), T0 + 1);
    const policy = entry(pat.sk, policyRecord('flow_claims', { quorum: 1 }), T0 - 50);
    const unattested = entry(pam.sk, action('claim', { party: 'P', amount: 7 }), T0 + 2);
    const ok = entry(pat.sk, attestation(claim.id, 'attest'), T0 + 3);
    const imported = importPartnerLog(
      { holon: 'P', genesis: partnerKey.pk, entries: shuffled([claim, stranger, unattested, ok]), membersLog: partnerMembers(), policyEntries: [policy] },
      'flow_claims',
    );
    expect(imported.source).toBe('log');
    expect(imported.policy.quorum).toBe(1);
    expect(imported.accepted.map((e) => e.id)).toEqual([claim.id]);
    expect(imported.pending).toBe(1);
    expect(imported.rejected).toBe(1);
  });

  it('falls back to the pinned key alone when the membership log was not founded by it', () => {
    const forged = testKey();
    const forgedLog = [
      membershipOp({ sk: forged.sk, op: 'genesis', created_at: T0 - 100, holon: 'P' }),
      membershipOp({ sk: forged.sk, op: 'add', pubkey: pam.pk, role: 'member', created_at: T0 - 90, holon: 'P' }),
    ];
    const byMember = entry(pam.sk, action('claim', { party: 'P', amount: 5 }), T0);
    const byKey = entry(partnerKey.sk, action('claim', { party: 'P', amount: 5 }), T0 + 1);
    const imported = importPartnerLog({ holon: 'P', genesis: partnerKey.pk, entries: [byMember, byKey], membersLog: forgedLog }, 'flow_claims');
    expect(imported.source).toBe('bootstrap');
    expect(imported.accepted.map((e) => e.id)).toEqual([byKey.id]);
  });
});

describe('federatedActors', () => {
  const own = () => bootstrapActors({ members: [ourMember.pk], admins: [ourAdmin.pk] });
  const partner = () =>
    importPartnerLog({ holon: 'P', genesis: partnerKey.pk, entries: [], membersLog: partnerMembers() }, 'flow_claims');

  it('accepts partner keys as members acting for the partner; own keys keep their role', () => {
    const fed = federatedActors(own(), [partner()]);
    expect(fed.partners).toEqual(['P']);
    expect(fed.roleAt(ourAdmin.pk, T0)).toBe('admin');
    expect(fed.originOf(ourAdmin.pk, T0)).toBeNull();
    expect(fed.roleAt(pat.pk, T0)).toBe('member'); // a partner admin does not attest here
    expect(fed.originOf(pat.pk, T0)).toBe('P');
    expect(fed.isAcceptedAt(pam.pk, T0)).toBe(true);
    expect(fed.isAcceptedAt(pam.pk, T0 - 95)).toBe(false); // as of time: before the partner added them
    expect(fed.isAcceptedAt(outsider.pk, T0)).toBe(false);
    expect(fed.roleAt(outsider.pk, T0)).toBeNull();
  });

  it("re-judges imported entries under the importer's policy: our attesters, our quorum", () => {
    const imported = partner();
    const claim = entry(pam.sk, action('claim', { party: 'P', amount: 5 }), T0);
    const partnerAttest = entry(pat.sk, attestation(claim.id, 'attest'), T0 + 1);
    const ourAttest = entry(ourAdmin.sk, attestation(claim.id, 'attest'), T0 + 2);
    const fed = federatedActors(own(), [imported]);
    const run = (entries: LogEvent<unknown>[]) =>
      collapse<unknown, number>({ entries, actors: fed, policy: { quorum: 1 }, initial: 0, fold: (n) => n + 1 });
    expect(run([claim, partnerAttest]).pending.map((j) => j.reason)).toEqual(['quorum']);
    expect(run([claim, partnerAttest, ourAttest]).accepted.map((e) => e.id)).toEqual([claim.id]);
  });
});

describe('pinnedPartners', () => {
  it('lists the well-formed pins of a policy', () => {
    expect(pinnedPartners({ partners: { P: partnerKey.pk, Q: 'junk' } })).toEqual([['P', partnerKey.pk]]);
    expect(pinnedPartners(null)).toEqual([]);
  });
});
