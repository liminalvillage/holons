import { Scenes, Markup } from 'telegraf';

// Create a scene for video input - using InputScene pattern
const videoScene = new Scenes.BaseScene('video');

// Entry point for the scene
videoScene.enter((ctx) => {
  // Use InputScene for video input
  ctx.scene.enter('input_scene', {
    promptText: 'We would like you to share a 1-minute video explaining your story using the following framework:\n\n- A Story of Self: Share something personal about yourself.\n- A Story of Us: Share something about the community you belong to or want to create.\n- A Story of Now: Share what motivates you right now.\n\nPlease upload your video now.',
    allowMedia: true,
    allowedMediaTypes: ['video'],
    requireMedia: true,
    showCancelButton: true,
    onComplete: async (ctx, media) => {
      // Store the video in session
      ctx.session.video = media.file;

      if (!ctx.session.wizard) {
        // save the new data to the database
        ctx.session.db.gun.get(ctx.from.id.toString()).get('video').put(ctx.session.video);
        if (ctx.session.sceneStack) {
          ctx.session.sceneStack.pop();
          if (ctx.session.sceneStack.length > 0) {
            ctx.scene.enter(ctx.session.sceneStack[ctx.session.sceneStack.length - 1]);
          }
        }
        return;
      }

      ctx.session.stage += 1;
      if (ctx.session.stage === ctx.session.sequence.length) {
        ctx.scene.enter('done');
      } else {
        ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
      }
    },
    onCancel: async (ctx) => {
      // Handle cancellation - return to previous scene or leave
      if (ctx.session.sceneStack && ctx.session.sceneStack.length > 0) {
        ctx.session.sceneStack.pop();
        if (ctx.session.sceneStack.length > 0) {
          ctx.scene.enter(ctx.session.sceneStack[ctx.session.sceneStack.length - 1]);
        }
      }
    }
  });
});

// Export the scene
export default videoScene;
