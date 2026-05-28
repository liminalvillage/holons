/**
 * @fileoverview Community library system for item lending and borrowing.
 * @module src/Library
 */

import { Markup } from 'telegraf';
import { REAEventStore, REAEventFactory } from '@holons/core/rea';
import { REAAggregator } from '@holons/core/scoring';
import { extractItemsFromImage } from './AI.js';
import { Calendar } from './Calendar.js';
import {
    LIBRARY_TYPES as LIBRARY_TYPES_CORE,
    borrowItem as coreBorrowItem,
    recordBorrowAccounting as coreRecordBorrowAccounting,
    recordReturnAccounting as coreRecordReturnAccounting,
    returnItem as coreReturnItem,
    type AccountingDeps,
    type LibraryItem,
} from '@holons/core/library';

// Re-export LIBRARY_TYPES so existing imports `from './Library.js'` keep working
// while also making it sourceable from `@holons/core/library`.
const LIBRARY_TYPES = LIBRARY_TYPES_CORE;
export { LIBRARY_TYPES };
export type { LibraryItem };

// --- Local structural types (UI-only; bot/db are duck-typed) ---
type AnyCtx = any;
type CommandHandler = (ctx: AnyCtx) => any | Promise<any>;
type ActionHandler = (ctx: AnyCtx) => any | Promise<any>;
interface BotLike {
    command(name: string, handler: CommandHandler): unknown;
    action(matcher: string | RegExp, handler: ActionHandler): unknown;
}
interface DbLike {
    get(holonId: string, lens: string, id: string): Promise<any>;
    getAll(holonId: string, lens: string): Promise<any[]>;
    put(holonId: string, lens: string, value: any): Promise<unknown>;
    delete(holonId: string, lens: string, id: string): Promise<unknown>;
}

interface PendingPhotoState {
    waiting: boolean;
    items: Array<string | { name: string; value?: number }>;
    selected: Set<number>;
}

interface PendingBorrow {
    userId: number | string;
    username: string | undefined;
    firstName: string;
    lastName: string;
    item: any;
    itemName: string;
    fromKeyboard: boolean;
}

interface CreateLibraryItemOptions {
    createdBy?: number | string;
    createdByUsername?: string;
    category?: string;
    description?: string;
    value?: number;
}

/**
 * Number of items to display per page in the library.
 * @constant {number}
 */
const ITEMS_PER_PAGE = 15;

/**
 * Community library for managing shared items with credit-based borrowing.
 *
 * @class Library
 * @description Provides a complete library system where community members can
 * add items, set borrowing credits, and track lending history. Uses REA events
 * for immutable transaction tracking. Features include deposits, credit balances,
 * and item statistics.
 *
 * @property {Object} bot - Telegraf bot instance
 * @property {DB} db - Database instance
 * @property {REAEventStore} eventStore - REA event store for transactions
 * @property {REAEventFactory} eventFactory - Factory for creating REA events
 * @property {REAAggregator} aggregator - Aggregator for computing balances
 *
 * @example
 * const library = new Library(bot, db);
 * // Use /additem hammer 5 to add an item worth 5 credits
 * // Use /borrow hammer to borrow an item
 */
class Library {
    bot: BotLike;
    db: DbLike;
    expensesInstance: any | null;
    pendingPhotoItems: Map<number | string, PendingPhotoState>;
    borrowLocks: Set<string>;
    pendingBorrows: Map<string, PendingBorrow>;
    calendar: any;
    eventStore: any;
    eventFactory: typeof REAEventFactory;
    aggregator: any;

