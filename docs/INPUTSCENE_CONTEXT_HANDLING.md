# InputScene Context Handling - Critical Information

## ⚠️ IMPORTANT: Context Parameter Behavior

When using InputScene, the `ctx` parameter passed to your `onComplete` callback is **NOT** the same context from when you called `ctx.scene.enter()`.

### The Problem

```javascript
// ❌ WRONG - This will cause issues
async buy(ctx) {
    const holonId = ctx.chat.id;  // From command context
    const language = await this.settings.getLanguage(holonId);

    if (!items || items.length === 0) {
        return ctx.scene.enter('input_scene', {
            promptText: 'Enter items:',
            onComplete: async (ctx, items) => {
                // holonId and language here are from CLOSURE, not fresh ctx
                // This may work in some cases but is unreliable
                await this.db.put(holonId + '/shopping', items);  // ❌ BAD
            }
        });
    }
}
```

**Why this is wrong:**
- The `holonId` variable is captured from the original command context
- When `onComplete` executes, it's in a different context (the user's text response)
- Using closure variables can lead to incorrect chat IDs, especially in group chats or with concurrent users

### The Solution

```javascript
// ✅ CORRECT - Always get values from callback ctx parameter
async buy(ctx) {
    const language = await this.settings.getLanguage(ctx.chat.id);

    if (!items || items.length === 0) {
        return ctx.scene.enter('input_scene', {
            promptText: utils.i18next.t('shoppingprompt', { lng: language }),
            inputType: 'array',
            onComplete: async (ctx, items) => {
                // Get holonId FRESH from the callback ctx parameter
                const holonId = ctx.chat.id;  // ✅ GOOD
                const lang = await this.settings.getLanguage(holonId);

                // Now use the fresh values
                for (let item of items) {
                    await this.db.put(holonId + '/shopping', {
                        id: item,
                        done: false,
                        from: ctx.from.username  // Also fresh from callback ctx
                    });
                }

                await ctx.reply(utils.i18next.t('shoppingadded', {
                    items: items.join(", "),
                    lng: lang
                }));
            }
        });
    }
}
```

---

## 📋 Context Flow Diagram

```
User sends: /buy
    ↓
Command handler executes
    ctx = {chat: {id: 123}, from: {id: 456}, message: {text: '/buy'}}
    ↓
ctx.scene.enter('input_scene', {...})
    ↓
Bot asks: "Please enter items:"
    ↓
User sends: "milk, bread"
    ↓
InputScene text handler executes
    ctx = {chat: {id: 123}, from: {id: 456}, message: {text: 'milk, bread'}}  ← DIFFERENT MESSAGE
    ↓
onComplete(ctx, ['milk', 'bread']) called
    ↓
Callback executes with NEW ctx (from "milk, bread" message)
```

**Key Point:** The `ctx` in `onComplete` is from the user's text response, NOT from the `/buy` command.

---

## ✅ Best Practices

### 1. Always Use Callback Context

```javascript
// ✅ CORRECT
onComplete: async (ctx, input) => {
    const holonId = ctx.chat.id;           // Get from callback ctx
    const userID = ctx.from.id;           // Get from callback ctx
    const username = ctx.from.username;   // Get from callback ctx
    const language = await this.settings.getLanguage(holonId);

    // Use these fresh values
    await this.db.put(holonId + '/data', {
        value: input,
        user: userID
    });
}
```

### 2. Don't Rely on Closures for Context Data

```javascript
// ❌ WRONG
const holonId = ctx.chat.id;
const userID = ctx.from.id;

onComplete: async (ctx, input) => {
    await this.db.put(holonId + '/data', input);  // BAD - uses closure variable
}

// ✅ CORRECT
onComplete: async (ctx, input) => {
    const holonId = ctx.chat.id;  // Get fresh
    await this.db.put(holonId + '/data', input);  // GOOD - uses fresh value
}
```

### 3. Pre-fetch Values Only for Prompts

```javascript
// ✅ CORRECT - Pre-fetch for prompt display only
const language = await this.settings.getLanguage(ctx.chat.id);

return ctx.scene.enter('input_scene', {
    promptText: utils.i18next.t('some_prompt', { lng: language }),  // OK - used in prompt
    onComplete: async (ctx, input) => {
        // Get fresh language for response
        const callbackLang = await this.settings.getLanguage(ctx.chat.id);
        await ctx.reply(utils.i18next.t('success', { lng: callbackLang }));
    }
});
```

### 4. Bind `this` if Needed

```javascript
// ✅ CORRECT - Bind this to access class methods
return ctx.scene.enter('input_scene', {
    promptText: 'Enter data:',
    onComplete: async (ctx, input) => {
        const holonId = ctx.chat.id;
        await this.processData(ctx, holonId, input);  // this.processData works
    }.bind(this)  // Bind if you're not using arrow functions
});

// OR with arrow functions (automatic binding)
return ctx.scene.enter('input_scene', {
    promptText: 'Enter data:',
    onComplete: async (ctx, input) => {
        const holonId = ctx.chat.id;
        await this.processData(ctx, holonId, input);  // this.processData works
    }  // Arrow function automatically binds this
});
```

---

## 🔍 Common Mistakes

### Mistake 1: Using Command Context Variables

