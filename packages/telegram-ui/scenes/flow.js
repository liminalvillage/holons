// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview The one rule for moving between the onboarding scenes.
 *
 * A scene is reached in one of two ways:
 *  - as a step of a wizard run — `session.sequence` walked by `session.stage`;
 *  - as a single edit from the welcome-back menu — the scene sits on top of
 *    `session.sceneStack`, the answer is saved at once, and the member goes
 *    back to the menu below it.
 *
 * Every scene used to carry its own copy of this; they had drifted (some
 * guarded a missing stack or sequence, most did not) and a miss threw inside
 * the handler, leaving the member stuck in the scene.
 *
 * @module scenes/flow
 */

import { mergeDna } from '../src/dna.js';

/** The wizard the welcome menu runs when no sequence was asked for. */
export const DEFAULT_SEQUENCE = [
  'values',
  'location',
  'categories',
  'questions',
  'saveprofile',
];

/** Begin a wizard run over `sequence` (scene ids), from its first step. */
export function startSequence(ctx, sequence, db) {
  ctx.session.sequence = [...sequence];
  ctx.session.stage = 0;
  ctx.session.wizard = true;
  ctx.session.sceneStack = [];
  if (db) ctx.session.db = db;
  return ctx.scene.enter(ctx.session.sequence[0]);
}

/** Forget the run — the next `/onboarding` or "Restart Wizard" starts clean. */
export function endSequence(ctx) {
  delete ctx.session.sequence;
  ctx.session.stage = 0;
  ctx.session.wizard = false;
}

/** Move to the next step of the run; past the last one → `done`. */
export function nextStep(ctx) {
  const sequence = ctx.session.sequence;
  if (!Array.isArray(sequence) || sequence.length === 0) {
    return ctx.scene.leave();
  }
  const stage =
    (Number.isInteger(ctx.session.stage) ? ctx.session.stage : -1) + 1;
  ctx.session.stage = stage;
  return ctx.scene.enter(stage >= sequence.length ? 'done' : sequence[stage]);
}

/** The run is over before its last step (a community's DNA has no more). */
export function finishSequence(ctx) {
  return ctx.scene.enter('done');
}

/** Open `sceneId` as a single edit from the menu scene `menuId`. */
export function editFromMenu(ctx, menuId, sceneId) {
  ctx.session.wizard = false;
  ctx.session.sceneStack = [menuId, sceneId];
  return ctx.scene.enter(sceneId);
}

/** Drop the current scene off the stack and return to the menu under it. */
export function backToMenu(ctx) {
  const stack = ctx.session.sceneStack;
  if (Array.isArray(stack)) stack.pop();
  const previous = Array.isArray(stack) ? stack[stack.length - 1] : undefined;
  return previous ? ctx.scene.enter(previous) : ctx.scene.leave();
}

/**
 * The current scene has its answer. In a wizard run the answer stays in the
 * session until the profile is saved; as a single edit `fields` are merged
 * into the member's DNA right away.
 */
export function completeStep(ctx, fields = {}) {
  if (ctx.session.wizard) return nextStep(ctx);
  if (Object.keys(fields).length > 0) {
    void mergeDna(ctx.session.db, ctx.from.id, fields);
  }
  return backToMenu(ctx);
}
