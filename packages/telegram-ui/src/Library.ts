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
    bookItem as coreBookItem,
    bookingBound,
    bookingStatus,
    dayKey,
    getLibraryStats,
    minuteKey,
    recordBorrowAccounting as coreRecordBorrowAccounting,
    recordReturnAccounting as coreRecordReturnAccounting,
    returnItem as coreReturnItem,
    returnableBooking,
    timeOf,
    wallClock,
    ymd,
    type AccountingDeps,
    type Booking,
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
    itemName: string;
    /** Booking by the clock: a day is picked, then a start time, then a length. */
    timed?: boolean;
    day?: string;
    /** Chosen start, as a `YYYY-MM-DDTHH:mm` bound. */
    start?: string;
}

/** Quick lengths offered from now, and lengths offered after a start time (minutes). */
const QUICK_MINUTES = [60, 120, 240];
const LENGTH_MINUTES = [30, 60, 120, 180, 240, 360, 480, 720];

function fmtLength(minutes: number): string {
    return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}

/** A booking bound as the bot shows it: "12/10" or "12/10 14:00". */
function fmtBound(s: string): string {
    const [, m, d] = dayKey(s).split('-');
    const day = `${Number(d)}/${Number(m)}`;
    const time = timeOf(s);
    return time ? `${day} ${time}` : day;
}

/** "12/10 14:00–15:00" within a day, else "12/10 → 14/10". */
function fmtRange(b: Pick<Booking, 'start' | 'end'>): string {
    if (timeOf(b.start) && dayKey(b.start) === dayKey(b.end)) {
        return `${fmtBound(b.start)}–${timeOf(b.end)}`;
    }
    return dayKey(b.start) === dayKey(b.end) ? fmtBound(b.start) : `${fmtBound(b.start)} → ${fmtBound(b.end)}`;
}

