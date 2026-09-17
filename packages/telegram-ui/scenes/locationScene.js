import { Scenes } from 'telegraf';
import { backToMenu, completeStep } from './flow.js';

// Create a scene for location input - using InputScene pattern
const locationScene = new Scenes.BaseScene('location');

// Entry point for the scene
locationScene.enter(ctx => {
  // Use InputScene for location input
  ctx.scene.enter('input_scene', {
    promptText: 'Please share your location using the paperclip icon below',
    allowLocation: true,
    requireMedia: false, // Don't require media, but allow location
    showCancelButton: true,
    onComplete: async (ctx, location) => {
      ctx.session.location = location;
      return completeStep(ctx, { location });
    },
    onCancel: async ctx => backToMenu(ctx),
  });
});

// Export the scene
export default locationScene;
