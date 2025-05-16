// Description: This file contains the Expenses class, which handles all the expenses related commands and actions.
import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import i18next from 'i18next';
import * as utils from './utilities.js';


export default class Expenses {
    constructor(bot, db, ui, settings) {
        this.bot = bot;
        this.db = db;
        this.ui = ui;
        this.settings = settings;

        bot.command(['expense', 'spent', 'speso'], async (ctx) => { this.spent(ctx) });
        bot.command(['remove'], async (ctx) => { this.removeFromSplit(ctx) });
        bot.command(['add'], async (ctx) => { this.addToSplit(ctx) });
        bot.command(['ledger'], async (ctx) => { this.ledger(ctx) });
        bot.action(/split:(.+)/, async (ctx) => {
            const chatID = utils.getChatId(ctx) 
            const messageID = utils.getMessageId(ctx)
            const userID = utils.getUserId(ctx);
            const expenseID = ctx.match[1];
            const language = await this.settings.getLanguage(chatID)
            const result = await this.joinSplit(chatID, userID, expenseID);
            if (result) {
                ctx.telegram.editMessageText(chatID, messageID, null, await this.createMessage(chatID,result), Markup.inlineKeyboard([{ text: i18next.t('Split', { lng: language }), callback_data: `split:${result.id}` }, { text: 'Split All', callback_data: `splitall:${result.id}` }])).catch(err => console.log(err));
            } else {
                ctx.reply(i18next.t('expensejoinfail', { lng: language }));
            }
        });

        bot.action(/splitall:(.+)/, async (ctx) => {
            const chatID = utils.getChatId(ctx);
            const messageID = utils.getMessageId(ctx);
            const expenseID = ctx.match[1];
            const language = await this.settings.getLanguage(chatID)
            const result = await this.splitAll(chatID, expenseID);
            if (result) {
                let message = await this.createMessage(chatID,result);
                ctx.telegram.editMessageText(chatID, messageID, null, message, Markup.inlineKeyboard([
                    { text: i18next.t('Split', { lng: language }), callback_data: `split:${result.id}` }, 
                    { text: i18next.t('Split All', { lng: language }), callback_data: `splitall:${result.id}` }
                ])).catch(err => console.log(err));
            } else {
                ctx.reply(i18next.t('expensejoinfail', { lng: language }));
            }
        });

        bot.command(['clear', 'balance', 'credit', 'bilancio'], async (ctx) => {
            const chatID = ctx.chat.id;
            const currency = ctx.message.text.split(' ').slice(1)[0];
            const language = await this.settings.getLanguage(chatID)
            if (currency == null || currency.length == 0)
                return ctx.reply(i18next.t('balanceusage', { lng: language }));
            const { creditMatrix, userNames } = await this.calculateCredits(chatID, currency);
            this.ui.getCreditTable(creditMatrix, userNames, chatID).then((path) => {
                ctx.replyWithPhoto({ source: fs.createReadStream(path) },Markup.inlineKeyboard([
                    Markup.button.url(i18next.t('Open Dashboard', { lng: language }), 
                      `https://dashboard.holons.io/${chatID}/expenses`)
                  ])).catch(err => console.log(err));
            });
        });

    }
    // show all transactions in the ledger
    async ledger(ctx) {
        const chatID = ctx.chat.id;
        const expenses = await this.db.getAll(chatID + '/expenses');
        const language = await this.settings.getLanguage(chatID)
        if (expenses.length === 0) {
            ctx.reply(i18next.t('ledgerempty', { lng: language }));
            return;
        }
        let message = ""//i18next.t('ledgerheader', { lng: language });
        for (const expense of expenses) {
            message += 'id: ' + expense.id + ' \n' + await this.createMessage(chatID,expense) + '\n\n';
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
        const chatID = ctx.chat.id;
        const messageID = ctx.message.message_id;
        const args = ctx.message.text.split(' ').slice(1);
        const language = await this.settings.getLanguage(chatID)
        const command = ctx.message.text.split(' ')[0].replace('/', '');
        if (args.length < 3) {
            return ctx.reply(i18next.t('expenseusage', { command: command, lng: language }));
        }

        const amount = parseFloat(args[0]);
        let currencyInput = args[1]; // Renamed to currencyInput
        const description = args.slice(2).join(' ');

        // Validate currency against settings
        const currentSettings = await this.settings.getSettings(chatID);
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


        const expense = await this.addExpense(messageID + 1, chatID, amount, normalizedCurrency, description, ctx.from.id, [6152474485]);
        if (expense) {
            ctx.reply(await this.createMessage(chatID, expense), Markup.inlineKeyboard(
                [{ text: i18next.t('Split', { lng: language }), callback_data: `split:${expense.id}` }, { text: i18next.t('Split All', { lng: language }), callback_data: `splitall:${expense.id}` }]
            ));
        } else {
            ctx.reply(i18next.t('expenseaddfail', {lng: language, error: 'Invalid amount or data.'}) || 'Failed to add expense. Ensure amount is valid.');
        }
    };

    async addExpense(messageID, chatID, amount, currency, description, paidBy, splitWith) {
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
            id: messageID,
            date: Date.now(),
            amount,
            currency,
            description,
            paidBy,
            splitWith    
        };
        await this.db.put(chatID + '/expenses', expense)
        console.log('added expense', expense.id)
        return expense;
    }

