import { Scenes, Markup } from 'telegraf';

// Create a scene for onboarding
const saveprofileScene = new Scenes.BaseScene('saveprofile');

// Entry point for the scene
saveprofileScene.enter((ctx) => {
  let message = 'Thread:'+ ctx.session.thread+'\n'
  ctx.session.public? message += 'Public:'+ctx.session.public+'\n':
  ctx.session.location? message += 'Location:'+ctx.session.location+'\n':
  ctx.session.values? message += 'Values:'+ctx.session.values+'\n':
  ctx.session.enquiry? message += 'Enquiry:'+ctx.session.enquiry+'\n':
  ctx.session.category? message += 'Category:'+ctx.session.category+'\n':
  ctx.session.name? message += 'Name:'+ctx.session.name+'\n':
  ctx.session.video? message +=  'Video:'+ctx.session.video+'\n':
  ctx.session.email? message += 'Email:'+ctx.session.email+'\n':
  ctx.session.phone? message += 'Phone:'+ctx.session.phone+'\n':
  ctx.session.website? message += 'Website:'+ctx.session.website+'\n':
  ctx.session.twitter? message += 'Twitter:'+ctx.session.twitter+'\n':
  ctx.session.facebook? message += 'Facebook:'+ctx.session.facebook+'\n':
  ctx.session.instagram? message += 'Instagram:'+ctx.session.instagram+'\n':
  ctx.session.linkedin? message += 'Linkedin:'+ctx.session.linkedin+'\n':
  ctx.session.youtube? message += 'Youtube:'+ctx.session.youtube+'\n':
  ctx.session.github? message += 'Github:'+ctx.session.github+'\n':
  ctx.session.medium? message += 'Medium:'+ctx.session.medium+'\n':
  ctx.session.tiktok? message += 'Tiktok:'+ctx.session.tiktok+'\n':
  ctx.session.twitch? message += 'Twitch:'+ctx.session.twitch+'\n':

  ctx.reply(ctx.session.toString())
  ctx.reply('Would you wish to make your answers public?', Markup.inlineKeyboard([
    [Markup.button.callback('Yes', 'public'), Markup.button.callback('No', 'private')]
  ]));
});

saveprofileScene.action('public', (ctx) => {
  ctx.session.public = true;
  ctx.session.stage +=1;
  ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
});

saveprofileScene.action('private', (ctx) => {
  ctx.session.public = false;
  ctx.session.stage +=1;
  if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
});


// Export the scene
export default saveprofileScene;
