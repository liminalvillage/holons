/**
 * @fileoverview Telegram UI for shopping lists.
 *
 * Domain logic (CRUD on the per-holon shopping checklist) is delegated to
 * `@holons/core/shopping`. This module is responsible only for Telegram
 * commands, scenes, and rendering inline keyboards.
 *
 * @module src/Shopping
 */

import { Markup, Telegraf } from 'telegraf';
import * as utils from './utilities.js';

import {
  createEmptyChecklist,
  normalizeChecklist,
  addItems as coreAddItems,
  toggleItem as coreToggleItem,
  removeChecked as coreRemoveChecked,
  stampNeedId,
  needIdOf,
  type ShoppingChecklist,
  type ShoppingItem as CoreShoppingItem,
} from '@holons/core/shopping';
import { needFromShoppingItem, publishNeedNearby } from '@holons/core/needs';

// ----------------------------------------------------------------------------
// Local types
// ----------------------------------------------------------------------------

interface DB {
  get: (
    holonId: string,
    bucket: string,
    id: string,
  ) => Promise<unknown>;
  put: (
    holonId: string,
    bucket: string,
    value: unknown,
  ) => Promise<unknown>;
}

interface Settings {
  getLanguage: (holonId: string | number) => Promise<string>;
}

// Canonical shapes are owned by @holons/core/shopping (created: ISO).
type ShoppingItem = CoreShoppingItem;
type ShoppingList = ShoppingChecklist;

/**
 * Interface mirroring `@holons/core/shopping`. The implementation is inline
 * in `LocalShoppingService` until Unit 5 lands the canonical core module.
 */
interface ShoppingServiceLike {
  getList(holonId: string): Promise<ShoppingList | null>;
  addItems(
    holonId: string,
    items: string[],
    createdBy?: number,
    category?: string,
  ): Promise<ShoppingList>;
  toggleItem(holonId: string, itemId: string | number): Promise<ShoppingList | null>;
  removeChecked(holonId: string): Promise<{ list: ShoppingList; removed: number }>;
}

// ----------------------------------------------------------------------------
// Local implementation of the core shopping service.
// ----------------------------------------------------------------------------

class LocalShoppingService implements ShoppingServiceLike {
  private db: DB;
  constructor(db: DB) {
    this.db = db;
  }

  async getList(holonId: string): Promise<ShoppingList | null> {
    // Read-normalize: promotes legacy createdAt(ms) → created(ISO).
    return normalizeChecklist(await this.db.get(holonId, 'checklists', 'shopping'));
  }

  async addItems(
    holonId: string,
    items: string[],
    createdBy?: number,
    category?: string,
  ) {
    const list = (await this.getList(holonId)) ?? createEmptyChecklist();
    const updated = coreAddItems(list, items, {
      ...(createdBy != null ? { createdBy } : {}),
      ...(typeof category === 'string' ? { category } : {}),
    });
    await this.db.put(holonId, 'checklists', updated);
    return updated;
  }

  async toggleItem(holonId: string, itemId: string | number) {
    const list = await this.getList(holonId);
    if (!list) return null;
    const updated = coreToggleItem(list, itemId);
    if (!updated) return null;
    await this.db.put(holonId, 'checklists', updated);
    return updated;
  }

  async removeChecked(holonId: string) {
    const list = (await this.getList(holonId)) ?? createEmptyChecklist();
    const before = list.items.length;
    const updated = coreRemoveChecked(list) ?? createEmptyChecklist();
    await this.db.put(holonId, 'checklists', updated);
    return { list: updated, removed: before - updated.items.length };
  }
}

// ----------------------------------------------------------------------------
// Telegraf adapter: ctx in, replies out.
// ----------------------------------------------------------------------------

interface AnyCtx {
  chat?: { id: number | string };
  match?: RegExpMatchArray;
  from?: { id: number; username?: string; first_name?: string };
  message?: {
    text: string;
    message_thread_id?: number;
    is_topic_message?: boolean;
    reply_to_message?: {
      forum_topic_created?: { name?: string };
    };
  };
  scene?: { enter: (name: string, state?: unknown) => unknown };
  reply: (text: string, extra?: unknown) => Promise<unknown>;
  editMessageText: (text: string, extra?: unknown) => Promise<unknown>;
  answerCbQuery?: () => Promise<unknown>;
}

class Shopping {
  bot: Telegraf;
  db: DB;
  settings: Settings;
  /** Domain service. Type matches the future `@holons/core/shopping` API. */
  service: ShoppingServiceLike;

