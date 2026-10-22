import { Scenes, Markup } from 'telegraf';
import { getholonId } from '../src/utilities.js';
import { completeStep } from './flow.js';

// Create a scene
const h3Scene = new Scenes.BaseScene('h3');

// Entry point for the scene
h3Scene.enter(async ctx => {
  //ctx.session.db.put('categories', Object.assign({}, categoryTypes.categories))
  //let categoryTypes = JSON.parse(await ctx.session.db.getAll('categories'))

  ctx
    .reply(
      "Please click the 'Select Hexagon' button below, zoom in and select the hexagon where this holon is located / centered on.",
      Markup.keyboard([
        Markup.button.webApp(
          'Select Hexagon',
          'https://hexamap.holons.io/index.html?id=' + getholonId(ctx)
        ),
      ])
    )
    .catch(err => console.log(err));
});

h3Scene.on('message', async ctx => {
  if (!ctx.message.web_app_data) {
    console.error('Web app data is not present');
    return;
  }

  console.log(ctx.message.web_app_data);

  if (typeof ctx.message.web_app_data.data !== 'string') {
    console.error('Web app data is not a string');
    return;
  }
  ctx.session.hex = ctx.message.web_app_data.data;
  return completeStep(ctx, { hex: ctx.session.hex });
});

// Export the scene
export default h3Scene;
