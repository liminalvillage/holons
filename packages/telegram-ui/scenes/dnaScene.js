import { Scenes, Markup } from 'telegraf';

import dnaData from '../data/dna.json' with { type: 'json' };
import enquiryTypes from '../data/enquiries.json' with { type: 'json' };

// Create a scene
export const dnaScene = new Scenes.BaseScene('dna');

dnaScene.enter(ctx => {
  ctx.session.dna_sequence = '';
  ctx.session.currentdna = 0;
  ctx.scene.enter('dna_' + ctx.session.currentdna);
});

dnaScene.action(/explain_(.+)/, ctx => {
  const topic = ctx.callbackQuery.data.split('_')[1];
  const enquiry = enquiryTypes.enquiries.filter(
    enquiry => enquiry.name === topic
  );
  if (enquiry.length === 0) {
    ctx.answerCbQuery('No description available');
    return;
  } else ctx.answerCbQuery(enquiry[0].description);
});

dnaScene.action('done', ctx => {
  ctx.session.stage += 1;
  if (ctx.session.stage === ctx.session.sequence.length)
    ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
});

export function createScenesForDNA() {
  //todo:load questions from gun db
  return dnaData.dna.map((question, index) => {
    return createScene(question, index);
  });
}

function createScene(question, index) {
  const scene = new Scenes.BaseScene(`dna_${index}`);

  scene.enter(ctx => {
    ctx.replyWithHTML(
      `<b>${question.description}</b>\n`,
      createOptionMarkup(question.options)
    );
  });

  scene.action(/.*/, ctx => {
    //should store the requirement and enter the next scene
    const userId = ctx.from.id;
    ctx.answerCbQuery();
    ctx.session.userResponses[userId] = {
      lastAnswer: ctx.match[0],
    };

    ctx.session.currentdna += 1;
    if (ctx.session.currentdna != ctx.session.dna_sequence.length) {
      ctx.scene.enter(`dna_${ctx.session.currentdna}`);
    } else {
      ctx.reply('Thank you for completing the questions!');
      ctx.session.stage += 1;
      if (ctx.session.stage === ctx.session.sequence.length)
        ctx.scene.enter('done');
      else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
    }
  });
  return scene;
}

function createOptionMarkup(options) {
  return Markup.inlineKeyboard(
    options.map(option => [Markup.button.callback(option, option)])
  );
}

export default dnaScene;
