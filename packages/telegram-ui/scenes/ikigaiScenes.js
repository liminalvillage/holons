// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Onboarding steps for what a member offers the world: their
 * ikigai and a LinkedIn link. Both land in the member's DNA (`ikigai`,
 * `linkedin`) and, once made public, are what surfaces such as a community's
 * services page show next to their name. Both can be skipped.
 *
 * @module scenes/ikigaiScenes
 */

import { Scenes } from 'telegraf';
import { backToMenu, completeStep, nextStep } from './flow.js';

const IKIGAI_MAX = 1000;
const LINKEDIN_RE =
  /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company|pub)\/[\w%.-]+\/?/i;

/** A LinkedIn profile link in `text`, as a canonical https URL — or null. */
export function normaliseLinkedin(text) {
  const m = LINKEDIN_RE.exec(String(text ?? ''));
  if (!m) return null;
  const path = m[0]
    .replace(/^https?:\/\//i, '')
    .replace(/^(?:[a-z]{2,3}\.)?linkedin\.com/i, '');
  return `https://www.linkedin.com${path}`;
}

/** Skipping moves a wizard run on, or returns a single edit to the menu. */
const skip = ctx => (ctx.session.wizard ? nextStep(ctx) : backToMenu(ctx));

export const ikigaiScene = new Scenes.BaseScene('ikigai');

ikigaiScene.enter(ctx =>
  ctx.scene.enter('input_scene', {
    promptText:
      '🌱 What is your ikigai?\n\n' +
      'Where what you love, what you are good at, what the world needs and ' +
      'what you can be paid for meet — e.g. healer, facilitator, coach, ' +
      'builder, artist. A few lines are perfect.\n\n' +
      'If you make your answers public, this is what people see when they ' +
      'look for sessions with you.',
    validate: input =>
      input.length <= IKIGAI_MAX || {
        valid: false,
        error: `Please keep it under ${IKIGAI_MAX} characters.`,
      },
    cancelButtonText: 'Skip',
    cancelText: 'Skipped.',
    onComplete: async (ctx, ikigai) => {
      ctx.session.ikigai = ikigai;
      return completeStep(ctx, { ikigai });
    },
    onCancel: skip,
  })
);

export const linkedinScene = new Scenes.BaseScene('linkedin');

linkedinScene.enter(ctx =>
  ctx.scene.enter('input_scene', {
    promptText:
      '🔗 Share your LinkedIn profile link, so people can learn more about ' +
      'your work.\n\ne.g. linkedin.com/in/your-name',
    validate: input =>
      !!normaliseLinkedin(input) || {
        valid: false,
        error:
          'That does not look like a LinkedIn profile link (linkedin.com/in/…). Try again, or tap Skip.',
      },
    transform: input => normaliseLinkedin(input),
    cancelButtonText: 'Skip',
    cancelText: 'Skipped.',
    onComplete: async (ctx, linkedin) => {
      ctx.session.linkedin = linkedin;
      return completeStep(ctx, { linkedin });
    },
    onCancel: skip,
  })
);
