// @ts-nocheck — TS migration sweep (Phase B unit tg-ui/remaining-modules):
// Renamed `.js` → `.ts` and routed through `@holons/core/checklists` for the
// canonical type/constant surface area. Strict typing of every Telegraf
// handler in this 1k-line UI module is deferred to the future
// `core/checklists` extraction unit; the runtime behaviour is unchanged.
/**
 * @fileoverview Checklist management for HolonsBot.
 * @module src/Checklists
 */
import { Markup } from 'telegraf';
import i18next from 'i18next';
import * as utils from './utilities.js';
import {
    CHECKLIST_TYPES as CHECKLIST_TYPES_CORE,
    createChecklistObject as coreCreateChecklistObject,
    type Checklist,
    type ChecklistItem,
    type ChecklistType,
} from '@holons/core/checklists';

// Re-export so other modules can `import type { Checklist } from './Checklists.js'`
// or directly from `@holons/core/checklists` — same shape either way.
export type { Checklist, ChecklistItem, ChecklistType };

/**
 * Standard checklist types supported by the system.
 * Sourced from `@holons/core/checklists` so other UIs stay aligned.
 */
const CHECKLIST_TYPES = CHECKLIST_TYPES_CORE;

/**
 * Checklist management class for creating and managing various types of checklists.
 *
 * @class Checklists
 * @description Handles creation, display, and management of checklists including
 * regular checklists, agendas, shopping lists, quest checklists, and role checklists.
 *
 * @property {Telegraf} bot - The Telegraf bot instance
 * @property {DB} db - Database instance
 * @property {Quests|null} questInstance - Quests module reference
 * @property {Roles|null} rolesInstance - Roles module reference
 *
 * @example
 * const checklists = new Checklists(bot, db);
 * checklists.questInstance = questsModule;
 * // Checklist commands are now available: /checklist, /newchecklist, etc.
 */
class Checklists {
    /**
     * Creates a new Checklists instance and registers checklist commands.
     * @constructor
     * @param {Telegraf} bot - The Telegraf bot instance
     * @param {DB} db - The database instance
     */
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
        this.questInstance = null;
        this.rolesInstance = null;
        
        // Scenes migrated to InputScene - no custom scenes needed
        
