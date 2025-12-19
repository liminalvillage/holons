# InputScene Migration Guide

## Overview

The `InputScene` utility provides a consistent, reusable way to collect user input across HolonsBot. This guide shows where the InputScene is registered and how to use it.

---

## ✅ Registration Location

The InputScene is registered in the service container and automatically initialized when the bot starts:

### File: `/core/ServiceDefinitions.js`

**Line 36:** Import added
```javascript
import InputScene from '../utils/InputScene.js';
```

**Lines 200-209:** Service definition added
```javascript
// InputScene - Utility scene for collecting user input
inputScene: {
  factory: ({ telebot }) => {
    const inputScene = new InputScene(telebot);
    log.info('InputScene utility initialized and registered');
    return inputScene;
  },
  singleton: true,
  dependencies: ['telebot'],
},
```

The InputScene is registered as `'input_scene'` and is available globally via:
```javascript
ctx.scene.enter('input_scene', { /* options */ })
```

---

## 📍 Where to Use InputScene

### High Priority Replacements

1. **Quests.js:52-84** - Quest description input
2. **Checklists.js:114-203** - Add checklist items
3. **Checklists.js:212-275** - New checklist title
4. **Roles.js:60-143** - Add role with title/description
5. **Roles.js:146-212** - Edit role

### Medium Priority Replacements

6. **Holons.js:102-178** - Token balance address input
7. **Holons.js:180-249** - Claim wallet address
8. **Holons.js:251-383** - Reward distribution (token + amount)
9. **Settings.js:962-1046** - Add array items scene
10. **Settings.js:1075-1141** - Text input scene
11. **Settings.js:1144-1206** - Array input scene
12. **SettingsScenes.js:101-128** - Purpose input
13. **SettingsScenes.js:131-159** - Name input
14. **SettingsScenes.js:162-205** - Domains input
15. **SettingsScenes.js:207-242** - Values input
16. **SettingsScenes.js:244-276** - Roles input
17. **SettingsScenes.js:278-307** - Admin ID input
18. **SettingsScenes.js:309-354** - Hex location input
19. **SettingsScenes.js:389-421** - Add test
20. **SettingsScenes.js:423-464** - Federation holon ID
21. **SettingsScenes.js:466-510** - Toggle user membership
22. **SettingsScenes.js:512-556** - Add user by ID

### Command Parameter Fallbacks

23. **Shopping.js:17-30** - `/buy` command (when no items provided)
24. **Expenses.js** - Expense commands (when amount/currency missing)
25. **Announcements.js** - `/announce` command (when message missing)
26. **Tags.js** - `/tag` and `/gettag` commands
27. **Scheduler.js** - `/recurring` command parameter collection

---

## 🔄 Complete Migration Example: Quest Description

### BEFORE (Quests.js:52-84)

```javascript
setupScenes() {
    this.descriptionScene = new Scenes.BaseScene('description_scene');

    this.descriptionScene.enter(async (ctx) => {
        const quest = await this.db.get(ctx.scene.state.holonId + '/quests', ctx.scene.state.questId.toString());
        const promptMessage = await ctx.reply('📝 Reply with a description for this task.');
        ctx.scene.state.promptMessageId = promptMessage.message_id;
    });

    this.descriptionScene.on('text', async (ctx) => {
        try {
            const quest = await this.db.get(ctx.scene.state.holonId + '/quests', ctx.scene.state.questId.toString());
            if (!await this.questExists(quest, ctx, ctx.scene.state.questId)) {
                return ctx.scene.leave();
            }

            quest.description = ctx.message.text;
            await this.db.put(ctx.scene.state.holonId + '/quests', quest);

            const botHasAdminRights = await isBotAdmin(ctx);
            if (botHasAdminRights) {
                if (ctx.scene.state.promptMessageId) {
                    await ctx.deleteMessage(ctx.scene.state.promptMessageId).catch(() => {});
                }
                await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
            }

            await this.updateMessage(ctx, quest);
            return ctx.scene.leave();
        } catch (error) {
            return ctx.scene.leave();
        }
    });

    this.bot.stage.register(this.descriptionScene);
}
```

