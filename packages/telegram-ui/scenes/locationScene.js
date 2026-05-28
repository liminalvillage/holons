import { Scenes } from 'telegraf';

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

      if (!ctx.session.wizard) {
        // save the new data to the database
        ctx.session.db.gun
          .get(ctx.from.id.toString())
          .get('location')
          .put(ctx.session.location);
        if (ctx.session.sceneStack) {
          ctx.session.sceneStack.pop();
          if (ctx.session.sceneStack.length > 0) {
            ctx.scene.enter(
              ctx.session.sceneStack[ctx.session.sceneStack.length - 1]
            );
          }
        }
        return;
      }

      ctx.session.stage += 1;
      if (!ctx.session.sequence) {
        ctx.scene.leave();
        return;
      }
      if (ctx.session.stage === ctx.session.sequence.length) {
        ctx.scene.enter('done');
      } else {
        ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
      }
    },
    onCancel: async ctx => {
      // Handle cancellation - return to previous scene or leave
      if (ctx.session.sceneStack && ctx.session.sceneStack.length > 0) {
        ctx.session.sceneStack.pop();
        if (ctx.session.sceneStack.length > 0) {
          ctx.scene.enter(
            ctx.session.sceneStack[ctx.session.sceneStack.length - 1]
          );
        }
      }
    },
  });
});

// Export the scene
export default locationScene;
