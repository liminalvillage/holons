import { Scenes } from 'telegraf';
import { summarize } from '../src/AI.js';
import { mergeDna } from '../src/dna.js';

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
    if (!ctx.session.wizard) {
      // save the new data to the database
      void mergeDna(ctx.session.db, ctx.from.id, { summary: summary });
      ctx.reply(summary);
      ctx.scene.leave();

      if (ctx.session.sceneStack) {
        ctx.session.sceneStack.pop();
        ctx.scene.enter(
          ctx.session.sceneStack[ctx.session.sceneStack.length - 1]
        );
      }

      return;
    }

    ctx.reply(summary);
    // wizard mode
    ctx.session.stage += 1;
    if (ctx.session.stage === ctx.session.sequence?.length) {
      ctx.scene.enter('done'); // Ensure 'done' is a valid scene or handle this case
    } else {
      if (ctx.session.sequence)
        ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
      else ctx.scene.leave();
    }
  } catch (error) {
    console.error('Error in summarizing:', error);
    ctx.reply('An error occurred while summarizing.');
  }
});

summarizeScene.on('text', async ctx => {
  ctx.session.messages += ctx.message.text + '\n';
});

export default summarizeScene;