**Total Lines:** 33 lines

---

### AFTER (Using InputScene)

```javascript
// Remove setupScenes() method entirely - no custom scene needed!

// In registerActions() method, modify the descriptions_quest_ action:
registerActions() {
    // ... other actions ...

    this.bot.action(/descriptions_quest_(.+)/, async (ctx) => {
        const questId = ctx.match[1];
        const holonId = getholonId(ctx);

        return ctx.scene.enter('input_scene', {
            promptKey: 'quest_description_prompt', // Translation key
            // OR use direct text:
            // promptText: '📝 Reply with a description for this task.',
            allowEmpty: false,
            validate: async (description, ctx) => {
                // Check if quest still exists
                const quest = await this.db.get(holonId + '/quests', questId);
                if (!await this.questExists(quest, ctx, questId)) {
                    return { valid: false, error: 'Quest no longer exists.' };
                }
                return { valid: true };
            },
            onComplete: async (ctx, description) => {
                const quest = await this.db.get(holonId + '/quests', questId);
                quest.description = description;
                await this.db.put(holonId + '/quests', quest);
                await this.updateMessage(ctx, quest);
            },
            onError: async (ctx, error) => {
                console.error('Error updating quest description:', error);
            }
        });
    });

    // ... other actions ...
}
```

**Total Lines:** 26 lines (22% reduction)

**Benefits:**
- ✅ Auto cleanup of messages (when bot has admin rights)
- ✅ Built-in error handling
- ✅ Translation support via `promptKey`
- ✅ Validation before processing
- ✅ Cancel support (`/cancel` command built-in)
- ✅ Consistent UX across all input collection

---

## 🎯 Migration Example: Checklist Items (Array Input)

### BEFORE (Checklists.js:114-203)

```javascript
this.addItemScene = new Scenes.BaseScene('add_checklist_item_scene');

this.addItemScene.enter(async (ctx) => {
    const canReadMessages = await isBotAdmin(ctx);
    let promptText;

    if (canReadMessages) {
        promptText = 'Please enter the new items (comma-separated for multiple items):';
    } else {
        promptText = 'Holons needs rights to read user input.\n\nAlternatively, you can use the /additem command followed by a comma-separated list: \n/additem item 1, item 2, item 3';
    }

    const promptMessage = await ctx.reply(promptText);
    ctx.scene.state.promptMessageId = promptMessage.message_id;
});

this.addItemScene.on('text', async (ctx) => {
    try {
        const holonId = getholonId(ctx);
        const checklistId = ctx.scene.state.checklistId;

        // Handle /additem command prefix
        let itemsText = ctx.message.text;
        if (itemsText.startsWith('/additem ')) {
            itemsText = itemsText.replace('/additem ', '');
        }

        // Split by comma
        const items = itemsText.split(',').map(i => i.trim()).filter(i => i);

        if (items.length === 0) {
            await ctx.reply('No items provided.');
            return ctx.scene.leave();
        }

        // Add items...
        for (const itemText of items) {
            const item = {
                id: Date.now() + Math.random(),
                text: itemText,
                completed: false
            };
            await this.db.push(holonId + '/checklists/' + checklistId + '/items', item);
        }

        // Cleanup messages
        const botHasAdminRights = await isBotAdmin(ctx);
        if (botHasAdminRights) {
            await ctx.deleteMessage(ctx.scene.state.promptMessageId).catch(() => {});
            await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
        }

        await this.displayChecklist(ctx, checklistId);
        return ctx.scene.leave();

    } catch (error) {
        console.error('Error adding items:', error);
        await ctx.reply('Error adding items.');
        return ctx.scene.leave();
    }
});

this.bot.stage.register(this.addItemScene);
```

**Total Lines:** 60+ lines

---

### AFTER (Using InputScene)

