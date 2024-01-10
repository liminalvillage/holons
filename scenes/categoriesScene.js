import {
  Scenes,
  Markup
} from 'telegraf';
import enquiryTypes from "./guilds.json" assert { type: "json" };

import fs from 'fs';

// Create a scene
const categoriesScene = new Scenes.BaseScene('categories');

// Entry point for the scene
categoriesScene.enter(async (ctx) => {
  //ctx.session.db.put('enquiries', Object.assign({}, enquiryTypes.enquiries))
  //let enquiryTypes = JSON.parse(await ctx.session.db.getAll('enquiries'))
  
  ctx.replyWithPhoto({
      source: fs.createReadStream('./scenes/guilds.jpg'),
      caption: 'Please select a category you would like to join'
    },
    Markup.inlineKeyboard([
      [Markup.button.callback(enquiryTypes.guilds[0].name, 'enquiry_' + enquiryTypes.guilds[0].name), Markup.button.callback('ℹ️', 'explain_' + enquiryTypes.guilds[0].name)],
      [Markup.button.callback(enquiryTypes.guilds[1].name, 'enquiry_' + enquiryTypes.guilds[1].name), Markup.button.callback('ℹ️', 'explain_' + enquiryTypes.guilds[1].name)],
      [Markup.button.callback(enquiryTypes.guilds[2].name, 'enquiry_' + enquiryTypes.guilds[2].name), Markup.button.callback('ℹ️', 'explain_' + enquiryTypes.guilds[2].name)],
      [Markup.button.callback(enquiryTypes.guilds[3].name, 'enquiry_' + enquiryTypes.guilds[3].name), Markup.button.callback('ℹ️', 'explain_' + enquiryTypes.guilds[3].name)],
      [Markup.button.callback(enquiryTypes.guilds[4].name, 'enquiry_' + enquiryTypes.guilds[4].name), Markup.button.callback('ℹ️', 'explain_' + enquiryTypes.guilds[4].name)],
      [Markup.button.callback(enquiryTypes.guilds[5].name, 'enquiry_' + enquiryTypes.guilds[5].name), Markup.button.callback('ℹ️', 'explain_' + enquiryTypes.guilds[5].name)],
      [Markup.button.callback(enquiryTypes.guilds[6].name, 'enquiry_' + enquiryTypes.guilds[6].name), Markup.button.callback('ℹ️', 'explain_' + enquiryTypes.guilds[6].name)],
    ]))

});

categoriesScene.action(/explain_(.+)/, ctx => {
  var topic = ctx.callbackQuery.data.split('_')[1]
  const enquiry =enquiryTypes.enquiries.dfilter(enquiry => enquiry.name === topic )
  if (enquiry.length === 0) {
    ctx.answerCbQuery('No description available');
    return;
  }
  else
    ctx.answerCbQuery(enquiry[0].description);
})

categoriesScene.action(/enquiry_(.+)/, ctx => {
  ctx.session.enquiry = ctx.callbackQuery.data.split('_')[1]
  ctx.session.stage +=1;
  console.log(ctx.session)
  if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
})

categoriesScene.action('done', (ctx) => {
  ctx.scene.enter('question_1'); // Transition to the first question
});

// Export the scene
export default categoriesScene;