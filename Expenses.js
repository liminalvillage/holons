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
            const chatID = ctx.callbackQuery?.message?.chat?.id
            const messageID = ctx.callbackQuery.message.message_id;
            const expenseID = ctx.match[1];
            const language = await this.settings.getLanguage(chatID)
            const result = await this.joinSplit(chatID, ctx.from.username, expenseID);
            if (result) {
                ctx.telegram.editMessageText(chatID, messageID, null, this.createMessage(result), Markup.inlineKeyboard([{ text: i18next.t('Split', { lng: language }), callback_data: `split:${result.id}` }, { text: 'Split All', callback_data: `splitall:${result.id}` }])).catch(err => console.log(err));
            } else {
                ctx.reply(i18next.t('expensejoinfail', { lng: language }));
            }
        });

        bot.action(/splitall:(.+)/, async (ctx) => {
            const chatID = ctx.callbackQuery?.message?.chat?.id
            const messageID = ctx.callbackQuery.message.message_id;
            const expenseID = ctx.match[1];
            const language = await this.settings.getLanguage(chatID)
            const result = await this.splitAll(chatID, ctx.from.username, expenseID);
            if (result) {
                ctx.telegram.editMessageText(chatID, messageID, null, this.createMessage(result), Markup.inlineKeyboard([{ text: 'Split', callback_data: `split:${result.id}` }, { text: 'Split All', callback_data: `splitall:${result.id}` }])).catch(err => console.log(err));
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
            const { creditMatrix, userArray } = await this.calculateCredits(chatID, currency);
            this.ui.getCreditTable(creditMatrix, userArray, chatID).then((path) => {
                ctx.replyWithPhoto({ source: fs.createReadStream(path) });
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
        expenses.forEach(expense => {
            message += 'id: ' + expense.id + ' \n' + this.createMessage(expense) + '\n\n';
        });
        ctx.reply(message);

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
        let currency = args[1];
        // valid currency check
        currency = currency.toLowerCase().replace(/s$/, '');
        currency = currency.replace(/[^a-z]/g, '');
        if (!(currency == 'euro' || currency == 'hour' || currency == 'dollar'))
            return ctx.reply(i18next.t('expenseusage', { command: command, lng: language }));

        const description = args.slice(2).join(' ');
        // TODO WARNING!!: messageID+1 is a dirty hack to get the id of the reply message as id of the expense. This will break if another message is sent at the same time
        const expense = await this.addExpense(messageID + 1, chatID, amount, currency, description, ctx.from.username);
        ctx.reply(this.createMessage(expense), Markup.inlineKeyboard(
            [{ text: i18next.t('Split', { lng: language }), callback_data: `split:${expense.id}` }, { text: i18next.t('Split All', { lng: language }), callback_data: `splitall:${expense.id}` }]
        ));
    };

    async addExpense(messageID, chatID, amount, currency, description, paidBy) {
        //do health check on currency: remove uppercase, check if it's a valid currency, remove plural
        if (isNaN(amount) || amount <= 0 || currency == null || currency.length == 0) {
            return false;
        }

        amount = parseFloat(amount);

        currency = currency.toLowerCase().replace(/s$/, '');
        currency = currency.replace(/[^a-z]/g, '');
        //remove the word "for" or "per" from the description at the beginning
        description = description.replace(/^for /, ''); //EN
        description = description.replace(/^per /, '');
        description = description.replace(/^voor /, '');
        description = description.replace(/^für /, '');
        description = description.replace(/^por /, '');
        description = description.replace(/^pour /, '');

        const expense = {
            id: messageID,
            date: Date.now().toString(),
            amount,
            currency,
            description,
            paidBy,
            splitWith: [paidBy]
        };
        await this.db.put(chatID + '/expenses', expense)
        console.log('added expense', expense.id)
        return expense;
    }

    async joinSplit(chatID, username, expenseID) {
        let expense = await this.db.get(chatID + '/expenses', expenseID)

        if (expense) {
            if (!expense.splitWith.includes(username)) { //add user to split
                expense.splitWith.push(username);
            }
            else {//remove user from split
                expense.splitWith = expense.splitWith.filter(function (value, index, arr) { return value != username; });
            }

            await this.db.put(chatID + '/expenses', expense)
            return expense;
        }
        return false;
    }

    async removeFromSplit(ctx) {
        const language = await this.settings.getLanguage(ctx.chat.id)

        if (!ctx.message.reply_to_message && ctx.message.text.split(' ').length < 2){
            ctx.reply('Please specify the expense ID or reply to the expense message you want to remove a user from');
            return;
        }
        let chatID = ctx.chat.id;//
        // extract username from the text
       // let username = ctx.message.text.split(' ').slice(1).join(' ');
        // let expenseID = ctx.message.reply_to_message.message_id; 
        //get the expense as first word in the reply message
        let expenseID = ctx.message.text.split(' ').slice(1)[0];
        if ( ctx.message.reply_to_message)
            expenseID = ctx.message.reply_to_message.message_id;
        let username = ctx.message.text.split(' ').slice(1)[1];
        //get expense id from the replied message
        let expense = await this.db.get(chatID + '/expenses', expenseID)
        if (expense) {
            expense.splitWith = expense.splitWith.filter(function (value, index, arr) { return value != username; });
            await this.db.put(chatID + '/expenses', expense)
            ctx.telegram.editMessageText(chatID, expenseID, null, this.createMessage(expense), Markup.inlineKeyboard(
                [{ text: i18next.t('Split', { lng: language }), callback_data: `split:${expense.id}` }, { text: i18next.t('Split All', { lng: language }), callback_data: `splitall:${expense.id}` }]
            )).catch(err => console.log(err))
            return expense;
        }
        return false;
    }

    async addToSplit(ctx) {
        const language = await this.settings.getLanguage(ctx.chat.id)
        if (!ctx.message.reply_to_message && ctx.message.text.split(' ').length < 2){
            ctx.reply('Please specify the expense ID or reply to the expense message you want to remove a user from');
            return;
        }
        let chatID = ctx.chat.id;
        let expenseID = ctx.message.text.split(' ').slice(1)[0];
        let username = ctx.message.text.split(' ').slice(1)[1];
        //get expense id from the replied message
        if ( ctx.message.reply_to_message)
            expenseID = ctx.message.reply_to_message.message_id;
        // let username = ctx.message.text.split(' ').slice(1).join(' ');
        // let expenseID = ctx.message.reply_to_message.message_id;

        let expense = await this.db.get(chatID + '/expenses', expenseID)
        if (expense) {
            if (!expense.splitWith)
                expense.splitWith = [];
            if (!expense.splitWith.includes(username))
                expense.splitWith.push(username);
            await this.db.put(chatID + '/expenses', expense)
            ctx.telegram.editMessageText(chatID, expenseID, null, this.createMessage(expense), Markup.inlineKeyboard(
                [{ text: i18next.t('Split', { lng: language }), callback_data: `split:${expense.id}` }, { text: i18next.t('Split All', { lng: language }), callback_data: `splitall:${expense.id}` }]
            )).catch(err => console.log(err));
            return expense;
        }
        return false;
    }

    async splitAll(chatID, username, expenseID) {
        let expense = await this.db.get(chatID + '/expenses', expenseID)
        if (expense) {
            let users = await this.db.getAll(chatID + '/users')
            let userArray = users.map(user => user.username)
            expense.splitWith = userArray;
            await this.db.put(chatID + '/expenses', expense)
            return expense;
        }
        return false;
    }

    async calculateCredits(chatID, currency) {
        if (currency == null || currency.length == 0)
            return false;
        if (typeof currency === 'string' || currency instanceof String) {
            currency = currency.toLowerCase().replace(/s$/, '');
        } else {
            console.error('currency is not a string:', currency);
        }

        currency = currency.replace(/[^a-z]/g, '');

        let expenses = await this.db.getAll(chatID + '/expenses')
        let users = await this.db.getAll(chatID + '/users')
        let userArray = users.map(user => user.username)
        let creditMatrix = Array(userArray.length).fill(0).map(() => Array(userArray.length).fill(0));

        expenses.forEach(expense => {
            if (expense.currency == currency) {
                const amountPerPerson = expense.amount / (expense.splitWith.length > 0 ? expense.splitWith.length : 1);
                const payerIndex = userArray.indexOf(expense.paidBy);
                expense.splitWith.forEach(member => {
                    const memberIndex = userArray.indexOf(member);
                    if (memberIndex === -1 || payerIndex === -1)
                        return
                    if (payerIndex !== memberIndex) {
                        creditMatrix[payerIndex][memberIndex] += amountPerPerson;
                        creditMatrix[memberIndex][payerIndex] -= amountPerPerson;
                    }
                });
            }
        });

        return { creditMatrix, userArray };
    }

    createMessage(expense) {
        const amount = expense.amount;
        const currency = expense.currency;
        const description = expense.description;
        const paidBy = expense.paidBy;
        const splitWith = expense.splitWith.length > 0 ? expense.splitWith.join(", ") : "";

        return i18next.t('expensemessage', { amount, currency, description, paidBy, splitWith });
    }
}



