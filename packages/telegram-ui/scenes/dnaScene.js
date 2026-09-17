import { Scenes, Markup } from 'telegraf';

import dnaData from '../data/dna.json' with { type: 'json' };
import { mergeDna } from '../src/dna.js';
import { endSequence, finishSequence } from './flow.js';

// A community's DNA: the questions in data/dna.json, asked in a group chat and
// answered from the community's perspective. The answers are the group's, so
// they are saved in the group's own holon — and the run ends there: the steps
// that follow in /onboarding (arrival, values, …) are a person's.
export const dnaScene = new Scenes.BaseScene('dna');

dnaScene.enter(ctx => {
  ctx.session.dnaAnswers = {};
  return ctx.scene.enter('dna_0');
});

export function createScenesForDNA() {
  //todo: load questions from the holon's dna lens
  return dnaData.dna.map((question, index) => {
    return createScene(question, index);
  });
}

function createScene(question, index) {
  const scene = new Scenes.BaseScene(`dna_${index}`);

  scene.enter(ctx =>
    ctx.replyWithHTML(
      `<b>${question.description}</b>\n`,
      createOptionMarkup(question.options)
    )
  );

  scene.action(/^dna_(\d+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    const answer = question.options[Number(ctx.match[1])];
    if (answer === undefined) return;

    ctx.session.dnaAnswers = {
      ...ctx.session.dnaAnswers,
      [question.id]: answer,
    };
    await ctx
      .editMessageText(`<b>${question.description}</b>\n${answer}`, {
        parse_mode: 'HTML',
      })
      .catch(() => {});

    if (index + 1 < dnaData.dna.length) {
      return ctx.scene.enter(`dna_${index + 1}`);
    }

    const saved = await mergeDna(ctx.session.db, ctx.chat.id, {
      community: ctx.session.dnaAnswers,
    });
    if (!saved) {
      endSequence(ctx);
      await ctx.reply(
        "Sorry, I could not save your community's DNA. Please run /onboarding again."
      );
      return ctx.scene.leave();
    }
    ctx.session.saved = 'community';
    return finishSequence(ctx);
  });
  return scene;
}

// The button carries the option's position, not its text: Telegram caps
// callback data at 64 bytes and the longest option is already 61.
function createOptionMarkup(options) {
  return Markup.inlineKeyboard(
    options.map((option, i) => [Markup.button.callback(option, `dna_${i}`)])
  );
}

export default dnaScene;
