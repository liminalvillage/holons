// Description: This file contains the Expenses class, which handles all the expenses related commands and actions.
import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import i18next from 'i18next';


export default class Expenses {
    constructor(bot, db, ui, settings) {
        this.bot = bot;
        this.db = db;
        this.ui = ui;
        this.settings = settings;
 
        bot.command(['spent','speso'], async (ctx) => {
            const chatID = ctx.chat.id;
            const args = ctx.message.text.split(' ').slice(1);
            console.log(this.settings)
            const language = await this.settings.getLanguage(chatID)
            const command = ctx.message.text.split(' ')[0].replace('/', '');
            if (args.length < 3) {
                return ctx.reply(i18next.t('expenseusage', { command:command, lng: language })); 
            }

            const amount = parseFloat(args[0]);
            const currency = args[1];
            const description = args.slice(2).join(' ');
            const expense = await this.addExpense(chatID, amount, currency, description, ctx.from.username);
            ctx.reply(this.createMessage(expense), Markup.inlineKeyboard(
                [{ text: i18next.t('Split',{lng:language}), callback_data: `split:${expense.id}` }, { text: i18next.t('Split All',{lng:language}), callback_data: `splitall:${expense.id}` }]
            ));
        });


        bot.action(/split:(.+)/, async (ctx) => {
            const chatID = ctx.callbackQuery?.message?.chat?.id
            const messageID = ctx.callbackQuery.message.message_id;
            const expenseID = ctx.match[1];
            const language = await this.settings.getLanguage(chatID)
            const result = await this.joinSplit(chatID, ctx.from.username, expenseID);
            if (result) {
                ctx.telegram.editMessageText(chatID, messageID, null, this.createMessage(result), Markup.inlineKeyboard([{ text: i18next.t('Split',{lng:language}), callback_data: `split:${result.id}` }, { text: 'Split All', callback_data: `splitall:${result.id}` }])).catch(err => console.log(err));
            } else {
                ctx.reply(i18next.t('expensejoinfail',{lng:language}));
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
                ctx.reply(i18next.t('expensejoinfail',{lng:language}));
            }
        });


        // bot.action(/clear:(.+)/, async (ctx) => {
        //     const chatID = ctx.callbackQuery?.message?.chat?.id
        //     const messageID = ctx.callbackQuery.message.message_id;
        //     const expenseID = ctx.match[1];

        // });

        bot.command(['clear','balance','credit','bilancio'], async (ctx) => {
            const chatID = ctx.chat.id;
            const currency = ctx.message.text.split(' ').slice(1);
            const language = await this.settings.getLanguage(chatID)
            if (currency == null || currency.length == 0) 
                return ctx.reply(i18next.t('balanceusage', { lng: language }));
            const { creditMatrix, userArray } = await this.calculateCredits(chatID, currency);
            this.ui.getCreditTable(creditMatrix, userArray, chatID).then((path) => {
                ctx.replyWithPhoto({ source: fs.createReadStream(path) });
              }); 
        });

    }

    async addExpense(chatID, amount, currency, description, paidBy) {
        const expense = {
            id: Date.now().toString(),
            amount,
            currency,
            description,
            paidBy,
            splitWith: [paidBy]
        };
        await this.db.put(chatID + '/expenses', expense)
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

            await this.db.put(chatID + '/expenses',expense)
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
            await this.db.put(chatID + '/expenses',expense)
            return expense;
        }
        return false;
    }

    async calculateCredits(chatID, currency) {
        let expenses = await this.db.getAll( chatID + '/expenses')
        let users = await this.db.getAll(chatID + '/users')
        let userArray = users.map(user => user.username)
        let creditMatrix = Array(userArray.length).fill(0).map(() => Array(userArray.length).fill(0));

        expenses.forEach(expense => {
            //if (expense.currency == currency){ 
            const amountPerPerson = expense.amount / (expense.splitWith.length > 0 ? expense.splitWith.length : 1);
            const payerIndex = userArray.indexOf(expense.paidBy);
            expense.splitWith.forEach(member => {
                const memberIndex = userArray.indexOf(member);
                console.log(memberIndex, member)
                if (payerIndex !== memberIndex) {
                    creditMatrix[payerIndex][memberIndex] += amountPerPerson;
                    creditMatrix[memberIndex][payerIndex] -= amountPerPerson;
                }
            });
           // }
        });

        return { creditMatrix, userArray };
    }

    createMessage(expense) {
        const amount = expense.amount;
        const currency = expense.currency;
        const description = expense.description;
        const paidBy = expense.paidBy;
        const splitWith = expense.splitWith.join(", ");

        return i18next.t('expensemessage', { amount, currency, description, paidBy, splitWith });
    }
}



