/**
 * @fileoverview Community library system for item lending and borrowing.
 * @module src/Library
 */

import { Markup } from 'telegraf';
import { REAEventStore, REAEventFactory, REAAggregator } from './domain/rea/index.js';

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
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;

        // Initialize REA components
        this.eventStore = new REAEventStore(db);
        this.eventFactory = REAEventFactory;
        this.aggregator = new REAAggregator(this.eventStore);

        this.bot.command('removeitem', (ctx) => this.removeItem(ctx));
        this.bot.command('additem', (ctx) => this.addItem(ctx));
        this.bot.command('borrow', (ctx) => this.borrowItem(ctx, false));
        this.bot.command('return', (ctx) => this.returnItem(ctx, false));
        this.bot.command('inventory', (ctx) => this.inventory(ctx));
        this.bot.command('setcredits', (ctx) => this.setItemCredits(ctx));
        this.bot.command('mycredits', (ctx) => this.showUserCredits(ctx));
        this.bot.action(/borrow_(.+)/, (ctx) => this.borrowItem(ctx, true));
        this.bot.action(/return_(.+)/, (ctx) => this.returnItem(ctx, true));
        this.bot.command('stats', (ctx) => this.showStats(ctx));
    }

    async addItem(ctx) {
        let holonId = ctx.chat.id;
        const [_, item, credits, ...categoryWords] = ctx.message.text.split(/\s+/);
        const category = categoryWords.join(' ') || 'Uncategorized';
        if (!item) {
            ctx.reply('Please specify an item to add and optional credits. eg: /additem hammer 5');
            return;
        }
        if(await this.db.get(holonId + '/library', item)) {
            ctx.reply(`${item} is already in the library.`);
            return;
        }

        const itemCredits = parseInt(credits) || 1;
        await this.db.put(holonId + '/library', { 
            id: item, 
            borrowed: false,
            credits: itemCredits,
            owner: ctx.from.id,
            borrower: null,
            totalEarned: 0,
            category: category
        });
        ctx.reply(`Added ${item} to the library (${itemCredits} credits per borrow).`);
    }

    async removeItem(ctx) {
        let holonId = ctx.chat.id;
        const item = ctx.message.text.split('/removeitem ')[1];
        if (!item) {
            ctx.reply('Please specify an item to remove. eg: /removeitem hammer');
            return;
        }
        await this.db.del(holonId + '/library', item);
        ctx.reply(`Removed ${item} from the library.`);
    }

    async borrowItem(ctx, fromKeyboard = false) {
        let holonId = ctx.chat.id;
        const item = fromKeyboard ? ctx.match[1] : ctx.message.text.split('/borrow ')[1];

        if (!item) {
            ctx.reply('Please specify an item to borrow. eg: /borrow hammer');
            return;
        }

        let currentItem = await this.db.get(holonId + '/library', item);
        if (!currentItem) {
            ctx.reply(`${item} is not in the library.`);
            return;
        }
        if(currentItem.borrowed) {
            ctx.reply(`${item} is already borrowed by ${currentItem.borrower}.`);
            return;
        }

        // Check if it's the owner borrowing
        const isOwner = currentItem.owner === ctx.from.id;

        if (!isOwner) {
            // Handle credit checks and transactions only for non-owners
            const deposit = Math.ceil(currentItem.credits * 0.5);
            const totalCost = currentItem.credits + deposit;

            let userCredits = await this.getUserCredits(ctx.from.id, holonId);
            if (userCredits < totalCost) {
                ctx.reply(`You need ${currentItem.credits} credits plus ${deposit} credit deposit. You have ${userCredits} credits.`);
                return;
            }

            // Deduct credits including deposit
            await this.updateUserCredits(ctx.from.id, holonId, -totalCost);
            await this.db.put(holonId + '/deposits', {
                id: item,
                amount: deposit,
                borrower: ctx.from.id
            });

            // Add credits to owner
            await this.updateUserCredits(currentItem.owner, holonId, currentItem.credits);
            currentItem.totalEarned += currentItem.credits;

            // Create REA events for the borrow transaction
            try {
                const events = this.eventFactory.itemBorrowed(
                    holonId,
                    ctx.from,
                    currentItem,
                    currentItem.credits,
                    deposit
                );
                await Promise.all(events.map(e => this.eventStore.put(holonId, e)));
                console.log(`Item ${item} borrowed with ${events.length} REA events`);
            } catch (error) {
                console.error('Error creating REA events for borrow:', error);
            }
        }

        currentItem.borrowed = true;
        currentItem.borrower = ctx.from.username;
        await this.db.put(holonId + '/library', currentItem);

        if (fromKeyboard) {
            let list = await this.getLibraryItems(ctx);
            ctx.editMessageText('Here is the library inventory:', this.getLibraryKeyboard(list))
                .catch((error) => { console.log(error) });
        } else {
            const message = isOwner ?
                `You borrowed your own item: ${item}` :
                `${currentItem.borrower} borrowed ${item} for ${currentItem.credits} credits.`;
            ctx.reply(message).catch((err) => { console.log(err) });
        }
    }

    async setItemCredits(ctx) {
        let holonId = ctx.chat.id;
        const [_, item, credits] = ctx.message.text.split(/\s+/);
        if (!item || !credits) {
            ctx.reply('Please specify item and credits. eg: /setcredits hammer 5');
            return;
        }

        let currentItem = await this.db.get(holonId + '/library', item);
        if (!currentItem) {
            ctx.reply(`${item} is not in the library.`);
            return;
        }

        if (currentItem.owner !== ctx.from.id) {
            ctx.reply(`Only the owner can change the credits for ${item}.`);
            return;
        }

        currentItem.credits = parseInt(credits);
        await this.db.put(holonId + '/library', currentItem);
        ctx.reply(`Updated ${item} to ${credits} credits per borrow.`);
    }

    async showUserCredits(ctx) {
        let holonId = ctx.chat.id;
        const credits = await this.getUserCredits(ctx.from.id, holonId);
        const items = await this.getLibraryItems(ctx);
        let earnings = 0;
        
        items.forEach(item => {
            if (item.owner === ctx.from.id) {
                earnings += item.totalEarned || 0;
            }
        });

        ctx.reply(`Your credits: ${credits}\nTotal earnings: ${earnings}`);
    }

    async getUserCredits(userId, holonId) {
        const credits = await this.db.get(holonId + '/credits', userId.toString());
        return credits?.amount || 10; // New users start with 10 credits
    }

    async updateUserCredits(userId, holonId, amount) {
        const current = await this.getUserCredits(userId, holonId);
        await this.db.put(holonId + '/credits', {
            id: userId.toString(),
            amount: current + amount
        });
    }

    async returnItem(ctx, fromKeyboard = false) {
        let holonId = ctx.chat.id;
        const item = fromKeyboard ? ctx.match[1] : ctx.message.text.split('/return ')[1];

        if (!item) {
            ctx.reply('Please specify an item to return. eg: /return hammer');
            return;
        }

        let currentItem = await this.db.get(holonId + '/library', item);
        if (!currentItem) {
            ctx.reply(`${item} is not in the library.`);
            return;
        }
        if(!currentItem.borrowed) {
            ctx.reply(`${item} is not borrowed.`);
            return;
        }

        if (currentItem.borrower !== ctx.from.username) {
            ctx.reply(`Only ${currentItem.borrower} can return this item.`);
            return;
        }

        // Return deposit if item is returned in good condition
        const deposit = await this.db.get(holonId + '/deposits', currentItem.id);
        if (deposit) {
            await this.updateUserCredits(ctx.from.id, holonId, deposit.amount);
            await this.db.del(holonId + '/deposits', currentItem.id);

            // Create REA events for the return transaction
            try {
                const events = this.eventFactory.itemReturned(
                    holonId,
                    ctx.from,
                    currentItem,
                    deposit.amount
                );
                await Promise.all(events.map(e => this.eventStore.put(holonId, e)));
                console.log(`Item ${item} returned with ${events.length} REA events`);
            } catch (error) {
                console.error('Error creating REA events for return:', error);
            }

            ctx.reply(`Deposit of ${deposit.amount} credits returned.`);
        }

        currentItem.borrowed = false;
        currentItem.borrower = null;
        await this.db.put(holonId + '/library', currentItem);

        if (fromKeyboard) {
            let list = await this.getLibraryItems(ctx);
            ctx.editMessageText('Here is the library inventory:', this.getLibraryKeyboard(list))
                .catch((error) => { console.log(error) });
        } else {
            ctx.reply(`You returned ${item}.`);
        }
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
            const status = item.borrowed ? `( ${item.borrower} )` : ` (${item.credits} credits)`;
            mu.push([Markup.button.callback(item.id + status, 
                item.borrowed ? `return_${item.id}` : `borrow_${item.id}`)]);
        });
        return Markup.inlineKeyboard(mu);
    }

    async getLibraryItems(ctx) {
        let holonId = ctx.chat.id;
        let list = await this.db.getAll(holonId + '/library');
        list.sort((a, b) => a.id.localeCompare(b.id));
        return list;
    }

    async searchItems(ctx) {
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

    async rateItem(ctx) {
        const [_, item, rating, ...reviewWords] = ctx.message.text.split(/\s+/);
        const review = reviewWords.join(' ');
        const numRating = parseInt(rating);

        if (!item || isNaN(numRating) || numRating < 1 || numRating > 5) {
            ctx.reply('Please rate using format: /rate item 1-5 optional review');
            return;
        }

        let currentItem = await this.db.get(holonId + '/library', item);
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

        await this.db.put(holonId + '/library', currentItem);
        ctx.reply(`Thank you for rating ${item}!`);
    }

    async reportIssue(ctx) {
        const [_, item, ...issueWords] = ctx.message.text.split(/\s+/);
        const issue = issueWords.join(' ');

        let currentItem = await this.db.get(holonId + '/library', item);
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

        await this.db.put(holonId + '/library', currentItem);
        ctx.reply(`Issue reported for ${item}. The owner will be notified.`);
    }

    async showStats(ctx) {
        let list = await this.getLibraryItems(ctx);
        const stats = {
            totalItems: list.length,
            borrowedItems: list.filter(i => i.borrowed).length,
            totalCreditsInSystem: 0,
            mostBorrowedItems: {},
            topLenders: {}
        };

        // Calculate item popularity
        list.forEach(item => {
            stats.mostBorrowedItems[item.id] = item.totalEarned / item.credits;
            stats.topLenders[item.owner] = (stats.topLenders[item.owner] || 0) + item.totalEarned;
        });

        // Format stats message
        const statsMessage = `📊 Library Statistics
Total Items: ${stats.totalItems}
Currently Borrowed: ${stats.borrowedItems}
Most Popular Items: ${Object.entries(stats.mostBorrowedItems)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3)
    .map(([item, borrows]) => `\n- ${item} (${borrows} borrows)`)
    .join('')}`;

        ctx.reply(statsMessage);
    }
}

export default Library;