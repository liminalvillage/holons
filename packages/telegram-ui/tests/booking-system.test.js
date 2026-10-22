// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'url';
import { Context } from 'telegraf';
import BookingSystem, {
  conditionHolds,
  fieldApplies,
  profileFields,
  selectionToData,
} from '../src/BookingSystem.js';
import booking from '../data/booking.json' with { type: 'json' };

const CONFIG = fileURLToPath(new URL('../data/booking.json', import.meta.url));

/** A BookingSystem over the real booking.json, with a bot that only records. */
function system() {
  const bot = {
    stage: { register: vi.fn() },
    command: vi.fn(),
    telegram: { sendMessage: vi.fn() },
  };
  return new BookingSystem(bot, null, CONFIG);
}

/** A context mid-application, standing on `fieldId` with `data` answered. */
function ctxAt(sys, fieldId, data = {}) {
  const bookingSequence = sys.config.sections.map(s => `booking_${s.id}`);
  // A Telegraf Context (scene middleware insists), with no update behind it.
  const ctx = new Context(
    { update_id: 1, message: { from: { id: 42 }, chat: { id: 42 } } },
    {},
    {}
  );
  ctx.session = {
    booking: { data: { ...data } },
    bookingSequence,
    bookingStage: bookingSequence.indexOf(`booking_${fieldId}`),
  };
  ctx.scene = { enter: vi.fn(), leave: vi.fn() };
  return ctx;
}

const entered = ctx => ctx.scene.enter.mock.calls.at(-1)[0];

/** Run a field scene's enter handler and hand back the primitive's state. */
async function openField(sys, fieldId, ctx) {
  await sys.sceneMap.get(fieldId).enterMiddleware()(ctx, async () => {});
  const [, state] = ctx.scene.enter.mock.calls.at(-1);
  return state;
}

describe('booking.json', () => {
  const byKey = Object.fromEntries(
    booking.sections
      .filter(s => s.type !== 'section')
      .map(s => [s.storageKey, s])
  );

  it('asks the web form’s questions, in its order', () => {
    expect(
      booking.sections.filter(s => s.type !== 'section').map(s => s.storageKey)
    ).toEqual([
      'name',
      'email',
      'location',
      'age_range',
      'x',
      'linkedin',
      'website',
      'role',
      'intention',
      'ikigai',
      'public_profile',
      'background',
      'community_experience',
      'wellbeing',
      'referral',
      'visit',
      'arrival',
      'departure',
      'transportation',
      'drivers_license',
      'accommodation',
      'tasks',
      'contribution_preference',
      'capacity',
      'social_links',
    ]);
  });

  it('keeps the travel questions for those who come in person', () => {
    for (const key of [
      'arrival',
      'departure',
      'transportation',
      'drivers_license',
      'accommodation',
    ]) {
      expect(byKey[key].showIf).toEqual({
        field: 'visit',
        in: ['visit', 'unsure'],
      });
    }
    expect(byKey.transportation.required).toBe(false);
    expect(byKey.accommodation.required).toBe(false);
    expect(byKey.visit.options.map(o => o.value)).toEqual([
      'visit',
      'unsure',
      'remote',
    ]);
  });

  it('roles are a multi choice; social links only when no profile was given', () => {
    expect(byKey.role.type).toBe('multi_select');
    expect(byKey.role.options.map(o => o.value)).toEqual([
      'pollinator',
      'facilitator',
      'storyteller',
      'forager',
      'hub_founder',
      'hub_steward',
    ]);
    expect(byKey.social_links).toMatchObject({
      required: true,
      showIf: { allEmpty: ['x', 'linkedin', 'website'] },
    });
  });
});

