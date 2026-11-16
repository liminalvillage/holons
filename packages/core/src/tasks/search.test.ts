// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { hashtagsIn, matchesQuestQuery, questFacetCounts, questFacets } from './search.js';
import type { Quest } from './types.js';

const q = (over: Partial<Quest> = {}): Quest =>
  ({ id: 'q', title: 'T', status: 'ongoing', participants: [], ...over }) as Quest;

describe('hashtagsIn', () => {
  it('finds tags as written, dedupes case- and accent-insensitively, skips numbers and anchors', () => {
    expect(hashtagsIn('Fix the #Garden gate, #garden again, #3 times, #orto-bio')).toEqual(['Garden', 'orto-bio']);
    expect(hashtagsIn('see page.html#anchor and &#39;')).toEqual([]);
    expect(hashtagsIn('#Café and #cafe')).toEqual(['Café']);
    expect(hashtagsIn(null)).toEqual([]);
  });
});

describe('questFacets', () => {
  it('collects category, kind, people and tags', () => {
    const facets = questFacets(
      q({
        type: 'task',
        category: 'Garden',
        title: 'Water the #tomatoes',
        description: 'and the #Herbs',
        initiator: { id: 1, username: 'rob' },
        participants: [{ id: 2, firstName: 'Ana', lastName: 'Ruiz' }, { id: 1, username: '@rob' }],
        tags: ['herbs', 'summer'],
      } as Partial<Quest>),
    );
    expect(facets.map((f) => `${f.kind}:${f.value}:${f.label}`)).toEqual([
      'category:garden:Garden',
      'kind:task:task',
      'person:rob:@rob',
      'person:ana ruiz:Ana Ruiz',
      'tag:herbs:#herbs',
      'tag:summer:#summer',
      'tag:tomatoes:#tomatoes',
    ]);
  });

  it('tolerates a participants list stored as JSON text', () => {
    const facets = questFacets(q({ participants: '[{"id":3,"username":"zoe"}]' } as never));
    expect(facets).toContainEqual({ kind: 'person', value: 'zoe', label: '@zoe' });
  });
});

describe('matchesQuestQuery', () => {
  const quest = q({
    type: 'event',
    title: 'Sauna night #wellbeing',
    location: 'Valle',
    category: 'Community',
    initiator: { id: 1, username: 'rob' },
  } as Partial<Quest>);

  it('matches everything on an empty query', () => {
    expect(matchesQuestQuery(quest, {})).toBe(true);
  });
  it('needs every word, anywhere, accent- and case-blind, @/# optional', () => {
    expect(matchesQuestQuery(quest, { text: 'sauna valle' })).toBe(true);
    expect(matchesQuestQuery(quest, { text: '@rob #WELLBEING' })).toBe(true);
    expect(matchesQuestQuery(quest, { text: 'communitý' })).toBe(true);
    expect(matchesQuestQuery(quest, { text: 'sauna beach' })).toBe(false);
  });
  it('needs every picked facet', () => {
    expect(matchesQuestQuery(quest, { facets: [{ kind: 'tag', value: '#Wellbeing' }] })).toBe(true);
    expect(matchesQuestQuery(quest, { facets: [{ kind: 'person', value: 'rob' }, { kind: 'kind', value: 'event' }] })).toBe(true);
    expect(matchesQuestQuery(quest, { facets: [{ kind: 'category', value: 'garden' }] })).toBe(false);
  });
});

describe('questFacetCounts', () => {
  it('counts each facet once per quest, most common first', () => {
    const counts = questFacetCounts([
      q({ category: 'Garden', title: '#a #a' }),
      q({ category: 'Garden' }),
      q({ category: 'Kitchen', title: '#a' }),
    ]);
    // An untyped quest is a task (core's `questKind`): all three carry it.
    expect(counts.map((c) => [c.label, c.count])).toEqual([
      ['task', 3],
      ['#a', 2],
      ['Garden', 2],
      ['Kitchen', 1],
    ]);
  });
});
