import { Scenes, Markup } from 'telegraf';
import {Calendar} from '../Calendar.js';

// Create a scene for onboarding
const departurebookingScene = new Scenes.BaseScene('departurebooking');
let calendar;
// Entry point for the scene
departurebookingScene.enter((ctx) => {
  ctx.reply('When would you like to depart?');
 
    calendar = new Calendar(ctx.telegraf,{
    date_format: 'YYYY/MM/DD HH:mm:ss',
    time_selector_mod: false,
    language: 'en',
    bot_api: 'telegraf'
});
calendar.startNavCalendar(ctx);//TODO: pass quest information to recreate message
});

departurebookingScene.on('callback_query', (ctx) => {
    const callbackData = ctx.callbackQuery.data;
 
      var when = calendar.clickButtonCalendar(ctx);
      ctx.session.departure = when;
      if (!ctx.session.wizard) {
        // save the new data to the database
        ctx.session.db.gun.get('Holons').get(ctx.from.id.toString()).get('departure').put(ctx.session.departure);
        ctx.session.sceneStack.pop();
        ctx.scene.enter(ctx.session.sceneStack[ctx.session.sceneStack.length-1]);
        return
      }
      ctx.session.stage +=1;
      if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
      else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
}
)


// Export the scene
export default departurebookingScene;
