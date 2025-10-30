/**
 * InputScene Examples
 *
 * This file demonstrates various ways to use the InputScene utility
 * for collecting user input across the HolonsBot codebase.
 */

// ============================================================================
// EXAMPLE 1: Simple Text Input (Quest Description)
// ============================================================================
// Location: Quests.js - Replace descriptionScene
// Old code (lines 52-84):
/*
this.descriptionScene = new Scenes.BaseScene('description_scene');
this.descriptionScene.enter(async (ctx) => {
    const quest = await this.db.get(ctx.scene.state.chatId + '/quests', ctx.scene.state.questId.toString());
    const promptMessage = await ctx.reply('📝 Reply with a description for this task.');
    ctx.scene.state.promptMessageId = promptMessage.message_id;
});
this.descriptionScene.on('text', async (ctx) => {
    // ... validation and processing
});
this.bot.stage.register(this.descriptionScene);
*/

// NEW CODE using InputScene:
/*
bot.action(/descriptions_quest_(.+)/, async (ctx) => {
    const questId = ctx.match[1];
    const chatId = getChatId(ctx);

    return ctx.scene.enter('input_scene', {
        promptKey: 'quest_description_prompt',  // '📝 Reply with a description for this task.'
        allowEmpty: false,
        onComplete: async (ctx, description) => {
            const quest = await this.db.get(chatId + '/quests', questId);

            if (!await this.questExists(quest, ctx, questId)) {
                return;
            }

            quest.description = description;
            await this.db.put(chatId + '/quests', quest);
            await this.updateMessage(ctx, quest);
        },
        onError: async (ctx, error) => {
            console.error('Error updating quest description:', error);
        }
    });
});
*/


// ============================================================================
// EXAMPLE 2: Array Input with Validation (Checklist Items)
// ============================================================================
// Location: Checklists.js - Replace addItemScene
// Old code (lines 114-203):
/*
this.addItemScene = new Scenes.BaseScene('add_checklist_item_scene');
this.addItemScene.enter(async (ctx) => {
    const promptMessage = await ctx.reply('Please enter the new items (comma-separated for multiple items):');
    ctx.scene.state.promptMessageId = promptMessage.message_id;
});
this.addItemScene.on('text', async (ctx) => {
    // ... split by comma, process items
});
*/

// NEW CODE using InputScene:
/*
return ctx.scene.enter('input_scene', {
    promptKey: 'checklist_add_items_prompt',  // 'Please enter the new items:'
    formatHint: 'Format: item1, item2, item3',
    example: 'Buy milk, Clean room, Call mom',
    inputType: 'array',  // Auto-splits by comma/newline
    allowEmpty: false,
    validate: (items) => {
        if (items.length === 0) {
            return { valid: false, error: 'Please provide at least one item.' };
        }
        return { valid: true };
    },
    onComplete: async (ctx, items) => {
        const checklistId = ctx.scene.state.checklistId;
        const chatId = getChatId(ctx);

        // Add items to checklist
        for (const itemText of items) {
            const item = {
                id: Date.now() + Math.random(),
                text: itemText,
                completed: false,
                createdAt: Date.now()
            };
            await this.db.push(chatId + '/checklists/' + checklistId + '/items', item);
        }

        await this.displayChecklist(ctx, checklistId);
    }
});
*/


// ============================================================================
// EXAMPLE 3: Numeric Input with Validation (Token Amount)
// ============================================================================
// Location: Holons.js - Reward scene
// Old code (lines 251-383):
/*
this.rewardScene.on('text', async (ctx) => {
    const args = ctx.message.text.trim().split(/\s+/);
    const tokenAddress = args[0];
    const amount = ethers.parseUnits(args[1], 18);
    // ...
});
*/

