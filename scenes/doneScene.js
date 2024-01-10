import { Scenes, Markup } from 'telegraf';

// Create a scene for onboarding
const doneScene = new Scenes.BaseScene('done');

// Entry point for the scene
doneScene.enter((ctx) => {
  ctx.reply('Thank you!');
});


// Export the scene
export default doneScene;
