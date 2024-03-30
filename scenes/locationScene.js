import { Scenes, Markup } from 'telegraf';

// Create a scene for onboarding
const locationScene = new Scenes.BaseScene('location');

// Entry point for the scene
locationScene.enter((ctx) => {
  ctx.reply('Please share your location using the paperclip icon below');
});

// Handle video submission
locationScene.on('location', (ctx) => {
  let message_id = ctx.message.message_id;
  ctx.session.location = ctx.message.location;
  if (!ctx.session.wizard) {
    // save the new data to the database
    ctx.session.db.gun.get(ctx.from.id.toString()).get('location').put(ctx.session.location);
    ctx.session.sceneStack.pop();
    ctx.scene.enter(ctx.session.sceneStack[ctx.session.sceneStack.length-1]);
    return
  }
  ctx.session.stage +=1;
  if (!ctx.session.sequence) ctx.scene.leave();
  if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);

});

// Export the scene
export default locationScene;