// NEW CODE using InputScene:
/*
return ctx.scene.enter('input_scene', {
    promptText: 'Please enter the token address and amount to reward members.',
    formatHint: 'Format: [token address] [amount]',
    example: '0x1234...5678 100',
    validate: async (input) => {
        const args = input.trim().split(/\s+/);

        if (args.length !== 2) {
            return {
                valid: false,
                error: 'Please provide both token address and amount.\nFormat: [token address] [amount]'
            };
        }

        if (!ethers.isAddress(args[0])) {
            return { valid: false, error: 'Invalid token address format.' };
        }

        if (isNaN(args[1]) || parseFloat(args[1]) <= 0) {
            return { valid: false, error: 'Amount must be a positive number.' };
        }

        return { valid: true };
    },
    transform: (input) => {
        const args = input.trim().split(/\s+/);
        return {
            tokenAddress: args[0],
            amount: ethers.parseUnits(args[1], 18)
        };
    },
    onComplete: async (ctx, { tokenAddress, amount }) => {
        // Execute reward distribution
        await this.distributeReward(ctx, tokenAddress, amount);
    }
});
*/


// ============================================================================
// EXAMPLE 4: Role Input with Pipe Format (Add Role)
// ============================================================================
// Location: Roles.js - Add role scene
// Old code (lines 60-143):
/*
this.addRoleScene.on('text', async (ctx) => {
    let [title, description] = roleText.split('|').map(part => part.trim());
    // ...
});
*/

// NEW CODE using InputScene:
/*
return ctx.scene.enter('input_scene', {
    promptKey: 'role_add_prompt',
    formatHint: 'Format: Title | Description\nDescription is optional.',
    example: 'Space Angel | Welcomes new members',
    validate: async (input, ctx) => {
        const [title] = input.split('|').map(part => part.trim());

        if (!title) {
            return { valid: false, error: 'Please provide at least a title for the role.' };
        }

        // Check if role already exists
        const chatId = getChatId(ctx);
        const existingRoles = await this.db.get(chatId + '/settings', 'roles') || [];

        if (existingRoles.some(r => r.title.toLowerCase() === title.toLowerCase())) {
            return { valid: false, error: `Role "${title}" already exists.` };
        }

        return { valid: true };
    },
    transform: (input) => {
        let [title, description = ''] = input.split('|').map(part => part.trim());
        return { title, description };
    },
    onComplete: async (ctx, { title, description }) => {
        const chatId = getChatId(ctx);
        const role = {
            id: Date.now(),
            title,
            description,
            members: [],
            createdAt: Date.now()
        };

        await this.db.push(chatId + '/settings/roles', role);
        await ctx.reply(`✅ Role "${title}" has been created!`);
    }
});
*/


// ============================================================================
// EXAMPLE 5: Email Validation
// ============================================================================
/*
return ctx.scene.enter('input_scene', {
    promptText: 'Please enter your email address:',
    inputType: 'email',  // Built-in email validation
    errorText: 'Please provide a valid email address.',
    onComplete: async (ctx, email) => {
        await this.db.put(ctx.from.id + '/profile', { email });
        await ctx.reply('✅ Email address saved!');
    }
});
*/


// ============================================================================
// EXAMPLE 6: URL Input with Validation
// ============================================================================
/*
return ctx.scene.enter('input_scene', {
    promptText: 'Please enter the website URL:',
    inputType: 'url',  // Built-in URL validation
    onComplete: async (ctx, url) => {
        const chatId = getChatId(ctx);
        await this.db.put(chatId + '/settings', { website: url });
        await ctx.reply(`✅ Website set to: ${url}`);
    }
});
*/


// ============================================================================
// EXAMPLE 7: Integer Input for User ID
// ============================================================================
/*
return ctx.scene.enter('input_scene', {
    promptKey: 'settings_enter_user_id',
    inputType: 'integer',  // Only accepts whole numbers
    validate: async (userId, ctx) => {
        // Check if user exists
        try {
            await ctx.telegram.getChat(userId);
            return { valid: true };
        } catch {
            return { valid: false, error: 'User not found. Please enter a valid user ID.' };
        }
    },
    onComplete: async (ctx, userId) => {
        const chatId = getChatId(ctx);
        await this.db.push(chatId + '/members', { userId, joinedAt: Date.now() });
        await ctx.reply('✅ User added to the holon!');
    }
});
*/


