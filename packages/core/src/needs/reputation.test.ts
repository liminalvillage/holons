// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  NEED_RATING_TYPE,
  buildNeedRating,
  foldNeedRatings,
  isNeedRating,
  needRatingId,
  rateNeedHandoff,
  reputationByUser,
  reputationOf,
} from './reputation.js';
import { needPartyOf } from './responses.js';
import type { PublishedNeed } from './types.js';

const REQUESTER = { id: 'req-user' };
const PROVIDER = { id: 'prov-user' };

const fulfilled = (over: Partial<PublishedNeed> = {}): PublishedNeed =>
  ({
    id: 'need-9',
    title: 'flour 5kg',
    type: 'need',
    status: 'fulfilled',
    initiator: { id: 'req-user', username: 'Rita' },
    participants: [],
    responses: [
      {
        id: 'r1',
        responder: { id: 'prov-user', name: 'Piero', holonId: 'prov-holon' },
        createdAt: 'x',
      },
    ],
    claimedResponseId: 'r1',
    ...over,
  }) as PublishedNeed;

describe('needPartyOf', () => {
  it('derives the side from the need itself', () => {
    expect(needPartyOf(fulfilled(), 'req-user')).toBe('requester');
    expect(needPartyOf(fulfilled(), 'prov-user')).toBe('provider');
    expect(needPartyOf(fulfilled(), 'stranger')).toBeNull();
    expect(needPartyOf(fulfilled(), null)).toBeNull();
  });
});

