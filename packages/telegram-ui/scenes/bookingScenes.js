// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview The arrival and departure steps: a question with a calendar
 * under it. Both are the same scene with a different question, field and
 * earliest day.
 *
 * @module scenes/bookingScenes
 */

import { Scenes } from 'telegraf';
import { Calendar } from '../src/Calendar.js';
import { completeStep } from './flow.js';

/** How the picked day is stored on the session and in the member's DNA. */
const DATE_FORMAT = 'YYYY/MM/DD HH:mm:ss';

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * A picker is built per update and keeps nothing between them: the keyboard is
 * a function of the tapped button and the earliest day alone. (It used to be a
 * module-level variable, so one member's calendar replaced everyone else's.)
 * No bot is passed — the telegraf adapter answers through `ctx`.
 */
function pickerFor(earliest) {
  return new Calendar(false, {
    date_format: DATE_FORMAT,
    time_selector_mod: false,
    language: 'en',
    bot_api: 'telegraf',
    start_date: earliest,
  });
}

/**
 * @param {Object} step
 * @param {string} step.id - scene id
 * @param {string} step.field - session + DNA field the day is stored under
 * @param {string} step.question - shown above the calendar
 * @param {(ctx: Object) => Date} [step.earliest] - first day that can be picked
 */
export function createBookingScene({ id, field, question, earliest }) {
  const scene = new Scenes.BaseScene(id);
  const earliestFor = ctx => earliest?.(ctx) ?? startOfToday();

  scene.enter(async ctx => {
    const from = earliestFor(ctx);
    // Open on the month of the earliest day, not on a month of blank buttons.
    const month = new Date(from.getFullYear(), from.getMonth(), 1);
    await ctx.reply(question, {
      reply_markup: pickerFor(from).createNavigationKeyboard(
        month,
        ctx.chat.id
      ),
    });
  });

  scene.on('callback_query', async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    // -1 = a month/year arrow or a blank button: the picker has redrawn the
    // keyboard itself and the member is still choosing.
    const when = pickerFor(earliestFor(ctx)).clickButtonCalendar(ctx);
    if (when === -1) return;

    ctx.session[field] = when;
    await ctx
      .editMessageText(`${question} ${when.slice(0, 10)}`)
      .catch(() => {});
    return completeStep(ctx, { [field]: when });
  });

  return scene;
}

export const arrivalbookingScene = createBookingScene({
  id: 'arrivalbooking',
  field: 'arrival',
  question: 'When would you like to arrive?',
});

export const departurebookingScene = createBookingScene({
  id: 'departurebooking',
  field: 'departure',
  question: 'When would you like to depart?',
  // Not before the arrival picked a step earlier.
  earliest: ctx => {
    const arrival = ctx.session.arrival ? new Date(ctx.session.arrival) : null;
    return arrival && !Number.isNaN(arrival.getTime())
      ? arrival
      : startOfToday();
  },
});