  constructor(bot: Telegraf, db: DB, settings: Settings) {
    this.bot = bot;
    this.db = db;
    this.settings = settings;
    this.service = new LocalShoppingService(db);

    this.bot.command(['buy', 'comprare', 'compra', 'bring'], (ctx) =>
      this.buy(ctx as unknown as AnyCtx),
    );
    this.bot.command(['shopping', 'shop', 'spesa', 'lista', 'listaspesa'], (ctx) =>
      this.shopping(ctx as unknown as AnyCtx),
    );
    this.bot.action(/toggle_shopping_(.+)/, (ctx) =>
      this.toggle(ctx as unknown as AnyCtx),
    );
    this.bot.action('done_shopping', (ctx) =>
      this.done(ctx as unknown as AnyCtx),
    );
    this.bot.action('add_shopping_item', (ctx) =>
      this.addItem(ctx as unknown as AnyCtx),
    );
    // Category headers are non-interactive — acknowledge the tap and do nothing.
    this.bot.action(/shopping_category_.+/, (ctx) =>
      (ctx as unknown as AnyCtx).answerCbQuery?.().catch(() => {}),
    );
    this.bot.action(/share_need_(.+)/, (ctx) =>
      this.shareAsNeed(ctx as unknown as AnyCtx),
    );
  }

  /**
   * Derive a category for an incoming command from the Telegram forum topic
   * it was sent into. Mirrors Quests.getCategory so /buy and /task agree on
   * how topics map to categories.
   */
  getCategory(ctx: AnyCtx): string {
    const msg = ctx.message;
    if (!msg) return '';
    if (msg.message_thread_id && msg.reply_to_message?.forum_topic_created?.name) {
      return msg.reply_to_message.forum_topic_created.name;
    }
    return msg.message_thread_id ? `Topic ${msg.message_thread_id}` : '';
  }

  async buy(ctx: AnyCtx) {
    const holonId = String(ctx.chat!.id);
    const language = await this.settings.getLanguage(holonId);
    const items = utils.parseList(ctx.message!.text);
    const category = this.getCategory(ctx);

    if (!items || items.length === 0) {
      // No items provided, use InputScene to collect them.
      return ctx.scene!.enter('input_scene', {
        promptText: utils.i18next.t('shoppingprompt', { lng: language }),
        inputType: 'array',
        allowEmpty: false,
        onComplete: async (cbCtx: AnyCtx, collected: string[]) => {
          const cbHolonId = String(cbCtx.chat!.id);
          const cbLanguage = await this.settings.getLanguage(cbHolonId);
          // Use the original command's category — the InputScene reply may
          // arrive in the general chat even if the user started in a topic.
          await this.service.addItems(cbHolonId, collected, cbCtx.from?.id, category);
          await cbCtx.reply(
            utils.i18next.t('shoppingadded', {
              items: collected.join(', '),
              lng: cbLanguage,
            }),
          );
        },
      });
    }

    await this.service.addItems(holonId, items, ctx.from?.id, category);
    await ctx.reply(
      utils.i18next.t('shoppingadded', {
        items: items.join(', '),
        lng: language,
      }),
    );
  }

  async shopping(ctx: AnyCtx) {
    const holonId = String(ctx.chat!.id);
    const language = await this.settings.getLanguage(holonId);
    const list = await this.service.getList(holonId);

    if (!list || !list.items || list.items.length === 0) {
      await ctx.reply(utils.i18next.t('shoppingempty', { lng: language }));
      return;
    }

    // When the command runs inside a forum topic, scope the view to that
    // topic's category. In the general chat, show every item across all
    // categories.
    const category = this.getCategory(ctx);
    const visible = category
      ? list.items.filter((i) => (i.category ?? '') === category)
      : list.items;

    if (visible.length === 0) {
      await ctx.reply(utils.i18next.t('shoppingempty', { lng: language }));
      return;
    }

    await ctx
      .reply(
        utils.i18next.t('shoppinglist', { lng: language }),
        this.getShoppingListKeyboard(visible, language, !category),
      )
      .catch((error: unknown) => {
        console.log(error);
      });
  }

  async toggle(ctx: AnyCtx) {
    const holonId = String(ctx.chat!.id);
    const language = await this.settings.getLanguage(holonId);
    const itemId = ctx.match![1];

    const updated = await this.service.toggleItem(holonId, itemId);
    if (!updated) return;

    // Preserve the topic scope when re-rendering the inline keyboard.
    const category = this.getCategory(ctx);
    const visible = category
      ? updated.items.filter((i) => (i.category ?? '') === category)
      : updated.items;

    await ctx
      .editMessageText(
        utils.i18next.t('shoppinglist', { lng: language }),
        this.getShoppingListKeyboard(visible, language, !category),
      )
      .catch((error: unknown) => {
        console.log(error);
      });
  }

  async done(ctx: AnyCtx) {
    const holonId = String(ctx.chat!.id);
    const language = await this.settings.getLanguage(holonId);

    const { list } = await this.service.removeChecked(holonId);
    await ctx
      .editMessageText(
        utils.i18next.t('shoppingcompleted', {
          remaining: list.items.length,
          lng: language,
        }),
      )
      .catch((error: unknown) => {
        console.log(error);
      });
  }