describe('showIf', () => {
  it('evaluates in / notIn / allEmpty, and lists as all-of', () => {
    expect(
      conditionHolds({ field: 'visit', in: ['visit'] }, { visit: 'visit' })
    ).toBe(true);
    expect(conditionHolds({ field: 'visit', in: ['visit'] }, {})).toBe(false);
    expect(
      conditionHolds({ field: 'role', in: ['other'] }, { role: ['x', 'other'] })
    ).toBe(true);
    expect(
      conditionHolds({ field: 'visit', notIn: ['remote'] }, { visit: 'remote' })
    ).toBe(false);
    expect(conditionHolds({ allEmpty: ['x', 'y'] }, { x: ' ', y: [] })).toBe(
      true
    );
    expect(conditionHolds({ allEmpty: ['x', 'y'] }, { y: '@ada' })).toBe(false);
    expect(
      conditionHolds([{ allEmpty: ['x'] }, { field: 'v', in: ['a'] }], {
        v: 'a',
      })
    ).toBe(true);
    expect(fieldApplies({ id: 'no_condition' }, {})).toBe(true);
  });

  it('a remote applicant skips the travel questions, and nothing of them is kept', () => {
    const sys = system();
    const ctx = ctxAt(sys, 'visit', {
      visit: 'remote',
      arrival: '2026-11-01', // left over from an earlier answer
      transportation: ['car', 'other'],
      transportation_other: 'Horse',
    });
    sys.advanceToNextField(ctx);
    expect(entered(ctx)).toBe('booking_section_contribution');
    expect(ctx.session.booking.data).toEqual({ visit: 'remote' });
  });

  it('an applicant who may come is asked for dates', () => {
    for (const visit of ['visit', 'unsure']) {
      const sys = system();
      const ctx = ctxAt(sys, 'visit', { visit });
      sys.advanceToNextField(ctx);
      expect(entered(ctx)).toBe('booking_section_dates');
    }
  });

  it('social links are asked only when x, LinkedIn and website are all empty', () => {
    const sys = system();
    const asked = ctxAt(sys, 'capacity', {});
    sys.advanceToNextField(asked);
    expect(entered(asked)).toBe('booking_social_links');

    const skipped = ctxAt(sys, 'capacity', { linkedin: 'linkedin.com/in/ada' });
    sys.advanceToNextField(skipped);
    expect(entered(skipped)).toBe('booking_complete');
  });
});

describe('Other answers', () => {
  it('single choice: the value as a string, Other’s text in <key>_other', () => {
    expect(selectionToData('single_select', { value: 'mixed' })).toEqual({
      value: 'mixed',
    });
    expect(
      selectionToData('single_select', {
        value: 'other',
        customValue: 'Barter',
      })
    ).toEqual({ value: 'other', other: 'Barter' });
  });

  it('multi choice: the values as a list with "other", the texts in <key>_other', () => {
    expect(selectionToData('multi_select', ['tech', 'cooking'])).toEqual({
      value: ['tech', 'cooking'],
    });
    expect(
      selectionToData('multi_select', ['tech', 'other:Bees', 'other:Sauna'])
    ).toEqual({ value: ['tech', 'other'], other: 'Bees; Sauna' });
  });

  it('is stored in that shape through the field scenes', async () => {
    const sys = system();

    const single = ctxAt(sys, 'contribution_preference');
    const s = await openField(sys, 'contribution_preference', single);
    await s.onComplete(single, { value: 'other', customValue: 'Barter' });
    expect(single.session.booking.data).toEqual({
      contribution_preference: 'other',
      contribution_preference_other: 'Barter',
    });

    const multi = ctxAt(sys, 'role', { role_other: 'stale' });
    const m = await openField(sys, 'role', multi);
    await m.onComplete(multi, ['forager']);
    expect(multi.session.booking.data).toEqual({ role: ['forager'] });
    await m.onComplete(multi, ['forager', 'other:Beekeeper']);
    expect(multi.session.booking.data).toEqual({
      role: ['forager', 'other'],
      role_other: 'Beekeeper',
    });
  });
});

describe('public profile', () => {
  const profile = booking.settings.profile;
  const field = booking.sections.find(s => s.id === 'public_profile');

  it('is asked only once there is an ikigai or a LinkedIn to show', () => {
    expect(fieldApplies(field, {})).toBe(false);
    expect(fieldApplies(field, { ikigai: '  ' })).toBe(false);
    expect(fieldApplies(field, { ikigai: 'Healer' })).toBe(true);
    expect(fieldApplies(field, { linkedin: 'linkedin.com/in/ada' })).toBe(true);
  });

  it('takes ikigai and a canonical LinkedIn only with a yes', () => {
    const data = {
      ikigai: ' Healer ',
      linkedin: 'it.linkedin.com/in/ada',
      wellbeing: 'private',
    };
    expect(
      profileFields(profile, { ...data, public_profile: 'no' })
    ).toBeNull();
    expect(profileFields(profile, data)).toBeNull();
    expect(profileFields(profile, { ...data, public_profile: 'yes' })).toEqual({
      ikigai: 'Healer',
      linkedin: 'https://www.linkedin.com/in/ada',
    });
    expect(
      profileFields(profile, { linkedin: 'my profile', public_profile: 'yes' })
    ).toBeNull();
  });

  it('writes them into the DNA when the application completes', async () => {
    const sys = system();
    const put = vi.fn();
    const db = { get: vi.fn(async () => null), put };
    const ctx = ctxAt(sys, 'capacity', {
      name: 'Ada',
      ikigai: 'Healer',
      public_profile: 'yes',
    });
    ctx.session.db = db;
    ctx.reply = vi.fn();
    const complete = sys.scenes.find(s => s.id === 'booking_complete');
    await complete.enterMiddleware()(ctx, async () => {});
    expect(put).toHaveBeenCalledWith('42', 'dna', {
      ikigai: 'Healer',
      public: true,
      id: '42',
    });
  });
});
