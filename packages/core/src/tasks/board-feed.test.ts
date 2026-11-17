// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { BoardQuest, QuestState } from './board.js';
import { STALE_AFTER_MS, rankQuests, sortFollowed } from './board-feed.js';

const NOW = 1_760_000_000_000;
const S = NOW / 1000;

const quest = (id: string, over: Partial<BoardQuest> = {}): BoardQuest => ({
  id,
  type: 'quest',
  title: id,
  status: 'ongoing',
  proposer: 'ana',
  initiator: { id: 'ana' },
  pubkey: 'pk',
  created: '',
  createdAt: S - 3600,
  until: NOW + 86_400_000,
  ends: '',
  needs: [],
  pledges: [],
  participants: [],
  curious: [],
  coverage: 0,
  state: 'open' as QuestState,
  lastActivity: S - 3600,
  names: {},
  ...over,
});

describe('rankQuests', () => {
  it('deals what is closest to tipping first', () => {
    const order = rankQuests([quest('far', { coverage: 0.1 }), quest('close', { coverage: 0.9, participants: [{ id: 'ben' }] }), quest('mid', { coverage: 0.5 })], { now: NOW });
    expect(order.map((q) => q.id)).toEqual(['close', 'mid', 'far']);
  });

  it('drops closed, lapsed, expired and already-decided quests', () => {
    const order = rankQuests(
      [quest('a'), quest('done', { state: 'done' }), quest('lapsed', { state: 'lapsed' }), quest('expired', { until: NOW - 1 }), quest('seen')],
      { now: NOW, decided: new Set(['seen']) },
    );
    expect(order.map((q) => q.id)).toEqual(['a']);
  });

  it('sinks a quest nobody has moved for a week', () => {
    const old = S - STALE_AFTER_MS / 1000 - 10;
    const order = rankQuests([quest('stale', { createdAt: old, lastActivity: old }), quest('fresh-empty')], { now: NOW });
    expect(order.map((q) => q.id)).toEqual(['fresh-empty', 'stale']);
  });

  it('lifts quests from people the viewer would work with again, lowers ones they would not', () => {
    const order = rankQuests([quest('stranger', { coverage: 0.2 }), quest('friend', { proposer: 'zoe' }), quest('avoid', { proposer: 'max', coverage: 0.3 })], {
      now: NOW,
      liked: new Set(['zoe']),
      avoided: new Set(['max']),
    });
    expect(order.map((q) => q.id)).toEqual(['friend', 'stranger', 'avoid']);
  });
});

describe('sortFollowed', () => {
  it('puts assembled first, then open, then the finished', () => {
    const order = sortFollowed([quest('l', { state: 'lapsed' }), quest('o', { state: 'open' }), quest('a', { state: 'assembled' }), quest('d', { state: 'done' })]);
    expect(order.map((q) => q.id)).toEqual(['a', 'o', 'd', 'l']);
  });
});
