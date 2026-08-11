// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  HANDOFF_CONFIRM_TYPE,
  buildHandoffConfirmation,
  confirmNeedHandoff,
  foldHandoffConfirmations,
  handoffConfirmationId,
  isHandoffConfirmation,
  withHandoffConfirmations,
} from './handoff.js';
import { claimNeed, generateHandoffCode, handoffCode } from './responses.js';
import type { PublishedNeed } from './types.js';

const claimed = (over: Partial<PublishedNeed> = {}): PublishedNeed =>
  ({
    id: 'need-9',
    title: 'flour 5kg',
    type: 'need',
    status: 'claimed',
    initiator: { id: 'req-user' },
    participants: [],
    responses: [
      { id: 'r1', responder: { id: 'prov-user', holonId: 'prov-holon' }, createdAt: 'x' },
    ],
    claimedResponseId: 'r1',
    handoff: { code: 'WXYZ' },
    ...over,
  }) as PublishedNeed;

describe('generateHandoffCode', () => {
  it('mints codes of the requested length from the unambiguous alphabet', () => {
    const code = generateHandoffCode({ length: 6 });
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(code).not.toMatch(/[01OIL]/);
  });

  it('is deterministic with an injected random source', () => {
    const rnd = () => 0;
    expect(generateHandoffCode({ random: rnd })).toBe('AAAA');
    expect(generateHandoffCode({ random: rnd, length: 2 })).toBe('AA');
  });

  it('does not derive from any public id (two mints differ)', () => {
    const seen = new Set(Array.from({ length: 16 }, () => generateHandoffCode()));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('claimNeed code minting', () => {
  const offered = (): PublishedNeed =>
    ({
      id: 'need-9',
      title: 'flour',
      type: 'need',
      status: 'offered',
      participants: [],
      responses: [{ id: 'r1', responder: { id: 'p' }, createdAt: 'x' }],
    }) as PublishedNeed;

  it('mints a random code, not the legacy id-derived one', () => {
    const res = claimNeed(offered(), 'r1');
    expect(res.ok).toBe(true);
    expect(res.need.handoff?.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(res.need.handoff?.code).not.toBe(handoffCode('need-9'));
  });

  it('accepts an explicit code and the legacy bare-now third argument', () => {
    const res = claimNeed(offered(), 'r1', { now: 1700000000000, code: 'QQQQ' });
    expect(res.need.handoff?.code).toBe('QQQQ');
    expect(res.need.claimedAt).toBe(new Date(1700000000000).toISOString());
    const legacy = claimNeed(offered(), 'r1', 1700000000000);
    expect(legacy.need.claimedAt).toBe(new Date(1700000000000).toISOString());
  });
});

describe('confirmation records', () => {
  it('builds the stable per-side record', () => {
    const rec = buildHandoffConfirmation('need-9', 'provider', 1700000000000);
    expect(rec).toEqual({
      id: 'need-9~handoff~provider',
      type: HANDOFF_CONFIRM_TYPE,
      needId: 'need-9',
      party: 'provider',
      at: new Date(1700000000000).toISOString(),
    });
    expect(handoffConfirmationId('need-9', 'requester')).toBe('need-9~handoff~requester');
  });

  it('recognizes and folds confirm records out of a mixed lens', () => {
    const lens = [
      buildHandoffConfirmation('need-9', 'requester', 1),
      buildHandoffConfirmation('need-9', 'provider', 2),
      buildHandoffConfirmation('other', 'requester', 3),
      { id: 'q1', type: 'need', status: 'requested' },
      null,
      { id: 'junk', type: 'handoff-confirm' }, // missing needId/party
    ];
    expect(isHandoffConfirmation(lens[0])).toBe(true);
    expect(isHandoffConfirmation(lens[3])).toBe(false);
    expect(isHandoffConfirmation(lens[5])).toBe(false);
    const folded = foldHandoffConfirmations(lens);
    expect(folded['need-9']).toEqual({
      requesterAt: new Date(1).toISOString(),
      providerAt: new Date(2).toISOString(),
    });
    expect(folded['other']).toEqual({ requesterAt: new Date(3).toISOString() });
  });

  it('merges folded confirmations into the need handoff state', () => {
    const folded = foldHandoffConfirmations([
      buildHandoffConfirmation('need-9', 'requester', 5),
    ]);
    const merged = withHandoffConfirmations(claimed(), folded);
    expect(merged.handoff).toEqual({
      code: 'WXYZ',
      requesterAt: new Date(5).toISOString(),
    });
  });

  it('falls back to the legacy id-derived code for pre-entropy records', () => {
    const merged = withHandoffConfirmations(claimed({ handoff: undefined }), {}, { key: 'need-9' });
    expect(merged.handoff?.code).toBe(handoffCode('need-9'));
  });
});

describe('confirmNeedHandoff', () => {
  const db = () => ({ put: vi.fn(async () => {}) });

  it('requester confirms: persists the record on the owner holon', async () => {
    const store = db();
    const res = await confirmNeedHandoff(store, 'owner-h', claimed(), 'requester', {
      now: 1700000000000,
    });
    expect(res.ok).toBe(true);
    expect(res.both).toBe(false);
    expect(store.put).toHaveBeenCalledWith(
      'owner-h',
      'quests',
      expect.objectContaining({ id: 'need-9~handoff~requester', party: 'requester' })
    );
  });

  it('provider must supply the matching code', async () => {
    const store = db();
    const bad = await confirmNeedHandoff(store, 'owner-h', claimed(), 'provider', {
      code: 'NOPE',
    });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('bad_code');
    expect(store.put).not.toHaveBeenCalled();

    const good = await confirmNeedHandoff(store, 'owner-h', claimed(), 'provider', {
      code: 'wxyz', // case-insensitive
    });
    expect(good.ok).toBe(true);
  });

  it('flips both when the other side already confirmed via a folded record', async () => {
    const store = db();
    const confirmations = foldHandoffConfirmations([
      buildHandoffConfirmation('need-9', 'requester', 1),
    ]);
    const res = await confirmNeedHandoff(store, 'owner-h', claimed(), 'provider', {
      code: 'WXYZ',
      confirmations,
    });
    expect(res.ok).toBe(true);
    expect(res.both).toBe(true);
  });

  it('routes by the owner-holon key for records reached through a hologram', async () => {
    const store = db();
    const res = await confirmNeedHandoff(store, 'owner-h', claimed(), 'requester', {
      key: 'canonical-key',
    });
    expect(res.ok).toBe(true);
    expect(store.put).toHaveBeenCalledWith(
      'owner-h',
      'quests',
      expect.objectContaining({ id: 'canonical-key~handoff~requester', needId: 'canonical-key' })
    );
  });

  it('rejects when the need is not claimed and persists nothing', async () => {
    const store = db();
    const res = await confirmNeedHandoff(
      store,
      'owner-h',
      claimed({ status: 'requested', handoff: undefined }),
      'requester'
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not_claimed');
    expect(store.put).not.toHaveBeenCalled();
  });
});
