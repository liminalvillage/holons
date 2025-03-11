import { Markup, Scenes } from 'telegraf';

class Checklists {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
        this.questInstance = null; // Initialize questInstance
        
        // Create scenes
        this.addItemScene = new Scenes.BaseScene('add_item_scene');
        this.newChecklistScene = new Scenes.BaseScene('new_checklist_scene');
        this.bot.stage.register(this.addItemScene);
        this.bot.stage.register(this.newChecklistScene);
        this.setupScenes();
        
        // Register commands and actions
        this.bot.command('checklist', (ctx) => this.showChecklist(ctx));
        this.bot.command('newchecklist', (ctx) => this.createChecklist(ctx));
        this.bot.command('addcheck', (ctx) => this.addChecklistItem(ctx));
        this.bot.command('removecheck', (ctx) => this.removeChecklist(ctx));
        this.bot.command('removechecklistitem', (ctx) => this.removeChecklistItem(ctx));
        this.bot.command('deletechecked', (ctx) => this.deleteCheckedItems(ctx));
        this.bot.command('checklists', (ctx) => this.showAllChecklists(ctx));
        this.bot.command('agenda', (ctx) => this.showSpecialChecklist(ctx, 'agenda', '📅'));
        this.bot.command('shopping', (ctx) => this.showSpecialChecklist(ctx, 'shopping', '🛒'));
        