    constructor(bot: BotLike, db: DbLike) {
        this.bot = bot;
        this.db = db;
        this.expensesInstance = null;
        this.pendingPhotoItems = new Map(); // Store pending items from photo extraction per chat
        this.borrowLocks = new Set(); // Prevent concurrent borrows of the same item
        this.pendingBorrows = new Map(); // Store pending borrows waiting for date selection: key=holonId:itemId, value={userId, username, item, fromKeyboard}

        // Initialize Calendar for date selection (date only, no time).
        // `start_date` is supported by the JS implementation but not surfaced
        // in its declared options shape — cast to `any` to keep the TS view
        // honest without changing runtime behaviour.
        this.calendar = new Calendar(bot as any, {
            date_format: 'YYYY-MM-DD',
            time_selector_mod: false,
            language: 'en',
            bot_api: 'telegraf',
            start_date: new Date(), // Can't select past dates
        } as any);

        // Initialize REA components. Bot's DbLike.get requires the id arg;
        // core's HoloSphereLike.get treats it as optional — cast at boundary.
        this.eventStore = new REAEventStore(db as any);
        this.eventFactory = REAEventFactory;
        this.aggregator = new REAAggregator(this.eventStore);

        // Register commands (using lib prefix to avoid conflicts with Checklists)
        this.bot.command('library', (ctx) => this.showLibrary(ctx));
        this.bot.command('inventory', (ctx) => this.showLibrary(ctx)); // Alias
        this.bot.command('libadd', (ctx) => this.addItem(ctx));
        this.bot.command('libremove', (ctx) => this.removeItem(ctx));
        this.bot.command('borrow', (ctx) => this.borrowItem(ctx, false));
        this.bot.command('return', (ctx) => this.returnItem(ctx, false));
        this.bot.command('setvalue', (ctx) => this.setItemValue(ctx));
        this.bot.command('libstats', (ctx) => this.showStats(ctx));

        // Register actions
        this.bot.action(/library_borrow_(.+)/, (ctx) => this.borrowItem(ctx, true));
        this.bot.action(/libret_(.+)/, (ctx) => this.showBorrowedItemDetails(ctx));
        this.bot.action(/lib_ret_(.+)/, (ctx) => this.returnItem(ctx, true));
        this.bot.action(/lib_del_(.+)/, (ctx) => this.deleteItemFromDetails(ctx));
        this.bot.action('library_back', (ctx) => this.showLibrary(ctx));
        this.bot.action('library_add_photo', (ctx) => this.promptPhotoUpload(ctx));
        this.bot.action('library_add_manual', (ctx) => this.promptManualAdd(ctx));
        this.bot.action('library_enter_remove_mode', (ctx) => this.enterRemoveMode(ctx));
        this.bot.action('library_exit_remove_mode', (ctx) => this.exitRemoveMode(ctx));
        this.bot.action(/library_remove_(.+)/, (ctx) => this.removeItemFromKeyboard(ctx));
        this.bot.action(/library_toggle_photo_(.+)/, (ctx) => this.togglePhotoItem(ctx));
        this.bot.action('library_confirm_photo', (ctx) => this.confirmPhotoItems(ctx));
        this.bot.action('library_cancel_photo', (ctx) => this.cancelPhotoItems(ctx));

        // Calendar date selection for library borrows
        this.bot.action(/lb_d_(.+)/, (ctx) => this.handleBorrowDateSelected(ctx, ctx.match[1]));
        this.bot.action(/lb_m_(.+)_(.+)/, (ctx) => this.handleCalendarNavigation(ctx));
        this.bot.action('library_cancel_borrow', (ctx) => this.cancelPendingBorrow(ctx));

        // Pagination actions
        this.bot.action(/library_page_(\d+)/, (ctx) => {
            const page = parseInt(ctx.match[1]);
            this.showLibrary(ctx, { page });
        });
        this.bot.action(/library_page_(\d+)_rm/, (ctx) => {
            const page = parseInt(ctx.match[1]);
            this.showLibrary(ctx, { page, removeMode: true });
        });
    }

    // Set expenses instance for integration
    setExpensesInstance(expensesInstance: any): void {
        this.expensesInstance = expensesInstance;
    }

    // Helper method to create a standardized library item
    createLibraryItem(id: string, type: string | undefined, options: CreateLibraryItemOptions = {}): LibraryItem {
        return {
            id: id,
            type: (type as LibraryItem['type']) || LIBRARY_TYPES.OTHER,
            borrowed: false,
            createdBy: options.createdBy,
            createdByUsername: options.createdByUsername,
            borrower: null,
            category: options.category || 'Uncategorized',
            description: options.description || '',
            value: options.value || 0,
            created: new Date().toISOString(),
        };
    }

    // Helper method to get item icon based on type
    getItemIcon(item: string | { type?: string }): string {
        if (typeof item === 'string') {
            return '📦';
        }
        switch (item.type) {
            case LIBRARY_TYPES.TOOL: return '🔧';
            case LIBRARY_TYPES.BOOK: return '📚';
            case LIBRARY_TYPES.EQUIPMENT: return '⚙️';
            case LIBRARY_TYPES.OTHER:
            default: return '📦';
        }
    }

    // Helper method to get item display title
    getItemDisplayTitle(item: string | { id: string }): string {
        if (typeof item === 'string') return item;
        return item.id;
    }

    // Helper method to get type display name
    getTypeDisplayName(type: string | undefined): string {
        switch (type) {
            case LIBRARY_TYPES.TOOL: return 'tool';
            case LIBRARY_TYPES.BOOK: return 'book';
            case LIBRARY_TYPES.EQUIPMENT: return 'equipment';
            case LIBRARY_TYPES.OTHER:
            default: return 'item';
        }
    }

    // Helper to detect item type from name
    detectItemType(itemName: string): string {
        const name = itemName.toLowerCase();
        const toolKeywords = ['hammer', 'drill', 'saw', 'screwdriver', 'wrench', 'pliers', 'shovel', 'rake', 'axe', 'knife'];
        const bookKeywords = ['book', 'manual', 'guide', 'novel', 'textbook'];
        const equipmentKeywords = ['camera', 'projector', 'speaker', 'tent', 'bicycle', 'ladder'];

        if (toolKeywords.some(k => name.includes(k))) return LIBRARY_TYPES.TOOL;
        if (bookKeywords.some(k => name.includes(k))) return LIBRARY_TYPES.BOOK;
        if (equipmentKeywords.some(k => name.includes(k))) return LIBRARY_TYPES.EQUIPMENT;
        return LIBRARY_TYPES.OTHER;
    }

