import {
  Scenes,
  Markup
} from 'telegraf';
import categoryTypes from "../data/guilds.json" assert { type: "json" };

import fs from 'fs';

// Create a scene
const categoriesScene = new Scenes.BaseScene('categories');

// Entry point for the scene
categoriesScene.enter(async (ctx) => {
  //ctx.session.db.put('categories', Object.assign({}, categoryTypes.categories))
  //let categoryTypes = JSON.parse(await ctx.session.db.getAll('categories'))
  
  ctx.replyWithPhoto({
      source: fs.createReadStream('./data/guilds.jpg'),
      caption: 'Please select a category you would like to join'
    },
    Markup.inlineKeyboard([
      [Markup.button.callback(categoryTypes.guilds[0].name, 'category_' + categoryTypes.guilds[0].name), Markup.button.callback('ℹ️', 'explain_' + categoryTypes.guilds[0].name)],
      [Markup.button.callback(categoryTypes.guilds[1].name, 'category_' + categoryTypes.guilds[1].name), Markup.button.callback('ℹ️', 'explain_' + categoryTypes.guilds[1].name)],
      [Markup.button.callback(categoryTypes.guilds[2].name, 'category_' + categoryTypes.guilds[2].name), Markup.button.callback('ℹ️', 'explain_' + categoryTypes.guilds[2].name)],
      [Markup.button.callback(categoryTypes.guilds[3].name, 'category_' + categoryTypes.guilds[3].name), Markup.button.callback('ℹ️', 'explain_' + categoryTypes.guilds[3].name)],
      [Markup.button.callback(categoryTypes.guilds[4].name, 'category_' + categoryTypes.guilds[4].name), Markup.button.callback('ℹ️', 'explain_' + categoryTypes.guilds[4].name)],
      [Markup.button.callback(categoryTypes.guilds[5].name, 'category_' + categoryTypes.guilds[5].name), Markup.button.callback('ℹ️', 'explain_' + categoryTypes.guilds[5].name)],
      [Markup.button.callback(categoryTypes.guilds[6].name, 'category_' + categoryTypes.guilds[6].name), Markup.button.callback('ℹ️', 'explain_' + categoryTypes.guilds[6].name)],
    ]))

});

categoriesScene.action(/explain_(.+)/, ctx => {
  var topic = ctx.callbackQuery.data.split('_')[1]
  const category =categoryTypes.guilds.filter(category => category.name === topic )
  if (category.length === 0) {
    ctx.answerCbQuery('No description available');
    return;
  }
  else
    ctx.answerCbQuery(category[0].description);
})

categoriesScene.action(/category_(.+)/, ctx => {
  ctx.session.category = ctx.callbackQuery.data.split('_')[1]
  if (!ctx.session.wizard) {
    // save the new data to the database
    ctx.session.db.gun.get('Holons').get(ctx.from.id.toString()).get('category').put(ctx.session.category);
    ctx.session.sceneStack.pop();
    ctx.scene.enter(ctx.session.sceneStack[ctx.session.sceneStack.length-1]);
    return
  }
  ctx.session.stage +=1;
  if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
})

// Export the scene
export default categoriesScene;