import { Markup } from 'telegraf';

export default class Participation {

    constructor(bot, db) {
        this.bot = bot;
        this.db = db;

        this.bot.command('participation', (ctx) => this.participation(ctx));
        bot.action(/participate_(.+)/, async (ctx) => { this.participate(ctx) });
    }

    async participation (ctx) {
        // Load all users
        let chatID = ctx.chat.id;
        let users = await this.db.getAll( chatID + '/users');
        if (!users) {
            ctx.reply('No users found.');
            return;
        }
        // Create participation list
        ctx.reply('Participation list:', createList(users) ).catch((error) => { console.log(error) });

    }

    async participate(ctx) {
        let chatID = ctx.callbackQuery.message.chat.id 
        let userID = ctx.callbackQuery.from.id;
        let targetuser = ctx.match[1];
        if (targetuser != userID) {
            ctx.answerCbQuery('You can only change your own state');
            return;
        }

        let users = await this.db.getAll(chatID + '/users');
        let user = await this.db.get(chatID + '/users',targetuser);

        if (user.participate == undefined) {
            user.participate = false;
        }

        user.participate = !user.participate;

        await this.db.put(chatID + '/users', user);
        ctx.editMessageText('Participation list:',  createList(users)).catch((error) => { console.log(error) });

    }
}

function createList(users) {
    let mu = []
    users.forEach(function (user) {
        let name = (user.first_name? user.first_name : user.username) + ' ' + (user.second_name? user.second_name : '')
        mu.push([Markup.button.callback((user.participate ? '✅ ' : '☑️ ') + name, `participate_${user.id}`)])
    })
    return Markup.inlineKeyboard(mu);

}
