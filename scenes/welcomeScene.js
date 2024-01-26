import { Scenes, Markup } from 'telegraf';

// Create a scene for offboarding
const welcomeScene = new Scenes.BaseScene('welcome');

// Entry point for the scene
welcomeScene.enter((ctx) => {
  ctx.session.db.gun.get('Holons').get(ctx.from.id.toString()).once((data, key) => {
    if (data) {
      ctx.reply('Welcome back to our onboarding process! Would you like to make some changes to your profile?', Markup.inlineKeyboard([
        [Markup.button.callback('yes', 'yes'), Markup.button.callback('No', 'no')]
      ]))
    } else {
      ctx.reply('Welcome to our onboarding process! I am your personal assistant. I will guide you through the process of creating your profile.');
      ctx.session.id = ctx.from.id;

      ctx.session.username = ctx.from.username;
      ctx.session.first_name = ctx.from.first_name;
      ctx.session.last_name = ctx.from.last_name;

      ctx.session.stage += 1;
      ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);

    }





  })






});

// Export the scene
export default welcomeScene;
