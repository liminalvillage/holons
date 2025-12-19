import { Markup } from 'telegraf';
import * as utils from './utilities.js';



class Shopping {
    constructor(bot, db,settings) {
        this.bot = bot;
        this.db = db;
        this.settings = settings;
        this.bot.command(['buy','comprare','compra','bring'], (ctx) => this.buy(ctx));
        this.bot.command(['shopping','shop','spesa','lista','listaspesa'], (ctx) => this.shopping(ctx));
        this.bot.action(/toggle_shopping_(.+)/, (ctx) => this.toggle(ctx));
        this.bot.action('done_shopping', (ctx) => this.done(ctx));
        this.bot.action('add_shopping_item', (ctx) => this.addItem(ctx));
    }

    async buy(ctx) {
        let holonId = ctx.chat.id;
        const language = await this.settings.getLanguage(holonId)
        const type = ctx.message.text.split(' ')[0].replace('/', '');
        let items = utils.parseList(ctx.message.text)

        console.log('[Shopping buy] Parsed items:', items);
        console.log('[Shopping buy] Items length:', items ? items.length : 0);

        if (!items || items.length === 0) {
            console.log('[Shopping buy] No items, entering InputScene');
            // No items provided, use InputScene to collect them
            return ctx.scene.enter('input_scene', {
                promptText: utils.i18next.t('shoppingprompt', { lng: language }),
                inputType: 'array',  // Auto-splits by comma/newline
                allowEmpty: false,
                onComplete: async (ctx, items) => {
                    // Get holonId fresh from the callback context
                    const callbackholonId = ctx.chat.id;
                    const callbackLanguage = await this.settings.getLanguage(callbackholonId);

                    console.log('[Shopping InputScene] Adding items:', items);
                    console.log('[Shopping InputScene] Holon ID:', callbackholonId);

                    // Get or create the shopping checklist
                    let shoppingList = await this.db.get(callbackholonId + '/checklists', 'shopping');

                    if (!shoppingList) {
                        console.log('[Shopping InputScene] Creating new shopping checklist');
                        shoppingList = {
                            id: 'shopping',
                            type: 'shopping',
                            title: 'Shopping List',
                            items: [],
                            createdAt: Date.now()
                        };
                    }

                    // Add items to checklist
                    const newItems = items.map(item => ({
                        id: Date.now() + Math.random(),
                        text: item,
                        checked: false,
                        createdBy: ctx.from.id
                    }));

                    shoppingList.items.push(...newItems);
                    console.log('[Shopping InputScene] Updated shopping list:', shoppingList);

                    // Save to checklists
                    await this.db.put(callbackholonId + '/checklists', shoppingList);
                    console.log('[Shopping InputScene] Saved to database');

                    await ctx.reply(utils.i18next.t('shoppingadded', {
                        items: items.join(", "),
                        lng: callbackLanguage
                    }));
                }
            });
        }

        // Items provided in command, process directly
        console.log('[Shopping buy] Items provided directly, adding to DB');

        // Get or create the shopping checklist
        let shoppingList = await this.db.get(holonId + '/checklists', 'shopping');

        if (!shoppingList) {
            console.log('[Shopping buy direct] Creating new shopping checklist');
            shoppingList = {
                id: 'shopping',
                type: 'shopping',
                title: 'Shopping List',
                items: [],
                createdAt: Date.now()
            };
        }

        // Add items to checklist
        const newItems = items.map(item => ({
            id: Date.now() + Math.random(),
            text: item,
            checked: false,
            createdBy: ctx.from.id
        }));

        shoppingList.items.push(...newItems);
        console.log('[Shopping buy direct] Updated shopping list:', shoppingList);

        // Save to checklists
        await this.db.put(holonId + '/checklists', shoppingList);
        console.log('[Shopping buy direct] Saved to database');

        ctx.reply(utils.i18next.t('shoppingadded', { items: items.join(", "), lng: language }));
    }

    async shopping(ctx) {
        console.log('[Shopping shopping] Command called');
        let holonId = ctx.chat.id;
        const language = await this.settings.getLanguage(holonId);

        // Get the shopping checklist
        let shoppingList = await this.db.get(holonId + '/checklists', 'shopping');

        if (!shoppingList || !shoppingList.items || shoppingList.items.length === 0) {
            console.log('[Shopping shopping] List is empty');
            ctx.reply(utils.i18next.t("shoppingempty", { lng: language }));
            return;
        }

        console.log('[Shopping shopping] Showing list with', shoppingList.items.length, 'items');
        ctx.reply(utils.i18next.t("shoppinglist", { lng: language }), this.getShoppingListKeyboard(shoppingList.items, language))
            .catch((error) => {console.log(error)});
    }

