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

import { mergeDna, readDna } from '../src/dna.js';

/** The wizard the welcome menu runs when no sequence was asked for. */
export const DEFAULT_SEQUENCE = [
  'values',
  'ikigai',
  'linkedin',
  'categories',
  'questions',
  'saveprofile',
];

/** The steps `/onboarding` walks, in order. */
export const ONBOARDING_SEQUENCE = [
  'welcome',
  'arrivalbooking',
  'departurebooking',
  'categories',
  'values',
  'ikigai',
  'linkedin',
  'saveprofile',
  'onboarding',
];

/**
 * What someone the bot already knows is asked when a website sends them to
 * onboarding: only their public profile — not the visitor questions
 * (arrival, departure, category, values) they answered or that
 * never applied to them.
 */
export const PROFILE_SEQUENCE = ['ikigai', 'linkedin', 'saveprofile'];

/** The deep-link payload that opens `/onboarding` (`t.me/<bot>?start=onboarding`). */
export const ONBOARDING_DEEPLINK = 'onboarding';

/** Begin the `/onboarding` journey from its first step. */
export function startOnboarding(ctx, db) {
  ctx.session.userResponses = [];
  return startSequence(ctx, ONBOARDING_SEQUENCE, db);
}

/**
 * Does the bot already know this person? Any one of: an onboarding DNA, a
 * profile in their own holon, or a hub they belong to (joining one records
 * it in their holon's `holons` lens).
 */
export async function isKnownUser(db, userId) {
  const id = String(userId);
  if (await readDna(db, id)) return true;
  try {
    const own = await db.get(id, 'users', id);
    if (own && !own._deleted) return true;
  } catch {
    // unreadable counts as unknown
  }
  try {
    const hubs =
      typeof db.getAll === 'function' ? await db.getAll(id, 'holons') : [];
    return Array.isArray(hubs) && hubs.some(h => h && !h._deleted);
  } catch {
    return false;
  }
}

/**
 * The deep link's entry: someone new walks the whole journey; someone the
 * bot already knows only completes their public profile.
 */
export async function startFromDeeplink(ctx, db) {
  if (!(await isKnownUser(db, ctx.from.id))) return startOnboarding(ctx, db);
  ctx.session.username = ctx.from.username;
  ctx.session.first_name = ctx.from.first_name;
  ctx.session.last_name = ctx.from.last_name;
  await ctx.reply(
    'Welcome back! Let us complete your public profile — your ikigai and LinkedIn — so people can find and book you.'
  );
  return startSequence(ctx, PROFILE_SEQUENCE, db);
}

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