// ============================================================================
// EXAMPLE 8: With Cancel Support
// ============================================================================
/*
return ctx.scene.enter('input_scene', {
    promptText: 'Enter the new holon name (or /cancel to abort):',
    cancelText: '❌ Name change cancelled.',
    onComplete: async (ctx, name) => {
        const chatId = getChatId(ctx);
        await this.db.put(chatId + '/settings', { name });
        await ctx.reply(`✅ Holon name updated to: ${name}`);
    },
    onCancel: async (ctx) => {
        // Additional cleanup if needed
        console.log('User cancelled name change');
    }
});
*/


// ============================================================================
// EXAMPLE 9: With Custom Error Handler
// ============================================================================
/*
return ctx.scene.enter('input_scene', {
    promptText: 'Enter blockchain contract address:',
    validate: (input) => {
        return ethers.isAddress(input);
    },
    errorText: 'Invalid Ethereum address. Please try again.',
    onComplete: async (ctx, address) => {
        await this.setupContract(ctx, address);
    },
    onError: async (ctx, error) => {
        // Log to monitoring service
        console.error('Contract setup error:', error);
        await ctx.reply('An unexpected error occurred. Please contact support.');

        // Notify admin
        await ctx.telegram.sendMessage(ADMIN_ID, `Contract setup failed: ${error.message}`);
    }
});
*/


// ============================================================================
// EXAMPLE 10: Replacing Command Parameter Parsing
// ============================================================================
// Instead of parsing command text manually, use InputScene when params are missing

// Old pattern in Shopping.js:
/*
bot.command('buy', async (ctx) => {
    let items = utils.parseList(ctx.message.text);
    if (items.length === 0) {
        return ctx.reply('Please provide items to buy.');
    }
    // ... add items
});
*/

// NEW pattern with fallback to InputScene:
/*
bot.command('buy', async (ctx) => {
    let items = utils.parseList(ctx.message.text);

    if (items.length === 0) {
        // No items in command, ask for them
        return ctx.scene.enter('input_scene', {
            promptKey: 'shopping_list_prompt',
            formatHint: 'Format: item1, item2, item3',
            example: 'Milk, Bread, Eggs',
            inputType: 'array',
            onComplete: async (ctx, items) => {
                await this.addItemsToShoppingList(ctx, items);
            }
        });
    }

    // Items provided in command, process directly
    await this.addItemsToShoppingList(ctx, items);
});
*/


// ============================================================================
// SUMMARY: Benefits of Using InputScene
// ============================================================================
/*
1. ✅ Consistency: All input prompts follow the same pattern
2. ✅ Translation Support: Easy i18next integration with promptKey
3. ✅ Validation: Built-in type validation (email, url, number, etc.)
4. ✅ Error Handling: Standardized error messages and retry logic
5. ✅ Message Cleanup: Automatic cleanup when bot has admin rights
6. ✅ Less Code: Reduces duplication across modules
7. ✅ Maintainability: Single place to update input collection behavior
8. ✅ User Experience: Consistent interface across all bot interactions
9. ✅ Cancel Support: Built-in /cancel command handling
10. ✅ Examples & Hints: Easy to add format hints and examples

MIGRATION PRIORITY:
- High: Quests.js (descriptionScene)
- High: Checklists.js (addItemScene, newChecklistScene)
- High: Roles.js (addRoleScene, editRoleScene)
- Medium: Holons.js (all blockchain input scenes)
- Medium: Settings.js & SettingsScenes.js (all input scenes)
- Low: One-off command parameter collection

BACKWARD COMPATIBILITY:
The InputScene is registered as 'input_scene' and doesn't interfere with
existing scenes. You can migrate modules one at a time without breaking changes.
*/
