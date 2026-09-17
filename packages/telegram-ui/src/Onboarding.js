/**
 * @fileoverview User onboarding flow with multi-step scenes.
 * @module src/Onboarding
 */

import h3Scene from '../scenes/h3Scene.js';
import {
  arrivalbookingScene,
  departurebookingScene,
} from '../scenes/bookingScenes.js';
import videoScene from '../scenes/videoScene.js';
import valuesScene from '../scenes/valuesScene.js';
import categoriesScene from '../scenes/categoriesScene.js';
import {
  questionsScene,
  createScenesForQuestions,
} from '../scenes/questionsScene.js';
import onboardingScene from '../scenes/onboardingScene.js';
import locationScene from '../scenes/locationScene.js';
import saveprofileScene from '../scenes/saveprofileScene.js';
import summarizeScene from '../scenes/summarizeScene.js';
import welcomeScene from '../scenes/welcomeScene.js';
import { dnaScene, createScenesForDNA } from '../scenes/dnaScene.js';
import done from '../scenes/doneScene.js';
import { startSequence } from '../scenes/flow.js';

/** The steps `/onboarding` walks, in order. */
const ONBOARDING_SEQUENCE = [
  'welcome',
  'arrivalbooking',
  'departurebooking',
  'categories',
  'values',
  'location',
  'saveprofile',
  'onboarding',
];

/**
 * User onboarding system with multi-step scene flows.
 *
 * @class Onboarding
 * @description Manages the user onboarding process through a series of
 * Telegraf scenes including welcome, location, values selection, DNA
 * questionnaire, and profile creation. Stores user responses for
 * profile building.
 *
 * @property {Object} bot - Telegraf bot instance
 * @property {DB} db - Database instance
 *
 * @example
 * const onboarding = new Onboarding(bot, db);
 * // User enters /start to begin onboarding
 */
export default class Onboarding {
  /**
   * @param {Object} bot - Telegraf bot instance
   * @param {DB} db - Database instance
   */
  constructor(bot, db) {
    this.db = db;
    this.bot = bot;

    const scenes = [
      welcomeScene,
      arrivalbookingScene,
      departurebookingScene,
      videoScene,
      valuesScene,
      categoriesScene,
      onboardingScene,
      locationScene,
      questionsScene,
      saveprofileScene,
      summarizeScene,
      h3Scene,
      dnaScene,
      done,
    ]
      .concat(createScenesForQuestions())
      .concat(createScenesForDNA());

    scenes.forEach(scene => {
      bot.stage.register(scene);
    });

    bot.command('onboarding', ctx => {
      ctx.session.userResponses = [];
      return startSequence(ctx, ONBOARDING_SEQUENCE, this.db);
    });

    bot.command('summarize', ctx => {
      ctx.session.db = this.db;
      ctx.scene.enter('summarize');
    });
  }
}
