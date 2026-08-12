// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  DELEGATIONS_LENS,
  DELEGATION_TYPE,
  buildDelegation,
  clearDelegate,
  foldDelegations,
  isDelegation,
  resolveDelegate,
  setDelegate,
} from './delegation.js';

describe('buildDelegation', () => {
  it('builds one revocable record per delegator, keyed by them', () => {
    const res = buildDelegation('alice', 'bob', 1700000000000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record).toEqual({
      id: 'alice',
      type: DELEGATION_TYPE,
      from: 'alice',
      to: 'bob',
      at: new Date(1700000000000).toISOString(),
    });
  });

  it('rejects self-delegation and missing ids', () => {
    expect(buildDelegation('alice', 'alice')).toEqual({ ok: false, reason: 'self' });
    expect(buildDelegation('', 'bob')).toEqual({ ok: false, reason: 'invalid' });
    expect(buildDelegation('alice', '')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('foldDelegations', () => {
  it('folds records into a from→to map, skipping junk and tombstones', () => {
    const alice = buildDelegation('alice', 'bob');
    const carol = buildDelegation('carol', 'bob');
    if (!alice.ok || !carol.ok) throw new Error('fixture');
    const map = foldDelegations([
      alice.record,
      carol.record,
      { ...carol.record, _deleted: true }, // revoked later copy wins nothing
      { id: 'x', type: 'proposal' },
      null,
    ]);
    expect(map).toEqual({ alice: 'bob' });
    expect(isDelegation(alice.record)).toBe(true);
    expect(isDelegation({ id: 'x', type: 'proposal' })).toBe(false);
  });
});

describe('resolveDelegate', () => {
  const votes = new Set(['dave']);

  it('follows a transitive chain to the first voter', () => {
    const delegations = { alice: 'bob', bob: 'carol', carol: 'dave' };
    expect(resolveDelegate('alice', delegations, votes)).toBe('dave');
  });

  it('returns null when the chain ends on a non-voter', () => {
    expect(resolveDelegate('alice', { alice: 'bob' }, votes)).toBeNull();
  });

  it('survives delegation cycles', () => {
    const delegations = { alice: 'bob', bob: 'alice' };
    expect(resolveDelegate('alice', delegations, votes)).toBeNull();
  });
});

describe('setDelegate / clearDelegate', () => {
  it('persists the delegation record on the delegations lens', async () => {
    const db = { put: vi.fn(async () => {}) };
    const res = await setDelegate(db, 'holon-1', 'alice', 'bob');
    expect(res.ok).toBe(true);
    expect(db.put).toHaveBeenCalledWith(
      'holon-1',
      DELEGATIONS_LENS,
      expect.objectContaining({ id: 'alice', from: 'alice', to: 'bob' })
    );
  });

  it('rejects invalid delegations without writing', async () => {
    const db = { put: vi.fn(async () => {}) };
    const res = await setDelegate(db, 'holon-1', 'alice', 'alice');
    expect(res.ok).toBe(false);
    expect(db.put).not.toHaveBeenCalled();
  });

  it('revokes by tombstoning the delegator record', async () => {
    const db = { put: vi.fn(async () => {}) };
    await clearDelegate(db, 'holon-1', 'alice');
    expect(db.put).toHaveBeenCalledWith(
      'holon-1',
      DELEGATIONS_LENS,
      expect.objectContaining({ id: 'alice', _deleted: true })
    );
  });
});