```javascript
// In the action handler that triggers adding items:
this.bot.action(/add_checklist_items_(.+)/, async (ctx) => {
    const checklistId = ctx.match[1];

    return ctx.scene.enter('input_scene', {
        promptKey: 'checklist_add_items_prompt',
        formatHint: i18next.t('checklist_format_hint'), // 'Format: item1, item2, item3'
        example: 'Buy milk, Clean room, Call mom',
        inputType: 'array', // Automatically splits by comma/newline
        allowEmpty: false,
        validate: (items) => {
            if (items.length === 0) {
                return {
                    valid: false,
                    error: i18next.t('checklist_no_items_error')
                };
            }
            return { valid: true };
        },
        onComplete: async (ctx, items) => {
            const holonId = getholonId(ctx);

            for (const itemText of items) {
                const item = {
                    id: Date.now() + Math.random(),
                    text: itemText,
                    completed: false,
                    createdAt: Date.now()
                };
                await this.db.push(holonId + '/checklists/' + checklistId + '/items', item);
            }

            await this.displayChecklist(ctx, checklistId);
        }
    });
});
```

**Total Lines:** 31 lines (48% reduction!)

**Additional Benefits:**
- ✅ Handles both comma AND newline separated lists
- ✅ Auto-trims whitespace
- ✅ Built-in empty validation
- ✅ No need to handle /additem prefix manually
- ✅ Automatic message cleanup

---

## 🔐 Migration Example: Ethereum Address Input

### BEFORE (Holons.js:180-249)

```javascript
this.claimScene = new Scenes.BaseScene('claim_scene');

this.claimScene.enter(async (ctx) => {
    await ctx.reply(`Please enter your wallet address on ${this.network} to claim tokens:`);
});

this.claimScene.on('text', async (ctx) => {
    try {
        const beneficiaryAddress = ctx.message.text.trim();

        if (!ethers.isAddress(beneficiaryAddress)) {
            await ctx.reply("Invalid address format. Please try again.");
            return;
        }

        // ... claim logic ...

        await ctx.scene.leave();

    } catch (error) {
        await ctx.reply('Error processing claim: ' + error.message);
        await ctx.scene.leave();
    }
});

this.bot.stage.register(this.claimScene);
```

---

### AFTER (Using InputScene)

```javascript
// In the claim command handler:
this.bot.command('claim', async (ctx) => {
    return ctx.scene.enter('input_scene', {
        promptText: `Please enter your wallet address on ${this.network} to claim tokens:`,
        example: '0x1234567890abcdef1234567890abcdef12345678',
        validate: (address) => {
            if (!ethers.isAddress(address)) {
                return {
                    valid: false,
                    error: 'Invalid Ethereum address format. Please check and try again.'
                };
            }
            return { valid: true };
        },
        onComplete: async (ctx, beneficiaryAddress) => {
            await this.processClaim(ctx, beneficiaryAddress);
        },
        onError: async (ctx, error) => {
            await ctx.reply('Error processing claim: ' + error.message);
        }
    });
});
```

**Benefits:**
- ✅ Cleaner validation logic
- ✅ Better error messages with example
- ✅ Centralized error handling

---

## 📋 InputScene API Reference

### Required Parameters

```javascript
ctx.scene.enter('input_scene', {
    onComplete: async (ctx, input) => {
        // Required: Called when valid input is received
    }
})
```

### Optional Parameters

```javascript
{
    // === Prompt Configuration ===
    promptKey: 'translation_key',           // i18next translation key
    promptText: 'Direct prompt text',       // OR direct text
    promptParams: { key: 'value' },         // Parameters for i18next

    // === Format Hints & Examples ===
    formatHint: 'Format: value1, value2',   // Format hint text
    formatHintKey: 'translation_key',       // OR i18next key
    formatHintParams: {},                   // Parameters for hint translation
    example: 'Example value',               // Example input

    // === Input Type & Validation ===
    inputType: 'text',                      // text|number|integer|email|url|array|boolean
    allowEmpty: false,                      // Allow empty input (default: false)
    allowLocation: false,                   // Accept location messages (default: false)

    // === Custom Validation ===
    validate: async (input, ctx) => {
        // Return true or { valid: true }
        // Return false or { valid: false, error: 'message' }
    },

    // === Transformation ===
    transform: async (input, ctx) => {
        // Transform input before onComplete
        return transformedInput;
    },

    // === Error Messages ===
    errorText: 'Validation error message',
    emptyErrorText: 'Empty input error',
    typeErrorText: 'Type validation error',
    nonTextErrorText: 'Non-text message error',
    cancelText: 'Cancelled message',

    // === Callbacks ===
    onComplete: async (ctx, input) => { },  // Required
    onCancel: async (ctx) => { },           // Optional
    onError: async (ctx, error) => { }      // Optional
}
```

