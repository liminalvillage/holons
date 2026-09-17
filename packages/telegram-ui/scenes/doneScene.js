import { Scenes } from 'telegraf';
import { endSequence } from './flow.js';

// Create a scene for offboarding
const doneScene = new Scenes.BaseScene('done');

/** The closing words follow what was really written, not what was hoped. */
function closingMessage(ctx) {
  if (ctx.session.saved === 'community') {
    return "Thank you! Your community's DNA is saved in the decentralized database.";
  }
  if (ctx.session.saved === true) {
    return 'Thank you so much for your time! Your profile is saved in the decentralized database. I will let you know when you have a match!';
  }
  return 'Thank you so much for your time! Nothing was saved — your answers stay in this chat. Run /onboarding again whenever you wish to share them.';
}

// Entry point for the scene
doneScene.enter(async ctx => {
  await ctx.reply(closingMessage(ctx));
  delete ctx.session.saved;
  endSequence(ctx);
  return ctx.scene.leave();
});

// Export the scene
export default doneScene;
