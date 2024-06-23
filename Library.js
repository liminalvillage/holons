import { Markup } from 'telegraf';

class Library {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
        this.bot.command('additem', (ctx) => this.add(ctx));
        this.bot.command('book', (ctx) => this.book(ctx));
        this.bot.command('return', (ctx) => this.return(ctx));
        this.bot.command('inventory', (ctx) => this.inventory(ctx));
        this.bot.action(/book_(.+)/, (ctx) => this.toggleBookStatus(ctx, true));
        this.bot.action(/return_(.+)/, (ctx) => this.toggleBookStatus(ctx, false));
    }

    async add(ctx) {
        let chatID = ctx.chat.id;
        const item = ctx.message.text.split('/add ')[1];
        if (!item) {
            ctx.reply('Please specify an item to add. eg: /add hammer');
            return;
        }
        if(await this.db.get(chatID + '/library',item)) {
            ctx.reply(`${item} is already in the library.`);
            return;
        }

        await this.db.put(chatID + '/library', { id: item, booked: false });
        ctx.reply(`Added ${item} to the library.`);
    }

    async book(ctx) {
        let chatID = ctx.chat.id;
        const item = ctx.message.text.split('/book ')[1];
        if (!item) {
            ctx.reply('Please specify an item to book. eg: /book hammer');
            return;
        }

        let currentItem = await this.db.get(chatID + '/library',item);
        if (!currentItem) {
            ctx.reply(`${item} is not in the library.`);
            return;
        }
        if(currentItem.booked) {
            ctx.reply(`${item} is already booked.`);
            return;
        }

        currentItem.booked = true;
        await this.db.put(chatID + '/library',currentItem);
        ctx.reply(`You booked ${item}.`);
    }

    async return(ctx) {
        let chatID = ctx.chat.id;
        const item = ctx.message.text.split('/return ')[1];
        if (!item) {
            ctx.reply('Please specify an item to return. eg: /return hammer');
            return;
        }

        let currentItem = await this.db.get(item);
        if (!currentItem) {
            ctx.reply(`${item} is not in the library.`);
            return;
        }
        if(!currentItem.booked) {
            ctx.reply(`${item} is not booked.`);
            return;
        }

        currentItem.booked = false;
        await this.db.put(chatID + '/library',currentItem);
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
            mu.push([Markup.button.callback(item.id + (item.booked ? ' (booked)' : ''), item.booked ? `return_${item.id}` : `book_${item.id}`)]);
        })
        return Markup.inlineKeyboard(mu);
    }

    async toggleBookStatus(ctx, isBooking) {
        let chatID = ctx.chat.id;
        const itemId = ctx.match[1];
        

        let currentItem = await this.db.get(chatID + '/library',itemId);
        if (!currentItem) {
            ctx.reply(`${itemId} is not in the library.`);
            return;
        }

        currentItem.booked = isBooking;
        await this.db.put(chatID + '/library',currentItem);
        ctx.editMessageText(`${isBooking ? 'Booked' : 'Returned'} ${itemId}`).catch((error) => { console.log(error) });
    }

    async getLibraryItems(ctx) {
        let chatID = ctx.chat.id;
        let list = await this.db.getAll(chatID + '/library');
        //list.sort((a, b) => a.id.localeCompare(b.id));
        return list;
    }
}

export default Library