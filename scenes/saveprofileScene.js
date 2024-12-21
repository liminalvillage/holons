import { Scenes, Markup, session } from 'telegraf';

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


  ctx.reply(message)
  ctx.reply('Would you wish to make your answers public?', Markup.inlineKeyboard([
    [Markup.button.callback('Yes', 'public'), Markup.button.callback('No', 'private')]
  ]));
});

saveprofileScene.action('public', (ctx) => {
  let userID = ctx.chat.id
  ctx.session.public = true;
  ctx.session.stage +=1;
  ctx.session.id = ctx.from.id
  console.log(ctx.session)
  //store data in the db
  ctx.session.db.holosphere.put(userID,"profile",createProfile(ctx.session))
  if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
});

saveprofileScene.action('private', (ctx) => {
  ctx.session.public = false;
  console.log(ctx.session)
  if (!ctx.session.wizard) {
    // save the new data to the database
    //ctx.session.db.gun.get(ctx.from.id.toString()).get('video').put(ctx.session.video);
    ctx.session.sceneStack.pop();
    ctx.scene.enter(ctx.session.sceneStack[ctx.session.sceneStack.length-1]);
    return
  }
  ctx.session.stage +=1;
  if (ctx.session.stage === ctx.session.sequence.length) ctx.scene.enter('done');
  else ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
});

function createProfile(session){
  var profile = {}
  profile.id = session.id
  profile.username = session.username
  profile.first_name = session.first_name
  profile.last_name = session.last_name
  profile.public = session.public
  profile.location = session.location
  profile.values = session.values
  profile.requirements = session.requirements
  profile.responses = session.responses
  profile.category = session.category
  profile.name = session.name
  profile.arrival = session.arrival
  profile.departure = session.departure
  profile.hex =session.hex
  console.log(profile)
  return profile
}

// Export the scene
export default saveprofileScene;
