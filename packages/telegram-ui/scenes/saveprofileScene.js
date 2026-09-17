import { Scenes, Markup } from 'telegraf';
import { dnaFromSession, mergeDna, readDna } from '../src/dna.js';
import { completeStep, nextStep } from './flow.js';

// Create a scene for onboarding
const saveprofileScene = new Scenes.BaseScene('saveprofile');

// Entry point for the scene
saveprofileScene.enter(ctx => {
  return ctx.reply(
    'Would you wish to make your answers public?',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('Yes', 'public'),
        Markup.button.callback('No', 'private'),
      ],
    ])
  );
});

// The DNA record is signed and published, so "No" means nothing is written:
// the answers stay on the session and go when the conversation does.
saveprofileScene.action('public', async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session.public = true;
  ctx.session.saved = await mergeDna(ctx.session.db, ctx.from.id, {
    ...dnaFromSession(ctx.session),
    public: true,
  });
  if (!ctx.session.saved) {
    return ctx.reply('Sorry, I could not save your profile. Please try again.');
  }
  return nextStep(ctx);
});

saveprofileScene.action('private', async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session.public = false;
  ctx.session.saved = false;
  if (await readDna(ctx.session.db, ctx.from.id)) {
    await ctx.reply(
      'The DNA you saved earlier is unchanged. To remove it, run /onboarding and choose Reset Profile.'
    );
  }
  return completeStep(ctx);
});

// Export the scene
export default saveprofileScene;
