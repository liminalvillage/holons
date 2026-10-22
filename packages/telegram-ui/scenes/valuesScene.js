import { Scenes, Markup } from 'telegraf';
import { completeStep } from './flow.js';
import valuesData from '../data/values.json' with { type: 'json' };

// The values a member can pick as part of their DNA, with what each means.
const values = valuesData.values;
const ids = values.map(v => v.id);

const valuesPerPage = 10; // two columns of five
const pageCount = Math.ceil(values.length / valuesPerPage);

/** How a value id reads on a button (`Quality_Evaluation` → `Quality/Evaluation`). */
const label = id => id.replace(/_/g, '/');

// Create a scene for onboarding
const valuesScene = new Scenes.BaseScene('values');

// Entry point for the scene
valuesScene.enter(ctx => {
  ctx.session.page = 0; // Initialize page number
  ctx.session.selectedValues = {}; // value → picked?
  ctx.reply(valuesText(ctx), valuesKeyboard(ctx)).catch(error => {
    console.log(error);
  });
});

/** The prompt, with what each value on this page means. */
function valuesText(ctx) {
  const picked = ids.filter(id => ctx.session.selectedValues[id]).length;
  const page = values.slice(
    ctx.session.page * valuesPerPage,
    (ctx.session.page + 1) * valuesPerPage
  );
  return [
    `Please select the values that represent you the most (${picked} picked):`,
    '',
    ...page.map(v => `• ${label(v.id)} — ${v.description}`),
  ].join('\n');
}

// Function to display values page
function valuesKeyboard(ctx) {
  const page = ctx.session.page;
  const cells = ids
    .slice(page * valuesPerPage, (page + 1) * valuesPerPage)
    .map(id =>
      Markup.button.callback(
        (ctx.session.selectedValues[id] ? '✅ ' : '☑️ ') + label(id),
        `value_${id}`
      )
    );
  const buttons = [];
  for (let i = 0; i < cells.length; i += 2) buttons.push(cells.slice(i, i + 2));

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('<', 'prev_page'));
  nav.push(Markup.button.callback(`${page + 1}/${pageCount}`, 'values_page'));
  if (page < pageCount - 1) nav.push(Markup.button.callback('>', 'next_page'));
  buttons.push(nav);
  buttons.push([Markup.button.callback('Done', 'done_picking')]);
  return Markup.inlineKeyboard(buttons);
}

function refresh(ctx) {
  ctx.answerCbQuery().catch(() => {});
  ctx.editMessageText(valuesText(ctx), valuesKeyboard(ctx)).catch(error => {
    console.log(error);
  });
}

// Handle value selection
ids.forEach(id => {
  valuesScene.action(`value_${id}`, ctx => {
    ctx.session.selectedValues[id] = !ctx.session.selectedValues[id];
    refresh(ctx);
  });
});

// Handle page navigation
valuesScene.action('prev_page', ctx => {
  ctx.session.page = Math.max(0, ctx.session.page - 1);
  refresh(ctx);
});

valuesScene.action('next_page', ctx => {
  ctx.session.page = Math.min(pageCount - 1, ctx.session.page + 1);
  refresh(ctx);
});

// The page counter is only a label.
valuesScene.action('values_page', ctx => ctx.answerCbQuery().catch(() => {}));

valuesScene.action('done_picking', async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  // Only what is still ticked: a value tapped twice is in the map as `false`.
  ctx.session.values = ids.filter(id => ctx.session.selectedValues[id]);
  return completeStep(ctx, { values: ctx.session.values });
});

// Export the scene
export default valuesScene;
