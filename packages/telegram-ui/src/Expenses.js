/**
 * @fileoverview Expense tracking and splitting for HolonsBot.
 * @module src/Expenses
 */
import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import i18next from 'i18next';
import * as utils from './utilities.js';
import { createPaddedCaption } from './utilities.js';
import { REAEventStore, REAEventFactory, REAAggregator } from './domain/rea/index.js';
import {
    computeBalances,
    computeUserCurrencyBalance,
    createExpense,
    normalizeCurrency,
    toggleParticipant as toggleParticipantSplit,
    addParticipant as addParticipantSplit,
    removeParticipant as removeParticipantSplit,
    splitAmongAll,
} from '@holons/core/expenses';

const DASHBOARD_ADDRESS = process.env.DASHBOARD_ADDRESS || 'https://dashboard.holons.io';

/**
 * Expense tracking and splitting class for managing shared expenses within holons.
 *
 * @class Expenses
 * @description Handles expense creation, splitting among participants, and balance tracking.
 * Integrates with REA (Resource-Event-Agent) pattern for economic event tracking.
 *
 * @property {Telegraf} bot - The Telegraf bot instance
 * @property {DB} db - Database instance
 * @property {UI} ui - UI module instance
 * @property {Settings} settings - Settings module instance
 * @property {REAEventStore} eventStore - REA event store for economic events
 * @property {Object} eventFactory - REA event factory
 * @property {REAAggregator} aggregator - REA aggregator for computing balances
 *
 * @example
 * const expenses = new Expenses(bot, db, ui, settings);
 * // Expense commands are now available: /expense, /spent, /ledger, etc.
 */
