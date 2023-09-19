const { Scenes, Markup } = require('telegraf');

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
const onboardingScene = new Scenes.BaseScene('onboarding');

// Entry point for the scene
onboardingScene.enter((ctx) => {
  ctx.reply('Welcome to the onboarding process! We would like you to share a 1-minute video explaining your story using the following framework:\n\n- A Story of Self: Share something personal about yourself.\n- A Story of Us: Share something about the community you belong to or want to create.\n- A Story of Now: Share what motivates you right now.\n\nPlease upload your video now.');
});

// Handle video submission
onboardingScene.on('video', (ctx) => {
  ctx.session.page = 0; // Initialize page number
  ctx.session.selectedValues = []; // Initialize selected values
  showValuesPage(ctx);
});

// Function to display values page
function showValuesPage(ctx) {
  const page = ctx.session.page;
  const buttons = values.slice(page * valuesPerPage, (page + 1) * valuesPerPage)
    .map(value => Markup.button.callback(value, `value_${value}`));

  // Add navigation buttons
  if (page > 0) buttons.push(Markup.button.callback('<', 'prev_page'));
  if (page < Math.ceil(values.length / valuesPerPage) - 1) buttons.push(Markup.button.callback('>', 'next_page'));

  ctx.reply('Great! Now Please select the values that represent you the most:', Markup.inlineKeyboard(buttons).extra());
}

// Handle value selection
values.forEach(value => {
  onboardingScene.action(`value_${value}`, (ctx) => {
    // Add the selected value to the user's session or database
    ctx.session.selectedValues.push(value);
    ctx.reply(`You have selected ${value}.`);
    showValuesPage(ctx); // Refresh the page to allow further selection
  });
});

// Handle page navigation
onboardingScene.action('prev_page', (ctx) => {
  ctx.session.page--;
  showValuesPage(ctx);
});

onboardingScene.action('next_page', (ctx) => {
  ctx.session.page++;
  showValuesPage(ctx);
});

// Export the scene
module.exports = onboardingScene;