describe('buildNeedRating', () => {
  it('the requester rates the provider (ratee carries the provider holon)', () => {
    const res = buildNeedRating(fulfilled(), REQUESTER, 5, { now: 1700000000000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record).toEqual({
      id: 'need-9~rating~requester',
      type: NEED_RATING_TYPE,
      needId: 'need-9',
      party: 'requester',
      rater: { id: 'req-user', name: 'Rita' },
      ratee: { id: 'prov-user', name: 'Piero', holonId: 'prov-holon' },
      stars: 5,
      at: new Date(1700000000000).toISOString(),
    });
    expect(needRatingId('need-9', 'requester')).toBe('need-9~rating~requester');
  });

  it('the provider rates the requester', () => {
    const res = buildNeedRating(fulfilled(), PROVIDER, 3, { comment: 'clear and kind' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.party).toBe('provider');
    expect(res.record.rater).toEqual({ id: 'prov-user', name: 'Piero', holonId: 'prov-holon' });
    expect(res.record.ratee).toEqual({ id: 'req-user', name: 'Rita' });
    expect(res.record.comment).toBe('clear and kind');
  });

  it('rejects a user who is neither side of the exchange', () => {
    const res = buildNeedRating(fulfilled(), { id: 'stranger' }, 4);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not_a_party');
  });

  it('keys the record by the owner-holon key when given one', () => {
    const res = buildNeedRating(fulfilled(), REQUESTER, 4, { key: 'canonical-key' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.id).toBe('canonical-key~rating~requester');
    expect(res.record.needId).toBe('canonical-key');
  });

  it('rejects stars outside 1..5 or non-integers', () => {
    for (const bad of [0, 6, 2.5, NaN]) {
      const res = buildNeedRating(fulfilled(), REQUESTER, bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe('bad_stars');
    }
  });

  it('rejects needs that are not fulfilled', () => {
    const res = buildNeedRating(fulfilled({ status: 'claimed' }), REQUESTER, 4);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not_fulfilled');
  });

  it('rejects when no claimed response identifies the provider', () => {
    const res = buildNeedRating(fulfilled({ claimedResponseId: undefined }), REQUESTER, 4);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('no_claimed_response');
  });
});

describe('folding and reputation', () => {
  const rec = (needId: string, by: { id: string }, stars: number, at = 1) => {
    const res = buildNeedRating(fulfilled({ id: needId }), by, stars, { now: at, key: needId });
    if (!res.ok) throw new Error('fixture');
    return res.record;
  };

  it('folds rating records out of a mixed lens, ignoring junk', () => {
    const lens = [
      rec('need-9', REQUESTER, 5),
      rec('need-9', PROVIDER, 4),
      rec('other', REQUESTER, 2),
      { id: 'q1', type: 'need', status: 'requested' },
      null,
      { id: 'junk', type: NEED_RATING_TYPE }, // missing needId/party/stars
    ];
    expect(isNeedRating(lens[0])).toBe(true);
    expect(isNeedRating(lens[3])).toBe(false);
    expect(isNeedRating(lens[5])).toBe(false);
    const folded = foldNeedRatings(lens);
    expect(folded['need-9']?.requester?.stars).toBe(5);
    expect(folded['need-9']?.provider?.stars).toBe(4);
    expect(folded['other']?.requester?.stars).toBe(2);
  });

  it('aggregates per ratee and dedupes replicated copies by record id', () => {
    const a = rec('need-1', REQUESTER, 5); // ratee: prov-user
    const b = rec('need-2', REQUESTER, 3); // ratee: prov-user
    const c = rec('need-1', PROVIDER, 4); // ratee: req-user
    const rep = reputationByUser([a, b, c, { ...a }]); // duplicate copy of a
    expect(rep['prov-user']).toEqual({ count: 2, average: 4 });
    expect(rep['req-user']).toEqual({ count: 1, average: 4 });
    expect(reputationOf([a, b, c, { ...a }], 'prov-user')).toEqual({ count: 2, average: 4 });
    expect(reputationOf([], 'prov-user')).toEqual({ count: 0, average: 0 });
  });
});

describe('rateNeedHandoff', () => {
  const db = () => ({ put: vi.fn(async () => {}) });

  it('persists on the owner holon and mirrors to the ratee holon', async () => {
    const store = db();
    const res = await rateNeedHandoff(store, 'owner-h', fulfilled(), REQUESTER, 5, {
      now: 1700000000000,
    });
    expect(res.ok).toBe(true);
    expect(store.put).toHaveBeenCalledWith(
      'owner-h',
      'quests',
      expect.objectContaining({ id: 'need-9~rating~requester', stars: 5 })
    );
    expect(store.put).toHaveBeenCalledWith(
      'prov-holon',
      'quests',
      expect.objectContaining({ id: 'need-9~rating~requester', stars: 5 })
    );
  });

  it('skips the mirror when the ratee lives on the owner holon (or opted out)', async () => {
    const sameHolon = db();
    await rateNeedHandoff(sameHolon, 'prov-holon', fulfilled(), REQUESTER, 4);
    expect(sameHolon.put).toHaveBeenCalledTimes(1);

    const optedOut = db();
    await rateNeedHandoff(optedOut, 'owner-h', fulfilled(), REQUESTER, 4, {
      mirrorToRatee: false,
    });
    expect(optedOut.put).toHaveBeenCalledTimes(1);
  });

  it('collects a mirror failure as an error instead of failing the rating', async () => {
    const store = {
      put: vi.fn(async (holon: string) => {
        if (holon === 'prov-holon') throw new Error('offline');
      }),
    };
    const res = await rateNeedHandoff(store, 'owner-h', fulfilled(), REQUESTER, 5);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]).toContain('mirror');
    }
  });

  it('rejects invalid ratings and persists nothing', async () => {
    const store = db();
    const notDone = await rateNeedHandoff(store, 'owner-h', fulfilled({ status: 'claimed' }), REQUESTER, 5);
    expect(notDone.ok).toBe(false);
    if (!notDone.ok) expect(notDone.reason).toBe('not_fulfilled');
    const stranger = await rateNeedHandoff(store, 'owner-h', fulfilled(), { id: 'stranger' }, 5);
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.reason).toBe('not_a_party');
    expect(store.put).not.toHaveBeenCalled();
  });
});