export default class Expenses {
    /**
     * Creates a new Expenses instance and registers expense commands.
     * @constructor
     * @param {Telegraf} bot - The Telegraf bot instance
     * @param {DB} db - The database instance
     * @param {UI} ui - The UI module instance
     * @param {Settings} settings - The settings module instance
     */
    constructor(bot, db, ui, settings) {
        this.bot = bot;
        this.db = db;
        this.ui = ui;
        this.settings = settings;

        this.eventStore = new REAEventStore(db);
        this.eventFactory = REAEventFactory;
        this.aggregator = new REAAggregator(this.eventStore);

        bot.command(['expense', 'spent', 'speso'], async (ctx) => { this.spent(ctx) });
        bot.command(['remove'], async (ctx) => { this.removeFromSplit(ctx) });
        bot.command(['add'], async (ctx) => { this.addToSplit(ctx) });
        bot.command(['ledger'], async (ctx) => { this.ledger(ctx) });
        bot.action(/split:(.+)/, async (ctx) => {
            const holonId = utils.getholonId(ctx) 
            const messageId = utils.getMessageId(ctx)
            const userID = utils.getUserId(ctx);
            const expenseID = ctx.match[1];
            const language = await this.settings.getLanguage(holonId)
            const result = await this.joinSplit(holonId, userID, expenseID);
            if (result) {
                ctx.telegram.editMessageText(holonId, messageId, null, await this.createMessage(holonId,result), Markup.inlineKeyboard([
                    [{ text: i18next.t('Select Participants', { lng: language }) || 'Select Participants', callback_data: `select_participants:${result.id}` }]
                ])).catch(err => console.log(err));
            } else {
                ctx.reply(i18next.t('expensejoinfail', { lng: language }));
            }
        });

        bot.action(/splitall:(.+)/, async (ctx) => {
            const holonId = utils.getholonId(ctx);
            const messageId = utils.getMessageId(ctx);
            const expenseID = ctx.match[1];
            const language = await this.settings.getLanguage(holonId)
            const result = await this.splitAll(holonId, expenseID);
            if (result) {
                let message = await this.createMessage(holonId,result);
                ctx.telegram.editMessageText(holonId, messageId, null, message, Markup.inlineKeyboard([
                    [{ text: i18next.t('Select Participants', { lng: language }) || 'Select Participants', callback_data: `select_participants:${result.id}` }]
                ])).catch(err => console.log(err));
            } else {
                ctx.reply(i18next.t('expensejoinfail', { lng: language }));
            }
        });

        // New action for showing participant selection interface
        bot.action(/select_participants:(.+)/, async (ctx) => {
            const holonId = utils.getholonId(ctx);
            const messageId = utils.getMessageId(ctx);
            const expenseID = ctx.match[1];
            await this.showParticipantSelection(ctx, holonId, messageId, expenseID);
        });

        // New action for toggling individual participants
        bot.action(/toggle_participant:(.+)_(.+)/, async (ctx) => {
            const holonId = utils.getholonId(ctx);
            const messageId = utils.getMessageId(ctx);
            const expenseID = ctx.match[1];
            const userID = parseInt(ctx.match[2]);
            await this.toggleParticipant(ctx, holonId, messageId, expenseID, userID);
        });

        // New action for going back to expense view from participant selection
        bot.action(/back_to_expense:(.+)/, async (ctx) => {
            const holonId = utils.getholonId(ctx);
            const messageId = utils.getMessageId(ctx);
            const expenseID = ctx.match[1];
            await this.showExpenseView(ctx, holonId, messageId, expenseID);
        });

        // New action for selecting all participants
        bot.action(/select_all_participants:(.+)/, async (ctx) => {
            const holonId = utils.getholonId(ctx);
            const messageId = utils.getMessageId(ctx);
            const expenseID = ctx.match[1];
            await this.selectAllParticipants(ctx, holonId, messageId, expenseID);
        });

        bot.command(['clear', 'balance', 'credit', 'bilancio'], async (ctx) => {
            const holonId = ctx.chat.id;
            const currency = ctx.message.text.split(' ').slice(1)[0];
            const language = await this.settings.getLanguage(holonId)
            
            console.log(`\n=== BALANCE COMMAND EXECUTED ===`);
            console.log(`Holon ID: ${holonId}`);
            console.log(`Currency: ${currency}`);
            console.log(`Language: ${language}`);
            
            if (currency == null || currency.length == 0) {
                console.log(`❌ No currency specified`);
                return ctx.reply(i18next.t('balanceusage', { lng: language }));
            }
            
            console.log(`✅ Currency specified: ${currency}`);
            
            const { creditMatrix, userNames } = await this.calculateCredits(holonId, currency);
            
            // Add detailed logging for the balance calculation
            console.log(`\n=== BALANCE CALCULATION RESULTS ===`);
            console.log(`Credit Matrix Size: ${creditMatrix.length} x ${creditMatrix[0]?.length || 0}`);
            console.log(`User Names:`, userNames);
            
            // FIX: Get users data for balance calculation
            const users = await this.db.getAll(holonId.toString(), 'users');
            
            // Log individual user balances
            console.log(`\n=== INDIVIDUAL USER BALANCES ===`);
            for (let i = 0; i < userNames.length; i++) {
                let netBalance = 0;
                for (let j = 0; j < creditMatrix[i].length; j++) {
                    if (i !== j) {
                        netBalance += creditMatrix[i][j];
                    }
                }
                const userId = users[i]?.id || 'unknown';
                console.log(`${userNames[i]} (ID: ${userId}): ${netBalance.toFixed(2)} ${currency}`);
            }
            
            // Log credit matrix details
            console.log(`\n=== DETAILED CREDIT MATRIX ===`);
            console.log(`Format: [Row User] owes [Column User] amount`);
            for (let i = 0; i < creditMatrix.length; i++) {
                for (let j = 0; j < creditMatrix[i].length; j++) {
                    if (i !== j && creditMatrix[i][j] !== 0) {
                        console.log(`${userNames[i]} owes ${userNames[j]}: ${creditMatrix[i][j].toFixed(2)} ${currency}`);
                    }
                }
            }
            
            this.ui.getCreditTable(creditMatrix, userNames, holonId).then((path) => {
                console.log(`✅ Credit table image generated: ${path}`);
                ctx.replyWithPhoto({ source: fs.createReadStream(path) }, {
                    caption: createPaddedCaption(''),
                    ...Markup.inlineKeyboard([
                        Markup.button.url(i18next.t('Open Dashboard', { lng: language }),
                          `${DASHBOARD_ADDRESS}/${holonId}/expenses`)
                      ])
                }).catch(err => console.log(err));
            });
        });

    }
    // show all transactions in the ledger
    async ledger(ctx) {
        const holonId = ctx.chat.id;
        const expenses = await this.db.getAll(holonId.toString(), 'expenses');
        const language = await this.settings.getLanguage(holonId)
        if (expenses.length === 0) {
            ctx.reply(i18next.t('ledgerempty', { lng: language }));
            return;
        }
        let message = ""//i18next.t('ledgerheader', { lng: language });
        for (const expense of expenses) {
            message += 'id: ' + expense.id + ' \n' + await this.createMessage(holonId,expense) + '\n\n';
        }
        //split message if too long
        if (message.length > 4096) {
            const messages = message.match(/[\s\S]{1,4096}/g) || [];
            messages.forEach(msg => ctx.reply(msg).catch(err => console.log(err)));
        } else {
            ctx.reply(message).catch(err => console.log(err));
        }

    }


