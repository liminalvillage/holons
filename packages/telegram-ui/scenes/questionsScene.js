import { Scenes, Markup } from 'telegraf';
import { getQuestions } from '../src/AI.js';
import questionsData from '../data/questions.json' with { type: 'json' };
import enquiryTypes from '../data/enquiries.json' with { type: 'json' };
import { completeStep, nextStep } from './flow.js';

// Create a scene
export const questionsScene = new Scenes.BaseScene('questions');

questionsScene.enter(ctx =>
  ctx.reply(
    'Please type a few sentences describing the ideal place you would be thriving in. Makes sure to be very specific with your requirements.'
  )
);

questionsScene.action('done', ctx => nextStep(ctx));

questionsScene.on('text', async ctx => {
  //ask ai to select questions from ctx.message.text
  ctx.session.requirements = ctx.message.text;

  ctx.session.currentquestion = 0;
  getQuestions(ctx.message.text).then(questions => {
    ctx.session.userResponses = [];
    ctx.session.question_sequence = questions.questions.map(
      question => question.id
    );
    ctx.reply(
      'Thank you for your input. We will now ask you a few questions to better clarify your needs.'
    );
    ctx.scene.enter(
      'question_' + ctx.session.question_sequence[ctx.session.currentquestion]
    );
  });
});

questionsScene.action(/explain_(.+)/, ctx => {
  const topic = ctx.callbackQuery.data.split('_')[1];
  const enquiry = enquiryTypes.enquiries.filter(
    enquiry => enquiry.name === topic
  );
  if (enquiry.length === 0) {
    ctx.answerCbQuery('No description available');
    return;
  } else ctx.answerCbQuery(enquiry[0].description);
});

questionsScene.action(/enquiry_(.+)/, ctx => {
  ctx.session.enquiry = ctx.callbackQuery.data.split('_')[1];
  return nextStep(ctx);
});

export function createScenesForQuestions() {
  //todo: load questions from the holon's dna lens
  return questionsData.questions.map(question => {
    return createScene(question);
  });
}

function createScene(question) {
  const scene = new Scenes.BaseScene(`question_${question.questionID}`);

  scene.enter(ctx => {
    const lastAnswer = ctx.session.userResponses?.at(-1)?.answer;
    const questionDetails = question.languages.EN; // Adjust based on user's language
    // Check if the question should be enabled based on previous answers
    if (
      question.enablingAnswers.length === 0 ||
      question.enablingAnswers.includes(lastAnswer)
    ) {
      ctx.replyWithHTML(
        `<b>${questionDetails.questionTopic}</b>\n${questionDetails.questionDescription}`,
        createOptionMarkup(questionDetails.options)
      );
    } else {
      ctx.scene.leave(); // Skip to next scene or end if no more questions
    }
  });

  scene.action(/.*/, ctx => {
    //should store the requirement and enter the next scene
    ctx.answerCbQuery();
    ctx.session.userResponses.push({
      id: question.questionID,
      answer: ctx.match[0],
    });
    // Determine the next question or end the conversation
    //const nextQuestion = questionsData.questions.find(q => q.enablingAnswers.includes(ctx.match[0]));

    ctx.session.currentquestion += 1;
    if (
      ctx.session.currentquestion != ctx.session.question_sequence.length &&
      ctx.session.currentquestion < 4
    ) {
      ctx.scene.enter(
        `question_${ctx.session.question_sequence[ctx.session.currentquestion]}`
      );
    } else {
      ctx.reply('Thank you for completing the questions!');
      return completeStep(ctx, { questions: ctx.session.userResponses });
    }
  });
  return scene;
}

function createOptionMarkup(options) {
  return Markup.inlineKeyboard(
    options.map(option =>
      Markup.button.callback(option.optionShortText, option.optionValue)
    )
  );
}
