import { Scenes, Markup } from 'telegraf';

// Create a scene for onboarding
const videoScene = new Scenes.BaseScene('video');

// Entry point for the scene
videoScene.enter((ctx) => {
  ctx.reply('We would like you to share a 1-minute video explaining your story using the following framework:\n\n- A Story of Self: Share something personal about yourself.\n- A Story of Us: Share something about the community you belong to or want to create.\n- A Story of Now: Share what motivates you right now.\n\nPlease upload your video now.');
});

// Handle video submission
videoScene.on('video', (ctx) => {
  //store the video in the db
  ctx.session.video = ctx.message.video;
  ctx.session.stage +=1;
  if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
});

// Export the scene
export default videoScene;