    // add user to split TODO: BOT ID IS HARDCODED, switch to either chatID or variable bot id 
    async joinSplit(chatID, userID, expenseID) {
        let expense = await this.db.get(chatID + '/expenses', expenseID)

        if (expense) {
            if (!expense.splitWith.includes(userID)) { //add user to split
                expense.splitWith.push(userID);
                // Remove holonsID if it exists in the array 
                expense.splitWith = expense.splitWith.filter(id => id !== 6152474485);
            }
            else {//remove user from split
                expense.splitWith = expense.splitWith.filter(function (value, index, arr) { return value != userID; });
                if (expense.splitWith.length == 0) {
                    expense.splitWith.push(6152474485);
                }
            }
        
            await this.db.put(chatID + '/expenses', expense)
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

        let chatID = ctx.chat.id;
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
                const users = await this.db.getAll(chatID + '/users');
                const user = users.find(u => u.username?.toLowerCase() === username.toLowerCase());
                if (!user) {
                    return ctx.reply(i18next.t('usernotfound', { lng: language }));
                }
                userId = user.id;
            }

            const chatMember = await ctx.telegram.getChatMember(chatID, userId);
            if (!chatMember || !chatMember.user) {
                return ctx.reply(i18next.t('usernotfound', { lng: language }));
            }

            let expense = await this.db.get(chatID + '/expenses', expenseID)
            if (expense) {
                expense.splitWith = expense.splitWith.filter(value => value != chatMember.user.id);
                await this.db.put(chatID + '/expenses', expense)
                ctx.telegram.editMessageText(chatID, expenseID, null, await this.createMessage(chatID,expense), Markup.inlineKeyboard(
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

        let chatID = ctx.chat.id;
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
                const users = await this.db.getAll(chatID + '/users');
                const user = users.find(u => u.username?.toLowerCase() === username.toLowerCase());
                if (!user) {
                    return ctx.reply(i18next.t('usernotfound', { lng: language }));
                }
                userId = user.id;
            }

            const chatMember = await ctx.telegram.getChatMember(chatID, userId);
            if (!chatMember || !chatMember.user) {
                return ctx.reply(i18next.t('usernotfound', { lng: language }));
            }

            let expense = await this.db.get(chatID + '/expenses', expenseID)
            if (expense) {
                if (!expense.splitWith)
                    expense.splitWith = [];
                if (!expense.splitWith.includes(chatMember.user.id))
                    expense.splitWith.push(chatMember.user.id);
                await this.db.put(chatID + '/expenses', expense)
                ctx.telegram.editMessageText(chatID, expenseID, null, await this.createMessage(chatID, expense), Markup.inlineKeyboard(
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

    async splitAll(chatID, expenseID) {
        let expense = await this.db.get(chatID + '/expenses', expenseID)
        if (expense) {
            let users = await this.db.getAll(chatID + '/users')
            let userArray = users.map(user => user.id)
            expense.splitWith = userArray;
            await this.db.put(chatID + '/expenses', expense)
            return expense;
        }
        return false;
    }

    async calculateCredits(chatID, currency) {
        // Validate and normalize currency input
        if (!currency || typeof currency !== 'string' || currency.length === 0) {
            console.error('Invalid currency provided to calculateCredits:', currency);
            return { creditMatrix: [], userNames: [] };
        }
        
        const requestedCurrencyNormalized = currency.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '');

        // Fetch data from the database
        let expenses = await this.db.getAll(chatID + '/expenses');
        let users = await this.db.getAll(chatID + '/users');
        const currentSettings = await this.settings.getSettings(chatID); 
        const allowedCurrenciesSetting = currentSettings.currencies || [];

        // Early exit if no users are found
        if (!users || users.length === 0) {
            console.log('No users found for credit calculation in chat:', chatID);
            return { creditMatrix: [], userNames: [] }; // Return empty structure
        }

        let userArray = users.map(user => user.id);
        let creditMatrix = Array(userArray.length).fill(0).map(() => Array(userArray.length).fill(0));

        // Process each expense to calculate credits
        expenses.forEach(expense => {
            // Ensure the expense currency matches the requested currency (case-insensitive)
            const expenseCurrencyNormalized = expense.currency ? expense.currency.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '') : '';
            
            if (expenseCurrencyNormalized === requestedCurrencyNormalized) {
                // If allowed currencies are defined in settings, ensure this expense's currency is one of them
                if (allowedCurrenciesSetting.length > 0 && !allowedCurrenciesSetting.includes(expenseCurrencyNormalized)) {
                    console.warn(`Skipping expense ${expense.id} for credit calculation; its currency '${expense.currency}' (normalized: '${expenseCurrencyNormalized}') is not in the allowed list: [${allowedCurrenciesSetting.join(', ')}]`);
                    return; 
                }

                // Ensure splitWith is an array, default to empty if not
                const splitWithArray = Array.isArray(expense.splitWith) ? expense.splitWith : [];
                const numberOfSplitters = splitWithArray.length > 0 ? splitWithArray.length : 1;
                const amountPerPerson = expense.amount / numberOfSplitters;

                const payerIndex = userArray.indexOf(expense.paidBy);

                // Ensure payer is found in the user list
                if (payerIndex === -1) {
                    console.warn(`Payer ID ${expense.paidBy} not found in user list for expense ${expense.id}`);
                    return; // Skip this expense if payer not found
                }

                splitWithArray.forEach(memberId => {
                    const memberIndex = userArray.indexOf(memberId);

                    // Ensure member is found in the user list
                    if (memberIndex === -1) {
                        console.warn(`Member ID ${memberId} not found in user list for expense ${expense.id}`);
                        return; // Skip this member if not found
                    }

                    // Update the credit matrix, avoiding self-credit updates
                    if (payerIndex !== memberIndex) {
                        // Ensure the matrix indices are valid before assignment
                        if (creditMatrix[payerIndex] && creditMatrix[memberIndex]) {
                           creditMatrix[payerIndex][memberIndex] += amountPerPerson;
                           creditMatrix[memberIndex][payerIndex] -= amountPerPerson;
                        } else {
                           console.error(`Invalid indices for credit matrix update: payerIndex=${payerIndex}, memberIndex=${memberIndex}`);
                        }
                    }
                });
            }
        });

        // Get display names for the users involved
        let userNames = await Promise.all(userArray.map(userId => this.getDisplayName(chatID, userId)));

        return { creditMatrix, userNames };
    }

    async createMessage(chatID,expense) {
        const amount = expense.amount;
        const currency = expense.currency;
        const description = expense.description;
        
        // Get payer's info
        const paidBy = await this.getDisplayName(chatID, expense.paidBy);

        // Get all splitters' info and map to display names
        const splitNames = await Promise.all(expense.splitWith.map(userId => this.getDisplayName(chatID, userId)));
        
        const splitWith = splitNames.join(", ");

        return i18next.t('expensemessage', { amount, currency, description, paidBy, splitWith });
    }

    async getDisplayName(chatId, userId) {
        if (userId == 6152474485) {
            return "Holons";
        }

        if (userId == chatId) {
            const groupInfo = await this.settings.getSettings(chatId).name;
            return groupInfo || "This Holon"; //TODO maybe get the group name from the settings

        }
        const userInfo = await this.db.get(chatId + '/users', userId);
        if (!userInfo) {
            return userId.toString();
        }
        return utils.getDisplayName(userInfo);
    }

    async getUserCurrencyBalance(chatID, userID, currencyName) {
        const expenses = await this.db.getAll(chatID + '/expenses');
        let netBalance = 0;
        const normalizedTargetCurrency = currencyName.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '');

        if (!expenses || expenses.length === 0) {
            return 0;
        }

        for (const expense of expenses) {
            const expenseCurrencyNormalized = expense.currency ? expense.currency.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '') : '';

            if (expenseCurrencyNormalized === normalizedTargetCurrency) {
                const numSplitters = expense.splitWith && expense.splitWith.length > 0 ? expense.splitWith.length : 1;
                const share = expense.amount / numSplitters;
                let userInSplit = expense.splitWith ? expense.splitWith.includes(userID) : false;

                if (expense.paidBy === userID) {
                    netBalance += expense.amount; // User paid the full amount
                    if (userInSplit) {
                        netBalance -= share; // Subtract their own share
                    }
                } else if (userInSplit) {
                    netBalance -= share; // User is in split but didn't pay, so they owe their share
                }
            }
        }
        return netBalance;
    }
}



