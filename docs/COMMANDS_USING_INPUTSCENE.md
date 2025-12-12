# Commands That Can Use InputScene

## Current Status: NO COMMANDS USE IT YET

The InputScene utility has been created and registered, but **no commands currently use it**. This document shows which commands **should** be updated to use InputScene when users don't provide required parameters.

---

## Commands That Should Use InputScene

### 1. Shopping Commands ✅ HIGH PRIORITY

**File:** `Shopping.js:11`
**Commands:** `/buy`, `/comprare`, `/compra`, `/bring`

**Current Behavior (Lines 17-30):**
```javascript
async buy(ctx) {
    let items = utils.parseList(ctx.message.text)
    if (!items || items.length === 0) {
        ctx.reply(utils.i18next.t('shoppingusage', { type: type, lng: language }));
        return;  // ❌ Just shows usage, doesn't help user
    }
    // ... add items
}
```

**Problem:** When user types `/buy` without items, they just get a usage message. They have to type the command again.

**Should Be:**
```javascript
async buy(ctx) {
    let items = utils.parseList(ctx.message.text)

    if (!items || items.length === 0) {
        // No items provided, ask for them using InputScene
        return ctx.scene.enter('input_scene', {
            promptKey: 'shopping_list_prompt',
            formatHint: i18next.t('shopping_format_hint'),
            example: 'Milk, Bread, Eggs',
            inputType: 'array',
            onComplete: async (ctx, items) => {
                await this.addItems(ctx, items);
            }
        });
    }

    // Items provided in command, process directly
    await this.addItems(ctx, items);
}
```

---

### 2. Announcement Commands ✅ HIGH PRIORITY

**File:** `Announcements.js:13`
**Commands:** `/announce`, `/announcement`, `/annuncia`, `/annuncio`

**Current Behavior (Lines 17-25):**
```javascript
async announce(ctx) {
    const message = ctx.message.text.split(' ').slice(1).join(' ')
    if (!message || message.length === 0 || message === '') {
        ctx.reply(utils.i18next.t('announcementusage', { lng: language }));
        return;  // ❌ Just shows usage message
    }
    // ... create announcement
}
```

**Problem:** User has to retype `/announce` with the message.

**Should Be:**
```javascript
async announce(ctx) {
    const message = ctx.message.text.split(' ').slice(1).join(' ')

    if (!message || message.length === 0 || message === '') {
        // No message provided, ask for it
        return ctx.scene.enter('input_scene', {
            promptKey: 'announcement_message_prompt',
            example: 'Meeting at 3pm in the main hall',
            allowEmpty: false,
            onComplete: async (ctx, message) => {
                await this.createAnnouncement(ctx, message);
            }
        });
    }

    // Message provided in command
    await this.createAnnouncement(ctx, message);
}
```

---

### 3. Checklist Item Addition ⚠️ MEDIUM PRIORITY

**File:** `Checklists.js:38`
**Command:** `/additem`

**Current Behavior:**
The command triggers a scene, but the scene itself should be replaced with InputScene.

**Should Use:** The InputScene instead of `add_checklist_item_scene`

---

### 4. Settings Commands ⚠️ MEDIUM PRIORITY

**File:** `Settings.js`

#### A. Add Values (`/addvalues` - Line 772)
**Current:** Enters a scene
**Should Use:** InputScene directly

#### B. Add Domains (`/adddomains` - Line 798)
**Current:** Enters a scene
**Should Use:** InputScene directly

#### C. Add Roles (`/addroles` - Line 823)
**Current:** Enters a scene
**Should Use:** InputScene directly

#### D. Add Currencies (`/addcurrencies` - Line 864)
**Current:** Enters a scene
**Should Use:** InputScene directly

---

### 5. Tag Commands ⚠️ MEDIUM PRIORITY

**File:** `Tags.js`

#### A. Get Tagged Messages (`/gettag`)
**Current Behavior:**
```javascript
bot.command('gettag', async (ctx) => {
    const tag = ctx.message.text.split(' ')[1];
    if (!tag) {
        return ctx.reply('Please provide a tag name.');  // ❌ Just error message
    }
    // ... get messages
});
```