    async spent(ctx) {
        const holonId = ctx.chat.id;
        const messageId = ctx.message.message_id;
        const args = ctx.message.text.split(' ').slice(1);
        const language = await this.settings.getLanguage(holonId)
        const command = ctx.message.text.split(' ')[0].replace('/', '');
        if (args.length < 3) {
            return ctx.reply(i18next.t('expenseusage', { command: command, lng: language }));
        }

        const amount = parseFloat(args[0]);
        let currencyInput = args[1]; // Renamed to currencyInput
        const description = args.slice(2).join(' ');

        // Validate currency against settings
        const currentSettings = await this.settings.getSettings(holonId);
        const allowedCurrencies = currentSettings.currencies || [];
        
        // Normalize input currency via shared @holons/core/expenses rule.
        const normalizedCurrency = normalizeCurrency(currencyInput);

        if (allowedCurrencies.length > 0 && !allowedCurrencies.includes(normalizedCurrency)) {
            return ctx.reply(i18next.t('expensecurrencyinvalid', {
                lng: language,
                currency: currencyInput,
                allowed_currencies: allowedCurrencies.join(', ')
            }) || `Invalid currency: ${currencyInput}. Allowed currencies are: ${allowedCurrencies.join(', ')}`);
        } else if (allowedCurrencies.length === 0 && normalizedCurrency.length === 0) {
            // If no currencies are set in settings, and input is empty after normalization (e.g. "123 !!!")
             return ctx.reply(i18next.t('expenseusage', { command: command, lng: language }));
        }


        const picture = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : null;
        const expense = await this.addExpense(messageId + 1, holonId, amount, normalizedCurrency, description, ctx.from.id, [holonId], picture);
        if (expense) {
            ctx.reply(await this.createMessage(holonId, expense), Markup.inlineKeyboard([
                [{ text: i18next.t('Select Participants', { lng: language }) || 'Select Participants', callback_data: `select_participants:${expense.id}` }]
            ]));
        } else {
            ctx.reply(i18next.t('expenseaddfail', {lng: language, error: 'Invalid amount or data.'}) || 'Failed to add expense. Ensure amount is valid.');
        }
    };

    async addExpense(messageId, holonId, amount, currency, description, paidBy, splitWith, picture = null) {
        // Validation, currency normalization and description cleanup live in core.
        const expense = createExpense({
            id: messageId,
            holonId,
            amount,
            currency,
            description,
            paidBy,
            splitWith,
            picture,
        });
        if (!expense) return false;

        // Store expense record (for display and backward compatibility)
        await this.db.put(holonId.toString(), 'expenses', expense);

        // Create REA events for accounting (expense:paid + expense:share for each participant)
        try {
            const events = this.eventFactory.expenseEvents(holonId, expense);
            await Promise.all(events.map(e => this.eventStore.put(holonId, e)));
            console.log(`Added expense ${expense.id} with ${events.length} REA events`);
        } catch (error) {
            console.error('Error creating REA events for expense:', error);
        }

        return expense;
    }

