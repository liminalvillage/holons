// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { normalizeOnboarding, type OnboardingConfig } from './config.js';
import {
  addCard,
  addStep,
  draftIssues,
  moveCard,
  moveStep,
  newOnboardingId,
  removeCard,
  removeStep,
  addProfileField,
  removeProfileField,
  updateCard,
  updateProfileField,
  updateStep,
} from './edit.js';
import { DEFAULT_PROFILE_FIELDS } from './profile.js';
import { previewSteps } from './index.js';

const base: OnboardingConfig = {
  enabled: true,
  steps: [
    { id: 'profile', title: 'Profile', cards: [{ id: 'profile', title: 'Fill in your profile', confirm: 'profile' }] },
    {
      id: 'arrival',
      title: 'Arrival',
      cards: [
        { id: 'dates', title: 'Dates', confirm: 'self' },
        { id: 'video', title: 'Video', confirm: 'self', link: 'https://example.org' },
      ],
    },
  ],
};

describe('editing onboarding steps', () => {
  it('gives a new step a fresh id and one blank card', () => {
    const { config, step } = addStep(base);
    expect(config.steps.at(-1)).toBe(step);
    expect(step.id).toMatch(/^step_[a-z0-9]+$/);
    expect(step.cards).toEqual([{ id: expect.stringMatching(/^card_/), title: '', confirm: 'self' }]);
    expect(newOnboardingId('step', ['step_a'])).not.toBe('step_a');
  });

  it('keeps ids across a rename: people walking a step are not sent back', () => {
    const renamed = updateStep(updateCard(base, 'arrival', 'dates', { title: 'Your arrival dates' }), 'arrival', { title: 'Before you arrive' });
    expect(renamed.steps[1]).toMatchObject({ id: 'arrival', title: 'Before you arrive', cards: [{ id: 'dates', title: 'Your arrival dates' }, { id: 'video' }] });
    expect(normalizeOnboarding(renamed).steps[1].cards[0].id).toBe('dates');
    expect(base.steps[1].title).toBe('Arrival');
  });

  it('adds cards to a step, and changes who ticks them', () => {
    const { config, card } = addCard(base, 'arrival', { title: 'Meet your buddy' });
    const admin = updateCard(config, 'arrival', card!.id, { confirm: 'admin' });
    expect(admin.steps[1].cards.at(-1)).toMatchObject({ title: 'Meet your buddy', confirm: 'admin' });
    expect(addCard(base, 'nope').card).toBeNull();
  });

  it('drops an emptied description or link', () => {
    const c = updateCard(base, 'arrival', 'video', { link: '' }).steps[1].cards[1];
    expect('link' in c).toBe(false);
  });

  it('moves steps and cards, clamped at either end', () => {
    expect(moveStep(base, 'arrival', -1).steps.map((s) => s.id)).toEqual(['arrival', 'profile']);
    expect(moveStep(base, 'profile', -1)).toBe(base);
    expect(moveCard(base, 'arrival', 'dates', 1).steps[1].cards.map((c) => c.id)).toEqual(['video', 'dates']);
    expect(moveCard(base, 'arrival', 'video', 1)).toBe(base);
  });

  it('removes steps and cards', () => {
    expect(removeStep(base, 'profile').steps.map((s) => s.id)).toEqual(['arrival']);
    expect(removeCard(base, 'arrival', 'dates').steps[1].cards.map((c) => c.id)).toEqual(['video']);
  });

  it('a blank card survives editing and is dropped on save, and the draft says so', () => {
    const { config, step } = addStep(base);
    const edited = moveStep(config, step.id, -1);
    expect(edited.steps.find((s) => s.id === step.id)!.cards).toHaveLength(1);
    expect(draftIssues(edited)).toEqual([
      { kind: 'empty-step', step: step.id },
      { kind: 'untitled-card', step: step.id, card: step.cards[0].id },
    ]);
    expect(normalizeOnboarding(edited).steps.map((s) => s.id)).toEqual(['profile', 'arrival']);
    expect(draftIssues(base)).toEqual([]);
  });

  it('previews the steps as a newcomer standing on one of them', () => {
    const { config } = addStep(base);
    const view = previewSteps('-100123', config, 1);
    expect(view.map((s) => [s.id, s.state])).toEqual([
      ['profile', 'done'],
      ['arrival', 'current'],
    ]);
    expect(view[0].cards[0]).toMatchObject({ done: true, questId: 'onboarding--100123-profile-profile' });
    expect(view[1].cards.every((c) => !c.done)).toBe(true);
  });
});

describe('editing what a profile card asks', () => {
  const fieldsOf = (c: OnboardingConfig, step: string, card: string) => c.steps.find((s) => s.id === step)!.cards.find((x) => x.id === card)!.fields;

  it('a card turned into a profile card asks the defaults; turned back, it forgets them', () => {
    const asked = updateCard(base, 'arrival', 'dates', { confirm: 'profile' });
    expect(fieldsOf(asked, 'arrival', 'dates')).toEqual(DEFAULT_PROFILE_FIELDS);
    expect(fieldsOf(updateCard(asked, 'arrival', 'dates', { confirm: 'self' }), 'arrival', 'dates')).toBeUndefined();
  });

  it('adds a known field once, a custom one under a fresh key that is kept, and removes them', () => {
    let c = updateCard(base, 'arrival', 'dates', { confirm: 'profile' });
    c = addProfileField(c, 'arrival', 'dates', 'arrival');
    c = addProfileField(c, 'arrival', 'dates', 'arrival');
    c = addProfileField(c, 'arrival', 'dates');
    const fields = fieldsOf(c, 'arrival', 'dates')!;
    expect(fields.map((f) => f.key).slice(0, 3)).toEqual(['first_name', 'ikigai', 'arrival']);
    const custom = fields[3];
    expect(custom).toMatchObject({ key: expect.stringMatching(/^custom_/), label: '', required: true });
    expect(draftIssues(c)).toContainEqual({ kind: 'unnamed-field', step: 'arrival', card: 'dates', field: custom.key });

    c = updateProfileField(c, 'arrival', 'dates', custom.key, { label: 'Diet', required: false });
    expect(fieldsOf(c, 'arrival', 'dates')![3]).toEqual({ ...custom, label: 'Diet', required: false });
    c = removeProfileField(c, 'arrival', 'dates', 'ikigai');
    expect(fieldsOf(c, 'arrival', 'dates')!.map((f) => f.key)).toEqual(['first_name', 'arrival', custom.key]);
    expect(normalizeOnboarding(c).steps[1].cards[0].fields!.map((f) => f.key)).toEqual(['first_name', 'arrival', custom.key]);
  });

  it('a field op on a card that is not a profile card changes nothing', () => {
    expect(addProfileField(base, 'arrival', 'video', 'arrival')).toEqual(base);
  });
});