**Should Be:**
```javascript
bot.command('gettag', async (ctx) => {
    const tag = ctx.message.text.split(' ')[1];

    if (!tag) {
        return ctx.scene.enter('input_scene', {
            promptText: 'Please enter the tag name to search:',
            example: 'meeting',
            allowEmpty: false,
            onComplete: async (ctx, tag) => {
                await this.getTaggedMessages(ctx, tag);
            }
        });
    }

    await this.getTaggedMessages(ctx, tag);
});
```

---

### 6. Expense Commands 🔄 LOW PRIORITY

**File:** `Expenses.js`

Commands like `/expense`, `/spent`, `/speso` could benefit when amount or currency is missing, but these are more complex (need both amount AND currency).

**Current:** Shows usage message
**Could Use:** Multi-step InputScene or custom validation

---

## Summary Table

| Command | File | Line | Priority | Current Behavior | Should Use InputScene |
|---------|------|------|----------|------------------|----------------------|
| `/buy` | Shopping.js | 11 | ✅ HIGH | Shows usage | Yes - array input |
| `/announce` | Announcements.js | 13 | ✅ HIGH | Shows usage | Yes - text input |
| `/additem` | Checklists.js | 38 | ⚠️ MEDIUM | Enters scene | Replace scene |
| `/addvalues` | Settings.js | 772 | ⚠️ MEDIUM | Enters scene | Replace scene |
| `/adddomains` | Settings.js | 798 | ⚠️ MEDIUM | Enters scene | Replace scene |
| `/addroles` | Settings.js | 823 | ⚠️ MEDIUM | Enters scene | Replace scene |
| `/addcurrencies` | Settings.js | 864 | ⚠️ MEDIUM | Enters scene | Replace scene |
| `/gettag` | Tags.js | ~46 | ⚠️ MEDIUM | Shows error | Yes - text input |
| `/expense` | Expenses.js | 16 | 🔄 LOW | Shows usage | Maybe - complex |

---

## Translation Keys Needed

Add these to your locale files (`data/locales/*.json`):

```json
{
  "shopping_list_prompt": "Please enter items to buy:",
  "shopping_format_hint": "Format: item1, item2, item3",
  "announcement_message_prompt": "Please enter your announcement message:",
  "tag_search_prompt": "Please enter the tag name to search:"
}
```

---

## Quick Migration for /buy Command

Here's the complete code change for the Shopping.js `/buy` command:

### BEFORE (Shopping.js:17-30):
```javascript
async buy(ctx) {
    let holonId = ctx.chat.id;
    const language = await this.settings.getLanguage(holonId)
    const type = ctx.message.text.split(' ')[0].replace('/', '');
    let items = utils.parseList(ctx.message.text)
    if (!items || items.length === 0) {
        ctx.reply(utils.i18next.t('shoppingusage', { type: type, lng: language }));
        return;
    }
    for (let item of items)
        await this.db.put(holonId + '/shopping', { id: item, done: false, from: ctx.from.username });

    ctx.reply(utils.i18next.t('shoppingadded', { items: items.join(", "), lng: language }));
}
```

### AFTER:
```javascript
async buy(ctx) {
    let holonId = ctx.chat.id;
    const language = await this.settings.getLanguage(holonId)
    const type = ctx.message.text.split(' ')[0].replace('/', '');
    let items = utils.parseList(ctx.message.text)

    if (!items || items.length === 0) {
        // No items provided, use InputScene to collect them
        return ctx.scene.enter('input_scene', {
            promptKey: 'shopping_list_prompt',
            formatHint: utils.i18next.t('shopping_format_hint', { lng: language }),
            example: 'Milk, Bread, Eggs',
            inputType: 'array',  // Auto-splits by comma/newline
            allowEmpty: false,
            onComplete: async (ctx, items) => {
                // Add items to shopping list
                for (let item of items) {
                    await this.db.put(holonId + '/shopping', {
                        id: item,
                        done: false,
                        from: ctx.from.username
                    });
                }
                await ctx.reply(utils.i18next.t('shoppingadded', {
                    items: items.join(", "),
                    lng: language
                }));
            }
        });
    }

    // Items provided in command, process directly
    for (let item of items) {
        await this.db.put(holonId + '/shopping', {
            id: item,
            done: false,
            from: ctx.from.username
        });
    }
    await ctx.reply(utils.i18next.t('shoppingadded', {
        items: items.join(", "),
        lng: language
    }));
}
```

