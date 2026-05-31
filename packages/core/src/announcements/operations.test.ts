// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import {
  createAnnouncement,
  emptyTracking,
  federationKey,
  recordFederatedMessage,
  selectFederationTargets,
  targetAcceptsLens,
} from './operations.js';

describe('announcements/operations', () => {
  it('createAnnouncement stamps created and stringifies chat', () => {
    const a = createAnnouncement({ id: 5, content: 'hi', chat: 123 as unknown as string });
    expect(a.id).toBe(5);
    expect(a.content).toBe('hi');
    expect(a.chat).toBe('123');
    expect(typeof a.created).toBe('string');
  });

  it('federationKey is stable', () => {
    expect(federationKey('A', 9)).toBe('A_9_fedannouncements');
  });

  it('selectFederationTargets drops the source holon', () => {
    const fed = { outbound: ['A', 'B', 'C'] };
    expect(selectFederationTargets(fed, 'B')).toEqual(['A', 'C']);
    expect(selectFederationTargets(null, 'B')).toEqual([]);
  });

  it('targetAcceptsLens honours the receiver inbound allowlist', () => {
    const target = { lensConfig: { A: { inbound: ['announcements', 'quests'] } } };
    expect(targetAcceptsLens(target, 'A')).toBe(true);
    expect(targetAcceptsLens(target, 'A', 'quests')).toBe(true);
    expect(targetAcceptsLens(target, 'A', 'expenses')).toBe(false);
    expect(targetAcceptsLens(target, 'B')).toBe(false);
    expect(targetAcceptsLens(null, 'A')).toBe(false);
  });

  it('recordFederatedMessage upserts by holon', () => {
    let t = emptyTracking('A', 1);
    t = recordFederatedMessage(t, { holonId: 'B', ref: 10 });
    t = recordFederatedMessage(t, { holonId: 'C', ref: 11 });
    expect(t.messages).toHaveLength(2);
    t = recordFederatedMessage(t, { holonId: 'B', ref: 99 });
    expect(t.messages).toHaveLength(2);
    expect(t.messages.find(m => m.holonId === 'B')?.ref).toBe(99);
  });
});