    async addItem(ctx: any) {
        let holonId = ctx.chat.id;
        const [_, item, value, ...categoryWords] = ctx.message.text.split(/\s+/);
        const category = categoryWords.join(' ') || 'Uncategorized';
        if (!item) {
            ctx.reply('Please specify an item to add. eg: /libadd hammer 10 tools');
            return;
        }
        if (await this.db.get(holonId.toString(), 'library', item)) {
            ctx.reply(`${item} is already in the library.`);
            return;
        }

        const itemValue = parseInt(value) || 0;
        const itemType = this.detectItemType(item);
        const libraryItem = this.createLibraryItem(item, itemType, {
            createdBy: ctx.from.id,
            createdByUsername: ctx.from.username,
            category: category,
            value: itemValue
        });

        await this.db.put(holonId.toString(), 'library', libraryItem);
        const icon = this.getItemIcon(libraryItem);
        ctx.reply(`${icon} Added ${item} to the library${itemValue > 0 ? ` (value: ${itemValue})` : ''}.`);
    }

    async removeItem(ctx: any) {
        let holonId = ctx.chat.id;
        const item = ctx.message.text.split('/libremove ')[1];
        if (!item) {
            ctx.reply('Please specify an item to remove. eg: /libremove hammer');
            return;
        }
        await this.db.delete(holonId.toString(), 'library', item);
        ctx.reply(`Removed ${item} from the library.`);
    }

    async borrowItem(ctx: any, fromKeyboard: boolean = false) {
        let holonId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
        let item;
        if (fromKeyboard) {
            item = ctx.match[1];
        } else {
            item = ctx.message.text.split('/borrow ')[1];
        }

        if (!item) {
            if (fromKeyboard) await ctx.answerCbQuery('No item specified').catch(() => {});
            else ctx.reply('Please specify an item to borrow. eg: /borrow hammer');
            return;
        }

        // Create a lock key to prevent concurrent borrows
        const lockKey = `${holonId}:${item}`;
        if (this.borrowLocks.has(lockKey)) {
            if (fromKeyboard) await ctx.answerCbQuery('Someone else is borrowing this item, please try again.').catch(() => {});
            else ctx.reply('Someone else is borrowing this item, please try again.');
            return;
        }

        // Check if item exists and is available
        let currentItem = await this.db.get(holonId.toString(), 'library', item);
        if (!currentItem) {
            if (fromKeyboard) await ctx.answerCbQuery(`${item} is not in the library.`).catch(() => {});
            else ctx.reply(`${item} is not in the library.`);
            return;
        }
        if (currentItem.borrowed) {
            if (fromKeyboard) await ctx.answerCbQuery(`${item} is already borrowed by ${currentItem.borrower}.`).catch(() => {});
            else ctx.reply(`${item} is already borrowed by ${currentItem.borrower}.`);
            return;
        }

        // Acquire lock to prevent others from borrowing while calendar is shown
        this.borrowLocks.add(lockKey);

        // Store pending borrow info with name for initials
        const firstName = ctx.from.first_name || '';
        const lastName = ctx.from.last_name || '';
        this.pendingBorrows.set(lockKey, {
            userId: ctx.from.id,
            username: ctx.from.username,
            firstName: firstName,
            lastName: lastName,
            item: currentItem,
            itemName: item,
            fromKeyboard: fromKeyboard
        });

        // Show calendar to select return date
        const icon = this.getItemIcon(currentItem);
        const calendarKeyboard = this.createLibraryCalendarKeyboard(new Date(), item);

        if (fromKeyboard) {
            await ctx.answerCbQuery().catch(() => {});
            await ctx.editMessageText(
                `📅 Borrowing ${icon} ${item}\n\nSelect return date:`,
                { reply_markup: calendarKeyboard }
            ).catch((error: unknown) => { console.log(error) });
        } else {
            await ctx.reply(
                `📅 Borrowing ${icon} ${item}\n\nSelect return date:`,
                { reply_markup: calendarKeyboard }
            );
        }
    }

    // Create calendar keyboard with library-specific callback prefixes
    // `_item` is accepted for call-site compatibility — the JS keyboard is
    // global to the holon and doesn't need the item id baked into the cells.
    createLibraryCalendarKeyboard(date: Date | number | string, _item?: string) {
        const displayDate = new Date(date);
        displayDate.setDate(1);
        displayDate.setHours(0, 0, 0, 0);

        const today = new Date();
        const year = displayDate.getFullYear();
        const month = displayDate.getMonth();
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

        // Day names
        const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        type KbButton = { text: string; callback_data: string };
        const keyboard: { inline_keyboard: KbButton[][] } = { inline_keyboard: [] };

        // Header row: << < Month Year > >>
        keyboard.inline_keyboard.push([
            { text: '<<', callback_data: `lb_m_${monthStr}_yy` },  // prev year
            { text: '<', callback_data: `lb_m_${monthStr}_mm` },   // prev month
            { text: `${months[month]} ${year}`, callback_data: ' ' },
            { text: '>', callback_data: `lb_m_${monthStr}_pp` },   // next month
            { text: '>>', callback_data: `lb_m_${monthStr}_py` }   // next year
        ]);

        // Day names row
        keyboard.inline_keyboard.push(days.map(d => ({ text: d, callback_data: ' ' })));

        // Calculate days in month and first day of week
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayOfWeek = new Date(year, month, 1).getDay();

        // Build day rows
        let dayNum = 1;
        for (let week = 0; week < 6 && dayNum <= daysInMonth; week++) {
            const row: KbButton[] = [];
            for (let dow = 0; dow < 7; dow++) {
                if ((week === 0 && dow < firstDayOfWeek) || dayNum > daysInMonth) {
                    row.push({ text: ' ', callback_data: ' ' });
                } else {
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                    const thisDate = new Date(year, month, dayNum);
                    const isToday = thisDate.toDateString() === today.toDateString();
                    const isPast = thisDate < new Date(today.getFullYear(), today.getMonth(), today.getDate());

                    if (isPast) {
                        row.push({ text: ' ', callback_data: ' ' });
                    } else {
                        const dayText = isToday ? `(${dayNum})` : `${dayNum}`;
                        row.push({ text: dayText, callback_data: `lb_d_${dateStr}` });
                    }
                    dayNum++;
                }
            }
            keyboard.inline_keyboard.push(row);
        }

        // Cancel button
        keyboard.inline_keyboard.push([
            { text: '❌ Cancel', callback_data: 'library_cancel_borrow' }
        ]);

        return keyboard;
    }

