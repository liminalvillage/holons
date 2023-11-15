import config from "./config.json" assert { type: "json" };
import { Telegraf, Markup } from 'telegraf';

class Expense {
    constructor(bot) {
        this.bot = bot;
        this.expenses = [];
        this.users = new Set();

        bot.command('spent', (ctx) => {
            const args = ctx.message.text.split(' ').slice(1);
            if (args.length < 3) {
                return ctx.reply('Usage: /spent [amount] [currency] [description]');
            }

            const amount = parseFloat(args[0]);
            const currency = args[1];
            const description = args.slice(2).join(' ');
            expenseManager.addExpense(amount, currency, description, ctx.from.username);
            ctx.reply(`Expense recorded: ${amount} ${currency} for ${description}`);
        });

        bot.command('split', (ctx) => {
            const keyboard = expenseManager.expenses.map(expense => {
                return [{
                    text: `${expense.description} - ${expense.amount} ${expense.currency}`,
                    callback_data: `split:${expense.id}`
                }];
            });

            ctx.reply('Choose an expense to split:', Markup.inlineKeyboard(keyboard));
        });

        bot.action(/split:(.+)/, (ctx) => {
            const expenseId = ctx.match[1];
            const success = expenseManager.joinSplit(ctx.from.username, expenseId);
            if (success) {
                ctx.reply('You have joined the split.');
            } else {
                ctx.reply('Unable to join the split. It might not exist, or you are already part of it.');
            }
        });

        bot.command('clear', (ctx) => {
            const { debtMatrix, userArray } = expenseManager.calculateDebts();
            let summary = "Debt Matrix:\n   " + userArray.join(" ") + "\n";
            debtMatrix.forEach((row, index) => {
                summary += userArray[index] + ": " + row.join(" ") + "\n";
            });
            ctx.reply(summary);
        });

    }

    addExpense(amount, currency, description, paidBy) {
        const expense = {
            id: Date.now().toString(),
            amount,
            currency,
            description,
            paidBy,
            splitWith: [paidBy]
        };
        this.expenses.push(expense);
        this.users.add(paidBy);
    }

    joinSplit(username, expenseId) {
        const expense = this.expenses.find(e => e.id === expenseId);
        if (expense && !expense.splitWith.includes(username)) {
            expense.splitWith.push(username);
            this.users.add(username);
            return true;
        }
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
}
const bot = new Telegraf(config.telegram);
bot.launch();
const expenseManager = new Expense(bot);


