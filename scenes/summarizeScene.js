import {
  Scenes,
  Markup
} from 'telegraf';
import { summarize } from "../AI.js";

let summarizeScene = new Scenes.BaseScene('summarize');

summarizeScene.enter(ctx => {
  ctx.session.messages = ''; // Initialize the messages string
  ctx.reply('Chat normally, I will summarize it when you are done (type /done to finish)');
});



summarizeScene.command('done', async ctx => {
  console.log('done detected');
  try {
    const summary = await summarize(ctx.session.messages);
    ctx.reply(summary);
    ctx.session.stage += 1;
    if (ctx.session.stage === ctx.session.sequence?.length) {
      ctx.scene.enter('done'); // Ensure 'done' is a valid scene or handle this case
    } else {
      if (ctx.session.sequence)
        ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
      else
        ctx.scene.leave();
    }
  } catch (error) {
    console.error('Error in summarizing:', error);
    ctx.reply('An error occurred while summarizing.');
  }
});

summarizeScene.on('text', async ctx => {
  console.log('message received');
  ctx.session.messages += "\n" + ctx.from.username + ": " + ctx.message.text;
});

export default summarizeScene;