        // Register actions (unified for all checklist types)
        this.bot.action(/check_(.+)/, (ctx) => this.toggleCheckItem(ctx));
        this.bot.action(/show_checklist_(.+)/, (ctx) => this.handleChecklistButton(ctx));
        this.bot.action(/clear_checklist_(.+)/, (ctx) => this.clearChecklist(ctx));
        this.bot.action(/add_item_to_(.+)/, (ctx) => this.handleAddItemButton(ctx));
        this.bot.action('new_checklist', (ctx) => this.handleNewChecklistButton(ctx));
        this.bot.action(/enter_remove_mode_(.+)/, (ctx) => this.enterRemoveMode(ctx));
        this.bot.action(/exit_remove_mode_(.+)/, (ctx) => this.exitRemoveMode(ctx));
        this.bot.action(/remove_item_(.+)/, (ctx) => this.removeItem(ctx));
        this.bot.action(/back_to_quest_(.+)/, (ctx) => this.handleBackToQuest(ctx));
        this.bot.action('enter_delete_checklists_mode', (ctx) => this.enterDeleteChecklistsMode(ctx));
        this.bot.action('exit_delete_checklists_mode', (ctx) => this.exitDeleteChecklistsMode(ctx));
        this.bot.action(/delete_checklist_(.+)/, (ctx) => this.deleteChecklist(ctx));
    }

    setupScenes() {
        // Setup add item scene
        this.addItemScene.enter(async (ctx) => {
            // Store the original message ID and chat ID
            ctx.scene.state.originalMessageId = ctx.callbackQuery.message.message_id;
            ctx.scene.state.chatId = ctx.callbackQuery.message.chat.id;
            
            // Send prompt message
            const promptMessage = await ctx.reply('Please enter the new items (comma-separated for multiple items):');
            // Store prompt message ID for later deletion
            ctx.scene.state.promptMessageId = promptMessage.message_id;
        });

        this.addItemScene.on('text', async (ctx) => {
            const itemsText = ctx.message.text;
            const chatId = ctx.scene.state.chatId;
            const originalMessageId = ctx.scene.state.originalMessageId;
            const promptMessageId = ctx.scene.state.promptMessageId;
            const isSpecial = ctx.scene.state.isSpecial;
            
            try {
                // Get the checklist ID from the scene state
                const checklistId = ctx.scene.state.checklistId;
                if (!checklistId) {
                    await ctx.reply('Error: Checklist ID not found');
                    return ctx.scene.leave();
                }

                const checklist = await this.db.get(chatId + '/checklists', checklistId.toString()) || {
                    id: checklistId,
                    items: [],
                    created: new Date(),
                    type: checklistId // For special checklists
                };

                // Add new items
                const newItems = itemsText.split(',').map(text => ({
                    text: text.trim(),
                    checked: false
                })).filter(item => item.text);

                checklist.items.push(...newItems);
                await this.db.put(chatId + '/checklists', checklist);

                // Delete the prompt message
                if (promptMessageId) {
                    await ctx.deleteMessage(promptMessageId).catch(() => {});
                }
                // Delete the user's input message
                if (ctx.message) {
                    await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
                }

                // Update the original checklist message
                const icon = this.getChecklistIcon(checklistId);
                await ctx.telegram.editMessageText(
                    chatId,
                    originalMessageId,
                    null,
                    `${icon} ${checklistId.toUpperCase()}:`,
                    this.getChecklistKeyboard(checklist)
                );

                await ctx.scene.leave();

            } catch (error) {
                console.error('Error adding items to checklist:', error);
                await ctx.reply('Error adding items to checklist');
                await ctx.scene.leave();
            }
        });

        // Setup new checklist scene
        this.newChecklistScene.enter(async (ctx) => {
            await ctx.reply('Please enter a name for the new checklist, followed by comma-separated items (optional):\nExample: morning brush teeth, make bed, exercise');
        });

        this.newChecklistScene.on('text', async (ctx) => {
            const input = ctx.message.text;
            const [name, ...itemsText] = input.split(/\s+(.+)/); // Split on first space
            const chatId = ctx.chat.id;
            
            if (await this.db.get(chatId + '/checklists', name)) {
                await ctx.reply(`Checklist "${name}" already exists.`);
                return ctx.scene.leave();
            }

            // Parse items if they exist
            const items = itemsText.length > 0 
                ? itemsText[0].split(',')
                    .map(item => ({
                        text: item.trim(),
                        checked: false
                    }))
                    .filter(item => item.text)
                : [];

            const checklist = {
                id: name,
                items: items,
                creator: ctx.from.id,
                created: new Date(),
                type: 'checklist' // Add type field to identify regular checklists
            };

            await this.db.put(chatId + '/checklists', checklist);
            await ctx.reply(`Created checklist "${name}"${items.length ? ' with initial items' : ''}.`);
            
            // Show the checklist if items were added
            if (items.length > 0) {
                await ctx.reply(
                    `📋 ${name.toUpperCase()} Checklist:`, 
                    this.getChecklistKeyboard(checklist)
                );
            }
            
            // Show updated list of checklists
            await this.showAllChecklists(ctx);
            return ctx.scene.leave();
        });
    }

    async handleNewChecklistButton(ctx) {
        await ctx.answerCbQuery();
        await ctx.scene.enter('new_checklist_scene');
    }

    async showAllChecklists(ctx, deleteMode = false) {
        let chatID = ctx.chat.id;
        let lists = await this.db.getAll(chatID + '/checklists');
        
        // Filter out subtask checklists and show only regular and special checklists
        lists = lists.filter(list => !list.type || ['agenda', 'shopping'].includes(list.id));
        
        const buttons = lists.map(list => {
            if (deleteMode) {
                return [Markup.button.callback(
                    `❌ ${this.getChecklistIcon(list.id)} ${list.id}`,
                    `delete_checklist_${list.id}`
                )];
            }
            const total = list.items.length;
            const checked = list.items.filter(item => item.checked).length;
            return [Markup.button.callback(
                `${this.getChecklistIcon(list.id)} ${list.id}: ${checked}/${total} completed`,
                `show_checklist_${list.id}`
            )];
        });

        // Add control buttons at the bottom
        if (deleteMode) {
            buttons.push([
                Markup.button.callback('🔙 Back', 'exit_delete_checklists_mode')
            ]);
        } else {
            buttons.push([
                Markup.button.callback('➕ New Checklist', 'new_checklist'),
                Markup.button.callback('🗑️ Delete Checklists', 'enter_delete_checklists_mode')
            ]);
        }

        const message = deleteMode ? 'Select checklists to delete:' : 'Available Checklists:';
        
        if (ctx.callbackQuery) {
            await ctx.editMessageText(message, Markup.inlineKeyboard(buttons)).catch(error => console.log(error));
        } else {
            await ctx.reply(message, Markup.inlineKeyboard(buttons)).catch(error => console.log(error));
        }
    }

    async createChecklist(ctx) {
        const [_, name, ...itemsText] = ctx.message.text.split(/\s+/);
        if (!name) {
            ctx.reply('Please specify a checklist name. eg: /newchecklist morning');
            return;
        }

        let chatID = ctx.chat.id;
        if (await this.db.get(chatID + '/checklists', name)) {
            ctx.reply(`Checklist "${name}" already exists.`);
            return;
        }

        // Join the remaining text and split by commas
        const items = itemsText.join(' ').split(',').map(item => ({
            text: item.trim(),
            checked: false
        })).filter(item => item.text); // Filter out empty items

        const checklist = {
            id: name,
            items: items,
            creator: ctx.from.id,
            created: new Date(),
            type: 'checklist' // Add type field to identify regular checklists
        };

        await this.db.put(chatID + '/checklists', checklist);
        ctx.reply(`Created checklist "${name}"${items.length ? ' with initial items' : ''}.`);
        
        // Show the checklist if items were added
        if (items.length > 0) {
            ctx.reply(`📋 ${name.toUpperCase()} Checklist:`, this.getChecklistKeyboard(checklist));
        }
    }

    async addChecklistItem(ctx) {
        const [_, listName, ...itemWords] = ctx.message.text.split(/\s+/);
        if (!listName || itemWords.length === 0) {
            ctx.reply('Please specify list name and items. eg: /addcheck morning brush teeth, make bed, exercise');
            return;
        }

        await this.addItemsToChecklist(listName, itemWords.join(' '), ctx.chat.id, ctx);
    }

    async removeChecklistItem(ctx) {
        const [_, listName, ...itemWords] = ctx.message.text.split(/\s+/);
        if (!listName || itemWords.length === 0) {
            ctx.reply('Please specify list name and item. eg: /removeitem morning "brush teeth"');
            return;
        }

        const itemText = itemWords.join(' ');
        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', listName);
        
        if (!checklist) {
            ctx.reply(`Checklist "${listName}" not found.`);
            return;
        }

        const initialLength = checklist.items.length;
        checklist.items = checklist.items.filter(item => item.text !== itemText);

        if (checklist.items.length === initialLength) {
            ctx.reply(`Item "${itemText}" not found in checklist "${listName}".`);
            return;
        }

        await this.db.put(chatID + '/checklists', checklist);
        ctx.reply(`Removed "${itemText}" from checklist "${listName}".`);
    }

    async removeChecklist(ctx) {
        const name = ctx.message.text.split('/removelist ')[1];
        if (!name) {
            ctx.reply('Please specify a checklist name. eg: /removelist morning');
            return;
        }

        let chatID = ctx.chat.id;
        await this.db.del(chatID + '/checklists', name);
        ctx.reply(`Removed checklist "${name}".`);
    }

    async showChecklist(ctx, checklistId) {
        const chatId = ctx.callbackQuery.message.chat.id;
        
        try {
            const checklist = await this.db.get(chatId + '/checklists', checklistId);
            if (!checklist) {
                await ctx.answerCbQuery('Checklist not found');
                return;
            }

            // Edit current message to show checklist
            await ctx.editMessageText(
                `📋 ${checklist.questTitle || 'Checklist'}:`,
                this.getChecklistKeyboard(checklist)
            );
            
            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error showing checklist:', error);
            await ctx.answerCbQuery('Error displaying checklist');
        }
    }

    async toggleCheckItem(ctx) {
        const [listName, itemIndex] = ctx.match[1].split('_');
        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', listName);
        
        if (!checklist || !checklist.items[itemIndex]) {
            await ctx.answerCbQuery('Item not found');
            return;
        }

        checklist.items[itemIndex].checked = !checklist.items[itemIndex].checked;
        await this.db.put(chatID + '/checklists', checklist);

        const icon = this.getChecklistIcon(listName);
        const title = `${icon} ${listName.toUpperCase()}:`;

        await ctx.editMessageText(
            title,
            this.getChecklistKeyboard(checklist)
        ).catch(error => console.log(error));
    }

    async handleChecklistButton(ctx) {
        const listName = ctx.match[1];
        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', listName);
        
        if (!checklist) {
            ctx.reply(`Checklist "${listName}" not found.`);
            return;
        }

        // Show checklist in normal mode (removeMode = false)
        await ctx.reply(`📋 ${listName.toUpperCase()} Checklist:`, 
            this.getChecklistKeyboard(checklist, false)
        );
    }

    async clearChecklist(ctx) {
        const listName = ctx.match[1];
        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', listName);
        
        if (!checklist) {
            await ctx.answerCbQuery('Checklist not found');
            return;
        }

        if (listName === 'agenda') {
            // For agenda, only remove checked items
            const checkedItems = checklist.items.filter(item => item.checked);
            if (checkedItems.length === 0) {
                await ctx.answerCbQuery('No checked items to remove');
                return;
            }
            checklist.items = checklist.items.filter(item => !item.checked);
            await ctx.answerCbQuery(`Removed ${checkedItems.length} completed items ✓`);
        } else {
            // For other checklists, clear all checks
            checklist.items = checklist.items.map(item => ({
                ...item,
                checked: false
            }));
            await ctx.answerCbQuery('Cleared all items');
        }

        await this.db.put(chatID + '/checklists', checklist);
        
        const icon = this.getChecklistIcon(listName);
        const title = `${icon} ${listName.toUpperCase()}:`;

        await ctx.editMessageText(
            title,
            this.getChecklistKeyboard(checklist)
        ).catch(error => console.log(error));
    }

    getChecklistKeyboard(checklist, removeMode = false) {
        let buttons = [];
        
        // Add item buttons if there are any
        if (checklist.items.length > 0) {
            buttons = checklist.items.map((item, index) => {
                if (removeMode) {
                    return [Markup.button.callback(
                        `❌ ${item.text}`,
                        `remove_item_${checklist.id}_${index}`
                    )];
                } else {
                    const status = item.checked ? '✅' : '⬜️';
                    return [Markup.button.callback(
                        `${status} ${item.text}`,
                        `check_${checklist.id}_${index}`
                    )];
                }
            });
        }

        // Add control buttons based on checklist type
        if (this.isSpecialChecklist(checklist.id)) {
            if (checklist.id === 'agenda') {
                buttons.push([
                    Markup.button.callback('➕ Add Item', `add_item_to_${checklist.id}`),
                    Markup.button.callback('🗑️ Remove Checked', `clear_checklist_${checklist.id}`)
                ]);
            } else {
                // For shopping list and other special checklists
                buttons.push([
                    Markup.button.callback('➕ Add Item', `add_item_to_${checklist.id}`),
                    Markup.button.callback('🗑️ Clear Completed', `clear_checklist_${checklist.id}`)
                ]);
            }
        } else {
            buttons.push([
                Markup.button.callback(
                    '➕ Add Item',
                    `add_item_to_${checklist.id}`
                ),
                Markup.button.callback(
                    removeMode ? '🔙 Back' : '🗑️ Remove',
                    removeMode ? `exit_remove_mode_${checklist.id}` : `enter_remove_mode_${checklist.id}`
                ),
                Markup.button.callback(
                    '🔄 Clear All',
                    `clear_checklist_${checklist.id}`
                )
            ]);

            // Add back button for quest checklists
            if (checklist.questId) {
                buttons.push([
                    Markup.button.callback(
                        '🔙 Back to Task',
                        `back_to_quest_${checklist.chatId}_${checklist.questId}`
                    )
                ]);
            }
        }

        return Markup.inlineKeyboard(buttons);
    }

    async handleAddItemButton(ctx) {
        await ctx.answerCbQuery();
        const checklistId = ctx.match[1];
        await ctx.scene.enter('add_item_scene', { 
            checklistId: checklistId,
            chatId: ctx.callbackQuery.message.chat.id,
            messageId: ctx.callbackQuery.message.message_id
        });
    }

    async handleDummyAction(ctx) {
        await ctx.answerCbQuery();
        await ctx.reply('This action is not available.');
    }

    async enterRemoveMode(ctx) {
        await ctx.answerCbQuery();
        const listName = ctx.match[1];
        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', listName);
        
        if (!checklist) {
            ctx.reply(`Checklist "${listName}" not found.`);
            return;
        }

        await ctx.editMessageText(
            `📋 ${listName.toUpperCase()} Checklist:\nSelect items to remove:`,
            this.getChecklistKeyboard(checklist, true)
        ).catch(error => console.log(error));
    }

    async exitRemoveMode(ctx) {
        await ctx.answerCbQuery();
        const listName = ctx.match[1];
        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', listName);
        
        if (!checklist) {
            ctx.reply(`Checklist "${listName}" not found.`);
            return;
        }

        await ctx.editMessageText(
            `📋 ${listName.toUpperCase()} Checklist:`,
            this.getChecklistKeyboard(checklist, false)
        ).catch(error => console.log(error));
    }

    async removeItem(ctx) {
        await ctx.answerCbQuery();
        const [listName, itemIndex] = ctx.match[1].split('_');
        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', listName);
        
        if (!checklist || !checklist.items[itemIndex]) {
            ctx.reply('Item not found.');
            return;
        }

        // Store the item text before removing it
        const removedItemText = checklist.items[itemIndex].text;

        // Remove the item
        checklist.items = checklist.items.filter((_, index) => index !== parseInt(itemIndex));
        await this.db.put(chatID + '/checklists', checklist);

        // Update the message with the new keyboard, staying in remove mode
        await ctx.editMessageText(
            `📋 ${listName.toUpperCase()} Checklist:\nRemoved "${removedItemText}"`,
            this.getChecklistKeyboard(checklist, true)
        ).catch(error => console.log(error));
    }

    async deleteCheckedItems(ctx) {
        const [_, listName] = ctx.message.text.split(/\s+/);
        if (!listName) {
            ctx.reply('Please specify a checklist name. eg: /deletechecked morning');
            return;
        }

        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', listName);
        
        if (!checklist) {
            ctx.reply(`Checklist "${listName}" not found.`);
            return;
        }

        const initialLength = checklist.items.length;
        const checkedItems = checklist.items.filter(item => item.checked);
        
        if (checkedItems.length === 0) {
            ctx.reply(`No checked items found in checklist "${listName}".`);
            return;
        }

        // Remove checked items
        checklist.items = checklist.items.filter(item => !item.checked);
        await this.db.put(chatID + '/checklists', checklist);

        const removedCount = initialLength - checklist.items.length;
        const removedItems = checkedItems.map(item => `"${item.text}"`).join(', ');
        
        await ctx.reply(`Removed ${removedCount} checked items from checklist "${listName}": ${removedItems}`);
        
        // Show the updated checklist
        await ctx.reply(
            `📋 ${listName.toUpperCase()} Checklist:`, 
            this.getChecklistKeyboard(checklist)
        );
    }

    async addItemsToChecklist(listName, itemsText, chatId, ctx) {
        let checklist = await this.db.get(chatId + '/checklists', listName);
        
        if (!checklist) {
            await ctx.reply(`Checklist "${listName}" not found.`);
            return null;
        }

        // Split by commas and create items
        const newItems = itemsText.split(',')
            .map(item => ({
                text: item.trim(),
                checked: false
            }))
            .filter(item => item.text); // Filter out empty items

        if (newItems.length === 0) {
            await ctx.reply('No valid items provided.');
            return null;
        }

        checklist.items.push(...newItems);
        await this.db.put(chatId + '/checklists', checklist);

        const itemsAdded = newItems.map(item => `"${item.text}"`).join(', ');
        await ctx.reply(`Added ${newItems.length} items to checklist "${listName}": ${itemsAdded}`);
        
        // Show the updated checklist
        await ctx.reply(
            `📋 ${listName.toUpperCase()} Checklist:`, 
            this.getChecklistKeyboard(checklist)
        );

        return checklist;
    }

    async handleBackToQuest(ctx) {
        const [chatId, questId] = ctx.match[1].split('_');
        
        try {
            const quest = await this.db.get(chatId + '/quests', questId);
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            if (!this.questInstance) {
                console.error('Quest instance not set');
                await ctx.answerCbQuery('Error: Cannot return to quest');
                return;
            }

            // Use the quest instance's updateMessage method to rerender the quest
            await this.questInstance.updateMessage(ctx, quest);
            await ctx.answerCbQuery();

        } catch (error) {
            console.error('Error handling back to quest:', error);
            await ctx.answerCbQuery('Error returning to quest');
        }
    }

    // Add a method to get the quest instance
    async getQuestInstance() {
        // This should be set from outside after construction
        if (!this.questInstance) {
            console.error('Quest instance not set');
            return null;
        }
        return this.questInstance;
    }

    // Add a method to set the quest instance
    setQuestInstance(questInstance) {
        this.questInstance = questInstance;
        console.log('Quest instance set successfully');
    }

    async showSpecialChecklist(ctx, type, icon) {
        const chatId = ctx.chat.id;
        let checklist = await this.db.get(chatId + '/checklists', type) || {
            id: type,
            items: [],
            created: new Date()
        };

        await ctx.reply(
            `${icon} ${type.toUpperCase()}:`,
            this.getChecklistKeyboard(checklist)
        );
    }

    // Helper method to determine if a checklist is special
    isSpecialChecklist(checklistId) {
        return ['agenda', 'shopping'].includes(checklistId);
    }

    // Helper method to get checklist icon
    getChecklistIcon(checklistId) {
        switch(checklistId) {
            case 'agenda': return '📅';
            case 'shopping': return '🛒';
            default: return '📋';
        }
    }

    getSpecialChecklistKeyboard(checklist) {
        let buttons = [];
        
        // Add item buttons if there are any
        if (checklist.items.length > 0) {
            buttons = checklist.items.map((item, index) => {
                const status = item.checked ? '✅' : '⬜️';
                return [Markup.button.callback(
                    `${status} ${item.text}`,
                    `${checklist.type}_check_${index}`
                )];
            });
        }

        // Add control buttons
        buttons.push([
            Markup.button.callback('➕ Add Item', `${checklist.type}_add`),
            Markup.button.callback('🗑️ Clear Completed', `${checklist.type}_delete_checked`)
        ]);

        return Markup.inlineKeyboard(buttons);
    }

    async enterDeleteChecklistsMode(ctx) {
        await ctx.answerCbQuery();
        await this.showAllChecklists(ctx, true);
    }

    async exitDeleteChecklistsMode(ctx) {
        await ctx.answerCbQuery();
        await this.showAllChecklists(ctx, false);
    }

    async deleteChecklist(ctx) {
        const listName = ctx.match[1];
        let chatID = ctx.chat.id;
        
        // Don't allow deletion of special checklists
        if (this.isSpecialChecklist(listName)) {
            await ctx.answerCbQuery('Cannot delete special checklists');
            return;
        }

        await this.db.del(chatID + '/checklists', listName);
        await ctx.answerCbQuery(`Deleted checklist "${listName}"`);
        
        // Refresh the delete mode view
        await this.showAllChecklists(ctx, true);
    }
}

export default Checklists; 