  /**
   * Publish a list item as a geolocated need (see @holons/core/needs and
   * docs/needs-offers-network.md): partners get standalone copies, the
   * holon's settings.hex cell gets a live hologram, and the item is stamped
   * with the needId so checking it off fulfils the need everywhere.
   */
  async shareAsNeed(ctx: AnyCtx) {
    await ctx.answerCbQuery?.().catch(() => {});
    const holonId = String(ctx.chat!.id);
    const language = await this.settings.getLanguage(holonId);
    const itemId = ctx.match![1];

    const list = await this.service.getList(holonId);
    const item = list?.items.find((i) => String(i.id) === String(itemId));
    if (!list || !item || needIdOf(item)) return; // gone or already shared

    const from = ctx.from;
    const need = needFromShoppingItem(item, {
      holonId,
      initiator: {
        id: from?.id ?? holonId,
        username: from?.username || from?.first_name || String(from?.id ?? ''),
      },
    });

    try {
      // this.db IS the holosphere instance (see HolonsMultiBot/services).
      const outcome = await publishNeedNearby(this.db as never, holonId, need, {
        toPartners: true,
        toHex: true,
      });
      const stamped = stampNeedId(list, item.id, String(need.id));
      if (stamped) await this.db.put(holonId, 'checklists', stamped);

      const missedMap = outcome.errors.some((e) => /hex address/i.test(e));
      await ctx.reply(
        utils.i18next.t(missedMap ? 'needsharedpartial' : 'needshared', {
          item: item.text,
          lng: language,
        }),
      );
    } catch (error) {
      console.log('[Shopping] shareAsNeed failed:', error);
      await ctx
        .reply(utils.i18next.t('needsharefailed', { lng: language }))
        .catch(() => {});
    }
  }

  async addItem(ctx: AnyCtx) {
    await ctx.answerCbQuery?.().catch(() => {});
    const holonId = String(ctx.chat!.id);
    const language = await this.settings.getLanguage(holonId);
    const category = this.getCategory(ctx);

    return ctx.scene!.enter('input_scene', {
      promptText: utils.i18next.t('shoppingprompt', { lng: language }),
      inputType: 'array',
      allowEmpty: false,
      onComplete: async (cbCtx: AnyCtx, collected: string[]) => {
        const cbHolonId = String(cbCtx.chat!.id);
        const cbLanguage = await this.settings.getLanguage(cbHolonId);
        const updated = await this.service.addItems(
          cbHolonId,
          collected,
          cbCtx.from?.id,
          category,
        );
        await cbCtx.reply(
          utils.i18next.t('shoppingadded', {
            items: collected.join(', '),
            lng: cbLanguage,
          }),
        );
        const visible = category
          ? updated.items.filter((i) => (i.category ?? '') === category)
          : updated.items;
        await cbCtx.reply(
          utils.i18next.t('shoppinglist', { lng: cbLanguage }),
          this.getShoppingListKeyboard(visible, cbLanguage, !category),
        );
      },
    });
  }

  /**
   * Build the inline keyboard for a shopping list. When `showCategoryHeaders`
   * is true (the unscoped /shopping view), items are grouped under a non-
   * clickable header row per category — uncategorized items appear first.
   */
  /**
   * One keyboard row per item: the toggle, plus a 📡 share-as-need button for
   * items that are still wanted and not yet published (shared ones show 🛰).
   */
  private itemRow(item: ShoppingItem): any[] {
    const row = [
      Markup.button.callback(
        (item.checked ? '✅ ' : '☑️ ') + item.text,
        `toggle_shopping_${item.id}`,
      ),
    ];
    if (!item.checked) {
      row.push(
        needIdOf(item)
          ? Markup.button.callback('🛰', `shopping_category_shared`)
          : Markup.button.callback('📡', `share_need_${item.id}`),
      );
    }
    return row;
  }

  getShoppingListKeyboard(
    items: ShoppingItem[],
    language: string,
    showCategoryHeaders = false,
  ): any {
    const mu: any[][] = [];

    if (showCategoryHeaders) {
      const groups = new Map<string, ShoppingItem[]>();
      for (const item of items) {
        const key = item.category && item.category.trim() ? item.category : '';
        const bucket = groups.get(key);
        if (bucket) bucket.push(item);
        else groups.set(key, [item]);
      }
      // Sort: uncategorized first, then alpha.
      const keys = [...groups.keys()].sort((a, b) => {
        if (a === '' && b !== '') return -1;
        if (b === '' && a !== '') return 1;
        return a.localeCompare(b);
      });
      const multiCategory = keys.some((k) => k !== '') && keys.length > 1;
      for (const key of keys) {
        if (multiCategory && key) {
          mu.push([Markup.button.callback(`— ${key} —`, `shopping_category_${key}`)]);
        }
        for (const item of groups.get(key)!) {
          mu.push(this.itemRow(item));
        }
      }
    } else {
      items.forEach((item) => {
        mu.push(this.itemRow(item));
      });
    }

    mu.push([
      Markup.button.callback(
        utils.i18next.t('shoppingadd', { lng: language }),
        'add_shopping_item',
      ),
      Markup.button.callback(
        utils.i18next.t('shoppingclear', { lng: language }),
        'done_shopping',
      ),
    ]);
    return Markup.inlineKeyboard(mu);
  }
}

export default Shopping;
export type { ShoppingServiceLike };
