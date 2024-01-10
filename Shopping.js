import { Markup } from 'telegraf';
import * as utils from './utilities.js';


export class Shopping {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
        this.bot.command('buy', (ctx) => this.buy(ctx));
        this.bot.command('shopping', (ctx) => this.shopping(ctx));
        this.bot.action(/toggle_(.+)/, (ctx) => this.toggle(ctx));
        this.bot.action('done', (ctx) => this.done(ctx));
    }

    async buy(ctx) {
        let chatID = ctx.chat.id;
        //let item = ctx.message.text.split(' ').slice(1).join(' ')
        let items = utils.parseList(ctx.message.text)
        if (!items) {
            ctx.reply('Please specify an item to buy. eg: /buy milk');
            return;
        }
        let shoppingDB = await this.db.docs('WeQuest.' + chatID.toString() + '.shopping')
        await shoppingDB.load()
        for (let item of items)
            await shoppingDB.put({ id: item, done: false, from: ctx.from.username });
  
        ctx.reply(`Added ${items.join(", ")} to the shopping list.`);
    }

    async shopping(ctx) {
        let list = await this.getShoppingList(ctx)
        if (list.length === 0) {
            ctx.reply('Your shopping list is empty. Use /buy to add items.');
            return;
        }
        ctx.reply('Here is your shopping list:', this.getShoppingListKeyboard(list));
    }

    async toggle(ctx) {
        let chatID = ctx.chat.id;
        const index = parseInt(ctx.match[1]);
        const list = await this.getShoppingList(ctx);
        list[index].done = !list[index].done;
        let shoppingDB = await this.db.docs('WeQuest.' + chatID.toString() + '.shopping')
        await shoppingDB.load()
        shoppingDB.put(list[index])
        ctx.editMessageText('Here is your shopping list:', this.getShoppingListKeyboard(list)).catch((error) => {console.log(error)  });
    }

    async done(ctx) {
        
        let chatID = ctx.chat.id;
        let shoppingDB = await this.db.docs('WeQuest.' + chatID.toString() + '.shopping')
        await shoppingDB.load()

        let list = await this.getShoppingList(ctx);
        for (let item of list) {
    
            if (item.done) await shoppingDB.del(item.id);
        }
        
        list = await this.getShoppingList(ctx);
        ctx.editMessageText(`Shopping completed${list.length?' (with '+ list.length + ' items remaining)':'.'}`).catch((error) => {console.log(error)  });
    }

    getShoppingListKeyboard(list) {
        let mu =[]
        list.forEach(function (item, index) {
            mu.push([Markup.button.callback( (item.done?'✅ ' :'☑️ ' ) + item.id , `toggle_${index}`)])
        })
        mu.push([Markup.button.callback('👍 Clear Checked ✅', 'done')])
        return Markup.inlineKeyboard(mu);
    }

    async getShoppingList(ctx) {
        let chatID = ctx.chat.id;
        let shoppingDB = await this.db.docs('WeQuest.' + chatID.toString() + '.shopping')
        await shoppingDB.load()
    
        let list = await shoppingDB.get('');
        list.sort((a, b) => a.id.localeCompare(b.id));
        return list;
    }
}

