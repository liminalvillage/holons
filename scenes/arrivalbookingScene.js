import { Scenes, Markup } from 'telegraf';
import {Calendar} from '../Calendar.js';

// Create a scene for onboarding
const arrivalbookingScene = new Scenes.BaseScene('arrivalbooking');
let calendar;
// Entry point for the scene
arrivalbookingScene.enter((ctx) => {
  ctx.reply('When would you like to arrive?');
 
    calendar = new Calendar(ctx.telegraf,{
    date_format: 'YYYY/MM/DD HH:mm:ss',
    time_selector_mod: false,
    language: 'en',
    bot_api: 'telegraf'
});
calendar.startNavCalendar(ctx);//TODO: pass quest information to recreate message
});

arrivalbookingScene.on('callback_query', (ctx) => {
    const callbackData = ctx.callbackQuery.data;
 
      var when = calendar.clickButtonCalendar(ctx);
      ctx.session.startwhen = when;
      ctx.session.stage +=1;
      if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
      else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
}
)


// Export the scene
export default arrivalbookingScene;
