import { Scenes } from 'telegraf';
import { Calendar } from '../src/Calendar.js';
import { mergeDna } from '../src/dna.js';

// Create a scene for onboarding
const arrivalbookingScene = new Scenes.BaseScene('arrivalbooking');
let calendar;
// Entry point for the scene
arrivalbookingScene.enter(async ctx => {
  await ctx.reply('When would you like to arrive?');

  calendar = new Calendar(ctx.telegraf, {
    date_format: 'YYYY/MM/DD HH:mm:ss',
    time_selector_mod: false,
    language: 'en',
    bot_api: 'telegraf',
  });
  calendar.startNavCalendar(ctx, 'en'); //TODO: pass quest information to recreate message
});

arrivalbookingScene.on('callback_query', ctx => {
  const when = calendar.clickButtonCalendar(ctx);
  ctx.session.arrival = when;
  if (!ctx.session.wizard) {
    // save the new data to the database
    void mergeDna(ctx.session.db, ctx.from.id, {
      arrival: ctx.session.arrival,
    });
    ctx.session.sceneStack.pop();
    ctx.scene.enter(ctx.session.sceneStack[ctx.session.sceneStack.length - 1]);
    return;
  }
  ctx.session.stage += 1;
  if (ctx.session.stage === ctx.session.sequence.length)
    ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
});

// Export the scene
export default arrivalbookingScene;