    // Toggle a user in/out of an expense's split. Pure logic in @holons/core/expenses.
    async joinSplit(holonId, userID, expenseID) {
        const expense = await this.db.get(holonId.toString(), 'expenses', expenseID);
        if (!expense) return false;

        const updated = toggleParticipantSplit(expense, userID, holonId);
        await this.db.put(holonId.toString(), 'expenses', updated);
        return updated;
    }

    async removeFromSplit(ctx) {
        const language = await this.settings.getLanguage(ctx.chat.id)

        if (!ctx.message.reply_to_message){
            ctx.reply('Please reply to the expense message you want to remove a user from');
            return;
        }

        if (!ctx.message.entities || !ctx.message.entities.length) {
            return ctx.reply(i18next.t('expenseremoveusage', { lng: language }));
        }

        let holonId = ctx.chat.id;
        let expenseID = ctx.message.reply_to_message.message_id; 

        // Get the mentioned user
        const entity = ctx.message.entities.find(e => e.type === 'text_mention' || e.type === 'mention');
        if (!entity) {
            return ctx.reply(i18next.t('usernotfound', { lng: language }));
        }

        try {
            let userId;
            if (entity.type === 'text_mention' && entity.user) {
                // User mentioned by first/last name - we have their ID directly
                userId = entity.user.id;
            } else if (entity.type === 'mention') {
                // For username mentions, we need to get the user from our database
                const username = ctx.message.text.slice(entity.offset + 1, entity.offset + entity.length);
                const users = await this.db.getAll(holonId.toString(), 'users');
                const user = users.find(u => u.username?.toLowerCase() === username.toLowerCase());
                if (!user) {
                    return ctx.reply(i18next.t('usernotfound', { lng: language }));
                }
                userId = user.id;
            }

            const chatMember = await ctx.telegram.getChatMember(holonId, userId);
            if (!chatMember || !chatMember.user) {
                return ctx.reply(i18next.t('usernotfound', { lng: language }));
            }

            const expense = await this.db.get(holonId.toString(), 'expenses', expenseID);
            if (expense) {
                const updated = removeParticipantSplit(expense, chatMember.user.id);
                await this.db.put(holonId.toString(), 'expenses', updated);
                ctx.telegram.editMessageText(holonId, expenseID, null, await this.createMessage(holonId, updated), Markup.inlineKeyboard(
                    [{ text: i18next.t('Split', { lng: language }), callback_data: `split:${updated.id}` }, { text: i18next.t('Split All', { lng: language }), callback_data: `splitall:${updated.id}` }]
                )).catch(err => console.log(err));
                return updated;
            }
        } catch (error) {
            console.error('Error getting chat member:', error);
            return ctx.reply(i18next.t('usernotfound', { lng: language }));
        }
        return false;
    }

