import { Telegraf, Scenes, session, Markup } from 'telegraf';

import arrivalbookingScene from './scenes/arrivalbookingScene.js';
import departurebookingScene from './scenes/departurebookingScene.js';
import videoScene from './scenes/videoScene.js';
import valuesScene from './scenes/valuesScene.js';
import categoriesScene from './scenes/categoriesScene.js';
import { questionsScene, createScenesForQuestions } from './scenes/questionsScene.js';
import onboardingScene from './scenes/onboardingScene.js';
import locationScene from './scenes/locationScene.js';
import saveprofileScene from './scenes/saveprofileScene.js'
import summarizeScene from './scenes/summarizeScene.js';
import done from './scenes/doneScene.js';

export default class Onboarding {
  constructor(bot, db) {
    this.db = db;
    this.bot = bot;
    this.userResponses = {};

    const stage = new Scenes.Stage(
      [arrivalbookingScene, departurebookingScene, videoScene, valuesScene, categoriesScene, onboardingScene, locationScene, questionsScene, saveprofileScene, summarizeScene, done].concat(createScenesForQuestions())
    );

    bot.use(session());
    bot.use(stage.middleware());

    bot.command('start', ctx => {
      const userId = ctx.from.id;
      ctx.session.stage = 0;
      ctx.session.sequence= ['arrivalbooking','departurebooking','categories', 'values', 'location','questions', 'saveprofile','onboarding'];
      //ctx.session.sequence = ['categories', 'summarize', 'values', 'categories', 'saveprofile'];

      ctx.session.userResponses = [];
      ctx.session.db = this.db;
      ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
    });

    bot.command('summarize', ctx => { ctx.scene.enter('summarize') });
  }

  async testDB() {
    await this.db.put('enquiries', enquiryTypes)

    //let data = await this.db.getAll('enquiries')//.then((enquiries) => {
    //   console.log(enquiries)
    // }
    // )
    console.log(await this.db.gun.get('RegenMatch').get('enquiries'))
  }
}

// const bot = new Telegraf(process.env.TELEGRAM);
// const match = new RegenMatch(bot);

// await match.testDB();

// bot.launch()
//   .then(() => console.log('Bot started'))
//   .catch(err => console.error('Bot launch failed', err));

// process.once('SIGINT', () => bot.stop('SIGINT'));
// process.once('SIGTERM', () => bot.stop('SIGTERM'));
