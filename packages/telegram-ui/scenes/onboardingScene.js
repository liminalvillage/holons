import { Scenes } from 'telegraf';
import { ONBOARDING_MAX_QUESTIONS, onboarding } from '../src/AI.js';
import { nextStep } from './flow.js';

// Create a scene for onboarding
const onboardingScene = new Scenes.BaseScene('onboarding');

// Entry point for the scene
onboardingScene.enter(ctx => {
  ctx.reply(
    'Do you have any questions? Just ask me! type /done when you are finished.'
  );
  ctx.session.aiHistory = [];
});

onboardingScene.command(['done', 'next'], ctx => nextStep(ctx));

onboardingScene.on('text', async ctx => {
  try {
    const history = ctx.session.aiHistory ?? [];
    // Each question adds a user and an assistant message; the conversation is
    // only ever appended to, so it stops here rather than being trimmed.
    if (history.length >= ONBOARDING_MAX_QUESTIONS * 2) {
      await ctx.reply(
        'That is all the questions I can take here — type /done to continue, and ask more in @HolonicDAO.'
      );
      return;
    }
    await ctx.sendChatAction('typing').catch(() => {});
    const answer = await onboarding(history, ctx.message.text);
    ctx.session.aiHistory = answer.history;
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