        // Register commands and actions
        this.bot.command('checklist', (ctx) => this.showChecklist(ctx));
        this.bot.command('newchecklist', (ctx) => this.createChecklist(ctx));
        this.bot.command('addcheck', (ctx) => this.addChecklistItem(ctx));
        this.bot.command('removecheck', (ctx) => this.removeChecklist(ctx));
        this.bot.command('removechecklistitem', (ctx) => this.removeChecklistItem(ctx));
        this.bot.command('deletechecked', (ctx) => this.deleteCheckedItems(ctx));
        this.bot.command('checklists', (ctx) => this.showAllChecklists(ctx, {}));
        this.bot.command('agenda', (ctx) => this.showSpecialChecklist(ctx, 'agenda', '📅'));
        // Note: /shopping command is handled by Shopping.js module
        this.bot.command('additem', (ctx) => this.directAddItem(ctx));
        
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
        // Removed duplicate back_to_role_ handler - owned by Roles.js:29
        this.bot.action('enter_delete_checklists_mode', (ctx) => this.enterDeleteChecklistsMode(ctx));
        this.bot.action('exit_delete_checklists_mode', (ctx) => this.exitDeleteChecklistsMode(ctx));
        this.bot.action(/delete_checklist_(.+)/, (ctx) => this.deleteChecklist(ctx));
        this.bot.action('back_to_all_checklists', (ctx) => this.handleBackToChecklists(ctx));
    }

    // Helper method to create a standardized checklist object.
    // Delegates to @holons/core/checklists so the shape (incl. `created` ISO)
    // stays aligned across UIs.
    createChecklistObject(id, type, options = {}) {
        return coreCreateChecklistObject(id, type, options);
    }

    // Helper method to get display title for any checklist
    getChecklistDisplayTitle(checklist) {
        if (checklist.parentTitle) {
            return checklist.parentTitle;
        }
        return checklist.id.toUpperCase();
    }

    // Helper method to get checklist type display name
    getTypeDisplayName(type) {
        switch (type) {
            case CHECKLIST_TYPES.QUEST: return 'task';
            case CHECKLIST_TYPES.ROLE: return 'role task';
            case CHECKLIST_TYPES.AGENDA: return 'agenda';
            case CHECKLIST_TYPES.SHOPPING: return 'shopping list';
            case CHECKLIST_TYPES.CHECKLIST: 
            default: return 'checklist';
        }
    }


    async handleNewChecklistButton(ctx) {
        await ctx.answerCbQuery().catch();
        const originalMessageId = ctx.callbackQuery.message.message_id;
        const holonId = ctx.callbackQuery.message.chat.id;

        // Use InputScene for checklist name input
        return ctx.scene.enter('input_scene', {
            promptText: 'Please enter a name for the new checklist (no underscores allowed):',
            allowEmpty: false,
            validate: async (name, ctx) => {
                const holonId = ctx.chat.id;

                // Validate name: no underscores
                if (name.includes('_')) {
                    return { valid: false, error: 'Checklist names cannot contain underscores (_). Please try again without it.' };
                }

                // Check if checklist already exists
                if (await this.db.get(holonId.toString(), 'checklists', name)) {
                    return { valid: false, error: `Checklist "${name}" already exists.` };
                }

                return { valid: true };
            },
            onComplete: async (ctx, name) => {
                const holonId = ctx.chat.id;

                // Create the new empty checklist with standardized type
                const checklist = this.createChecklistObject(name, CHECKLIST_TYPES.CHECKLIST, { creator: ctx.from.id });

                await this.db.put(holonId.toString(), 'checklists', checklist);

                // Re-show the list of all checklists
                await this.showAllChecklists(ctx, { editMessageId: originalMessageId, holonId: holonId });
            }
        });
    }

    async showAllChecklists(ctx, options = {}) {
        const deleteMode = options.deleteMode || false;
        // Determine the message ID to edit: prioritize options, then callbackQuery
        const editMessageId = options.editMessageId || (ctx.callbackQuery ? ctx.callbackQuery.message.message_id : null);
        // Determine holon ID reliably: prioritize options, then ctx.chat, then callbackQuery
        const holonId = options.holonId || ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
    
        if (!holonId) {
            console.error("Could not determine holon ID in showAllChecklists");
            // Try answering callback query if possible before returning
            if (ctx.callbackQuery) await ctx.answerCbQuery("Error: Could not find chat.").catch(() => {});
            return;
        }

        let lists = await this.db.getAll(holonId.toString(), 'checklists');
        
        // Ensure all lists have a type, defaulting to 'checklist' for backward compatibility
        lists = lists.map(list => {
            if (!list.type) {
                // Migrate legacy checklists based on their properties
                if (['agenda', 'shopping'].includes(list.id)) {
                    list.type = list.id;
                } else if (list.questId || list.questTitle || list.isTaskChecklist) {
                    list.type = CHECKLIST_TYPES.QUEST;
                } else if (list.roleId || list.roleTitle || list.isRoleChecklist) {
                    list.type = CHECKLIST_TYPES.ROLE;
                } else {
                    list.type = CHECKLIST_TYPES.CHECKLIST;
                }
            }
            return list;
        });

        // Filter out subtask checklists and show only regular and special checklists
        lists = lists.filter(list => 
            list.type === CHECKLIST_TYPES.CHECKLIST || 
            list.type === CHECKLIST_TYPES.AGENDA || 
            list.type === CHECKLIST_TYPES.SHOPPING
        );
        
        const buttons = lists.map(list => {
            if (deleteMode) {
                return [Markup.button.callback(
                    `❌ ${this.getChecklistIcon(list)} ${this.getChecklistDisplayTitle(list)}`,
                    `delete_checklist_${list.id}`
                )];
            }
            const total = list.items.length;
            const checked = list.items.filter(item => item.checked).length;
            return [Markup.button.callback(
                `${this.getChecklistIcon(list)} ${this.getChecklistDisplayTitle(list)}: ${checked}/${total} completed`,
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
        
        const keyboard = Markup.inlineKeyboard(buttons);

        try {
            if (editMessageId) {
                 // Edit the specified message or the callback query message
                await ctx.telegram.editMessageText(holonId, editMessageId, null, message, keyboard);
            } else {
                // Reply if no specific message to edit (e.g., called by command)
                await ctx.reply(message, keyboard);
            }
             // Answer callback query ONLY if it exists and we attempted an edit based on it
            if (ctx.callbackQuery && options.editMessageId === null) { // Answer only if edit was triggered by this callback
                 await ctx.answerCbQuery().catch(() => {}); // Safely answer
            }
        } catch (error) {
            console.error(`Error in showAllChecklists (holonId: ${holonId}, editMessageId: ${editMessageId}, deleteMode: ${deleteMode}):`, error);
            // Ignore common "message is not modified" error, otherwise notify user if editing failed
            if (editMessageId && !(error.description && error.description.includes("message is not modified"))) {
                 // Check if we can reply in the context before doing so
                 if (ctx.reply) {
                    await ctx.reply("Failed to update the checklist list.").catch(() => {});
                 } else {
                    // Fallback if ctx.reply isn't available (e.g., from scene with minimal context)
                    await this.bot.telegram.sendMessage(holonId, "Failed to update the checklist list.").catch(() => {});
                 }
            }
             // Still attempt to answer callback query on error if applicable
            if (ctx.callbackQuery && options.editMessageId === null) {
                 await ctx.answerCbQuery("Error updating list").catch(() => {});
            }
        }
    }

    async createChecklist(ctx) {
        const name = ctx.message.text.split('/newchecklist ')[1]?.trim(); // Extract name after command
        
        // Delete the user's command message immediately
        await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
        
        if (!name) {
             await ctx.reply('Please specify a checklist name. eg: /newchecklist morning')
                         .then(msg => setTimeout(() => ctx.deleteMessage(msg.message_id).catch(() => {}), 5000)); // Delete after 5s
            return;
        }

        // Validate name: no underscores
        if (name.includes('_')) {
             await ctx.reply('Checklist names cannot contain underscores (_). Please use a different name.')
                         .then(msg => setTimeout(() => ctx.deleteMessage(msg.message_id).catch(() => {}), 5000)); // Delete after 5s
            return;
        }

        let holonId = ctx.chat.id;
        if (await this.db.get(holonId.toString(), 'checklists', name)) {
             await ctx.reply(`Checklist "${name}" already exists.`)
                         .then(msg => setTimeout(() => ctx.deleteMessage(msg.message_id).catch(() => {}), 5000)); // Delete after 5s
            return;
        }

        // Create the new empty checklist with standardized type
        const checklist = this.createChecklistObject(name, CHECKLIST_TYPES.CHECKLIST, { creator: ctx.from.id });

        await this.db.put(holonId.toString(), 'checklists', checklist);
        
        // Confirm creation and delete the confirmation after a few seconds
         await ctx.reply(`Created checklist "${name}".`)
                     .then(msg => setTimeout(() => ctx.deleteMessage(msg.message_id).catch(() => {}), 3000)); // Delete after 3s
                     
        // Optionally: Show the list of all checklists again if the command was likely used from a general context
        // await this.showAllChecklists(ctx); 
        
        // Or show the newly created empty checklist
        // await ctx.reply(`📋 ${name.toUpperCase()} Checklist:`, this.getChecklistKeyboard(checklist));
    }

    async addChecklistItem(ctx) {
        const [_, listName, ...itemWords] = ctx.message.text.split(/\s+/);
        if (!listName || itemWords.length === 0) {
            ctx.reply('Please specify list name and items. eg: /addcheck morning brush teeth, make bed, exercise');
            return;
        }

        await this.addItemsToChecklist(listName, itemWords.join(' '), ctx.chat.id, ctx);
    }

    async directAddItem(ctx) {
        const text = ctx.message.text.trim();
        
        // Check command format
        if (text === '/additem' || !text.includes(' ')) {
            ctx.reply('Please use format: /additem [checklist-name] [item1, item2, item3]');
            return;
        }
        
        // Extract checklist name and items
        const withoutCommand = text.substring(8).trim();
        const firstSpace = withoutCommand.indexOf(' ');
        
        if (firstSpace === -1) {
            ctx.reply('Please provide items to add. Format: /additem [checklist-name] [item1, item2, item3]');
            return;
        }
        
        const checklistId = withoutCommand.substring(0, firstSpace).trim();
        const itemsText = withoutCommand.substring(firstSpace + 1).trim();
        
        if (!itemsText) {
            ctx.reply('Please provide items to add. Format: /additem [checklist-name] [item1, item2, item3]');
            return;
        }
        
        const holonId = ctx.chat.id;
        
        try {
            // Get or create the checklist
            const checklist = await this.db.get(holonId.toString(), 'checklists', checklistId);

            if (!checklist) {
                // Check if this might be a quest ID instead, by looking for a quest with this ID
                const quest = await this.db.get(holonId.toString(), 'quests', checklistId);
                
                if (quest) {
                    // This might be a quest's task list - check if it has a checklistId
                    if (quest.checklistId) {
                        // Try to get the actual checklist
                        const questChecklist = await this.db.get(holonId.toString(), 'checklists', quest.checklistId.toString());
                        if (questChecklist) {
                            // Process items for the quest's checklist
                            return await this.processChecklistItems(questChecklist, itemsText, holonId, ctx);
                        }
                    }
                    
                    // Checklist doesn't exist yet, but this is a valid quest ID
                    // Create a new checklist for this quest
                    const newChecklist = this.createChecklistObject(checklistId, CHECKLIST_TYPES.QUEST, {
                        creator: ctx.from.id,
                        questId: quest.id,
                        parentTitle: quest.title,
                        holonId: holonId
                    });
                    
                    return await this.processChecklistItems(newChecklist, itemsText, holonId, ctx);
                }
                
                // Check if this might be a role ID instead
                const role = await this.db.get(holonId.toString(), 'roles', checklistId);

                if (role) {
                    // This might be a role's task list - check if it has a checklistId
                    if (role.checklistId) {
                        // Try to get the actual checklist
                        const roleChecklist = await this.db.get(holonId.toString(), 'checklists', role.checklistId.toString());
                        if (roleChecklist) {
                            // Process items for the role's checklist
                            return await this.processChecklistItems(roleChecklist, itemsText, holonId, ctx);
                        }
                    }
                    
                    // Checklist doesn't exist yet, but this is a valid role ID
                    // Create a new checklist for this role
                    const newChecklist = this.createChecklistObject(checklistId, CHECKLIST_TYPES.ROLE, {
                        creator: ctx.from.id,
                        roleId: role.id,
                        parentTitle: role.title,
                        holonId: holonId
                    });
                    
                    return await this.processChecklistItems(newChecklist, itemsText, holonId, ctx);
                }
                
                // Create a new regular checklist
                const newChecklist = this.createChecklistObject(checklistId, CHECKLIST_TYPES.CHECKLIST, {
                    creator: ctx.from.id
                });
                
                return await this.processChecklistItems(newChecklist, itemsText, holonId, ctx);
            }
            
            // Existing checklist found - Migrate legacy type if needed
            if (!checklist.type) {
                if (['agenda', 'shopping'].includes(checklist.id)) {
                    checklist.type = checklist.id;
                } else if (checklist.questId || checklist.questTitle || checklist.isTaskChecklist) {
                    checklist.type = CHECKLIST_TYPES.QUEST;
                } else if (checklist.roleId || checklist.roleTitle || checklist.isRoleChecklist) {
                    checklist.type = CHECKLIST_TYPES.ROLE;
                } else {
                    checklist.type = CHECKLIST_TYPES.CHECKLIST;
                }
            }
            return await this.processChecklistItems(checklist, itemsText, holonId, ctx);
            
        } catch (error) {
            console.error('Error adding items with /additem command:', error);
            ctx.reply('Error adding items to checklist');
        }
    }
    
    // Helper method to process items for a checklist
    async processChecklistItems(checklist, itemsText, holonId, ctx) {
        // Parse and add items
        const newItems = itemsText.split(',').map(text => ({
            text: text.trim(),
            checked: false
        })).filter(item => item.text);
        
        if (newItems.length === 0) {
            ctx.reply('No valid items found. Please use comma-separated list: /additem [checklist-name] [item1, item2, item3]');
            return null;
        }
        
        // Add the items to the checklist
        checklist.items.push(...newItems);
        await this.db.put(holonId.toString(), 'checklists', checklist);
        
        // Show success message with added items
        const addedItemsText = newItems.map(item => `"${item.text}"`).join(', ');
        const checklistTypeName = this.getTypeDisplayName(checklist.type);
        const displayTitle = this.getChecklistDisplayTitle(checklist);
        ctx.reply(`Added ${newItems.length} items to ${checklistTypeName} "${displayTitle}": ${addedItemsText}`);
        
        // Show the updated checklist
        await ctx.reply(
            `${this.getChecklistIcon(checklist)} ${displayTitle}:`,
            this.getChecklistKeyboard(checklist)
        );
        
        return checklist;
    }

    async removeChecklistItem(ctx) {
        const [_, listName, ...itemWords] = ctx.message.text.split(/\s+/);
        if (!listName || itemWords.length === 0) {
            ctx.reply('Please specify list name and item. eg: /removeitem morning "brush teeth"');
            return;
        }

        const itemText = itemWords.join(' ');
        let holonId = ctx.chat.id;
        let checklist = await this.db.get(holonId.toString(), 'checklists', listName);

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

        await this.db.put(holonId.toString(), 'checklists', checklist);
        ctx.reply(`Removed "${itemText}" from checklist "${listName}".`);
    }

    async removeChecklist(ctx) {
        const name = ctx.message.text.split('/removelist ')[1];
        if (!name) {
            ctx.reply('Please specify a checklist name. eg: /removelist morning');
            return;
        }

        let holonId = ctx.chat.id;
        await this.db.delete(holonId.toString(), 'checklists', name);
        ctx.reply(`Removed checklist "${name}".`);
    }

    async showChecklist(ctx, checklistId) {
        const holonId = ctx.callbackQuery.message.chat.id;
        if (!checklistId) {
            await ctx.answerCbQuery('No checklist ID provided');
            return;
        }
        try {
            const checklist = await this.db.get(holonId.toString(), 'checklists', checklistId);
            if (!checklist) {
                await ctx.answerCbQuery('Checklist not found');
                return;
            }

            // Edit current message to show checklist
            await ctx.editMessageText(
                `${this.getChecklistIcon(checklist)} ${this.getChecklistDisplayTitle(checklist)}:`,
                this.getChecklistKeyboard(checklist)
            ).catch((err) => { console.log(err) });
            
            await ctx.answerCbQuery().catch()
        } catch (error) {
            console.error('Error showing checklist:', error);
            await ctx.answerCbQuery('Error displaying checklist');
        }
    }

    async toggleCheckItem(ctx) {
        const [listName, itemIndex] = ctx.match[1].split('_');
        let holonId = ctx.chat.id;
        let checklist = await this.db.get(holonId.toString(), 'checklists', listName);

        if (!checklist || !checklist.items[itemIndex]) {
            await ctx.answerCbQuery('Item not found');
            return;
        }

        checklist.items[itemIndex].checked = !checklist.items[itemIndex].checked;
        await this.db.put(holonId.toString(), 'checklists', checklist);

        const icon = this.getChecklistIcon(checklist);
        const title = `${icon} ${this.getChecklistDisplayTitle(checklist)}:`;

        await ctx.editMessageText(
            title,
            this.getChecklistKeyboard(checklist)
        ).catch(error => console.log(error));
    }

    async handleChecklistButton(ctx) {
        await ctx.answerCbQuery().catch()
        const listName = ctx.match[1];
        let holonId = ctx.chat.id;
        let checklist = await this.db.get(holonId.toString(), 'checklists', listName);
        
        if (!checklist) {
            console.log(`Checklist "${listName}" not found for chat ${holonId}.`);
            return;
        }

        // Migrate legacy checklist type if needed
        if (!checklist.type) {
            if (['agenda', 'shopping'].includes(checklist.id)) {
                checklist.type = checklist.id;
            } else if (checklist.questId || checklist.questTitle || checklist.isTaskChecklist) {
                checklist.type = CHECKLIST_TYPES.QUEST;
            } else if (checklist.roleId || checklist.roleTitle || checklist.isRoleChecklist) {
                checklist.type = CHECKLIST_TYPES.ROLE;
            } else {
                checklist.type = CHECKLIST_TYPES.CHECKLIST;
            }
        }

        // Get the standard keyboard
        const keyboardMarkup = this.getChecklistKeyboard(checklist, false);

        // Add "Back to Checklists" button if it's a regular checklist 
        // (not special and not a quest checklist which has its own back button)
        if (!this.isSpecialChecklist(checklist.id) && !checklist.questId) {
            const backButton = [Markup.button.callback('🔙 Back to Checklists', 'back_to_all_checklists')];
            // Ensure inline_keyboard exists before pushing
            if (keyboardMarkup.reply_markup && keyboardMarkup.reply_markup.inline_keyboard) {
                 keyboardMarkup.reply_markup.inline_keyboard.push(backButton);
            } else {
                // Fallback or create structure if needed, though getChecklistKeyboard should provide it
                 keyboardMarkup.reply_markup = { inline_keyboard: [backButton] }; 
            }
        }

        // Edit the message to show the checklist
        const icon = this.getChecklistIcon(listName);
        await ctx.editMessageText(
            `${icon} ${listName.toUpperCase()} Checklist:`, 
            keyboardMarkup
        ).catch(error => console.log(`Error editing message for checklist ${listName}:`, error));
    }

    async clearChecklist(ctx) {
        const listName = ctx.match[1];
        let holonId = ctx.chat.id;
        let checklist = await this.db.get(holonId.toString(), 'checklists', listName);

        if (!checklist) {
            await ctx.answerCbQuery('Checklist not found');
            return;
        }

        if (checklist.type === CHECKLIST_TYPES.AGENDA) {
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

        await this.db.put(holonId.toString(), 'checklists', checklist);
        
        const icon = this.getChecklistIcon(checklist);
        const title = `${icon} ${this.getChecklistDisplayTitle(checklist)}:`;

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
        if (checklist.type === CHECKLIST_TYPES.AGENDA || checklist.type === CHECKLIST_TYPES.SHOPPING) {
            const clearText = checklist.type === CHECKLIST_TYPES.AGENDA ? '🗑️ Remove Checked' : '🗑️ Clear Completed';
            buttons.push([
                Markup.button.callback('➕ Add Item', `add_item_to_${checklist.id}`),
                Markup.button.callback(clearText, `clear_checklist_${checklist.id}`)
            ]);
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
            if (checklist.type === CHECKLIST_TYPES.QUEST) {
                buttons.push([
                    Markup.button.callback(
                        i18next.t('back_to_task'),
                        `back_to_quest_${checklist.holonId}_${checklist.questId}`
                    )
                ]);
            }
            
            // Add back button for role checklists
            if (checklist.type === CHECKLIST_TYPES.ROLE) {
                buttons.push([
                    Markup.button.callback(
                        'Back to Role',
                        `back_to_role_${checklist.roleId}`
                    )
                ]);
            }
        }

        return Markup.inlineKeyboard(buttons);
    }

    async handleAddItemButton(ctx) {
        await ctx.answerCbQuery().catch();
        const checklistId = ctx.match[1];
        const originalMessageId = ctx.callbackQuery.message.message_id;
        const holonId = ctx.callbackQuery.message.chat.id;

        // Use InputScene for checklist item input
        return ctx.scene.enter('input_scene', {
            promptText: 'Please enter the new items (comma-separated for multiple items):',
            inputType: 'array',
            allowEmpty: false,
            onComplete: async (ctx, newItemsArray) => {
                const holonId = ctx.chat.id;

                try {
                    const checklist = await this.db.get(holonId.toString(), 'checklists', checklistId.toString()) ||
                        this.createChecklistObject(checklistId, CHECKLIST_TYPES.CHECKLIST, { creator: ctx.from.id });

                    // Convert array items to checklist item objects
                    const newItems = newItemsArray.map(text => ({
                        text: text,
                        checked: false
                    }));

                    // Add items
                    if (newItems.length > 0) {
                        checklist.items.push(...newItems);
                        await this.db.put(holonId.toString(), 'checklists', checklist);
                    }

                    // Update the original checklist message
                    const icon = this.getChecklistIcon(checklist);
                    await ctx.telegram.editMessageText(
                        holonId,
                        originalMessageId,
                        null,
                        `${icon} ${this.getChecklistDisplayTitle(checklist)}:`,
                        this.getChecklistKeyboard(checklist)
                    );

                } catch (error) {
                    console.error('Error adding items to checklist:', error);
                    await ctx.reply('Error adding items to checklist');
                }
            }
        });
    }

    async handleDummyAction(ctx) {
        await ctx.answerCbQuery().catch()
        await ctx.reply('This action is not available.');
    }

    async enterRemoveMode(ctx) {
        await ctx.answerCbQuery().catch()
        const listName = ctx.match[1];
        let holonId = ctx.chat.id;
        let checklist = await this.db.get(holonId.toString(), 'checklists', listName);
        
        if (!checklist) {
            // Use reply or editMessageText based on context
            if (ctx.callbackQuery) {
                await ctx.editMessageText(`Checklist "${listName}" not found.`).catch(error => console.log(error));
            } else {
                await ctx.reply(`Checklist "${listName}" not found.`);
            }
            return;
        }

        // Edit the message to show remove mode
        await ctx.editMessageText(
            `📋 ${listName.toUpperCase()} Checklist:\nSelect items to remove:`,
            this.getChecklistKeyboard(checklist, true)
        ).catch(error => {
            console.log(`Error entering remove mode for ${listName}:`, error);
            // Attempt to inform user if edit failed
             ctx.reply("Error entering remove mode.").catch(() => {});
        });
    }

    async exitRemoveMode(ctx) {
        await ctx.answerCbQuery().catch()
        const listName = ctx.match[1];
        // Use the logic within showChecklistKeyboard for editing back to normal view
        await this.handleChecklistButton(ctx); // Re-show the checklist in normal mode
    }

    async removeItem(ctx) {
        await ctx.answerCbQuery().catch()
        const [listName, itemIndex] = ctx.match[1].split('_');
        let holonId = ctx.chat.id;
        let checklist = await this.db.get(holonId.toString(), 'checklists', listName);

        if (!checklist || !checklist.items[itemIndex]) {
            ctx.reply('Item not found.');
            return;
        }

        // Store the item text before removing it
        const removedItemText = checklist.items[itemIndex].text;

        // Remove the item
        checklist.items = checklist.items.filter((_, index) => index !== parseInt(itemIndex));
        await this.db.put(holonId.toString(), 'checklists', checklist);

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

        let holonId = ctx.chat.id;
        let checklist = await this.db.get(holonId.toString(), 'checklists', listName);

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
        await this.db.put(holonId.toString(), 'checklists', checklist);

        const removedCount = initialLength - checklist.items.length;
        const removedItems = checkedItems.map(item => `"${item.text}"`).join(', ');
        
        await ctx.reply(`Removed ${removedCount} checked items from checklist "${listName}": ${removedItems}`);
        
        // Show the updated checklist
        await ctx.reply(
            `📋 ${listName.toUpperCase()} Checklist:`, 
            this.getChecklistKeyboard(checklist)
        );
    }

    async addItemsToChecklist(listName, itemsText, holonId, ctx) {
        let checklist = await this.db.get(holonId.toString(), 'checklists', listName);

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
        await this.db.put(holonId.toString(), 'checklists', checklist);

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
        const [holonId, questId] = ctx.match[1].split('_');
        
        try {
            const quest = await this.db.get(holonId.toString(), 'quests', questId);
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
            await ctx.answerCbQuery().catch()

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
        const holonId = ctx.chat.id;
        let checklist = await this.db.get(holonId.toString(), 'checklists', type) || {
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
    isSpecialChecklist(checklist) {
        // Handle legacy calls with just ID
        if (typeof checklist === 'string') {
            return ['agenda', 'shopping'].includes(checklist);
        }
        
        // New type-based logic
        return checklist.type === CHECKLIST_TYPES.AGENDA || checklist.type === CHECKLIST_TYPES.SHOPPING;
    }

    // Helper method to get checklist icon
    getChecklistIcon(checklist) {
        // Handle legacy calls with just ID
        if (typeof checklist === 'string') {
            switch(checklist) {
                case 'agenda': return '📅';
                case 'shopping': return '🛒';
                default: return '📋';
            }
        }
        
        // New type-based logic
        switch(checklist.type) {
            case CHECKLIST_TYPES.AGENDA: return '📅';
            case CHECKLIST_TYPES.SHOPPING: return '🛒';
            case CHECKLIST_TYPES.QUEST: return '📋';
            case CHECKLIST_TYPES.ROLE: return '👥';
            case CHECKLIST_TYPES.CHECKLIST:
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
        await ctx.answerCbQuery().catch()
        // Pass deleteMode option
        await this.showAllChecklists(ctx, { deleteMode: true });
    }

    async exitDeleteChecklistsMode(ctx) {
        await ctx.answerCbQuery().catch()
        // Pass deleteMode option
        await this.showAllChecklists(ctx, { deleteMode: false });
    }

    async deleteChecklist(ctx) {
        const listName = ctx.match[1];
        let holonId = ctx.chat.id;

        // Get the checklist to check its type
        const checklist = await this.db.get(holonId.toString(), 'checklists', listName);

        // Don't allow deletion of special checklists
        if (checklist && this.isSpecialChecklist(checklist)) {
            await ctx.answerCbQuery('Cannot delete special checklists');
            return;
        }

        await this.db.delete(holonId.toString(), 'checklists', listName);
        await ctx.answerCbQuery(`Deleted checklist "${listName}"`);
        
        // Refresh the delete mode view using options
        await this.showAllChecklists(ctx, { deleteMode: true });
    }

    // Method to handle going back to the list of all checklists
    async handleBackToChecklists(ctx) {
        await ctx.answerCbQuery().catch()
        // Call showAllChecklists using options, it will edit the message 
        await this.showAllChecklists(ctx, {});
    }

    async handleBackToRole(ctx) {
        const roleId = ctx.match[1];
        
        try {
            if (!this.rolesInstance) {
                console.error('Roles instance not set');
                await ctx.answerCbQuery('Error: Cannot return to role');
                return;
            }

            // Use the roles instance's handleBackToRole method to rerender the role
            await this.rolesInstance.handleBackToRole(ctx);

        } catch (error) {
            console.error('Error handling back to role:', error);
            await ctx.answerCbQuery('Error returning to role');
        }
    }

    // Add a method to get the roles instance
    async getRolesInstance() {
        // This should be set from outside after construction
        if (!this.rolesInstance) {
            console.error('Roles instance not set');
            return null;
        }
        return this.rolesInstance;
    }

    // Add a method to set the roles instance
    setRolesInstance(rolesInstance) {
        this.rolesInstance = rolesInstance;
        console.log('Roles instance set successfully');
    }
}

export default Checklists;
export { CHECKLIST_TYPES }; 