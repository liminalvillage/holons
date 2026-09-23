// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bootstrapActors } from './membership.js';
import { DEFAULT_POLICY, foldPolicies, normalizePolicy, policyFor, policyRecord } from './policy.js';
import { shuffled, signedEntry, testKey } from './testing.js';

const admin = testKey();
const member = testKey();
const T0 = 1_760_000_000;

describe('policy', () => {
  it('normalizes partial and junk input to a complete rule', () => {
    expect(normalizePolicy()).toEqual(DEFAULT_POLICY);
    expect(normalizePolicy({ quorum: 2.7, conflict: 'quorum', authors: ['admin', 'bogus' as never], attesters: [] }))
      .toEqual({ authors: ['admin'], attesters: ['admin'], quorum: 2, conflict: 'quorum' });
    expect(normalizePolicy({ quorum: -1 }).quorum).toBe(0);
  });

  it('folds the latest admin-signed record per lens; a member cannot set policy', () => {
    const actors = bootstrapActors({ members: [member.pk], admins: [admin.pk] });
    const log = [
      signedEntry({ sk: admin.sk, item: policyRecord('flow_claims', { quorum: 1 }).item as unknown as Record<string, unknown>, created_at: T0 }),
      signedEntry({ sk: admin.sk, item: policyRecord('flow_claims', { quorum: 2 }).item as unknown as Record<string, unknown>, created_at: T0 + 1 }),
      signedEntry({ sk: member.sk, item: policyRecord('flow_claims', { quorum: 9 }).item as unknown as Record<string, unknown>, created_at: T0 + 2 }),
      signedEntry({ sk: admin.sk, item: policyRecord('votes', { conflict: 'quorum' }).item as unknown as Record<string, unknown>, created_at: T0 + 3 }),
    ];
    const policies = foldPolicies(shuffled(log), actors);
    expect(policyFor(policies, 'flow_claims').quorum).toBe(2);
    expect(policyFor(policies, 'votes').conflict).toBe('quorum');
    expect(policyFor(policies, 'unknown')).toEqual(DEFAULT_POLICY);
  });
});
