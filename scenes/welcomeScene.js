import { Scenes, Markup } from 'telegraf';

// Create a scene for offboarding
const welcomeScene = new Scenes.BaseScene('welcome');

// Entry point for the scene
welcomeScene.enter((ctx) => {
  ctx.reply('Welcome to the Liminal Village onboarding process! I am your personal assistant. I will guide you through the process of creating your profile.');
  ctx.session.stage +=1;
  ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
});

// Export the scene
export default welcomeScene;
