import { describe, expect, it } from 'vitest';
import { rosterDiff, setParticipants, toggleAppreciation, toggleParticipant } from './participants.js';
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
    const out = toggleParticipant(start, { id: 7, username: 'sam' });
    expect(ID(out, 'participants')).toEqual(['7']);
    expect(ID(out, 'appreciation')).toEqual([]);
  });

  it('appreciating removes the member from participants', () => {
    const start = quest({ participants: [{ id: 7, username: 'sam' }] });
    const out = toggleAppreciation(start, { id: 7, username: 'sam' });
    expect(ID(out, 'appreciation')).toEqual(['7']);
    expect(ID(out, 'participants')).toEqual([]);
  });

  it('a member can never be in both lists', () => {
    let q = quest();
    q = toggleParticipant(q, { id: 1 }); // join
    q = toggleAppreciation(q, { id: 1 }); // switch to appreciate
    expect(ID(q, 'participants')).toEqual([]);
    expect(ID(q, 'appreciation')).toEqual(['1']);
    q = toggleParticipant(q, { id: 1 }); // switch back to doer
    expect(ID(q, 'participants')).toEqual(['1']);
    expect(ID(q, 'appreciation')).toEqual([]);
  });

  it('toggling the same action twice removes the member', () => {
    let q = toggleParticipant(quest(), { id: 1 });
    q = toggleParticipant(q, { id: 1 });
    expect(ID(q, 'participants')).toEqual([]);
  });
});

describe('wire-format tolerance (quests straight off the graph)', () => {
  it('joins a quest that has no participants field yet', () => {
    const raw = { id: '42', title: 'fresh quest' } as unknown as Quest;
    const out = toggleParticipant(raw, { id: 7, username: 'sam' });
    expect(ID(out, 'participants')).toEqual(['7']);
    expect(ID(out, 'appreciation')).toEqual([]);
  });

  it('appreciates a quest that has no people fields yet', () => {
    const raw = { id: '42', title: 'fresh quest' } as unknown as Quest;
    const out = toggleAppreciation(raw, { id: 7 });
    expect(ID(out, 'appreciation')).toEqual(['7']);
    expect(ID(out, 'participants')).toEqual([]);
  });

  it('keeps participants that arrive as a JSON string', () => {
    const raw = quest({
      participants: '[{"id":9,"username":"ana"}]' as unknown as Quest['participants'],
    });
    const out = toggleParticipant(raw, { id: 7 });
    expect(ID(out, 'participants')).toEqual(['9', '7']);
  });
});

describe('setParticipants (edit-form roster)', () => {
  it('replaces the roster: absent members are dropped, new ones added', () => {
    const start = quest({ participants: [{ id: 1 }, { id: 2 }] });
    const out = setParticipants(start, [{ id: 2 }, { id: 3, username: 'ada' }]);
    expect(ID(out, 'participants')).toEqual(['2', '3']);
    expect(start.participants).toHaveLength(2); // input untouched
  });

  it('folds duplicate ids and skips entries without an id', () => {
    const out = setParticipants(quest(), [
      { id: 1, username: 'a' },
      { id: '1', username: 'b' },
      { username: 'ghost' } as { id?: never; username: string },
    ]);
    expect(out.participants).toEqual([{ id: 1, username: 'a' }]);
  });

  it('every member placed on the roster leaves the appreciation list', () => {
    const start = quest({ appreciation: [{ id: 7 }, { id: 8 }] });
    const out = setParticipants(start, [{ id: 7 }]);
    expect(ID(out, 'participants')).toEqual(['7']);
    expect(ID(out, 'appreciation')).toEqual(['8']);
  });

  it('tolerates a stringified wire roster', () => {
    const start = quest({ appreciation: '[{"id":5}]' as unknown as never });
    const out = setParticipants(start, [{ id: 5 }]);
    expect(ID(out, 'appreciation')).toEqual([]);
  });
});

describe('rosterDiff', () => {
  it('names who joined and who left, by id', () => {
    const { joined, left } = rosterDiff(
      [{ id: 1 }, { id: 2, username: 'bo' }],
      [{ id: '2' }, { id: 3 }]
    );
    expect(joined.map((p) => String(p.id))).toEqual(['3']);
    expect(left.map((p) => String(p.id))).toEqual(['1']);
  });

  it('treats a missing roster as empty', () => {
    expect(rosterDiff(undefined, [{ id: 1 }]).joined).toHaveLength(1);
    expect(rosterDiff([{ id: 1 }], undefined).left).toHaveLength(1);
  });
});
