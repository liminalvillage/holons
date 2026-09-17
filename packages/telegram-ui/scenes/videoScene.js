import { Scenes } from 'telegraf';
import { backToMenu, completeStep } from './flow.js';

// Create a scene for video input - using InputScene pattern
const videoScene = new Scenes.BaseScene('video');

// Entry point for the scene
videoScene.enter(ctx => {
  // Use InputScene for video input
  ctx.scene.enter('input_scene', {
    promptText:
      'We would like you to share a 1-minute video explaining your story using the following framework:\n\n- A Story of Self: Share something personal about yourself.\n- A Story of Us: Share something about the community you belong to or want to create.\n- A Story of Now: Share what motivates you right now.\n\nPlease upload your video now.',
    allowMedia: true,
    allowedMediaTypes: ['video'],
    requireMedia: true,
    showCancelButton: true,
    onComplete: async (ctx, media) => {
      // Store the video in session
      ctx.session.video = media.file;
      return completeStep(ctx, { video: ctx.session.video });
    },
    onCancel: async ctx => backToMenu(ctx),
  });
});

// Export the scene
export default videoScene;
