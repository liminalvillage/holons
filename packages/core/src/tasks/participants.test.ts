import { describe, expect, it } from 'vitest';
import {
  toggleAppreciationExclusive,
  toggleParticipationExclusive,
} from './participants.js';
import type { Quest } from './types.js';

function quest(over: Partial<Quest> = {}): Quest {
  return {
    title: 'Plant the garden',
    status: 'ongoing',
    participants: [],
    appreciation: [],
    ...over,
  } as Quest;
}

const ID = (q: Quest, field: 'participants' | 'appreciation'): string[] =>
  (q[field] ?? []).map((u: { id: unknown }) => String(u.id));

describe('participation / appreciation mutual exclusion', () => {
  it('joining clears the member’s appreciation', () => {
    const start = quest({ appreciation: [{ id: 7, username: 'sam' }] });
    const out = toggleParticipationExclusive(start, { id: 7, username: 'sam' });
    expect(ID(out, 'participants')).toEqual(['7']);
    expect(ID(out, 'appreciation')).toEqual([]);
  });

  it('appreciating removes the member from participants', () => {
    const start = quest({ participants: [{ id: 7, username: 'sam' }] });
    const out = toggleAppreciationExclusive(start, { id: 7, username: 'sam' });
    expect(ID(out, 'appreciation')).toEqual(['7']);
    expect(ID(out, 'participants')).toEqual([]);
  });

  it('a member can never be in both lists', () => {
    let q = quest();
    q = toggleParticipationExclusive(q, { id: 1 }); // join
    q = toggleAppreciationExclusive(q, { id: 1 }); // switch to appreciate
    expect(ID(q, 'participants')).toEqual([]);
    expect(ID(q, 'appreciation')).toEqual(['1']);
    q = toggleParticipationExclusive(q, { id: 1 }); // switch back to doer
    expect(ID(q, 'participants')).toEqual(['1']);
    expect(ID(q, 'appreciation')).toEqual([]);
  });

  it('toggling the same action twice removes the member', () => {
    let q = toggleParticipationExclusive(quest(), { id: 1 });
    q = toggleParticipationExclusive(q, { id: 1 });
    expect(ID(q, 'participants')).toEqual([]);
  });
});
