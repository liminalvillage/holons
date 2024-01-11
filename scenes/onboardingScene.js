import {
  Scenes,
  Markup
} from 'telegraf';
import {
  onboarding
} from "../AI.js";

// Create a scene for onboarding
const onboardingScene = new Scenes.BaseScene('onboarding');

// Entry point for the scene
onboardingScene.enter((ctx) => {
  ctx.reply('Do you have any questions? Just ask me! type /done when you are finished.');
  ctx.session.thread = null;
});

onboardingScene.command('done', async ctx => {
  try {
    ctx.session.stage += 1;
    if (ctx.session.stage === ctx.session.sequence?.length) {
      ctx.scene.enter('done');
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

onboardingScene.on('text', async ctx => {
  const userId = ctx.from.id;
  //ask ai to select questions from ctx.message.text
let thread = ''
let answer = await onboarding(ctx.session.thread,ctx.message.text)
    console.log(answer.thread, answer.text)
    ctx.session.thread = answer.thread;
    if(answer) ctx.reply(answer.text);
   //ctx.scene.enter('question_' + questions.questions[0].questionID); // Transition to the first question
  });

  onboardingScene.command('next',(ctx) => {
    ctx.session.stage +=1;
    if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
    else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
  }
  )



// Export the scene
export default onboardingScene;