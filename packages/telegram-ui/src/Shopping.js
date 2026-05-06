/**
 * @fileoverview Shopping list management for HolonsBot.
 * @module src/Shopping
 *
 * Storage layer (add / toggle / remove / clear-checked) is delegated to
 * `@holons/core/shopping` so the bot and the web UI read/write identical
 * shopping records. Telegraf scenes + inline keyboards remain here.
 */
import { Markup } from 'telegraf';
import {
    CHECKLISTS_COLLECTION,
    SHOPPING_KEY,
    addItems,
    normalizeChecklist,
    removeChecked,
    toggleItem,
} from '@holons/core/shopping';
import * as utils from './utilities.js';

/**
 * Shopping list management class for creating and managing shopping lists.
 *
 * @class Shopping
 * @description Handles shopping list creation, item management, and display.
 * Provides commands for adding items, viewing the list, and marking items as done.
 *
 * @property {Telegraf} bot - The Telegraf bot instance
 * @property {DB} db - Database instance
 * @property {Settings} settings - Settings module instance
 *
 * @example
 * const shopping = new Shopping(bot, db, settings);
 * // Shopping commands are now available: /buy, /shopping, etc.
 */
class Shopping {
    /**
     * Creates a new Shopping instance and registers shopping commands.
     * @constructor
     * @param {Telegraf} bot - The Telegraf bot instance
     * @param {DB} db - The database instance
     * @param {Settings} settings - The settings module instance
     */
    constructor(bot, db, settings) {
        this.bot = bot;
        this.db = db;
        this.settings = settings;
        this.bot.command(['buy','comprare','compra','bring'], (ctx) => this.buy(ctx));
        this.bot.command(['shopping','shop','spesa','lista','listaspesa'], (ctx) => this.shopping(ctx));
        this.bot.action(/toggle_shopping_(.+)/, (ctx) => this.toggle(ctx));
        this.bot.action('done_shopping', (ctx) => this.done(ctx));
        this.bot.action('add_shopping_item', (ctx) => this.addItem(ctx));
    }

    /**
     * Read the shopping container, normalized through core.
     * @private
     * @param {string|number} holonId
     * @returns {Promise<import('@holons/core/shopping').ShoppingChecklist|null>}
     */
    async _loadList(holonId) {
        const raw = await this.db.get(String(holonId), CHECKLISTS_COLLECTION, SHOPPING_KEY);
        return normalizeChecklist(raw);
    }

    /**
     * Persist the shopping container.
     * @private
     * @param {string|number} holonId
     * @param {import('@holons/core/shopping').ShoppingChecklist} list
     */
    async _saveList(holonId, list) {
        await this.db.put(String(holonId), CHECKLISTS_COLLECTION, list);
    }

    /**
     * Append items to the holon's shopping list and persist. Shared by /buy and the
     * "Add Item" inline button.
     * @private
     * @param {string|number} holonId
     * @param {string[]} items
     * @param {number|string} [createdBy]
     * @returns {Promise<import('@holons/core/shopping').ShoppingChecklist>}
     */
    async _appendItems(holonId, items, createdBy) {
        const current = await this._loadList(holonId);
        const updated = addItems(current, items, createdBy !== undefined ? { createdBy } : {});
        await this._saveList(holonId, updated);
        return updated;
    }

    async buy(ctx) {
        const holonId = ctx.chat.id;
        const language = await this.settings.getLanguage(holonId);
        let items = utils.parseList(ctx.message.text);

        console.log('[Shopping buy] Parsed items:', items);

        if (!items || items.length === 0) {
            // No items provided, use InputScene to collect them.
            return ctx.scene.enter('input_scene', {
                promptText: utils.i18next.t('shoppingprompt', { lng: language }),
                inputType: 'array',  // Auto-splits by comma/newline
                allowEmpty: false,
                onComplete: async (sceneCtx, sceneItems) => {
                    const callbackHolonId = sceneCtx.chat.id;
                    const callbackLanguage = await this.settings.getLanguage(callbackHolonId);

                    console.log('[Shopping InputScene] Adding items:', sceneItems);
                    await this._appendItems(callbackHolonId, sceneItems, sceneCtx.from?.id);

                    await sceneCtx.reply(utils.i18next.t('shoppingadded', {
                        items: sceneItems.join(", "),
                        lng: callbackLanguage,
                    }));
                },
            });
        }

        await this._appendItems(holonId, items, ctx.from?.id);
        ctx.reply(utils.i18next.t('shoppingadded', { items: items.join(", "), lng: language }));
    }