---

## Quick Migration for /announce Command

### BEFORE (Announcements.js:17-43):
```javascript
async announce(ctx) {
    let holonId = ctx.chat.id;
    let messageID = ctx.message.message_id;
    const language = await this.settings.getLanguage(holonId)
    const message = ctx.message.text.split(' ').slice(1).join(' ')
    if (!message || message.length === 0 || message === '') {
        ctx.reply(utils.i18next.t('announcementusage', { lng: language }));
        return;
    }

    let announcement = {
        id: messageID,
        user: ctx.from,
        date: new Date(),
        content: message,
        chat: holonId
    }

    await this.db.put(holonId + '/announcements', announcement);

    // Send formatted announcement in local chat
    const formattedMessage = this.createAnnouncementMessage(announcement, language);
    ctx.reply(formattedMessage, { parse_mode: 'Markdown' });

    // Check federation lens and replicate to other chats
    await this.handleFederatedAnnouncements(ctx, announcement, language);
}
```

### AFTER:
```javascript
async announce(ctx) {
    let holonId = ctx.chat.id;
    let messageID = ctx.message.message_id;
    const language = await this.settings.getLanguage(holonId)
    const message = ctx.message.text.split(' ').slice(1).join(' ')

    if (!message || message.length === 0 || message === '') {
        // No message provided, use InputScene to collect it
        return ctx.scene.enter('input_scene', {
            promptKey: 'announcement_message_prompt',
            formatHint: utils.i18next.t('announcement_format_hint', { lng: language }),
            example: 'Meeting at 3pm in the main hall',
            allowEmpty: false,
            onComplete: async (ctx, message) => {
                await this.createAndPublishAnnouncement(ctx, message);
            }
        });
    }

    // Message provided in command, process directly
    await this.createAndPublishAnnouncement(ctx, message);
}

async createAndPublishAnnouncement(ctx, message) {
    let holonId = ctx.chat.id;
    let messageID = ctx.message.message_id;
    const language = await this.settings.getLanguage(holonId);

    let announcement = {
        id: messageID,
        user: ctx.from,
        date: new Date(),
        content: message,
        chat: holonId
    }

    await this.db.put(holonId + '/announcements', announcement);

    // Send formatted announcement in local chat
    const formattedMessage = this.createAnnouncementMessage(announcement, language);
    await ctx.reply(formattedMessage, { parse_mode: 'Markdown' });

    // Check federation lens and replicate to other chats
    await this.handleFederatedAnnouncements(ctx, announcement, language);
}
```

---

## Benefits of These Migrations

1. ✅ **Better UX** - Users don't have to retype commands
2. ✅ **Consistency** - All input collection follows same pattern
3. ✅ **Validation** - Built-in type checking and validation
4. ✅ **Cleanup** - Automatic message deletion when bot has admin rights
5. ✅ **Cancel Support** - Users can type `/cancel` to abort
6. ✅ **Examples** - Users see format hints and examples
7. ✅ **Translation** - Easy i18next integration

---

## Next Steps

1. **Start with high priority commands:** `/buy` and `/announce`
2. **Test thoroughly** to ensure InputScene works as expected
3. **Add translation keys** to locale files
4. **Migrate medium priority commands** once pattern is proven
5. **Update scenes** in Checklists.js and Settings.js to use InputScene
6. **Document any issues** or improvements needed

---

## Notes

- The InputScene is already registered and ready to use
- No breaking changes - commands still work with parameters
- Only improves UX when parameters are missing
- Backward compatible with existing behavior