/** `start` plus `minutes`, as a timed bound. */
function addMinutes(start: string, minutes: number): string {
    return minuteKey(new Date(new Date(start).getTime() + minutes * 60_000));
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
    settings: any | null;
    pendingBorrows: Map<string, PendingBorrow>;
    calendar: any;
    eventStore: any;
    eventFactory: typeof REAEventFactory;
    aggregator: any;

    constructor(bot: BotLike, db: DbLike, settings: any | null = null) {
        this.bot = bot;
        this.db = db;
        this.settings = settings;
        this.expensesInstance = null;
        this.pendingPhotoItems = new Map(); // Store pending items from photo extraction per chat
        // A borrow waiting for its dates: one per person per chat (key=holonId:userId).
        // Core checks every booking against the stored item, so nothing is locked meanwhile.
        this.pendingBorrows = new Map();

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
        // `/inventory` now opens the stock shelf (src/Stock.ts); the library is /library.
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
        // Booking by the clock: a few hours from now, or a day → start time → length.
        this.bot.action(/^lb_q_(\d+)$/, (ctx) => this.handleQuickBorrow(ctx, parseInt(ctx.match[1])));
        this.bot.action('lb_t', (ctx) => this.handlePickTime(ctx));
        this.bot.action(/^lb_h_(\d{2}:\d{2})$/, (ctx) => this.handleStartSelected(ctx, ctx.match[1]));
        this.bot.action(/^lb_l_(\d+)$/, (ctx) => this.handleLengthSelected(ctx, parseInt(ctx.match[1])));
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
            case LIBRARY_TYPES.ACCOMMODATION: return '🛏️';
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
            case LIBRARY_TYPES.ACCOMMODATION: return 'accommodation';
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
        const accommodationKeywords = ['room', 'cabin', 'apartment', 'dorm', 'bungalow', 'guesthouse'];

        if (toolKeywords.some(k => name.includes(k))) return LIBRARY_TYPES.TOOL;
        if (bookKeywords.some(k => name.includes(k))) return LIBRARY_TYPES.BOOK;
        if (equipmentKeywords.some(k => name.includes(k))) return LIBRARY_TYPES.EQUIPMENT;
        if (accommodationKeywords.some(k => name.includes(k))) return LIBRARY_TYPES.ACCOMMODATION;
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

        const currentItem = await this.db.get(holonId.toString(), 'library', item);
        if (!currentItem) {
            if (fromKeyboard) await ctx.answerCbQuery(`${item} is not in the library.`).catch(() => {});
            else ctx.reply(`${item} is not in the library.`);
            return;
        }

        // Remember who is borrowing what while they pick the dates. An item that
        // is out right now can still be booked for later — core checks the
        // chosen stretch against every existing booking when it is confirmed.
        this.pendingBorrows.set(this.pendingKey(holonId, ctx.from.id), {
            userId: ctx.from.id,
            username: ctx.from.username,
            firstName: ctx.from.first_name || '',
            lastName: ctx.from.last_name || '',
            itemName: item,
        });

        const now = await this.holonNow(holonId);
        const status = bookingStatus(currentItem, now);
        const icon = this.getItemIcon(currentItem);
        const out = status.state === 'out' && status.booking
            ? `\n⏳ Out with ${status.booking.borrower} until ${fmtBound(status.booking.end)}`
            : '';
        const text = `📅 Borrowing ${icon} ${item}${out}\n\nFor a few hours from now, by the clock, or pick the return date:`;
        const calendarKeyboard = this.createLibraryCalendarKeyboard(now, item, { now });

        if (fromKeyboard) {
            await ctx.answerCbQuery().catch(() => {});
            await ctx.editMessageText(text, { reply_markup: calendarKeyboard })
                .catch((error: unknown) => { console.log(error) });
        } else {
            await ctx.reply(text, { reply_markup: calendarKeyboard });
        }
    }

    pendingKey(holonId: number | string, userId: number | string): string {
        return `${holonId}:${userId}`;
    }

    /**
     * The holon's wall clock. Booking times carry no zone, so a bot hosted
     * elsewhere reads "now" in the holon's own timezone setting; without one
     * the host's clock stands.
     */
    async holonNow(holonId: number | string): Promise<Date> {
        let zone = '';
        try {
            zone = (await this.settings?.getSettings(holonId))?.timezone || '';
        } catch {
            // no settings — host clock
        }
        return wallClock(new Date(), zone);
    }

    // Create calendar keyboard with library-specific callback prefixes
    // `_item` is accepted for call-site compatibility — the JS keyboard is
    // global to the holon and doesn't need the item id baked into the cells.
    // `opts.timed` is the day step of a by-the-clock booking: the same grid
    // without the shortcuts that lead into it.
    createLibraryCalendarKeyboard(
        date: Date | number | string,
        _item?: string,
        opts: { now?: Date; timed?: boolean } = {}
    ) {
        const displayDate = new Date(date);
        displayDate.setDate(1);
        displayDate.setHours(0, 0, 0, 0);

        const today = opts.now ?? new Date();
        const year = displayDate.getFullYear();
        const month = displayDate.getMonth();
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

        // Day names
        const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        type KbButton = { text: string; callback_data: string };
        const keyboard: { inline_keyboard: KbButton[][] } = { inline_keyboard: [] };

        if (!opts.timed) {
            keyboard.inline_keyboard.push(
                QUICK_MINUTES.map(m => ({ text: `⏱ ${fmtLength(m)}`, callback_data: `lb_q_${m}` })),
                [{ text: '🕐 Pick day & time', callback_data: 'lb_t' }]
            );
        }

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

        const holonId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
        const pending = this.pendingBorrows.get(this.pendingKey(holonId, ctx.from.id));
        const calendarKeyboard = this.createLibraryCalendarKeyboard(date, undefined, {
            now: await this.holonNow(holonId),
            timed: !!pending?.timed,
        });
        await ctx.editMessageReplyMarkup(calendarKeyboard).catch((error: unknown) => { console.log(error) });
    }

    /** The borrow this person is in the middle of, or null (after telling them so). */
    async pendingFor(ctx: any): Promise<{ holonId: number | string; pending: PendingBorrow } | null> {
        const holonId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
        const pending = this.pendingBorrows.get(this.pendingKey(holonId, ctx.from.id));
        if (!pending) {
            await ctx.answerCbQuery('No pending borrow found. Please try again.').catch(() => {});
            return null;
        }
        return { holonId, pending };
    }

    // A day was tapped: the return date of a whole-day borrow, or the day of a
    // by-the-clock booking (which goes on to ask for the start time).
    async handleBorrowDateSelected(ctx: any, dateStr: string) {
        const found = await this.pendingFor(ctx);
        if (!found) return;
        const { holonId, pending } = found;

        if (!pending.timed) {
            await this.completeBorrow(ctx, holonId, pending, { end: dateStr });
            return;
        }

        pending.day = dateStr;
        const now = await this.holonNow(holonId);
        // Today, the hours already gone are left out (the running one stays).
        const from = dateStr === ymd(now) ? now.getHours() : 0;
        const hours: Array<{ text: string; callback_data: string }> = [];
        for (let h = from; h < 24; h++) {
            const time = `${String(h).padStart(2, '0')}:00`;
            hours.push({ text: time, callback_data: `lb_h_${time}` });
        }
        const rows: Array<typeof hours> = [];
        for (let i = 0; i < hours.length; i += 4) rows.push(hours.slice(i, i + 4));
        rows.push([{ text: '❌ Cancel', callback_data: 'library_cancel_borrow' }]);

        await ctx.answerCbQuery().catch(() => {});
        await ctx.editMessageText(
            `🕐 Booking ${pending.itemName} on ${fmtBound(dateStr)}\n\nFrom what time?`,
            { reply_markup: { inline_keyboard: rows } }
        ).catch((error: unknown) => { console.log(error) });
    }

    // "Pick day & time": the calendar again, now choosing the day of the booking.
    async handlePickTime(ctx: any) {
        const found = await this.pendingFor(ctx);
        if (!found) return;
        const { holonId, pending } = found;
        pending.timed = true;
        const now = await this.holonNow(holonId);
        await ctx.answerCbQuery().catch(() => {});
        await ctx.editMessageText(
            `🕐 Booking ${pending.itemName}\n\nWhich day?`,
            { reply_markup: this.createLibraryCalendarKeyboard(now, pending.itemName, { now, timed: true }) }
        ).catch((error: unknown) => { console.log(error) });
    }

    // A start time was tapped: ask how long.
    async handleStartSelected(ctx: any, time: string) {
        const found = await this.pendingFor(ctx);
        if (!found) return;
        const { pending } = found;
        if (!pending.day) {
            await ctx.answerCbQuery('Pick a day first.').catch(() => {});
            return;
        }
        pending.start = bookingBound(pending.day, time);
        const lengths = LENGTH_MINUTES.map(m => ({ text: fmtLength(m), callback_data: `lb_l_${m}` }));
        await ctx.answerCbQuery().catch(() => {});
        await ctx.editMessageText(
            `🕐 Booking ${pending.itemName} from ${fmtBound(pending.start)}\n\nFor how long?`,
            {
                reply_markup: {
                    inline_keyboard: [
                        lengths.slice(0, 4),
                        lengths.slice(4),
                        [{ text: '❌ Cancel', callback_data: 'library_cancel_borrow' }],
                    ],
                },
            }
        ).catch((error: unknown) => { console.log(error) });
    }

    // A length was tapped after a start time: book that stretch.
    async handleLengthSelected(ctx: any, minutes: number) {
        const found = await this.pendingFor(ctx);
        if (!found) return;
        const { holonId, pending } = found;
        if (!pending.start) {
            await ctx.answerCbQuery('Pick a start time first.').catch(() => {});
            return;
        }
        await this.completeBorrow(ctx, holonId, pending, {
            start: pending.start,
            end: addMinutes(pending.start, minutes),
        });
    }

    // "1 h" / "2 h" / "4 h": from now.
    async handleQuickBorrow(ctx: any, minutes: number) {
        const found = await this.pendingFor(ctx);
        if (!found) return;
        const { holonId, pending } = found;
        const start = minuteKey(await this.holonNow(holonId));
        await this.completeBorrow(ctx, holonId, pending, { start, end: addMinutes(start, minutes) });
    }

    // Book the chosen stretch through core and show the outcome.
    async completeBorrow(
        ctx: any,
        holonId: number | string,
        pending: PendingBorrow,
        range: { start?: string; end: string }
    ) {
        const { itemName, username, firstName, lastName } = pending;
        const now = await this.holonNow(holonId);
        try {
            const result = await coreBookItem(
                this.db as any,
                holonId.toString(),
                itemName,
                {
                    id: ctx.from.id,
                    username,
                    first_name: firstName,
                    last_name: lastName,
                },
                range,
                { now }
            );

            if (!result.ok || !result.item || !result.booking) {
                const msg = result.reason === 'overlaps' && result.conflict
                    ? `Booked by ${result.conflict.borrower || 'someone'} ${fmtRange(result.conflict)} — pick another time.`
                    : result.reason === 'invalid_range'
                        ? 'That time is already past — pick a later one.'
                        : 'Item is no longer available.';
                await ctx.answerCbQuery(msg, { show_alert: true }).catch(() => {});
                await this.showLibrary(ctx);
                return;
            }

            const freshItem = result.item;
            const isOwner = !!result.isOwner;

            // Core helper internally skips owners + zero-value items and
            // swallows persistence errors (matches the original inline path).
            // The custody + fee REA events come from the ledger projection
            // on the library write itself; this mirrors the credit charge
            // into the expenses lens.
            const accountingDeps: AccountingDeps = { db: this.db as any };
            await coreRecordBorrowAccounting(accountingDeps, holonId, ctx.from, freshItem);

            const when = fmtRange(result.booking);
            await ctx.answerCbQuery(`Booked ${when}`).catch(() => {});

            // Show updated library
            let list = await this.getLibraryItems(ctx);
            const icon = this.getItemIcon(freshItem);
            const keyboard = this.getLibraryKeyboard(list, false, 0, now);

            // Build confirmation message with credit info if applicable
            let confirmMsg = `${icon} ${firstName || username} borrowed ${itemName}\n📅 ${when}`;
            if (!isOwner && freshItem.value > 0) {
                confirmMsg += `\n💳 ${freshItem.value}● charged`;
            }
            confirmMsg += '\n\n📦 Library:';

            await ctx.editMessageText(confirmMsg, keyboard).catch(() => {});

        } finally {
            this.pendingBorrows.delete(this.pendingKey(holonId, ctx.from.id));
        }
    }

    // Cancel pending borrow
    async cancelPendingBorrow(ctx: any) {
        const holonId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
        this.pendingBorrows.delete(this.pendingKey(holonId, ctx.from.id));

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

        const now = await this.holonNow(holonId);
        const returnResult = await coreReturnItem(
            this.db as any,
            holonId.toString(),
            item,
            {
                id: ctx.from.id,
                username: ctx.from.username,
                first_name: ctx.from.first_name,
                last_name: ctx.from.last_name,
            },
            { now }
        );

        if (!returnResult.ok) {
            const holder = returnResult.item ? bookingStatus(returnResult.item, now).booking?.borrower : null;
            const errorMessages: Record<string, string> = {
                not_found: `${item} is not in the library.`,
                not_borrowed: `${item} is not borrowed.`,
                forbidden: `Only ${holder || 'the borrower'} can return this item.`,
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
        const accountingDeps: AccountingDeps = { db: this.db as any };
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

        // Read the state from the bookings — the stored `borrowed` flag is only
        // as fresh as the last write.
        const now = await this.holonNow(holonId);
        const status = bookingStatus(item, now);
        const held = status.booking;
        if (!held) {
            await ctx.answerCbQuery('Item is not borrowed').catch(() => {});
            await this.showLibrary(ctx);
            return;
        }

        const icon = this.getItemIcon(item);
        const isOverdue = status.state === 'overdue';
        const overdueMarker = isOverdue ? ' 🔴' : '';

        // Check if current user is the owner
        const isOwner = item.createdBy === ctx.from.id;
        const ownerText = isOwner ? 'You' : (item.createdByUsername || `User ${item.createdBy}`);

        // Build info text
        let infoText = `${icon} **${item.id}**${overdueMarker}\n\n`;
        infoText += `🏠 Owner: ${ownerText}\n`;
        infoText += `👤 Borrower: ${held.borrower || held.borrowerInitials || 'Unknown'}\n`;
        infoText += `📅 Borrowed: ${fmtBound(held.start)}\n`;
        infoText += `📆 Return by: ${fmtBound(held.end)}${isOverdue ? ' (OVERDUE)' : ''}\n`;
        if (status.next) {
            infoText += `⏭ Next: ${status.next.borrower || 'someone'}, ${fmtRange(status.next)}\n`;
        }
        if (item.value > 0) {
            infoText += `💰 Value: ${item.value}●\n`;
        }

        // Core decides whose borrow this is (ids match as text, names as a
        // fallback) — the same rule the return itself applies.
        const isBorrower = !!returnableBooking(item, ctx.from, now);

        // Build keyboard
        const buttons = [];
        if (isBorrower) {
            buttons.push([Markup.button.callback('🔄 Return Item', `lib_ret_${itemId}`)]);
        }
        buttons.push([Markup.button.callback('📅 Book for later', `library_borrow_${itemId}`)]);
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
        const keyboard = this.getLibraryKeyboard(list, removeMode, currentPage, await this.holonNow(holonId));

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

    getLibraryKeyboard(list: any[], removeMode: boolean = false, page: number = 0, now: Date = new Date()) {
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
            } else if (bookingStatus(item, now).booking) {
                // Out (or overdue) - show details button with initials and when it is due back
                const status = bookingStatus(item, now);
                const held = status.booking!;
                const initials = held.borrowerInitials || (held.borrower ? held.borrower.charAt(0).toUpperCase() : '?');
                const overdueMarker = status.state === 'overdue' ? '🔴 ' : '';
                buttons.push([Markup.button.callback(
                    `${overdueMarker}🔄 ${icon} ${item.id} (${initials} ${fmtBound(held.end)})`,
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

        const stats = getLibraryStats(list, await this.holonNow(ctx.chat.id));

        // Format stats message
        const statsMessage = `📊 Library Statistics

📦 Total Items: ${stats.total}
🔄 Currently Borrowed: ${stats.borrowed}
✅ Available: ${stats.available}

By Type:
${Object.entries(stats.byType).map(([type, count]) => {
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