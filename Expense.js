import config from "./config.json" assert { type: "json" };
import { Telegraf, Markup } from 'telegraf';

class Expense {
    constructor(bot,db) {
        this.bot = bot;
        this.db = db;
        // this.expenses = [];
        // this.users = new Set();

        bot.command('spent', (ctx) => {
            const args = ctx.message.text.split(' ').slice(1);
            if (args.length < 3) {
                return ctx.reply('Usage: /spent [amount] [currency] [description]');
            }

            const amount = parseFloat(args[0]);
            const currency = args[1];
            const description = args.slice(2).join(' ');
            const expense = this.addExpense(amount, currency, description, ctx.from.username);
            ctx.reply(this.createMessage(expense), Markup.inlineKeyboard(
                [{ text: 'Split', callback_data: `split:${expense.id}` },{ text: 'Clear', callback_data: `clear:${expense.id}` }]
            ));
        });

    
        bot.action(/split:(.+)/, (ctx) => {
            const expenseId = ctx.match[1];
            const success = this.joinSplit(ctx.from.username, expenseId);
            let expense = this.expenses.find(e => e.id === expenseId)
            const chatID = ctx.callbackQuery?.message?.chat?.id 
            const messageID = ctx.callbackQuery.message.message_id;
            console.log(chatID, messageID);
            if (success) {
                ctx.telegram.editMessageText(chatID, messageID , null, this.createMessage(expense), Markup.inlineKeyboard([{ text: 'Split', callback_data: `split:${expense.id}` },{ text: 'Clear', callback_data: `clear:${expense.id}` }]));
            } else {
                ctx.reply('Unable to join the split. It might not exist, or you are already part of it.');
            }
        });

        bot.command('clear', (ctx) => {
            const { debtMatrix, userArray } = this.calculateDebts();
            let summary = "Debt Matrix:\n   " + userArray.join(" ") + "\n";
            debtMatrix.forEach((row, index) => {
                summary += userArray[index] + ": " + row.join(" ") + "\n";
            });
            ctx.reply(summary);
        });

    }

    async addExpense(amount, currency, description, paidBy) {
        const expense = {
            id: Date.now().toString(),
            amount,
            currency,
            description,
            paidBy,
            splitWith: [paidBy]
        };
        let expenseDB = await this.db.docs('WeQuest.' + chatID.toString() + '.expense')
        expenseDB.put(expense)

        return expense;
    }

    async joinSplit(username, expenseId) {
        let expenseDB = await this.db.docs('WeQuest.' + chatID.toString() + '.expense', { indexBy: 'id' })
        await expenseDB.load()
        let expense = await expenseDB.get(expenseId)
        
       //if (expense && !expense.splitWith.includes(username)) {
            expense.splitWith.push(username);
            await expenseDB.put(expense)
            return true;
        //}
        return false;
    }

    calculateDebts() {
        const userArray = Array.from(this.users);
        let debtMatrix = Array(userArray.length).fill(0).map(() => Array(userArray.length).fill(0));

        this.expenses.forEach(expense => {
            const amountPerPerson = expense.amount / expense.splitWith.length;
            const payerIndex = userArray.indexOf(expense.paidBy);
            expense.splitWith.forEach(member => {
                const memberIndex = userArray.indexOf(member);
                if (payerIndex !== memberIndex) {
                    debtMatrix[payerIndex][memberIndex] += amountPerPerson;
                    debtMatrix[memberIndex][payerIndex] -= amountPerPerson;
                }
            });
        });

        return { debtMatrix, userArray };
    }

    createMessage(expense) {
        return `Expense: ${expense.amount} ${expense.currency} for ${expense.description}\n`+
               `Paid by ${expense.paidBy}\n`+
               `Split with ${expense.splitWith.join(", ")}`;
    }
}

const bot = new Telegraf(config.telegram);
bot.launch();
const expenseManager = new Expense(bot);


