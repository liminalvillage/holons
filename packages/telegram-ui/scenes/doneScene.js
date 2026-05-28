import { Scenes } from 'telegraf';

// Create a scene for offboarding
const doneScene = new Scenes.BaseScene('done');

// Entry point for the scene
doneScene.enter(ctx => {
  ctx.reply(
    'Thank you so much for your time! Your profile is saved in the decentralized database. I will let you know when you have a match!'
  );
  ctx.session.stage = 0;
  ctx.scene.leave();
});

// Export the scene
export default doneScene;