    async addToSplit(ctx) {
        const language = await this.settings.getLanguage(ctx.chat.id)
        if (!ctx.message.reply_to_message){
            ctx.reply('Please reply to the expense message you want to add a user to');
            return;
        }

        let holonId = ctx.chat.id;
        let expenseID = ctx.message.reply_to_message.message_id;

        // Get the mentioned user
        const entity = ctx.message.entities.find(e => e.type === 'text_mention' || e.type === 'mention');
        if (!entity) {
            return ctx.reply(i18next.t('expenseaddusage', { lng: language }));
        }

        try {
            let userId;
            if (entity.type === 'text_mention' && entity.user) {
                // User mentioned by first/last name - we have their ID directly
                userId = entity.user.id;
            } else if (entity.type === 'mention') {
                // For username mentions, we need to get the user from our database
                const username = ctx.message.text.slice(entity.offset + 1, entity.offset + entity.length);
                const users = await this.db.getAll(holonId.toString(), 'users');
                const user = users.find(u => u.username?.toLowerCase() === username.toLowerCase());
                if (!user) {
                    return ctx.reply(i18next.t('usernotfound', { lng: language }));
                }
                userId = user.id;
            }

            const chatMember = await ctx.telegram.getChatMember(holonId, userId);
            if (!chatMember || !chatMember.user) {
                return ctx.reply(i18next.t('usernotfound', { lng: language }));
            }

            const expense = await this.db.get(holonId.toString(), 'expenses', expenseID);
            if (expense) {
                const updated = addParticipantSplit(expense, chatMember.user.id);
                await this.db.put(holonId.toString(), 'expenses', updated);
                ctx.telegram.editMessageText(holonId, expenseID, null, await this.createMessage(holonId, updated), Markup.inlineKeyboard(
                    [{ text: i18next.t('Split', { lng: language }), callback_data: `split:${updated.id}` }, { text: i18next.t('Split All', { lng: language }), callback_data: `splitall:${updated.id}` }]
                )).catch(err => console.log(err));
                return updated;
            }
        } catch (error) {
            console.error('Error getting chat member:', error);
            return ctx.reply(i18next.t('usernotfound', { lng: language }));
        }
        return false;
    }

    async splitAll(holonId, expenseID) {
        const expense = await this.db.get(holonId.toString(), 'expenses', expenseID);
        if (!expense) return false;
        const users = (await this.db.getAll(holonId.toString(), 'users')) || [];
        const updated = splitAmongAll(expense, users.map(u => u.id));
        await this.db.put(holonId.toString(), 'expenses', updated);
        return updated;
    }

    async calculateCredits(holonId, currency) {
        if (!currency || typeof currency !== 'string' || currency.length === 0) {
            console.error('Invalid currency provided to calculateCredits:', currency);
            return { creditMatrix: [], userNames: [] };
        }

        const expenses = (await this.db.getAll(holonId.toString(), 'expenses')) || [];
        const users = (await this.db.getAll(holonId.toString(), 'users')) || [];
        if (users.length === 0) {
            console.log('No users found for credit calculation in chat:', holonId);
            return { creditMatrix: [], userNames: [] };
        }

        const currentSettings = await this.settings.getSettings(holonId);
        const allowedCurrencies = currentSettings.currencies || [];

        // Pure computation — see @holons/core/expenses for the rules.
        const { creditMatrix, userIds } = computeBalances(expenses, users, currency, allowedCurrencies);
        const userNames = await Promise.all(userIds.map(id => this.getDisplayName(holonId, id)));

        return { creditMatrix, userNames };
    }

    async createMessage(holonId,expense) {
        const amount = expense.amount;
        const currency = expense.currency;
        const description = expense.description;
        
        // Get payer's info
        const paidBy = await this.getDisplayName(holonId, expense.paidBy);

        // Get all splitters' info and map to display names
        const splitNames = await Promise.all(expense.splitWith.map(userId => this.getDisplayName(holonId, userId)));
        
        const splitWith = splitNames.join(", ");

        return i18next.t('expensemessage', { amount, currency, description, paidBy, splitWith });
    }

    async getDisplayName(holonId, userId) {
        if (userId == 6152474485) {
            return "Holons";
        }

        if (userId == holonId) {
            const groupInfo = await this.settings.getSettings(holonId).name;
            return groupInfo || "This Holon"; //TODO maybe get the group name from the settings

        }
        const userInfo = await this.db.get(holonId.toString(), 'users', userId);
        if (!userInfo) {
            return userId.toString();
        }
        return utils.getDisplayName(userInfo);
    }

    async getUserCurrencyBalance(holonId, userID, currencyName) {
        const expenses = (await this.db.getAll(holonId.toString(), 'expenses')) || [];
        return computeUserCurrencyBalance(expenses, userID, currencyName);
    }

