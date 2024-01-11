import {
  Scenes,
  Markup
} from 'telegraf';
import { getQuestions  } from "../AI.js";
import questionsData from "../data/questions.json" assert { type: "json" };

// Create a scene
export const questionsScene = new Scenes.BaseScene('questions');

questionsScene.enter(ctx => ctx.reply('Please type a few sentences describing the ideal place you would be thriving in. Makes sure to be very specific with your requirements.'));

questionsScene.action('done', (ctx) => {
  ctx.session.stage +=1;
  if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
});

questionsScene.on('text', async ctx => {
  const userId = ctx.from.id;
  //ask ai to select questions from ctx.message.text
  ctx.session.userResponses[userId] = {
    initialInput: ctx.message.text
  };
  ctx.session.currentquestion = 0;
  getQuestions(ctx.message.text).then((questions) => {
    ctx.session.question_sequence = questions.questions.map(question => question.id);
    ctx.reply('Thank you for your input. We will now ask you a few questions to better clarify your needs.');
    ctx.scene.enter('question_' + ctx.session.question_sequence[ctx.session.currentquestion] );
  });
});

questionsScene.action(/explain_(.+)/, ctx => {
  var topic = ctx.callbackQuery.data.split('_')[1]
  const enquiry = enquiryTypes.enquiries.filter(enquiry => enquiry.name === topic)
  if (enquiry.length === 0) {
    ctx.answerCbQuery('No description available');
    return;
  } else
    ctx.answerCbQuery(enquiry[0].description);
})

questionsScene.action(/enquiry_(.+)/, ctx => {
  ctx.session.enquiry = ctx.callbackQuery.data.split('_')[1]
  ctx.session.stage +=1;
  if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
})


export function createScenesForQuestions(){
  //todo:load questions from gun db
  return questionsData.questions.map(question => {
     return createScene(question);
  })
}

function createScene(question) {
  const scene = new Scenes.BaseScene(`question_${question.questionID}`);

  scene.enter(ctx => {
    const userId = ctx.from.id;
    const questionDetails = question.languages.EN; // Adjust based on user's language
    // Check if the question should be enabled based on previous answers
    if (question.enablingAnswers.length === 0 || question.enablingAnswers.includes(this.userResponses[userId]?.lastAnswer)) {
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
    const userId = ctx.from.id;
    ctx.answerCbQuery();
    ctx.session.userResponses[userId] = {
      lastAnswer: ctx.match[0]
    };
    // Determine the next question or end the conversation
    //const nextQuestion = questionsData.questions.find(q => q.enablingAnswers.includes(ctx.match[0]));

    ctx.session.currentquestion += 1 
    if (ctx.session.currentquestion != ctx.session.question_sequence.length) {
      ctx.scene.enter(`question_${ctx.session.question_sequence[ctx.session.currentquestion]}`);
    } else {
      ctx.reply('Thank you for completing the questions!');
      ctx.session.stage +=1;
      if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
      else
      ctx.scene.enter(ctx.session.sequence[ctx.session.stage])
    }
  });
  return scene;
}


function createOptionMarkup(options) {
  return Markup.inlineKeyboard(
    options.map(option => Markup.button.callback(option.optionShortText, option.optionValue))
  );
}