    async shopping(ctx) {
        const holonId = ctx.chat.id;
        const language = await this.settings.getLanguage(holonId);

        const shoppingList = await this._loadList(holonId);

        if (!shoppingList || shoppingList.items.length === 0) {
            ctx.reply(utils.i18next.t("shoppingempty", { lng: language }));
            return;
        }

        ctx.reply(
            utils.i18next.t("shoppinglist", { lng: language }),
            this.getShoppingListKeyboard(shoppingList.items, language),
        ).catch((error) => { console.log(error); });
    }

    async toggle(ctx) {
        const holonId = ctx.chat.id;
        const language = await this.settings.getLanguage(holonId);
        const itemId = ctx.match[1];

        const current = await this._loadList(holonId);
        if (!current) {
            console.log('[Shopping toggle] Shopping list not found');
            return;
        }

        const exists = current.items.some(i => String(i.id) === String(itemId));
        if (!exists) return;

        const updated = toggleItem(current, itemId);
        await this._saveList(holonId, updated);

        ctx.editMessageText(
            utils.i18next.t("shoppinglist", { lng: language }),
            this.getShoppingListKeyboard(updated.items, language),
        ).catch((error) => { console.log(error); });
    }

    async done(ctx) {
        const holonId = ctx.chat.id;
        const language = await this.settings.getLanguage(holonId);

        const current = await this._loadList(holonId);
        if (!current) {
            console.log('[Shopping done] Shopping list not found');
            return;
        }

        const before = current.items.length;
        const updated = removeChecked(current);
        const removedCount = before - updated.items.length;

        await this._saveList(holonId, updated);
        console.log('[Shopping done] Removed', removedCount, 'items, remaining:', updated.items.length);

        ctx.editMessageText(
            utils.i18next.t('shoppingcompleted', { remaining: updated.items.length, lng: language }),
        ).catch((error) => { console.log(error); });
    }

    async addItem(ctx) {
        await ctx.answerCbQuery().catch(() => {});
        const holonId = ctx.chat.id;
        const language = await this.settings.getLanguage(holonId);

        return ctx.scene.enter('input_scene', {
            promptText: utils.i18next.t('shoppingprompt', { lng: language }),
            inputType: 'array',
            allowEmpty: false,
            onComplete: async (sceneCtx, sceneItems) => {
                const callbackHolonId = sceneCtx.chat.id;
                const callbackLanguage = await this.settings.getLanguage(callbackHolonId);

                console.log('[Shopping addItem] Adding items:', sceneItems);
                const updated = await this._appendItems(callbackHolonId, sceneItems, sceneCtx.from?.id);

                await sceneCtx.reply(utils.i18next.t('shoppingadded', {
                    items: sceneItems.join(", "),
                    lng: callbackLanguage,
                }));

                await sceneCtx.reply(
                    utils.i18next.t("shoppinglist", { lng: callbackLanguage }),
                    this.getShoppingListKeyboard(updated.items, callbackLanguage),
                );
            },
        });
    }

    getShoppingListKeyboard(items, language) {
        const mu = items.map((item) => [
            Markup.button.callback(
                (item.checked ? '✅ ' : '☑️ ') + item.text,
                `toggle_shopping_${item.id}`,
            ),
        ]);
        // Add "Add Item" and "Remove Selected" buttons at the bottom
        mu.push([
            Markup.button.callback(utils.i18next.t("shoppingadd", { lng: language }), 'add_shopping_item'),
            Markup.button.callback(utils.i18next.t("shoppingclear", { lng: language }), 'done_shopping'),
        ]);
        return Markup.inlineKeyboard(mu);
    }
}

export default Shopping;
