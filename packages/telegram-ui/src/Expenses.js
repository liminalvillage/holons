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
        
        // Normalize input currency (lowercase, singular - assuming singular is stored)
        const normalizedCurrency = currencyInput.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, ''); 

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
        //do health check on currency: remove uppercase, check if it's a valid currency, remove plural
        if (isNaN(amount) || amount <= 0 ) { // Currency validation moved to 'spent'
            return false;
        }

        // amount = parseFloat(amount); // Already float from 'spent'

        // currency is already normalized (lowercase, singular, no special chars) by the caller (`spent` method)
        // description = description.replace(/^for /, ''); //EN (already done in `spent` if needed, but usually fine here)
        description = description.replace(/^for /i, ''); // Case-insensitive
        description = description.replace(/^per /i, '');
        description = description.replace(/^voor /i, '');
        description = description.replace(/^für /i, '');
        description = description.replace(/^por /i, '');
        description = description.replace(/^pour /i, '');


        const expense = {
            id: messageId,
            date: Date.now(),
            amount,
            currency,
            description,
            paidBy,
            splitWith,
            picture: picture || null
        };

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

    // add user to split TODO: BOT ID IS HARDCODED, switch to either holonId or variable bot id
    async joinSplit(holonId, userID, expenseID) {
        let expense = await this.db.get(holonId.toString(), 'expenses', expenseID)

        if (expense) {
            if (!expense.splitWith.includes(userID)) { //add user to split
                expense.splitWith.push(userID);
                // Remove holonId ("This Holon") if it exists in the array
                expense.splitWith = expense.splitWith.filter(id => id !== holonId);
            }
            else {//remove user from split
                expense.splitWith = expense.splitWith.filter(function (value, index, arr) { return value != userID; });
                if (expense.splitWith.length == 0) {
                    expense.splitWith.push(holonId);
                }
            }

            await this.db.put(holonId.toString(), 'expenses', expense)
            return expense;
        }
        return false;
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

            let expense = await this.db.get(holonId.toString(), 'expenses', expenseID)
            if (expense) {
                expense.splitWith = expense.splitWith.filter(value => value != chatMember.user.id);
                await this.db.put(holonId.toString(), 'expenses', expense)
                ctx.telegram.editMessageText(holonId, expenseID, null, await this.createMessage(holonId,expense), Markup.inlineKeyboard(
                    [{ text: i18next.t('Split', { lng: language }), callback_data: `split:${expense.id}` }, { text: i18next.t('Split All', { lng: language }), callback_data: `splitall:${expense.id}` }]
                )).catch(err => console.log(err))
                return expense;
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

            let expense = await this.db.get(holonId.toString(), 'expenses', expenseID)
            if (expense) {
                if (!expense.splitWith)
                    expense.splitWith = [];
                if (!expense.splitWith.includes(chatMember.user.id))
                    expense.splitWith.push(chatMember.user.id);
                await this.db.put(holonId.toString(), 'expenses', expense)
                ctx.telegram.editMessageText(holonId, expenseID, null, await this.createMessage(holonId, expense), Markup.inlineKeyboard(
                    [{ text: i18next.t('Split', { lng: language }), callback_data: `split:${expense.id}` }, { text: i18next.t('Split All', { lng: language }), callback_data: `splitall:${expense.id}` }]
                )).catch(err => console.log(err));
                return expense;
            }
        } catch (error) {
            console.error('Error getting chat member:', error);
            return ctx.reply(i18next.t('usernotfound', { lng: language }));
        }
        return false;
    }

    async splitAll(holonId, expenseID) {
        let expense = await this.db.get(holonId.toString(), 'expenses', expenseID)
        if (expense) {
            let users = await this.db.getAll(holonId.toString(), 'users')
            let userArray = users.map(user => user.id)
            expense.splitWith = userArray;
            await this.db.put(holonId.toString(), 'expenses', expense)
            return expense;
        }
        return false;
    }

    async calculateCredits(holonId, currency) {
        console.log(`\n=== CALCULATING CREDITS ===`);
        console.log(`Holon ID: ${holonId}`);
        console.log(`Currency: ${currency}`);
        
        // Validate and normalize currency input
        if (!currency || typeof currency !== 'string' || currency.length === 0) {
            console.error('❌ Invalid currency provided to calculateCredits:', currency);
            return { creditMatrix: [], userNames: [] };
        }
        
        const requestedCurrencyNormalized = currency.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '');
        console.log(`✅ Normalized currency: ${requestedCurrencyNormalized}`);

        // Fetch data from the database
        let expenses = await this.db.getAll(holonId.toString(), 'expenses');
        let users = await this.db.getAll(holonId.toString(), 'users');
        const currentSettings = await this.settings.getSettings(holonId); 
        const allowedCurrenciesSetting = currentSettings.currencies || [];

        console.log(`📊 Data Summary:`);
        console.log(`  - Total expenses: ${expenses?.length || 0}`);
        console.log(`  - Total users: ${users?.length || 0}`);
        console.log(`  - Allowed currencies: [${allowedCurrenciesSetting.join(', ')}]`);

        // Early exit if no users are found
        if (!users || users.length === 0) {
            console.log('❌ No users found for credit calculation in chat:', holonId);
            return { creditMatrix: [], userNames: [] }; // Return empty structure
        }

        let userArray = users.map(user => user.id);
        let creditMatrix = Array(userArray.length).fill(0).map(() => Array(userArray.length).fill(0));

        console.log(`\n=== PROCESSING EXPENSES ===`);
        let processedExpenses = 0;
        let skippedExpenses = 0;

        // Process each expense to calculate credits
        expenses.forEach(expense => {
            // Ensure the expense currency matches the requested currency (case-insensitive)
            const expenseCurrencyNormalized = expense.currency ? expense.currency.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '') : '';
            
            console.log(`\nExpense ID: ${expense.id}`);
            console.log(`  Amount: ${expense.amount} ${expense.currency}`);
            console.log(`  Description: ${expense.description}`);
            console.log(`  Paid by: ${expense.paidBy}`);
            
            // FIX: Add proper type checking for splitWith
            let splitWithDisplay = 'none';
            if (expense.splitWith) {
                if (Array.isArray(expense.splitWith)) {
                    splitWithDisplay = expense.splitWith.join(', ');
                } else if (typeof expense.splitWith === 'string') {
                    splitWithDisplay = expense.splitWith;
                } else if (typeof expense.splitWith === 'number') {
                    splitWithDisplay = expense.splitWith.toString();
                } else {
                    splitWithDisplay = JSON.stringify(expense.splitWith);
                }
            }
            console.log(`  Split with: [${splitWithDisplay}]`);
            console.log(`  Currency match: ${expenseCurrencyNormalized} === ${requestedCurrencyNormalized} ? ${expenseCurrencyNormalized === requestedCurrencyNormalized}`);
            
            if (expenseCurrencyNormalized === requestedCurrencyNormalized) {
                // If allowed currencies are defined in settings, ensure this expense's currency is one of them
                if (allowedCurrenciesSetting.length > 0 && !allowedCurrenciesSetting.includes(expenseCurrencyNormalized)) {
                    console.warn(`⚠️ Skipping expense ${expense.id} for credit calculation; its currency '${expense.currency}' (normalized: '${expenseCurrencyNormalized}') is not in the allowed list: [${allowedCurrenciesSetting.join(', ')}]`);
                    skippedExpenses++;
                    return; 
                }

                // FIX: Ensure splitWith is an array, default to empty if not
                let splitWithArray = [];
                if (expense.splitWith) {
                    if (Array.isArray(expense.splitWith)) {
                        splitWithArray = expense.splitWith;
                    } else if (typeof expense.splitWith === 'string') {
                        // Try to parse as JSON or treat as single value
                        try {
                            const parsed = JSON.parse(expense.splitWith);
                            splitWithArray = Array.isArray(parsed) ? parsed : [parsed];
                        } catch {
                            splitWithArray = [expense.splitWith];
                        }
                    } else if (typeof expense.splitWith === 'number') {
                        splitWithArray = [expense.splitWith];
                    } else {
                        console.warn(`⚠️ Unknown splitWith type for expense ${expense.id}:`, typeof expense.splitWith, expense.splitWith);
                        splitWithArray = [];
                    }
                }
                
                const numberOfSplitters = splitWithArray.length > 0 ? splitWithArray.length : 1;
                const amountPerPerson = expense.amount / numberOfSplitters;

                console.log(`  ✅ Processing expense:`);
                console.log(`    Number of splitters: ${numberOfSplitters}`);
                console.log(`    Amount per person: ${amountPerPerson.toFixed(2)}`);
                console.log(`    SplitWith array: [${splitWithArray.join(', ')}]`);

                const payerIndex = userArray.indexOf(expense.paidBy);

                // Ensure payer is found in the user list
                if (payerIndex === -1) {
                    console.warn(`⚠️ Payer ID ${expense.paidBy} not found in user list for expense ${expense.id}`);
                    skippedExpenses++;
                    return; // Skip this expense if payer not found
                }

                console.log(`    Payer index: ${payerIndex}`);

                splitWithArray.forEach(memberId => {
                    const memberIndex = userArray.indexOf(memberId);

                    // Ensure member is found in the user list
                    if (memberIndex === -1) {
                        console.warn(`⚠️ Member ID ${memberId} not found in user list for expense ${expense.id}`);
                        return; // Skip this member if not found
                    }

                    console.log(`    Processing member ${memberId} (index: ${memberIndex})`);

                    // Update the credit matrix, avoiding self-credit updates
                    if (payerIndex !== memberIndex) {
                        // Ensure the matrix indices are valid before assignment
                        if (creditMatrix[payerIndex] && creditMatrix[memberIndex]) {
                           creditMatrix[payerIndex][memberIndex] += amountPerPerson;
                           creditMatrix[memberIndex][payerIndex] -= amountPerPerson;
                           console.log(`      ✅ Updated matrix: [${payerIndex}][${memberIndex}] += ${amountPerPerson.toFixed(2)}`);
                           console.log(`      ✅ Updated matrix: [${memberIndex}][${payerIndex}] -= ${amountPerPerson.toFixed(2)}`);
                        } else {
                           console.error(`❌ Invalid indices for credit matrix update: payerIndex=${payerIndex}, memberIndex=${memberIndex}`);
                        }
                    } else {
                        console.log(`      ⏭️ Skipping self-credit update for payer ${expense.paidBy}`);
                    }
                });
                
                processedExpenses++;
            } else {
                console.log(`  ⏭️ Skipping - currency mismatch`);
                skippedExpenses++;
            }
        });

        console.log(`\n=== PROCESSING SUMMARY ===`);
        console.log(`✅ Processed expenses: ${processedExpenses}`);
        console.log(`⏭️ Skipped expenses: ${skippedExpenses}`);

        // Get display names for the users involved
        let userNames = await Promise.all(userArray.map(userId => this.getDisplayName(holonId, userId)));
        
        console.log(`\n=== FINAL USER LIST ===`);
        userNames.forEach((name, index) => {
            console.log(`  ${index}: ${name} (ID: ${userArray[index]})`);
        });

        // ADD: Detailed credit matrix analysis
        console.log(`\n=== CREDIT MATRIX ANALYSIS ===`);
        console.log(`Matrix format: [Row User] owes [Column User] amount`);
        for (let i = 0; i < creditMatrix.length; i++) {
            for (let j = 0; j < creditMatrix[i].length; j++) {
                if (i !== j && creditMatrix[i][j] !== 0) {
                    console.log(`  ${userNames[i]} owes ${userNames[j]}: ${creditMatrix[i][j].toFixed(2)}`);
                }
            }
        }

        // ADD: Net balance calculation for each user
        console.log(`\n=== NET BALANCES ===`);
        for (let i = 0; i < creditMatrix.length; i++) {
            let netBalance = 0;
            for (let j = 0; j < creditMatrix[i].length; j++) {
                if (i !== j) {
                    netBalance += creditMatrix[i][j]; // Positive = owes money, Negative = is owed money
                }
            }
            console.log(`  ${userNames[i]}: ${netBalance.toFixed(2)} (${netBalance > 0 ? 'owes' : netBalance < 0 ? 'is owed' : 'balanced'})`);
        }

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
        console.log(`\n=== GETTING CURRENCY BALANCE ===`);
        console.log(`Holon ID: ${holonId}, User ID: ${userID}, Currency: ${currencyName}`);
        
        const expenses = await this.db.getAll(holonId.toString(), 'expenses');
        let netBalance = 0;
        const normalizedTargetCurrency = currencyName.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '');

        console.log(`Total expenses found: ${expenses?.length || 0}`);
        console.log(`Normalized target currency: ${normalizedTargetCurrency}`);

        if (!expenses || expenses.length === 0) {
            console.log(`❌ No expenses found`);
            return 0;
        }

        for (const expense of expenses) {
            const expenseCurrencyNormalized = expense.currency ? expense.currency.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '') : '';
            
            // FIX: Handle splitWith properly for display
            let splitWithDisplay = 'none';
            if (expense.splitWith) {
                if (Array.isArray(expense.splitWith)) {
                    splitWithDisplay = expense.splitWith.join(', ');
                } else if (typeof expense.splitWith === 'string') {
                    splitWithDisplay = expense.splitWith;
                } else if (typeof expense.splitWith === 'number') {
                    splitWithDisplay = expense.splitWith.toString();
                } else {
                    splitWithDisplay = JSON.stringify(expense.splitWith);
                }
            }
            
            console.log(`\nExpense ID: ${expense.id}`);
            console.log(`  Amount: ${expense.amount} ${expense.currency}`);
            console.log(`  Paid by: ${expense.paidBy}`);
            console.log(`  Split with: [${splitWithDisplay}]`);
            console.log(`  Currency match: ${expenseCurrencyNormalized} === ${normalizedTargetCurrency} ? ${expenseCurrencyNormalized === normalizedTargetCurrency}`);

            if (expenseCurrencyNormalized === normalizedTargetCurrency) {
                // FIX: Handle splitWith properly for calculation
                let splitWithArray = [];
                if (expense.splitWith) {
                    if (Array.isArray(expense.splitWith)) {
                        splitWithArray = expense.splitWith;
                    } else if (typeof expense.splitWith === 'string') {
                        // Try to parse as JSON or treat as single value
                        try {
                            const parsed = JSON.parse(expense.splitWith);
                            splitWithArray = Array.isArray(parsed) ? parsed : [parsed];
                        } catch {
                            splitWithArray = [expense.splitWith];
                        }
                    } else if (typeof expense.splitWith === 'number') {
                        splitWithArray = [expense.splitWith];
                    } else {
                        console.warn(`⚠️ Unknown splitWith type for expense ${expense.id}:`, typeof expense.splitWith, expense.splitWith);
                        splitWithArray = [];
                    }
                }
                
                const numSplitters = splitWithArray.length > 0 ? splitWithArray.length : 1;
                const share = expense.amount / numSplitters;
                // FIX: Handle data type mismatch for includes check
                let userInSplit = splitWithArray.some(id => id == userID); // Use == for type coercion

                console.log(`  ✅ Processing expense:`);
                console.log(`    Number of splitters: ${numSplitters}`);
                console.log(`    Share per person: ${share.toFixed(2)}`);
                console.log(`    User in split: ${userInSplit}`);
                console.log(`    User is payer: ${expense.paidBy === userID}`);
                console.log(`    Data types - expense.paidBy: ${typeof expense.paidBy} (${expense.paidBy}), userID: ${typeof userID} (${userID})`);

                // FIX: Handle data type mismatch for comparison
                const isPayer = expense.paidBy == userID; // Use == instead of === for type coercion
                
                if (isPayer) {
                    netBalance += expense.amount; // User paid the full amount
                    console.log(`    +${expense.amount} (paid full amount)`);
                    if (userInSplit) {
                        netBalance -= share; // Subtract their own share
                        console.log(`    -${share.toFixed(2)} (own share)`);
                    }
                } else if (userInSplit) {
                    netBalance -= share; // User is in split but didn't pay, so they owe their share
                    console.log(`    -${share.toFixed(2)} (owe share)`);
                }
                
                console.log(`    Current net balance: ${netBalance.toFixed(2)}`);
            } else {
                console.log(`  ⏭️ Skipping - currency mismatch`);
            }
        }
        
        console.log(`\nFinal net balance for user ${userID}: ${netBalance.toFixed(2)}`);
        return netBalance;
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

    // Toggle individual participant in expense split
    async toggleParticipant(ctx, holonId, messageId, expenseID, userID) {
        try {
            await ctx.answerCbQuery().catch(() => {});
            
            let expense = await this.db.get(holonId.toString(), 'expenses', expenseID);
            if (!expense) {
                await ctx.answerCbQuery('Expense not found');
                return;
            }

            // Toggle participant
            if (expense.splitWith.includes(userID)) {
                // Remove user from split
                expense.splitWith = expense.splitWith.filter(id => id !== userID);
                // Add holonId ("This Holon") if split becomes empty
                if (expense.splitWith.length === 0) {
                    expense.splitWith.push(holonId);
                }
            } else {
                // Add user to split
                expense.splitWith.push(userID);
                // Remove holonId ("This Holon") if it exists in the array
                expense.splitWith = expense.splitWith.filter(id => id !== holonId);
            }

            await this.db.put(holonId.toString(), 'expenses', expense);
            
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

    // Select all participants for expense split
    async selectAllParticipants(ctx, holonId, messageId, expenseID) {
        try {
            await ctx.answerCbQuery().catch(() => {});
            
            let expense = await this.db.get(holonId.toString(), 'expenses', expenseID);
            if (!expense) {
                await ctx.answerCbQuery('Expense not found');
                return;
            }

            const users = await this.db.getAll(holonId.toString(), 'users');

            // Add all users to the split (excluding holon ID to avoid duplication)
            expense.splitWith = users.map(user => user.id);

            await this.db.put(holonId.toString(), 'expenses', expense);
            
            // Refresh the participant selection view to show all users selected
            await this.showParticipantSelection(ctx, holonId, messageId, expenseID);

        } catch (error) {
            console.error('Error selecting all participants:', error);
            await ctx.answerCbQuery('Error selecting all participants');
        }
    }

}



