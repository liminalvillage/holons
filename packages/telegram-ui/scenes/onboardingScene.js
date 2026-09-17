import { Scenes } from 'telegraf';
import { onboarding } from '../src/AI.js';
import { nextStep } from './flow.js';

// Create a scene for onboarding
const onboardingScene = new Scenes.BaseScene('onboarding');

// Entry point for the scene
onboardingScene.enter(ctx => {
  ctx.reply(
    'Do you have any questions? Just ask me! type /done when you are finished.'
  );
  ctx.session.thread = null;
});

onboardingScene.command(['done', 'next'], ctx => nextStep(ctx));

onboardingScene.on('text', async ctx => {
  try {
    const answer = await onboarding(ctx.session.thread, ctx.message.text);
    if (!answer) return;
    ctx.session.thread = answer.thread;
    await ctx.reply(answer.text);
  } catch (error) {
    console.error('Error answering onboarding question:', error);
    await ctx.reply(
      'Sorry, I could not answer that right now. Type /done to continue.'
    );
  }
});

// Export the scene
export default onboardingScene;
