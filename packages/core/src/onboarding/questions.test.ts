// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A holon's own questions: one choice among options, or any of them, and
// which answers are sealed.

import { describe, expect, it } from 'vitest';
import {
  draftIssues,
  fieldAccepts,
  fieldAnswered,
  fieldText,
  fieldValue,
  isSealedField,
  missingProfileFields,
  normalizeOnboarding,
  normalizeProfileFields,
  normalizeProfileOptions,
  optionFor,
  optionLabels,
  profileComplete,
  type ProfileField,
} from './index.js';

const visit: ProfileField = {
  key: 'visit',
  label: 'Would you like to visit?',
  type: 'choice',
  required: true,
  options: [
    { value: 'visit', label: 'Yes, in person' },
    { value: 'unsure', label: 'Not sure yet' },
    { value: 'remote', label: 'Remotely only' },
  ],
};
const tasks: ProfileField = {
  key: 'tasks',
  label: 'How would you help?',
  type: 'multi',
  required: true,
  options: [
    { value: 'kitchen', label: 'Anchoring the kitchen', hint: 'Menu planning' },
    { value: 'cooking', label: 'Cooking' },
    { value: 'gardening', label: 'Gardening' },
  ],
};

describe('choice and multi fields', () => {
  it('normalize: options made safe and unique, a choice without options asks for text', () => {
    expect(normalizeProfileOptions([{ value: 'Hub Founder', label: 'Hub Founder' }, 'Café', { label: 'Hub founder' }, { value: '', label: '' }, 7])).toEqual([
      { value: 'hub_founder', label: 'Hub Founder' },
      { value: 'cafe', label: 'Café' },
      { value: '7', label: '7' },
    ]);
    const [a, b, c] = normalizeProfileFields([
      { key: 'visit', label: 'Visit?', type: 'choice', options: visit.options },
      { key: 'empty', label: 'Empty', type: 'multi', options: [] },
      { key: 'first_name', label: 'Name', type: 'text', sealed: true },
    ]);
    expect(a).toEqual({ key: 'visit', label: 'Visit?', type: 'choice', required: true, options: visit.options });
    expect(b).toEqual({ key: 'empty', label: 'Empty', type: 'text', required: true });
    expect(c).toEqual({ key: 'first_name', label: 'Name', type: 'text', required: true, sealed: true });
    // A config round-trips through normalizing unchanged.
    const config = normalizeOnboarding({ enabled: true, steps: [{ id: 's', title: 'S', cards: [{ id: 'q', title: 'Q', confirm: 'profile', fields: [visit, tasks] }] }] });
    expect(normalizeOnboarding(config)).toEqual(config);
    expect(config.steps[0].cards[0].fields).toEqual([visit, tasks]);
  });

  it('a holon question is sealed unless it says not; a catalog field is not unless it says so', () => {
    expect(isSealedField({ key: 'visit' })).toBe(true);
    expect(isSealedField({ key: 'visit', sealed: false })).toBe(false);
    expect(isSealedField({ key: 'ikigai' })).toBe(false);
    expect(isSealedField({ key: 'ikigai', sealed: true })).toBe(true);
    // Normalizing keeps `sealed` only where it differs from the default.
    expect(normalizeProfileFields([{ key: 'visit', label: 'V', sealed: true }])[0]).not.toHaveProperty('sealed');
    expect(normalizeProfileFields([{ key: 'visit', label: 'V', sealed: false }])[0].sealed).toBe(false);
  });

  it('a choice takes exactly one option, by value or by label', () => {
    expect(fieldAccepts(visit, 'remote')).toBe(true);
    expect(fieldAccepts(visit, 'not sure YET')).toBe(true);
    expect(fieldAccepts(visit, 'maybe')).toBe(false);
    expect(fieldAccepts(visit, '')).toBe(false);
    expect(fieldAccepts(visit, ['remote', 'visit'])).toBe(false);
    expect(fieldValue(visit, 'Not sure yet')).toBe('unsure');
    expect(fieldValue(visit, 'nonsense')).toBe('');
    expect(optionFor(visit, 'Remotely only')?.value).toBe('remote');
    expect(optionLabels(visit, 'unsure')).toEqual(['Not sure yet']);
  });

  it('a multi takes any options, typed or picked, kept in the field order', () => {
    expect(fieldAccepts(tasks, 'gardening, Cooking')).toBe(true);
    expect(fieldAccepts(tasks, ['kitchen'])).toBe(true);
    expect(fieldAccepts(tasks, 'gardening, juggling')).toBe(false);
    expect(fieldAccepts(tasks, ' , ')).toBe(false);
    expect(fieldValue(tasks, 'gardening, Anchoring the kitchen, juggling')).toEqual(['kitchen', 'gardening']);
    expect(fieldValue(tasks, ['cooking', 'cooking'])).toEqual(['cooking']);
    expect(fieldText(tasks, ['kitchen', 'gardening'])).toBe('kitchen, gardening');
    expect(fieldValue(tasks, fieldText(tasks, ['kitchen', 'gardening']))).toEqual(['kitchen', 'gardening']);
    expect(optionLabels(tasks, ['gardening', 'kitchen', 'gone'])).toEqual(['Anchoring the kitchen', 'Gardening']);
  });

  it('a card is complete only with answers its options hold', () => {
    expect(fieldAnswered(visit, 'remote')).toBe(true);
    expect(fieldAnswered(visit, 'gone')).toBe(false);
    expect(fieldAnswered(visit, ['remote'])).toBe(false);
    expect(fieldAnswered(tasks, ['gone', 'cooking'])).toBe(true);
    expect(fieldAnswered(tasks, ['gone'])).toBe(false);
    expect(missingProfileFields({ id: 'x', visit: 'remote', tasks: [] }, [visit, tasks]).map((f) => f.key)).toEqual(['tasks']);
    expect(profileComplete({ id: 'x', visit: 'remote', tasks: ['cooking'] }, [visit, tasks])).toBe(true);
  });

  it('the editor points at a choice with no options', () => {
    const config = { enabled: true, steps: [{ id: 's', title: 'S', cards: [{ id: 'c', title: 'C', confirm: 'profile' as const, fields: [{ ...visit, options: [] }] }] }] };
    expect(draftIssues(config)).toEqual([{ kind: 'no-options', step: 's', card: 'c', field: 'visit' }]);
  });
});
