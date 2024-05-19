import { Markup } from 'telegraf';
import * as utils from './utilities.js';



class Shopping {
    constructor(bot, db,settings) {
        this.bot = bot;
        this.db = db;
        this.settings = settings;
        this.bot.command(['buy','comprare','compra'], (ctx) => this.buy(ctx));
        this.bot.command(['shopping','shop','spesa','lista','listaspesa'], (ctx) => this.shopping(ctx));
        this.bot.action(/toggle_(.+)/, (ctx) => this.toggle(ctx));
        this.bot.action('done', (ctx) => this.done(ctx));
    }

    async buy(ctx) {
        let chatID = ctx.chat.id;
        const language = await this.settings.getLanguage(chatID)
        let items = utils.parseList(ctx.message.text)
        if (!items || items.length === 0) {
            ctx.reply(utils.i18next.t('shoppingusage', { type: type, lng: language }));
            return;
        }
        for (let item of items)
            await this.db.put(chatID + '/shopping', { id: item, done: false, from: ctx.from.username });
  
        ctx.reply(utils.i18next.t('shoppingadded', { items: items.join(", "), lng: language }));
    }

    async shopping(ctx) {
        let chatID = ctx.chat.id;
        const language = await this.settings.getLanguage(chatID)
        let list = await this.getShoppingList(ctx)
        if (list.length === 0) {
            ctx.reply(utils.i18next.t("shoppingempty", { lng: language }));
            return;
        }
        ctx.reply(utils.i18next.t("shoppinglist", { lng: language }), this.getShoppingListKeyboard(list, language)).catch((error) => {console.log(error)  });
    }

    async toggle(ctx) {
        let chatID = ctx.chat.id;
        const language = await this.settings.getLanguage(chatID)
        const index = parseInt(ctx.match[1]);
        const list = await this.getShoppingList(ctx);
        list[index].done = !list[index].done;
        this.db.put(chatID + '/shopping', list[index])
        ctx.editMessageText(utils.i18next.t("shoppinglist", { lng: language }), this.getShoppingListKeyboard(list, language)).catch((error) => {console.log(error)  });
    }

    async done(ctx) {
        
        let chatID = ctx.chat.id;
        const language = await this.settings.getLanguage(chatID)
        let list = await this.getShoppingList(ctx);
        for (let item of list) {
    
            if (item.done) await this.db.del(chatID + '/shopping',item.id);
        }
        
        list = await this.getShoppingList(ctx);
        ctx.editMessageText(utils.i18next.t('shoppingcompleted', { remaining: list.length, lng: language })).catch((error) => {console.log(error)  });
    }

    getShoppingListKeyboard(list, language = this.settings.getLanguage(chatID)) {
        
        let mu =[]
        list.forEach(function (item, index) {
            mu.push([Markup.button.callback( (item.done?'✅ ' :'☑️ ' ) + item.id , `toggle_${index}`)])
        })
        mu.push([Markup.button.callback(utils.i18next.t("shoppingclear", { lng: language }), 'done')])
        return Markup.inlineKeyboard(mu);
    }

    async getShoppingList(ctx) {
        let chatID = ctx.chat.id;
        let list = await this.db.getAll(chatID + '/shopping');
        list.sort((a, b) => a.id.localeCompare(b.id));
        return list;
    }
}

export default Shopping;