/**
 * @fileoverview User onboarding flow with multi-step scenes.
 * @module src/Onboarding
 */

import { Telegraf, Scenes, Markup } from 'telegraf';

import h3Scene from '../scenes/h3Scene.js';
import arrivalbookingScene from '../scenes/arrivalbookingScene.js';
import departurebookingScene from '../scenes/departurebookingScene.js';
import videoScene from '../scenes/videoScene.js';
import valuesScene from '../scenes/valuesScene.js';
import categoriesScene from '../scenes/categoriesScene.js';
import { questionsScene, createScenesForQuestions } from '../scenes/questionsScene.js';
import onboardingScene from '../scenes/onboardingScene.js';
import locationScene from '../scenes/locationScene.js';
import saveprofileScene from '../scenes/saveprofileScene.js'
import summarizeScene from '../scenes/summarizeScene.js';
import welcomeScene from '../scenes/welcomeScene.js';
import { dnaScene, createScenesForDNA } from '../scenes/dnaScene.js';
import done from '../scenes/doneScene.js';

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
 * @property {Object} userResponses - Temporary storage for user responses
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
    this.userResponses = {};

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
      done
    ].concat(createScenesForQuestions())
     .concat(createScenesForDNA());

    scenes.forEach(scene => {
      bot.stage.register(scene);
    });

    bot.command('onboarding', ctx => {
      const userId = ctx.from.id;
      ctx.session.stage = 0;
      ctx.session.sequence = ['welcome', 'arrivalbooking', 'departurebooking', 'categories', 'values', 'location', 'saveprofile', 'onboarding'];
      ctx.session.db = this.db;
      ctx.session.userResponses = [];
      ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
    });

    bot.command('summarize', ctx => { 
      ctx.session.db = this.db; 
      ctx.scene.enter('summarize') 
    });
  }
}
