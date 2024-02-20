import { Scenes, Markup } from 'telegraf';

// Create a scene for offboarding
const welcomeScene = new Scenes.BaseScene('welcome');

// Entry point for the scene
welcomeScene.enter((ctx) => { 
  ctx.session.db.gun.get('Holons').get(ctx.from.id.toString()).once((data, key) => {
    if (data) {
      ctx.session.sceneStack = []; // Initialize the stack if it doesn't exist
      ctx.session.sceneStack.push('welcome'); // Add the current scene to the stack
      ctx.reply('Welcome back to our onboarding process! Would you like to make some changes to your profile?', Markup.inlineKeyboard([
        
        [Markup.button.callback('See Profile', 'profile'), Markup.button.callback('Restart Wizard', 'wizard')],
        [Markup.button.callback('Change Profile', 'change'), Markup.button.callback('Reset Profile', 'delete')]
      
      ]))
    } else {
      wizard(ctx)
    }
  })

  welcomeScene.action('profile', (ctx) => {
    ctx.session.db.gun.get('Holons').get(ctx.from.id.toString()).once((data, key) => {
      ctx.reply('Your profile is as follows:\n\n' + JSON.stringify(data))
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

  welcomeScene.action('delete', (ctx) => {
    ctx.session.db.gun.get('holons/users').get(ctx.from.id.toString()).put(null)
    ctx.reply('Your profile has been deleted, type /start to create a new profile')
  })

  welcomeScene.action('name', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('values'); ctx.scene.enter('values') })
  welcomeScene.action('location', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('location'); ctx.scene.enter('location') })
  welcomeScene.action('hexagon', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('hexagon'); ctx.scene.enter('h3') })
  welcomeScene.action('values', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('values');  ctx.scene.enter('values') })
  welcomeScene.action('category', (ctx) => { ctx.session.wizard = false;ctx.session.sceneStack.push('categories');  ctx.scene.enter('categories') })
  welcomeScene.action('enquiry', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('questions');  ctx.scene.enter('questions') })
  welcomeScene.action('video', (ctx) => { ctx.session.wizard = false; ctx.session.sceneStack.push('video');  ctx.scene.enter('video') })

  function wizard(ctx){
    ctx.reply('Welcome to our onboarding process! I am your personal assistant. I will guide you through the process of creating your profile.');
    ctx.session.wizard = true;
    ctx.session.id = ctx.from.id;
    ctx.session.username = ctx.from.username;
    ctx.session.first_name = ctx.from.first_name;
    ctx.session.last_name = ctx.from.last_name;

    ctx.session.stage += 1;
    ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
  }

});

// Export the scene
export default welcomeScene
