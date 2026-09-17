import { Scenes } from 'telegraf';
import { summarize } from '../src/AI.js';
import { completeStep } from './flow.js';

const summarizeScene = new Scenes.BaseScene('summarize');

summarizeScene.enter(ctx => {
  ctx.session.messages = ''; // Initialize the messages string
  ctx.reply(
    'Chat normally, I will summarize it when you are done (type /done to finish)'
  );
});

summarizeScene.command('done', async ctx => {
  console.log('done detected');
  try {
    const summary = await summarize(ctx.session.messages);
    ctx.session.summary = summary;
    await ctx.reply(summary);
    return completeStep(ctx, { summary });
  } catch (error) {
    console.error('Error in summarizing:', error);
    ctx.reply('An error occurred while summarizing.');
  }
});

summarizeScene.on('text', async ctx => {
  ctx.session.messages += ctx.message.text + '\n';
});

export default summarizeScene;