    // Handle calendar navigation
    async handleCalendarNavigation(ctx: any) {
        await ctx.answerCbQuery().catch(() => {});

        // Format: lb_m_YYYY-MM_action
        const monthStr = ctx.match[1]; // YYYY-MM
        const action = ctx.match[2];   // mm, pp, yy, py

        const [year, month] = monthStr.split('-').map(Number);
        let date = new Date(year, month - 1, 1);

        switch (action) {
            case 'py': // next year
                date.setFullYear(date.getFullYear() + 1);
                break;
            case 'yy': // prev year
                date.setFullYear(date.getFullYear() - 1);
                break;
            case 'pp': // next month
                date.setMonth(date.getMonth() + 1);
                break;
            case 'mm': // prev month
                date.setMonth(date.getMonth() - 1);
                break;
        }

        const calendarKeyboard = this.createLibraryCalendarKeyboard(date);
        await ctx.editMessageReplyMarkup(calendarKeyboard).catch((error: unknown) => { console.log(error) });
    }

    // Handle date selection and complete the borrow
    async handleBorrowDateSelected(ctx: any, dateStr: string) {
        const holonId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;

        // Find the pending borrow for this user in this chat
        let pendingKey: string | null = null;
        let pendingBorrow: PendingBorrow | null = null;
        for (const [key, value] of this.pendingBorrows.entries()) {
            if (key.startsWith(`${holonId}:`) && value.userId === ctx.from.id) {
                pendingKey = key;
                pendingBorrow = value;
                break;
            }
        }

        if (!pendingBorrow || !pendingKey) {
            await ctx.answerCbQuery('No pending borrow found. Please try again.').catch(() => {});
            return;
        }
        // Narrow for the rest of the body — the null-check above guarantees both.
        const lockKey: string = pendingKey;

        const { itemName, username, firstName, lastName } = pendingBorrow;
        const returnDate = new Date(dateStr);

        try {
            const borrowResult = await coreBorrowItem(
                this.db as any,
                holonId.toString(),
                itemName,
                {
                    id: ctx.from.id,
                    username,
                    first_name: firstName,
                    last_name: lastName,
                },
                returnDate
            );

            if (!borrowResult.ok || !borrowResult.item) {
                await ctx.answerCbQuery('Item is no longer available.').catch(() => {});
                this.pendingBorrows.delete(lockKey);
                this.borrowLocks.delete(lockKey);
                await this.showLibrary(ctx);
                return;
            }

            const freshItem = borrowResult.item;
            const isOwner = !!borrowResult.isOwner;

            // Core helper internally skips owners + zero-value items and
            // swallows persistence errors (matches the original inline path).
            const accountingDeps: AccountingDeps = {
                db: this.db as any,
                eventStore: this.eventStore,
                eventFactory: this.eventFactory,
            };
            await coreRecordBorrowAccounting(accountingDeps, holonId, ctx.from, freshItem);

            await ctx.answerCbQuery(`Borrowed until ${dateStr}`).catch(() => {});

            // Show updated library
            let list = await this.getLibraryItems(ctx);
            const icon = this.getItemIcon(freshItem);
            const keyboard = this.getLibraryKeyboard(list);

            // Build confirmation message with credit info if applicable
            let confirmMsg = `${icon} ${firstName || username} borrowed ${itemName}\n📅 Return by: ${dateStr}`;
            if (!isOwner && freshItem.value > 0) {
                confirmMsg += `\n💳 ${freshItem.value}● charged`;
            }
            confirmMsg += '\n\n📦 Library:';

            await ctx.editMessageText(confirmMsg, keyboard).catch(() => {});

        } finally {
            // Clean up
            this.pendingBorrows.delete(pendingKey);
            this.borrowLocks.delete(pendingKey);
        }
    }

    // Cancel pending borrow
    async cancelPendingBorrow(ctx: any) {
        const holonId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;

        // Find and remove the pending borrow for this user
        for (const [key, value] of this.pendingBorrows.entries()) {
            if (key.startsWith(`${holonId}:`) && value.userId === ctx.from.id) {
                this.pendingBorrows.delete(key);
                this.borrowLocks.delete(key);
                break;
            }
        }

        await ctx.answerCbQuery('Borrow cancelled').catch(() => {});
        await this.showLibrary(ctx);
    }

