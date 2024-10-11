import { Markup } from 'telegraf';

class Library {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
        this.bot.command('additem', (ctx) => this.addItem(ctx));
        this.bot.command('borrow', (ctx) => this.borrowItem(ctx));
        this.bot.command('return', (ctx) => this.returnItem(ctx));
        this.bot.command('inventory', (ctx) => this.inventory(ctx));
        this.bot.action(/borrow_(.+)/, (ctx) => this.toggleItemStatus(ctx, true));
        this.bot.action(/return_(.+)/, (ctx) => this.toggleItemStatus(ctx, false));
    }

    async addItem(ctx) {
        let chatID = ctx.chat.id;
        const item = ctx.message.text.split('/additem ')[1];
        if (!item) {
            ctx.reply('Please specify an item to add. eg: /additem hammer');
            return;
        }
        if(await this.db.get(chatID + '/library', item)) {
            ctx.reply(`${item} is already in the library.`);
            return;
        }

        await this.db.put(chatID + '/library', { id: item, borrowed: false });
        ctx.reply(`Added ${item} to the library.`);
    }

    async borrowItem(ctx) {
        let chatID = ctx.chat.id;
        const item = ctx.message.text.split('/borrow ')[1];
        if (!item) {
            ctx.reply('Please specify an item to borrow. eg: /borrow hammer');
            return;
        }

        let currentItem = await this.db.get(chatID + '/library', item);
        if (!currentItem) {
            ctx.reply(`${item} is not in the library.`);
            return;
        }
        if(currentItem.borrowed) {
            ctx.reply(`${item} is already borrowed.`);
            return;
        }

        currentItem.borrowed = true;
        await this.db.put(chatID + '/library', currentItem);
        ctx.reply(`You borrowed ${item}.`);
    }

    async returnItem(ctx) {
        let chatID = ctx.chat.id;
        const item = ctx.message.text.split('/return ')[1];
        if (!item) {
            ctx.reply('Please specify an item to return. eg: /return hammer');
            return;
        }

        let currentItem = await this.db.get(chatID + '/library', item);
        if (!currentItem) {
            ctx.reply(`${item} is not in the library.`);
            return;
        }
        if(!currentItem.borrowed) {
            ctx.reply(`${item} is not borrowed.`);
            return;
        }

        currentItem.borrowed = false;
        await this.db.put(chatID + '/library', currentItem);
        ctx.reply(`You returned ${item}.`);
    }

    async inventory(ctx) {
        let list = await this.getLibraryItems(ctx);
        if (list.length === 0) {
            ctx.reply('The library is empty.');
            return;
        }
        ctx.reply('Here is the library inventory:', this.getLibraryKeyboard(list));
    }

    getLibraryKeyboard(list) {
        let mu = [];
        list.forEach(function (item) {
            mu.push([Markup.button.callback(item.id + (item.borrowed ? ' (borrowed)' : ''), item.borrowed ? `return_${item.id}` : `borrow_${item.id}`)]);
        })
        return Markup.inlineKeyboard(mu);
    }

    async toggleItemStatus(ctx, isBorrowing) {
        let chatID = ctx.chat.id;
        const itemId = ctx.match[1];
        
        let currentItem = await this.db.get(chatID + '/library', itemId);
        if (!currentItem) {
            ctx.reply(`${itemId} is not in the library.`);
            return;
        }

        currentItem.borrowed = isBorrowing;
        await this.db.put(chatID + '/library', currentItem);
        ctx.editMessageText(`${isBorrowing ? 'Borrowed' : 'Returned'} ${itemId}`).catch((error) => { console.log(error) });
    }

    async getLibraryItems(ctx) {
        let chatID = ctx.chat.id;
        let list = await this.db.getAll(chatID + '/library');
        list.sort((a, b) => a.id.localeCompare(b.id));
        return list;
    }
}

export default Library;