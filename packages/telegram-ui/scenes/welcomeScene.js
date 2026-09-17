import { Scenes, Markup } from 'telegraf';
import { clearDna, readDna } from '../src/dna.js';
import {
  DEFAULT_SEQUENCE,
  editFromMenu,
  nextStep,
  startSequence,
} from './flow.js';

// Create a scene for offboarding
const welcomeScene = new Scenes.BaseScene('welcome');

// Entry point for the scene
welcomeScene.enter(async ctx => {
  const holonId = ctx.chat.id;

  if (holonId < 0) {
    // Group Chats
    await ctx.reply(
      'Welcome to our community onboarding process! Please answer the following questions from the community perspective to create your DNA'
    );
    return ctx.scene.enter('dna');
  }

  // Check existing profile for individual users
  try {
    const data = await readDna(ctx.session.db, ctx.from.id);

    if (data) {
      return ctx.reply(
        'Welcome back! Would you like to make some changes to your DNA?',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('See DNA', 'DNA'),
            Markup.button.callback('Restart Wizard', 'wizard'),
          ],
          [
            Markup.button.callback('Change Profile', 'change'),
            Markup.button.callback('Reset Profile', 'delete'),
          ],
        ])
      );
    } else {
      return wizard(ctx);
    }
  } catch (error) {
    console.error('Error fetching profile:', error);
    return ctx.reply('Sorry, there was an error. Please try again.');
  }
});

// Action handlers
welcomeScene.action('DNA', async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const data = await readDna(ctx.session.db, ctx.from.id);
  ctx.reply('Your current DNA:\n\n' + JSON.stringify(data, null, 2));
});

welcomeScene.action('change', async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    'What would you like to change?',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('Name', 'name'),
        Markup.button.callback('Location', 'location'),
      ],
      [
        Markup.button.callback('Values', 'values'),
        Markup.button.callback('Category', 'category'),
      ],
      [
        Markup.button.callback('Enquiry', 'enquiry'),
        Markup.button.callback('Hexagon', 'hexagon'),
      ],
    ])
  );
});

welcomeScene.action('wizard', async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  return wizard(ctx);
});

welcomeScene.action('dnawizard', async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  return dnawizard(ctx);
});

welcomeScene.action('delete', async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  await clearDna(ctx.session.db, ctx.from.id);
  await ctx.reply('Your DNA has been deleted, type /start to create a new DNA');
});

// Scene navigation actions
const sceneMap = {
  name: 'values',
  location: 'location',
  hexagon: 'h3',
  values: 'values',
  category: 'categories',
  enquiry: 'questions',
  video: 'video',
};

Object.entries(sceneMap).forEach(([action, targetScene]) => {
  welcomeScene.action(action, async ctx => {
    await ctx.answerCbQuery().catch(() => {});
    return editFromMenu(ctx, 'welcome', targetScene);
  });
});

function wizard(ctx) {
  ctx.session.id = ctx.from.id;
  ctx.session.username = ctx.from.username;
  ctx.session.first_name = ctx.from.first_name;
  ctx.session.last_name = ctx.from.last_name;

  // Reached as the opening step of a run (/onboarding): carry on with it.
  // From a bare menu there is no run to continue — start the default one.
  if (ctx.session.sequence?.[ctx.session.stage] === 'welcome') {
    ctx.session.wizard = true;
    return nextStep(ctx);
  }
  return startSequence(ctx, DEFAULT_SEQUENCE);
}

function dnawizard(ctx) {
  ctx.session.wizard = false;
  return ctx.scene.enter('dna');
}

export default welcomeScene;