### Built-in Input Types

| Type | Description | Example |
|------|-------------|---------|
| `text` | Plain text (default) | Any string |
| `number` | Numeric value | `123.45` → `123.45` |
| `integer` | Whole number | `42` → `42` |
| `email` | Email address | `user@example.com` |
| `url` | Web URL | `https://example.com` |
| `array` | Comma/newline separated | `a, b, c` → `['a', 'b', 'c']` |
| `boolean` | True/false | `yes` → `true` |

---

## 🌍 Translation Keys to Add

Add these keys to your locale files (`data/locales/*.json`):

```json
{
  "quest_description_prompt": "📝 Reply with a description for this task.",
  "checklist_add_items_prompt": "Please enter the new items:",
  "checklist_format_hint": "Format: item1, item2, item3",
  "checklist_no_items_error": "Please provide at least one item.",
  "role_add_prompt": "Please enter role details in format:\nTitle | Description\n\nDescription is optional.",
  "settings_enter_user_id": "Please enter the user ID:",
  "input_scene_default_prompt": "Please enter your input:",
  "input_scene_example": "Example:",
  "input_scene_cancelled": "Input cancelled.",
  "input_scene_empty_error": "Input cannot be empty. Please try again.",
  "input_scene_validation_error": "Invalid input. Please try again.",
  "input_scene_number_error": "Please enter a valid number.",
  "input_scene_integer_error": "Please enter a valid integer.",
  "input_scene_email_error": "Please enter a valid email address.",
  "input_scene_url_error": "Please enter a valid URL.",
  "input_scene_text_only": "Please send text only.",
  "input_scene_error": "An error occurred. Please try again."
}
```

---

## ⚡ Quick Migration Checklist

For each scene you're migrating:

1. ✅ Identify the current scene (search for `new Scenes.BaseScene`)
2. ✅ Find where it's triggered (look for `ctx.scene.enter('scene_name')`)
3. ✅ Extract the prompt message
4. ✅ Extract any validation logic
5. ✅ Extract the completion logic
6. ✅ Replace with `ctx.scene.enter('input_scene', { ... })`
7. ✅ Remove the old scene registration (`bot.stage.register`)
8. ✅ Add translation keys if using `promptKey`
9. ✅ Test the new flow
10. ✅ Remove old scene code

---

## 🚀 Benefits Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Lines of Code** | 30-60 lines per scene | 10-25 lines per use |
| **Consistency** | Varies by developer | Standardized |
| **Translation** | Manual i18next calls | Built-in via promptKey |
| **Validation** | Custom per scene | Reusable patterns |
| **Error Handling** | Custom per scene | Standardized |
| **Message Cleanup** | Manual implementation | Automatic |
| **Cancel Support** | Must implement | Built-in |
| **Maintainability** | High duplication | Single source of truth |

---

## 📝 Notes

- The InputScene is already registered and available globally
- No need to import or register it in individual modules
- Backward compatible - existing scenes continue to work
- Migrate modules incrementally, no breaking changes
- See `utils/InputScene.examples.js` for more examples

---

## 🔗 Related Files

- **Implementation:** `/utils/InputScene.js`
- **Registration:** `/core/ServiceDefinitions.js:200-209`
- **Examples:** `/utils/InputScene.examples.js`
- **This Guide:** `/docs/INPUT_SCENE_MIGRATION.md`