```javascript
// ❌ WRONG
async myCommand(ctx) {
    const holonId = ctx.chat.id;

    return ctx.scene.enter('input_scene', {
        onComplete: async (ctx, input) => {
            await this.db.put(holonId + '/data', input);  // BAD
        }
    });
}

// ✅ CORRECT
async myCommand(ctx) {
    return ctx.scene.enter('input_scene', {
        onComplete: async (ctx, input) => {
            const holonId = ctx.chat.id;  // GOOD
            await this.db.put(holonId + '/data', input);
        }
    });
}
```

### Mistake 2: Mixing Old and New Context

```javascript
// ❌ WRONG
async myCommand(ctx) {
    const userID = ctx.from.id;  // From command

    return ctx.scene.enter('input_scene', {
        onComplete: async (ctx, input) => {
            const holonId = ctx.chat.id;  // From callback (GOOD)
            await this.db.put(holonId + '/users/' + userID + '/data', input);  // BAD - mixed contexts
        }
    });
}

// ✅ CORRECT
async myCommand(ctx) {
    return ctx.scene.enter('input_scene', {
        onComplete: async (ctx, input) => {
            const holonId = ctx.chat.id;    // From callback
            const userID = ctx.from.id;    // From callback
            await this.db.put(holonId + '/users/' + userID + '/data', input);  // GOOD
        }
    });
}
```

### Mistake 3: Pre-fetching Database Objects

```javascript
// ❌ WRONG
async myCommand(ctx) {
    const user = await this.db.get('users', ctx.from.id);  // Pre-fetched

    return ctx.scene.enter('input_scene', {
        onComplete: async (ctx, input) => {
            user.name = input;
            await this.db.put('users', user);  // BAD - user might be stale
        }
    });
}

// ✅ CORRECT
async myCommand(ctx) {
    return ctx.scene.enter('input_scene', {
        onComplete: async (ctx, input) => {
            // Fetch fresh from database in callback
            const user = await this.db.get('users', ctx.from.id);
            user.name = input;
            await this.db.put('users', user);  // GOOD
        }
    });
}
```

---

## 📚 Real Examples from HolonsBot

### Shopping.js - Correct Implementation

```javascript
async buy(ctx) {
    let holonId = ctx.chat.id;
    const language = await this.settings.getLanguage(holonId);
    const type = ctx.message.text.split(' ')[0].replace('/', '');
    let items = utils.parseList(ctx.message.text);

    if (!items || items.length === 0) {
        // Language pre-fetched for prompt only
        return ctx.scene.enter('input_scene', {
            promptText: utils.i18next.t('shoppingprompt', { lng: language }),
            inputType: 'array',
            allowEmpty: false,
            onComplete: async (ctx, items) => {
                // ✅ Get fresh values from callback ctx
                const callbackholonId = ctx.chat.id;
                const callbackLanguage = await this.settings.getLanguage(callbackholonId);

                // Use fresh values
                for (let item of items) {
                    await this.db.put(callbackholonId + '/shopping', {
                        id: item,
                        done: false,
                        from: ctx.from.username  // Also from callback ctx
                    });
                }

                await ctx.reply(utils.i18next.t('shoppingadded', {
                    items: items.join(", "),
                    lng: callbackLanguage
                }));
            }
        });
    }

    // Direct command execution
    for (let item of items) {
        await this.db.put(holonId + '/shopping', { id: item, done: false, from: ctx.from.username });
    }
    ctx.reply(utils.i18next.t('shoppingadded', { items: items.join(", "), lng: language }));
}
```

### Announcements.js - Correct Implementation

```javascript
async announce(ctx) {
    let holonId = ctx.chat.id;
    let messageID = ctx.message.message_id;
    const language = await this.settings.getLanguage(holonId);
    const message = ctx.message.text.split(' ').slice(1).join(' ');

    if (!message || message.length === 0 || message === '') {
        return ctx.scene.enter('input_scene', {
            promptText: utils.i18next.t('announcementprompt', { lng: language }),
            allowEmpty: false,
            onComplete: async (callbackCtx, message) => {
                // ✅ Pass the fresh callback context to the method
                await this.createAndPublishAnnouncement(callbackCtx, message);
            }
        });
    }

    // Direct command execution
    await this.createAndPublishAnnouncement(ctx, message);
}
```

---

## 🎯 Quick Checklist

Before committing code that uses InputScene:

- [ ] Are you getting `holonId` from the callback `ctx` parameter?
- [ ] Are you getting `userID` from the callback `ctx.from.id`?
- [ ] Are you getting any user info from the callback `ctx`?
- [ ] Are you re-fetching language settings in the callback?
- [ ] Are you avoiding closure variables for context data?
- [ ] Are you only pre-fetching values needed for the prompt text?
- [ ] Have you tested in a group chat to ensure it works?

---

## 🚨 Why This Matters

**In Private Chats:**
- Usually works even with closures because `ctx.chat.id` doesn't change

**In Group Chats:**
- Multiple users might trigger commands simultaneously
- Context can get mixed up between users
- Closure variables can cause data to be saved to wrong chat/user

**Best Practice:**
Always use fresh context from callback parameters to ensure correct behavior in all scenarios.

---

## 📝 Summary

### ✅ DO:
- Get ALL context values from the callback `ctx` parameter
- Pre-fetch only what's needed for prompt display
- Pass fresh context to helper methods

### ❌ DON'T:
- Use closure variables for `holonId`, `userID`, etc.
- Pre-fetch database objects before entering scene
- Mix command context and callback context

### 🎯 Golden Rule:
**If you need it in the callback, get it from the callback `ctx` parameter.**