    // Show participant selection interface with checklist-style user selection
    async showParticipantSelection(ctx, holonId, messageId, expenseID) {
        try {
            await ctx.answerCbQuery().catch(() => {});
            
            const expense = await this.db.get(holonId.toString(), 'expenses', expenseID);
            if (!expense) {
                await ctx.answerCbQuery('Expense not found');
                return;
            }

            const users = await this.db.getAll(holonId.toString(), 'users');
            const language = await this.settings.getLanguage(holonId);
            
            // Create buttons for each user
            const userButtons = [];

            // Add individual user buttons
            for (const user of users) {
                const isSelected = expense.splitWith.includes(user.id);
                const status = isSelected ? '✅' : '⬜️';
                const displayName = utils.getDisplayName(user);
                
                userButtons.push([{
                    text: `${status} ${displayName}`,
                    callback_data: `toggle_participant:${expenseID}_${user.id}`
                }]);
            }

            // Add control buttons
            userButtons.push([
                {
                    text: i18next.t('Select All', { lng: language }) || '☑️ Select All',
                    callback_data: `select_all_participants:${expenseID}`
                },
                {
                    text: i18next.t('Back', { lng: language }) || '🔙 Back',
                    callback_data: `back_to_expense:${expenseID}`
                }
            ]);

            const keyboard = Markup.inlineKeyboard(userButtons);
            const message = i18next.t('Select participants for split:', { lng: language }) || 'Select participants for split:';

            await ctx.telegram.editMessageText(holonId, messageId, null, message, keyboard);

        } catch (error) {
            console.error('Error showing participant selection:', error);
            await ctx.answerCbQuery('Error showing participant selection');
        }
    }

    // Toggle individual participant in expense split (Telegraf wrapper around core).
    async toggleParticipant(ctx, holonId, messageId, expenseID, userID) {
        try {
            await ctx.answerCbQuery().catch(() => {});

            const expense = await this.db.get(holonId.toString(), 'expenses', expenseID);
            if (!expense) {
                await ctx.answerCbQuery('Expense not found');
                return;
            }

            const updated = toggleParticipantSplit(expense, userID, holonId);
            await this.db.put(holonId.toString(), 'expenses', updated);

            // Refresh the participant selection view
            await this.showParticipantSelection(ctx, holonId, messageId, expenseID);
        } catch (error) {
            console.error('Error toggling participant:', error);
            await ctx.answerCbQuery('Error updating participant');
        }
    }

    // Show expense view with updated participant list
    async showExpenseView(ctx, holonId, messageId, expenseID) {
        try {
            await ctx.answerCbQuery().catch(() => {});
            
            const expense = await this.db.get(holonId.toString(), 'expenses', expenseID);
            if (!expense) {
                await ctx.answerCbQuery('Expense not found');
                return;
            }

            const language = await this.settings.getLanguage(holonId);
            const message = await this.createMessage(holonId, expense);
            
            const keyboard = Markup.inlineKeyboard([
                [{ text: i18next.t('Select Participants', { lng: language }) || 'Select Participants', callback_data: `select_participants:${expense.id}` }]
            ]);

            await ctx.telegram.editMessageText(holonId, messageId, null, message, keyboard);

        } catch (error) {
            console.error('Error showing expense view:', error);
            await ctx.answerCbQuery('Error showing expense');
        }
    }

    // Select all participants for expense split (Telegraf wrapper around core).
    async selectAllParticipants(ctx, holonId, messageId, expenseID) {
        try {
            await ctx.answerCbQuery().catch(() => {});

            const expense = await this.db.get(holonId.toString(), 'expenses', expenseID);
            if (!expense) {
                await ctx.answerCbQuery('Expense not found');
                return;
            }

            const users = (await this.db.getAll(holonId.toString(), 'users')) || [];
            const updated = splitAmongAll(expense, users.map(u => u.id));
            await this.db.put(holonId.toString(), 'expenses', updated);

            await this.showParticipantSelection(ctx, holonId, messageId, expenseID);
        } catch (error) {
            console.error('Error selecting all participants:', error);
            await ctx.answerCbQuery('Error selecting all participants');
        }
    }

}



