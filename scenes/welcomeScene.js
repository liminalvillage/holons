import { Scenes, Markup } from 'telegraf';

// Create a scene for offboarding
const welcomeScene = new Scenes.BaseScene('welcome');

// Entry point for the scene
welcomeScene.enter((ctx) => {
  const chatID = ctx.chat.id;

  if (chatID < 0) {// Group Chats
    ctx.reply('Welcome to our community onbording process! Please aswer the following questions from the commmunity perspective create your DNA');
    ctx.scene.enter('dna')

    ctx.session.sceneStack = []; // Initialize the stack if it doesn't exist
    ctx.session.sceneStack.push('welcome'); // Add the current scene to the stack
    ctx.reply('Welcome back! Would you like to make some changes to your DNA?', Markup.inlineKeyboard([

      [Markup.button.callback('See DNA', 'DNA'), Markup.button.callback('Restart Wizard', 'dnawizard')],
      [Markup.button.callback('Change DNA', 'change'), Markup.button.callback('Reset DNA', 'delete')]

    ]))
  
    return
  }
  ctx.session.db.gun.get(ctx.from.id.toString()).once((data, key) => {
  if (data) {
    ctx.session.sceneStack = []; // Initialize the stack if it doesn't exist
    ctx.session.sceneStack.push('welcome'); // Add the current scene to the stack
    ctx.reply('Welcome back! Would you like to make some changes to your DNA?', Markup.inlineKeyboard([

      [Markup.button.callback('See DNA', 'DNA'), Markup.button.callback('Restart Wizard', 'wizard')],
      [Markup.button.callback('Change Profile', 'change'), Markup.button.callback('Reset Profile', 'delete')]

    ]))
  } else {
    wizard(ctx)
  }
})

  welcomeScene.action('DNA', (ctx) => {
  ctx.session.db.gun.get(ctx.from.id.toString()).once((data, key) => {
    ctx.reply('Your current DNA:\n\n' + JSON.stringify(data))
  })
})

  welcomeScene.action('change', (ctx) => {
  ctx.reply('What would you like to change?', Markup.inlineKeyboard([
    [Markup.button.callback('Name', 'name'), Markup.button.callback('Location', 'location')],
    [Markup.button.callback('Values', 'values'), Markup.button.callback('Category', 'category')],
    [Markup.button.callback('Enquiry', 'enquiry'), Markup.button.callback('Hexagon', 'hexagon')]
  ]
  ))
})

  welcomeScene.action('wizard', (ctx) => wizard(ctx))
  welcomeScene.action('dnawizard', (ctx) => dnawizard(ctx))

  welcomeScene.action('delete', (ctx) => {
  ctx.session.db.gun.get('users').get(ctx.from.id.toString()).put(null)
  ctx.reply('Your DNA has been deleted, type /start to create a new DNA')
})

  welcomeScene.action('name', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('values'); ctx.scene.enter('values') })
  welcomeScene.action('location', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('location'); ctx.scene.enter('location') })
  welcomeScene.action('hexagon', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('hexagon'); ctx.scene.enter('h3') })
  welcomeScene.action('values', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('values'); ctx.scene.enter('values') })
  welcomeScene.action('category', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('categories'); ctx.scene.enter('categories') })
  welcomeScene.action('enquiry', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('questions'); ctx.scene.enter('questions') })
  welcomeScene.action('video', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('video'); ctx.scene.enter('video') })

  function wizard(ctx) {
    ctx.reply('Welcome to the personal onboarding process! I will guide you through the process of creating your DNA.');
    ctx.session.wizard = true;
    ctx.session.id = ctx.from.id;
    ctx.session.username = ctx.from.username;
    ctx.session.first_name = ctx.from.first_name;
    ctx.session.last_name = ctx.from.last_name;

    ctx.session.stage += 1;
    ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
  }

  function dnawizard(ctx) {
    ctx.reply('Welcome to the community onboarding process! I will guide you through the process of creating your community DNA.');
    ctx.session.wizard = false;
    ctx.scene.enter('dna')
  }

});

// Export the scene
export default welcomeScene
