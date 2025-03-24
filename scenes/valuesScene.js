import { Scenes, Markup } from 'telegraf';

// Define the values that can function as the user's DNA
const values = [
  'Integrity',
  'Compassion',
  'Courage',
  'Respect',
  'Responsibility',
  'Honesty',
  'Empathy',
  'Innovation'
];

const valuesPerPage = 4; // Number of values to display per page

// Create a scene for onboarding
const valuesScene = new Scenes.BaseScene('values');

// Entry point for the scene
valuesScene.enter((ctx) => {
  ctx.session.page = 0; // Initialize page number
  ctx.session.selectedValues = []; // Initialize selected values
  ctx.reply('Great! Now Please select the values that represent you the most:', showValuesKeyboard(ctx)).catch((error) => {console.log(error)  });
});


// Function to display values page
function showValuesKeyboard(ctx) {
  const page = ctx.session.page;
  const buttons = values.slice(page * valuesPerPage, (page + 1) * valuesPerPage)
    .map(value => [Markup.button.callback((ctx.session.selectedValues[value]?'✅ ' :'☑️ ' ) + value, `value_${value}`)]);

  // Add navigation buttons
  if (page > 0) buttons.push([Markup.button.callback('<', 'prev_page')]);
  if (page < Math.ceil(values.length / valuesPerPage) - 1) buttons.push([Markup.button.callback('>', 'next_page')]);
  buttons.push([Markup.button.callback('Done', 'done_picking')]);
  return Markup.inlineKeyboard(buttons);
 //ctx.editMessageText('Great! Now Please select the values that represent you the most:',  Markup.inlineKeyboard(buttons)).catch((error) => {console.log(error)  });
 
}



// Handle value selection
values.forEach(value => {
  valuesScene.action(`value_${value}`, (ctx) => {
    // Add the selected value to the user's session or database
    // if (ctx.session.selectedValues[value])
    //   ctx.session.selectedValues[value]=false;
    // else
    //   ctx.session.selectedValues[value]=true;
    ctx.session.selectedValues[value] = !ctx.session.selectedValues[value];
    ctx.editMessageText('Please select the values that represent you the most:', showValuesKeyboard(ctx)).catch((error) => {console.log(error)  });
    //showValuesPage(ctx); // Refresh the page to allow further selection
  });
});

// Handle page navigation
valuesScene.action('prev_page', (ctx) => {
  ctx.session.page--;
  ctx.editMessageText('Please select the values that represent you the most:', showValuesKeyboard(ctx)).catch((error) => {console.log(error)  });
});

valuesScene.action('next_page', (ctx) => {
  ctx.session.page++;
  ctx.editMessageText('Please select the values that represent you the most:', showValuesKeyboard(ctx)).catch((error) => {console.log(error)  });
});

valuesScene.action('done_picking', (ctx) => {
  if (!ctx.session.wizard) {
    // save the new data to the database
    ctx.session.db.gun.get(ctx.from.id.toString()).get('values').put(ctx.session.values);
    valuesScene.leave();
    ctx.session.sceneStack.pop();
    ctx.scene.enter(ctx.session.sceneStack[ctx.session.sceneStack.length-1]);
    return
  }

  ctx.session.stage += 1
  ctx.session.values = Object.keys(ctx.session.selectedValues)
  if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
});

// Export the scene
export default valuesScene;