    async toggle(ctx) {
        let holonId = ctx.chat.id;
        const language = await this.settings.getLanguage(holonId);
        const itemId = ctx.match[1];

        // Get the shopping checklist
        let shoppingList = await this.db.get(holonId + '/checklists', 'shopping');

        if (!shoppingList || !shoppingList.items) {
            console.log('[Shopping toggle] Shopping list not found');
            return;
        }

        // Find and toggle the item
        const item = shoppingList.items.find(i => i.id == itemId);
        if (item) {
            item.checked = !item.checked;
            await this.db.put(holonId + '/checklists', shoppingList);

            ctx.editMessageText(
                utils.i18next.t("shoppinglist", { lng: language }),
                this.getShoppingListKeyboard(shoppingList.items, language)
            ).catch((error) => {console.log(error)});
        }
    }

    async done(ctx) {
        let holonId = ctx.chat.id;
        const language = await this.settings.getLanguage(holonId);

        // Get the shopping checklist
        let shoppingList = await this.db.get(holonId + '/checklists', 'shopping');

        if (!shoppingList || !shoppingList.items) {
            console.log('[Shopping done] Shopping list not found');
            return;
        }

        // Remove checked items
        const beforeCount = shoppingList.items.length;
        shoppingList.items = shoppingList.items.filter(item => !item.checked);
        const removedCount = beforeCount - shoppingList.items.length;

        await this.db.put(holonId + '/checklists', shoppingList);

        console.log('[Shopping done] Removed', removedCount, 'items, remaining:', shoppingList.items.length);

        ctx.editMessageText(
            utils.i18next.t('shoppingcompleted', { remaining: shoppingList.items.length, lng: language })
        ).catch((error) => {console.log(error)});
    }

    async addItem(ctx) {
        await ctx.answerCbQuery().catch(() => {});
        let holonId = ctx.chat.id;
        const language = await this.settings.getLanguage(holonId);

        // Enter InputScene to collect new items
        return ctx.scene.enter('input_scene', {
            promptText: utils.i18next.t('shoppingprompt', { lng: language }),
            inputType: 'array',  // Auto-splits by comma/newline
            allowEmpty: false,
            onComplete: async (ctx, items) => {
                // Get holonId fresh from the callback context
                const callbackholonId = ctx.chat.id;
                const callbackLanguage = await this.settings.getLanguage(callbackholonId);

                console.log('[Shopping addItem] Adding items:', items);

                // Get or create the shopping checklist
                let shoppingList = await this.db.get(callbackholonId + '/checklists', 'shopping');

                if (!shoppingList) {
                    console.log('[Shopping addItem] Creating new shopping checklist');
                    shoppingList = {
                        id: 'shopping',
                        type: 'shopping',
                        title: 'Shopping List',
                        items: [],
                        createdAt: Date.now()
                    };
                }

                // Add items to checklist
                const newItems = items.map(item => ({
                    id: Date.now() + Math.random(),
                    text: item,
                    checked: false,
                    createdBy: ctx.from.id
                }));

                shoppingList.items.push(...newItems);
                console.log('[Shopping addItem] Updated shopping list:', shoppingList);

                // Save to checklists
                await this.db.put(callbackholonId + '/checklists', shoppingList);

                await ctx.reply(utils.i18next.t('shoppingadded', {
                    items: items.join(", "),
                    lng: callbackLanguage
                }));

                // Show updated shopping list
                await ctx.reply(
                    utils.i18next.t("shoppinglist", { lng: callbackLanguage }),
                    this.getShoppingListKeyboard(shoppingList.items, callbackLanguage)
                );
            }
        });
    }

    getShoppingListKeyboard(items, language) {
        let mu = [];
        items.forEach(function (item) {
            mu.push([Markup.button.callback(
                (item.checked ? '✅ ' : '☑️ ') + item.text,
                `toggle_shopping_${item.id}`
            )]);
        });
        // Add "Add Item" and "Remove Selected" buttons at the bottom
        mu.push([
            Markup.button.callback(utils.i18next.t("shoppingadd", { lng: language }), 'add_shopping_item'),
            Markup.button.callback(utils.i18next.t("shoppingclear", { lng: language }), 'done_shopping')
        ]);
        return Markup.inlineKeyboard(mu);
    }
}

export default Shopping;