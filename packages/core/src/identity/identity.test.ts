import { describe, expect, it } from 'vitest';
import {
  nameParts,
  realName,
  userName,
  questParticipantNames,
  mergeNameMaps,
  buildNameMap,
} from './index.js';

describe('nameParts', () => {
  it('reconciles snake_case, camelCase, and the bare REA name', () => {
    expect(nameParts({ id: 7, first_name: ' Ada ', last_name: 'Lovelace' })).toEqual({
      id: '7',
      first: 'Ada',
      last: 'Lovelace',
      username: '',
    });
    expect(nameParts({ firstName: 'Grace', lastName: 'Hopper' }).first).toBe('Grace');
    // REA agents carry only `name`; it reads as the username.
    expect(nameParts({ id: '9', name: 'alex' })).toMatchObject({ username: 'alex' });
  });
});

describe('realName', () => {
  it('is the full name, or just what exists, or ""', () => {
    expect(realName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
    expect(realName({ first_name: 'Ada' })).toBe('Ada');
    expect(realName({ last_name: 'Lovelace' })).toBe('Lovelace');
    expect(realName({ username: 'ada', name: 'ada', id: 1 })).toBe('');
  });
});

describe('userName', () => {
  it('prefers the full name', () => {
    expect(userName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
  });
  it('abbreviates the last name when asked (bot style)', () => {
    expect(
      userName({ first_name: 'Ada', last_name: 'Lovelace' }, { lastName: 'initial' }),
    ).toBe('Ada L.');
  });
  it('falls back to username, optionally @-prefixed', () => {
    expect(userName({ username: 'ada' })).toBe('ada');
    expect(userName({ name: 'ada' }, { at: true })).toBe('@ada');
  });
  it('falls back to #id then the unknown string', () => {
    expect(userName({ id: 42 })).toBe('#42');
    expect(userName({ id: 42 }, { idFallback: false })).toBe('Unknown');
    expect(userName(null, { unknown: 'Nobody' })).toBe('Nobody');
    expect(userName({ id: 42 }, { idFallback: false, unknown: 'Unknown User' })).toBe(
      'Unknown User',
    );
  });
});

describe('questParticipantNames', () => {
  it('maps ids to real names from participants and the initiator', () => {
    const quests = [
      {
        participants: [
          { id: 1, first_name: 'Ada', last_name: 'Lovelace' },
          { id: 2, username: 'noname' }, // username-only → excluded
        ],
        initiator: { id: 3, firstName: 'Grace', lastName: 'Hopper' },
      },
    ];
    const m = questParticipantNames(quests);
    expect(m.get('1')).toBe('Ada Lovelace');
    expect(m.get('3')).toBe('Grace Hopper');
    expect(m.has('2')).toBe(false);
  });
  it('keeps the first real name seen for an id', () => {
    const m = questParticipantNames([
      { participants: [{ id: 1, first_name: 'Ada', last_name: 'L' }] },
      { participants: [{ id: 1, first_name: 'Ada', last_name: 'Lovelace' }] },
    ]);
    expect(m.get('1')).toBe('Ada L');
  });
});

describe('mergeNameMaps', () => {
  it('lets later maps win and ignores empty values', () => {
    const a = new Map([['1', 'alex'], ['2', 'bob']]);
    const b = new Map([['1', 'Ada Lovelace'], ['3', '']]);
    const m = mergeNameMaps(a, b);
    expect(m.get('1')).toBe('Ada Lovelace'); // b wins
    expect(m.get('2')).toBe('bob');
    expect(m.has('3')).toBe(false); // empty ignored
  });
});

describe('buildNameMap', () => {
  it('layers reaUsers < quests < profiles', () => {
    const m = buildNameMap({
      reaUsers: [
        { id: 1, name: 'alex' },
        { id: 2, name: 'bob' },
        { id: 4, name: 'dora' },
      ],
      quests: [{ participants: [{ id: 2, first_name: 'Bob', last_name: 'Stone' }] }],
      profiles: [{ id: 1, first_name: 'Alex', last_name: 'Rivera' }],
    });
    expect(m.get('1')).toBe('Alex Rivera'); // profile beats REA username
    expect(m.get('2')).toBe('Bob Stone'); // quest beats REA username
    expect(m.get('4')).toBe('dora'); // REA-only
  });
  it('formats profile fallbacks via opts; REA names stay verbatim', () => {
    const m = buildNameMap(
      { reaUsers: [{ id: 1, name: 'alex' }], profiles: [{ id: 2, username: 'bob' }] },
      { at: true },
    );
    expect(m.get('1')).toBe('alex'); // REA verbatim, no '@'
    expect(m.get('2')).toBe('@bob'); // profile formatted with opts
  });
});