    async setItemValue(ctx: any) {
        let holonId = ctx.chat.id;
        const [_, item, value] = ctx.message.text.split(/\s+/);
        if (!item || !value) {
            ctx.reply('Please specify item and value. eg: /setvalue hammer 10');
            return;
        }

        let currentItem = await this.db.get(holonId.toString(), 'library', item);
        if (!currentItem) {
            ctx.reply(`${item} is not in the library.`);
            return;
        }

        if (currentItem.createdBy !== ctx.from.id) {
            ctx.reply(`Only the owner can change the value for ${item}.`);
            return;
        }

        currentItem.value = parseInt(value) || 0;
        await this.db.put(holonId.toString(), 'library', currentItem);
        const icon = this.getItemIcon(currentItem);
        ctx.reply(`${icon} Updated ${item} value to ${currentItem.value}.`);
    }

    async returnItem(ctx: any, fromKeyboard: boolean = false) {
        let holonId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
        let item;
        if (fromKeyboard) {
            item = ctx.match[1];
        } else {
            item = ctx.message.text.split('/return ')[1];
        }

        if (!item) {
            if (fromKeyboard) await ctx.answerCbQuery('No item specified').catch(() => {});
            else ctx.reply('Please specify an item to return. eg: /return hammer');
            return;
        }

        const returnResult = await coreReturnItem(
            this.db as any,
            holonId.toString(),
            item,
            {
                id: ctx.from.id,
                username: ctx.from.username,
                first_name: ctx.from.first_name,
                last_name: ctx.from.last_name,
            }
        );

        if (!returnResult.ok) {
            const errorMessages: Record<string, string> = {
                not_found: `${item} is not in the library.`,
                not_borrowed: `${item} is not borrowed.`,
                forbidden: `Only ${returnResult.item?.borrower} can return this item.`,
            };
            const msg = errorMessages[returnResult.reason ?? 'not_found'];
            if (fromKeyboard) await ctx.answerCbQuery(msg).catch(() => {});
            else ctx.reply(msg);
            return;
        }

        const currentItem = returnResult.item!;
        const isOwner = !!returnResult.isOwner;

        // Core helper internally skips owners + zero-value items and
        // swallows persistence errors (matches the original inline path).
        const accountingDeps: AccountingDeps = {
            db: this.db as any,
            eventStore: this.eventStore,
            eventFactory: this.eventFactory,
        };
        await coreRecordReturnAccounting(accountingDeps, holonId, ctx.from, currentItem);

        if (fromKeyboard) {
            const refundMsg = (!isOwner && currentItem.value > 0) ? ` (${currentItem.value}● refunded)` : '';
            await ctx.answerCbQuery(`Returned${refundMsg}`).catch(() => {});
            await this.showLibrary(ctx);
        } else {
            const icon = this.getItemIcon(currentItem);
            const refundMsg = (!isOwner && currentItem.value > 0) ? `\n💳 ${currentItem.value}● refunded` : '';
            ctx.reply(`${icon} You returned ${item}.${refundMsg}`);
        }
    }

