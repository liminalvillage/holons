import { Markup, Scenes } from 'telegraf';

class Checklists {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
        
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
        this.bot.command('checklists', (ctx) => this.showAllChecklists(ctx));
        this.bot.action(/check_(.+)/, (ctx) => this.toggleCheckItem(ctx));
        this.bot.action(/show_checklist_(.+)/, (ctx) => this.handleChecklistButton(ctx));
        this.bot.action(/clear_checklist_(.+)/, (ctx) => this.clearChecklist(ctx));
        this.bot.action(/add_item_to_(.+)/, (ctx) => this.handleAddItemButton(ctx));
        this.bot.action('new_checklist', (ctx) => this.handleNewChecklistButton(ctx));
        this.bot.action('dummy_action', (ctx) => this.handleDummyAction(ctx));
    }

    setupScenes() {
        // Setup add item scene
        this.addItemScene.enter(async (ctx) => {
            await ctx.reply('Please enter the new item text:');
        });

        this.addItemScene.on('text', async (ctx) => {
            const itemText = ctx.message.text;
            const listName = ctx.session.currentChecklist;
            const chatId = ctx.chat.id;
            
            let checklist = await this.db.get(chatId + '/checklists', listName);
            
            if (!checklist) {
                await ctx.reply(`Checklist "${listName}" not found.`);
                return ctx.scene.leave();
            }

            checklist.items.push({
                text: itemText,
                checked: false
            });

            await this.db.put(chatId + '/checklists', checklist);
            await ctx.reply(`Added "${itemText}" to checklist "${listName}".`);
            
            // Show the updated checklist
            await ctx.reply(
                `📋 ${listName.toUpperCase()} Checklist:`, 
                this.getChecklistKeyboard(checklist)
            );
            
            return ctx.scene.leave();
        });

        // Setup new checklist scene
        this.newChecklistScene.enter(async (ctx) => {
            await ctx.reply('Please enter a name for the new checklist:');
        });

        this.newChecklistScene.on('text', async (ctx) => {
            const name = ctx.message.text;
            const chatId = ctx.chat.id;
            
            if (await this.db.get(chatId + '/checklists', name)) {
                await ctx.reply(`Checklist "${name}" already exists.`);
                return ctx.scene.leave();
            }

            const checklist = {
                id: name,
                items: [],
                creator: ctx.from.id,
                created: new Date()
            };

            await this.db.put(chatId + '/checklists', checklist);
            await ctx.reply(`Created checklist "${name}".`);
            
            // Show updated list of checklists
            await this.showAllChecklists(ctx);
            return ctx.scene.leave();
        });
    }

    async handleNewChecklistButton(ctx) {
        await ctx.answerCbQuery();
        await ctx.scene.enter('new_checklist_scene');
    }

    async showAllChecklists(ctx) {
        let chatID = ctx.chat.id;
        let lists = await this.db.getAll(chatID + '/checklists');
        
        const buttons = lists.map(list => {
            const total = list.items.length;
            const checked = list.items.filter(item => item.checked).length;
            return [Markup.button.callback(
                `📋 ${list.id}: ${checked}/${total} completed`,
                `show_checklist_${list.id}`
            )];
        });

        // Add "New Checklist" button at the bottom
        buttons.push([
            Markup.button.callback('➕ New Checklist', 'new_checklist')
        ]);

        ctx.reply(
            'Available Checklists:',
            Markup.inlineKeyboard(buttons)
        );
    }

    async createChecklist(ctx) {
        const [_, name, ...items] = ctx.message.text.split(/\s+/);
        if (!name) {
            ctx.reply('Please specify a checklist name. eg: /newchecklist morning');
            return;
        }

        let chatID = ctx.chat.id;
        if (await this.db.get(chatID + '/checklists', name)) {
            ctx.reply(`Checklist "${name}" already exists.`);
            return;
        }

        const checklist = {
            id: name,
            items: items.map(item => ({
                text: item,
                checked: false
            })),
            creator: ctx.from.id,
            created: new Date()
        };

        await this.db.put(chatID + '/checklists', checklist);
        ctx.reply(`Created checklist "${name}"${items.length ? ' with initial items' : ''}.`);
    }

    async addChecklistItem(ctx) {
        const [_, listName, ...itemWords] = ctx.message.text.split(/\s+/);
        if (!listName || itemWords.length === 0) {
            ctx.reply('Please specify list name and item. eg: /additem morning brush teeth');
            return;
        }

        const itemText = itemWords.join(' ');
        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', listName);
        
        if (!checklist) {
            ctx.reply(`Checklist "${listName}" not found.`);
            return;
        }

        checklist.items.push({
            text: itemText,
            checked: false
        });

        await this.db.put(chatID + '/checklists', checklist);
        ctx.reply(`Added "${itemText}" to checklist "${listName}".`);
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

    async showChecklist(ctx) {
        const name = ctx.message.text.split('/checklist ')[1];
        if (!name) {
            ctx.reply('Please specify a checklist name. eg: /checklist morning');
            return;
        }

        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', name);
        
        if (!checklist) {
            ctx.reply(`Checklist "${name}" not found.`);
            return;
        }

        if (checklist.items.length === 0) {
            ctx.reply(`Checklist "${name}" is empty.`);
            return;
        }

        ctx.reply(`📋 ${name.toUpperCase()} Checklist:`, this.getChecklistKeyboard(checklist));
    }

    async toggleCheckItem(ctx) {
        const [listName, itemIndex] = ctx.match[1].split('_');
        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', listName);
        
        if (!checklist || !checklist.items[itemIndex]) {
            ctx.reply('Item not found.');
            return;
        }

        checklist.items[itemIndex].checked = !checklist.items[itemIndex].checked;
        await this.db.put(chatID + '/checklists', checklist);

        ctx.editMessageText(
            `📋 ${listName.toUpperCase()} Checklist:`,
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

        // Always show the checklist, even if empty
        await ctx.reply(`📋 ${listName.toUpperCase()} Checklist:`, this.getChecklistKeyboard(checklist));
    }

    async clearChecklist(ctx) {
        const listName = ctx.match[1];
        let chatID = ctx.chat.id;
        let checklist = await this.db.get(chatID + '/checklists', listName);
        
        if (!checklist) {
            ctx.reply(`Checklist "${listName}" not found.`);
            return;
        }

        checklist.items = checklist.items.map(item => ({
            ...item,
            checked: false
        }));

        await this.db.put(chatID + '/checklists', checklist);
        
        ctx.editMessageText(
            `📋 ${listName.toUpperCase()} Checklist:`,
            this.getChecklistKeyboard(checklist)
        ).catch(error => console.log(error));
    }

    getChecklistKeyboard(checklist) {
        let buttons = [];
        
        // Add item buttons if there are any
        if (checklist.items.length > 0) {
            buttons = checklist.items.map((item, index) => {
                const status = item.checked ? '✅' : '⬜️';
                return [Markup.button.callback(
                    `${status} ${item.text}`,
                    `check_${checklist.id}_${index}`
                )];
            });
        }

        // Always add the control buttons in a single row, even if list is empty
        buttons.push([
            Markup.button.callback(
                '➕ Add Item',
                `add_item_to_${checklist.id}`
            ),
            Markup.button.callback(
                '🔄 Clear All',
                `clear_checklist_${checklist.id}`
            )
        ]);

        return Markup.inlineKeyboard(buttons);
    }

    async handleAddItemButton(ctx) {
        await ctx.answerCbQuery();
        const listName = ctx.match[1];
        ctx.session.currentChecklist = listName;
        await ctx.scene.enter('add_item_scene');
    }

    async handleDummyAction(ctx) {
        await ctx.answerCbQuery();
        await ctx.reply('This action is not available.');
    }
}

export default Checklists; 