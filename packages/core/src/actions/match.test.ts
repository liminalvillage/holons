// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fuzzyFindByTitle, matchPerson, namesAnItem, titleMismatch } from './match.js';

const items = [
  { id: 'mr1', title: 'wash the van' },
  { id: 'mr2', title: 'clean the window' },
  { id: 'mr3', title: 'clean the kitchen' },
];

describe('fuzzyFindByTitle', () => {
  it('resolves an invented id via the utterance', () => {
    expect(fuzzyFindByTitle('100 scheduled the wash the van task to 4pm', items)).toEqual({
      id: 'mr1',
      title: 'wash the van',
    });
  });

  it('returns candidates when titles are too close to call', () => {
    const r = fuzzyFindByTitle('clean_task complete the clean task', items);
    expect(r && 'candidates' in r ? r.candidates.length : 0).toBeGreaterThan(1);
  });

  it('prefers the fully covered title among close ones', () => {
    expect(fuzzyFindByTitle('complete the clean the window task', items)).toEqual({
      id: 'mr2',
      title: 'clean the window',
    });
  });

  it('gives up when nothing plausibly matches', () => {
    expect(fuzzyFindByTitle('buy groceries tomorrow', items)).toBeNull();
    expect(namesAnItem('move it to five', items)).toBe(false);
  });

  it('matches split/joined compound words via the squashed form', () => {
    const quests = [
      { id: 'fc', title: 'Futurecasting' },
      { id: 'ek', title: 'clear out external kitchen' },
    ];
    expect(fuzzyFindByTitle('move the future casting to tomorrow', quests)).toEqual({
      id: 'fc',
      title: 'Futurecasting',
    });
  });
});

describe('titleMismatch', () => {
  const quests = [
    { id: 'mr9dq', title: 'Future Casting' },
    { id: 'mqv77', title: 'clear out external kitchen' },
    { id: 'mr9fb', title: 'Artizen Call' },
  ];

  it('flags a valid id whose title contradicts the utterance', () => {
    expect(
      titleMismatch(
        'Move the future casting to tomorrow.',
        { id: 'mqv77', title: 'clear out external kitchen' },
        quests,
      ),
    ).toEqual({ id: 'mr9dq', title: 'Future Casting' });
  });

  it('trusts the chosen id when the utterance names it', () => {
    expect(
      titleMismatch('reschedule the artizen call', { id: 'mr9fb', title: 'Artizen Call' }, quests),
    ).toBeNull();
  });

  it('never triggers on pronoun-only follow-ups', () => {
    expect(
      titleMismatch(
        'move it to 8pm instead',
        { id: 'mqv77', title: 'clear out external kitchen' },
        quests,
      ),
    ).toBeNull();
  });

  it('trusts partial overlap with the chosen title', () => {
    expect(
      titleMismatch(
        'add buy soap to the kitchen task',
        { id: 'mqv77', title: 'clear out external kitchen' },
        quests,
      ),
    ).toBeNull();
  });
});

describe('matchPerson', () => {
  const people = [
    { id: 1, first_name: 'Marco', last_name: 'Rossi', username: 'mrossi' },
    { id: 2, first_name: 'Marco', last_name: 'Bianchi' },
    { id: 3, first_name: 'Roberto', username: 'robertovalenti' },
    { id: 4, username: 'anna_k' },
  ];

  it('picks a person by first name when unique', () => {
    const r = matchPerson('Roberto', people);
    expect(r && 'match' in r ? r.match.id : null).toBe('3');
  });

  it('asks which when a first name is shared, and resolves with the surname', () => {
    const shared = matchPerson('Marco', people);
    expect(shared && 'candidates' in shared ? shared.candidates.map((c) => c.id) : []).toEqual([
      '1',
      '2',
    ]);
    const r = matchPerson('marco bianchi', people);
    expect(r && 'match' in r ? r.match.id : null).toBe('2');
  });

  it('matches a handle with or without @ and a short form of a name', () => {
    expect(matchPerson('@anna_k', people)).toMatchObject({ match: { id: '4' } });
    expect(matchPerson('Rob', people)).toMatchObject({ match: { id: '3' } });
  });

  it('returns null for nobody', () => {
    expect(matchPerson('Zed', people)).toBeNull();
    expect(matchPerson('', people)).toBeNull();
  });
});