    // Show borrowed item details
    async showBorrowedItemDetails(ctx: any) {
        const itemId = ctx.match[1];
        const holonId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;

        const item = await this.db.get(holonId.toString(), 'library', itemId);
        if (!item) {
            await ctx.answerCbQuery('Item not found').catch(() => {});
            return;
        }

        if (!item.borrowed) {
            await ctx.answerCbQuery('Item is not borrowed').catch(() => {});
            await this.showLibrary(ctx);
            return;
        }

        const icon = this.getItemIcon(item);
        const borrower = item.borrower || item.borrowerInitials || 'Unknown';

        // Format dates
        const borrowedDate = item.borrowedAt ? new Date(item.borrowedAt) : null;
        const returnDate = item.returnBy ? new Date(item.returnBy) : null;
        const now = new Date();

        // Check if overdue
        const isOverdue = returnDate && returnDate < now;
        const overdueMarker = isOverdue ? ' 🔴' : '';

        // Format borrowed date
        const borrowedStr = borrowedDate
            ? `${borrowedDate.getDate()}/${borrowedDate.getMonth() + 1}/${borrowedDate.getFullYear()}`
            : 'Unknown';

        // Format return date
        const returnStr = returnDate
            ? `${returnDate.getDate()}/${returnDate.getMonth() + 1}/${returnDate.getFullYear()}`
            : 'Not set';

        // Check if current user is the owner
        const isOwner = item.createdBy === ctx.from.id;
        const ownerText = isOwner ? 'You' : (item.createdByUsername || `User ${item.createdBy}`);

        // Build info text
        let infoText = `${icon} **${item.id}**${overdueMarker}\n\n`;
        infoText += `🏠 Owner: ${ownerText}\n`;
        infoText += `👤 Borrower: ${borrower}\n`;
        infoText += `📅 Borrowed: ${borrowedStr}\n`;
        infoText += `📆 Return by: ${returnStr}${isOverdue ? ' (OVERDUE)' : ''}\n`;
        if (item.value > 0) {
            infoText += `💰 Value: ${item.value}●\n`;
        }

        // Check if current user is the borrower
        const isBorrower = item.borrowerId === ctx.from.id || item.borrower === ctx.from.username;

        // Build keyboard
        const buttons = [];
        if (isBorrower) {
            buttons.push([Markup.button.callback('🔄 Return Item', `lib_ret_${itemId}`)]);
        }
        if (isOwner) {
            buttons.push([Markup.button.callback('🗑️ Delete Item', `lib_del_${itemId}`)]);
        }
        buttons.push([Markup.button.callback('🔙 Back to Library', 'library_back')]);

        await ctx.answerCbQuery().catch(() => {});
        await ctx.editMessageText(infoText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
        }).catch(() => {});
    }

    // Delete item from details view (owner only)
    async deleteItemFromDetails(ctx: any) {
        const itemId = ctx.match[1];
        const holonId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;

        const item = await this.db.get(holonId.toString(), 'library', itemId);
        if (!item) {
            await ctx.answerCbQuery('Item not found').catch(() => {});
            return;
        }

        // Only owner can delete
        if (item.createdBy !== ctx.from.id) {
            await ctx.answerCbQuery('Only the owner can delete this item').catch(() => {});
            return;
        }

        await this.db.delete(holonId.toString(), 'library', itemId);
        await ctx.answerCbQuery(`Deleted ${itemId}`).catch(() => {});
        await this.showLibrary(ctx);
    }

    // Show library with new interface
    async showLibrary(ctx: any, options: { removeMode?: boolean; page?: number } = {}) {
        const removeMode = options.removeMode || false;
        const page = options.page || 0;
        const holonId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;

        let list = await this.db.getAll(holonId.toString(), 'library');
        list.sort((a, b) => a.id.localeCompare(b.id));

        if (list.length === 0 && !removeMode) {
            await ctx.reply('📦 The library is empty.\n\nUse /libadd to add items or send a photo to add items from a picture.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('📷 Add from Photo', 'library_add_photo')],
                    [Markup.button.callback('➕ Add Manually', 'library_add_manual')]
                ]));
            return;
        }

        const totalPages = Math.ceil(list.length / ITEMS_PER_PAGE);
        const currentPage = Math.min(Math.max(0, page), totalPages - 1);
        const keyboard = this.getLibraryKeyboard(list, removeMode, currentPage);

        const pageInfo = totalPages > 1 ? ` (${currentPage + 1}/${totalPages})` : '';
        const headerText = `📦 Library${pageInfo}:`;

        if (ctx.callbackQuery) {
            await ctx.answerCbQuery().catch(() => {});
            await ctx.editMessageText(headerText, keyboard)
                .catch((error: unknown) => { console.log(error) });
        } else {
            await ctx.reply(headerText, keyboard);
        }
    }

    getLibraryKeyboard(list: any[], removeMode: boolean = false, page: number = 0) {
        let buttons = [];

        // Calculate pagination
        const totalPages = Math.ceil(list.length / ITEMS_PER_PAGE);
        const startIndex = page * ITEMS_PER_PAGE;
        const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, list.length);
        const pageItems = list.slice(startIndex, endIndex);

        // Add item buttons for current page
        pageItems.forEach((item) => {
            const icon = this.getItemIcon(item);
            if (removeMode) {
                buttons.push([Markup.button.callback(
                    `❌ ${icon} ${item.id}`,
                    `library_remove_${item.id}`
                )]);
            } else if (item.borrowed) {
                // Borrowed item - show details button with initials and return date
                const initials = item.borrowerInitials || (item.borrower ? item.borrower.charAt(0).toUpperCase() : '?');
                let returnInfo = initials;
                let overdueMarker = '';
                if (item.returnBy) {
                    const returnDate = new Date(item.returnBy);
                    const day = returnDate.getDate();
                    const month = returnDate.getMonth() + 1;
                    returnInfo = `${initials} ${day}/${month}`;
                    // Check if overdue
                    if (returnDate < new Date()) {
                        overdueMarker = '🔴 ';
                    }
                }
                buttons.push([Markup.button.callback(
                    `${overdueMarker}🔄 ${icon} ${item.id} (${returnInfo})`,
                    `libret_${item.id}`
                )]);
            } else {
                // Available item - show borrow button
                const valueText = item.value > 0 ? ` (${item.value}●)` : '';
                buttons.push([Markup.button.callback(
                    `${icon} ${item.id}${valueText}`,
                    `library_borrow_${item.id}`
                )]);
            }
        });

        // Add pagination buttons if needed
        if (totalPages > 1) {
            const paginationButtons = [];
            const suffix = removeMode ? '_rm' : '';

            if (page > 0) {
                paginationButtons.push(Markup.button.callback('⬅️ Prev', `library_page_${page - 1}${suffix}`));
            }
            paginationButtons.push(Markup.button.callback(`${page + 1}/${totalPages}`, ' '));
            if (page < totalPages - 1) {
                paginationButtons.push(Markup.button.callback('Next ➡️', `library_page_${page + 1}${suffix}`));
            }

            buttons.push(paginationButtons);
        }

        // Add control buttons
        if (removeMode) {
            buttons.push([
                Markup.button.callback('🔙 Back', 'library_exit_remove_mode')
            ]);
        } else {
            buttons.push([
                Markup.button.callback('📷 Add from Photo', 'library_add_photo'),
                Markup.button.callback('➕ Add', 'library_add_manual')
            ]);
            if (list.length > 0) {
                buttons.push([
                    Markup.button.callback('🗑️ Remove Items', 'library_enter_remove_mode')
                ]);
            }
        }

        return Markup.inlineKeyboard(buttons);
    }

    // Enter remove mode
    async enterRemoveMode(ctx: any) {
        await ctx.answerCbQuery().catch(() => {});
        await this.showLibrary(ctx, { removeMode: true });
    }

    // Exit remove mode
    async exitRemoveMode(ctx: any) {
        await ctx.answerCbQuery().catch(() => {});
        await this.showLibrary(ctx, { removeMode: false });
    }

    // Remove item from keyboard action
    async removeItemFromKeyboard(ctx: any) {
        const itemId = ctx.match[1];
        const holonId = ctx.chat.id;

        // Answer callback immediately for responsiveness
        ctx.answerCbQuery(`Removed ${itemId}`).catch(() => {});

        // Delete and refresh
        await this.db.delete(holonId.toString(), 'library', itemId);
        await this.showLibrary(ctx, { removeMode: true });
    }

    // Prompt for photo upload
    async promptPhotoUpload(ctx: any) {
        await ctx.answerCbQuery().catch(() => {});
        const holonId = ctx.chat.id;

        this.pendingPhotoItems.set(holonId, { waiting: true, items: [], selected: new Set() });

        await ctx.reply(
            '📷 Please send a photo of the items you want to add to the library.\n\nSupported formats: JPG, PNG, WEBP\n\nI will extract the items from the photo using AI.',
            Markup.inlineKeyboard([
                [Markup.button.callback('❌ Cancel', 'library_cancel_photo')]
            ])
        );
    }

    // Handle photo upload (to be called from bot's photo handler)
    async handlePhotoUpload(ctx: any) {
        const holonId = ctx.chat.id;
        const pending = this.pendingPhotoItems.get(holonId);

        if (!pending || !pending.waiting) {
            return false;
        }

        try {
            // Get the highest resolution photo
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const file = await ctx.telegram.getFile(photo.file_id);

            // Validate file type
            const filePath = file.file_path.toLowerCase();
            const supportedFormats = ['.jpg', '.jpeg', '.png', '.webp'];
            const isSupported = supportedFormats.some(ext => filePath.endsWith(ext));

            if (!isSupported) {
                await ctx.reply('❌ Unsupported image format. Please send a JPG, PNG, or WEBP image.',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('❌ Cancel', 'library_cancel_photo')]
                    ])
                );
                return true; // Handled, but invalid format
            }

            await ctx.reply('🔍 Analyzing image...');

            const fileUrl = `https://api.telegram.org/file/bot${ctx.telegram.token}/${file.file_path}`;

            // Download the image
            const response = await fetch(fileUrl);
            const imageBuffer = Buffer.from(await response.arrayBuffer());

            // Extract items using AI
            const result = await extractItemsFromImage(imageBuffer);

            if (result.error) {
                await ctx.reply(
                    `⚠️ ${result.error}\n\nThis is not a problem with your photo. Please try again later, or reach out so we can help:`,
                    Markup.inlineKeyboard([
                        [Markup.button.url('💬 Support & Feedback (HolonicDAO)', 'https://t.me/HolonicDAO')]
                    ])
                );
                this.pendingPhotoItems.delete(holonId);
                return true;
            }

            const items = result.items || [];

            if (items.length === 0) {
                await ctx.reply('No items could be identified in the image. Try with a clearer photo or add items manually.');
                this.pendingPhotoItems.delete(holonId);
                return true;
            }

            // Store items for selection (items are now {name, value} objects)
            // Use indices for selection since objects can't be compared by value in Set
            const allIndices = new Set(items.map((_, i) => i));
            this.pendingPhotoItems.set(holonId, {
                waiting: false,
                items: items,
                selected: allIndices // Select all by default
            });

            // Show items for confirmation
            await ctx.reply(
                `📦 Found ${items.length} items (${allIndices.size} selected). Toggle to select which to add:`,
                this.getPhotoItemsKeyboard(holonId)
            );

            return true;
        } catch (error) {
            console.error('Error processing photo:', error);
            await ctx.reply('Error processing the image. Please try again.');
            this.pendingPhotoItems.delete(holonId);
            return true;
        }
    }

    // Get keyboard for photo items selection
    getPhotoItemsKeyboard(holonId: number | string) {
        const pending = this.pendingPhotoItems.get(holonId);
        if (!pending) return Markup.inlineKeyboard([]);

        const buttons = pending.items.map((item, index) => {
            const isSelected = pending.selected.has(index);
            const itemName = typeof item === 'string' ? item : item.name;
            const itemValue = typeof item === 'object' && item.value ? ` (${item.value}●)` : '';
            return [Markup.button.callback(
                `${isSelected ? '✅' : '⬜️'} ${itemName}${itemValue}`,
                `library_toggle_photo_${index}`
            )];
        });

        buttons.push([
            Markup.button.callback('✅ Add Selected', 'library_confirm_photo'),
            Markup.button.callback('❌ Cancel', 'library_cancel_photo')
        ]);

        return Markup.inlineKeyboard(buttons);
    }

    // Toggle photo item selection
    async togglePhotoItem(ctx: any) {
        const index = parseInt(ctx.match[1]);
        const holonId = ctx.chat.id;
        const pending = this.pendingPhotoItems.get(holonId);

        if (!pending || !pending.items[index]) {
            await ctx.answerCbQuery('Item not found');
            return;
        }

        // Toggle by index
        if (pending.selected.has(index)) {
            pending.selected.delete(index);
        } else {
            pending.selected.add(index);
        }

        await ctx.answerCbQuery().catch(() => {});
        await ctx.editMessageText(
            `📦 Found ${pending.items.length} items (${pending.selected.size} selected). Toggle to select which to add:`,
            this.getPhotoItemsKeyboard(holonId)
        ).catch((error: unknown) => { console.log(error) });
    }

    // Confirm and add photo items
    async confirmPhotoItems(ctx: any) {
        const holonId = ctx.chat.id;
        const pending = this.pendingPhotoItems.get(holonId);

        if (!pending || pending.selected.size === 0) {
            await ctx.answerCbQuery('No items selected');
            return;
        }

        let added = 0;
        for (const index of pending.selected) {
            const item = pending.items[index];
            // Support both old string format and new {name, value} format
            const itemName = typeof item === 'string' ? item : item.name;
            const itemValue = typeof item === 'object' && item.value ? item.value : 0;

            // Check if item already exists
            if (await this.db.get(holonId.toString(), 'library', itemName)) {
                continue;
            }

            const itemType = this.detectItemType(itemName);
            const libraryItem = this.createLibraryItem(itemName, itemType, {
                createdBy: ctx.from.id,
                createdByUsername: ctx.from.username,
                value: itemValue
            });

            await this.db.put(holonId.toString(), 'library', libraryItem);
            added++;
        }

        this.pendingPhotoItems.delete(holonId);

        await ctx.answerCbQuery(`Added ${added} items`);
        await this.showLibrary(ctx);
    }

    // Cancel photo items
    async cancelPhotoItems(ctx: any) {
        const holonId = ctx.chat.id;
        this.pendingPhotoItems.delete(holonId);

        await ctx.answerCbQuery('Cancelled');
        await this.showLibrary(ctx);
    }

    // Prompt for manual add
    async promptManualAdd(ctx: any) {
        await ctx.answerCbQuery().catch(() => {});

        // Simple prompt - ask user to use command
        await ctx.reply('To add an item manually, use the command:\n\n/libadd <name> [value] [category]\n\nExample: /libadd hammer 10 tools');
    }

    async getLibraryItems(ctx: any) {
        let holonId = ctx.chat.id;
        let list = await this.db.getAll(holonId.toString(), 'library');
        list.sort((a, b) => a.id.localeCompare(b.id));
        return list;
    }

    async searchItems(ctx: any) {
        const searchTerm = ctx.message.text.split('/search ')[1].toLowerCase();
        let list = await this.getLibraryItems(ctx);
        
        const results = list.filter(item => 
            item.id.toLowerCase().includes(searchTerm) || 
            item.category.toLowerCase().includes(searchTerm)
        );

        if (results.length === 0) {
            ctx.reply('No items found matching your search.');
            return;
        }
        
        ctx.reply('Search results:', this.getLibraryKeyboard(results));
    }

    async rateItem(ctx: any) {
        // Legacy JS used a free `holonId` that threw at runtime; resolve from ctx.
        const holonId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
        const [_, item, rating, ...reviewWords] = ctx.message.text.split(/\s+/);
        const review = reviewWords.join(' ');
        const numRating = parseInt(rating);

        if (!item || isNaN(numRating) || numRating < 1 || numRating > 5) {
            ctx.reply('Please rate using format: /rate item 1-5 optional review');
            return;
        }

        let currentItem = await this.db.get(holonId.toString(), 'library', item);
        if (!currentItem) {
            ctx.reply(`${item} is not in the library.`);
            return;
        }

        currentItem.ratings = currentItem.ratings || [];
        currentItem.ratings.push({
            user: ctx.from.username,
            rating: numRating,
            review: review,
            date: new Date()
        });

        await this.db.put(holonId.toString(), 'library', currentItem);
        ctx.reply(`Thank you for rating ${item}!`);
    }

    async reportIssue(ctx: any) {
        const holonId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
        const [_, item, ...issueWords] = ctx.message.text.split(/\s+/);
        const issue = issueWords.join(' ');

        let currentItem = await this.db.get(holonId.toString(), 'library', item);
        if (!currentItem) {
            ctx.reply(`${item} is not in the library.`);
            return;
        }

        currentItem.issues = currentItem.issues || [];
        currentItem.issues.push({
            reporter: ctx.from.username,
            issue: issue,
            date: new Date(),
            resolved: false
        });

        await this.db.put(holonId.toString(), 'library', currentItem);
        ctx.reply(`Issue reported for ${item}. The owner will be notified.`);
    }

    async showStats(ctx: any) {
        let list = await this.getLibraryItems(ctx);

        // Count items by type
        const byType: Record<string, number> = {};
        list.forEach((item: any) => {
            const type = item.type || LIBRARY_TYPES.OTHER;
            byType[type] = (byType[type] || 0) + 1;
        });

        // Format stats message
        const statsMessage = `📊 Library Statistics

📦 Total Items: ${list.length}
🔄 Currently Borrowed: ${list.filter(i => i.borrowed).length}
✅ Available: ${list.filter(i => !i.borrowed).length}

By Type:
${Object.entries(byType).map(([type, count]) => {
    const icon = this.getItemIcon({ type });
    return `${icon} ${this.getTypeDisplayName(type)}: ${count}`;
}).join('\n')}`;

        ctx.reply(statsMessage);
    }

    // Check if library is waiting for a photo (for external photo handler)
    isWaitingForPhoto(holonId: number | string) {
        const pending = this.pendingPhotoItems.get(holonId);
        return pending && pending.waiting;
    }
}

export default Library;