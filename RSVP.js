import { Markup } from 'telegraf';

export default class RSVP {

    constructor(bot, db) {
        this.bot = bot;
        this.db = db;

        this.bot.command('rsvp', (ctx) => this.rsvp(ctx));
        bot.action(/participate_(.+)/, async (ctx) => { this.participate(ctx) });
    }

    async rsvp (ctx) {
        // Load all users
        let chatID = ctx.chat.id;
        let topic = ctx.message.text.split(' ').slice(1).join(' '); // TODO: Save topic in db (under chat/usermessage) so it can be retrieved later
        if (!topic) {
            ctx.reply('Please provide a title for the RSVP.');
            return;
        }
        let users = await this.db.getAll( chatID + '/users');
        if (users.lenght == 0) {
            ctx.reply('No users found.');
            return;
        }
        // Create participation list
        ctx.reply(topic, Markup.inlineKeyboard(createList(users)) ).catch((error) => { console.log(error) }).then((message) => {
            ctx.pinChatMessage(message.message_id)}).catch((error) => { console.log(error) });
        

    }

    async participate(ctx) {
        let topic = ctx.match[1];
        let chatID = ctx.callbackQuery.message.chat.id 
        let userID = ctx.callbackQuery.from.id;
        let messageID = ctx.callbackQuery.message.message_id;
        let targetuser = ctx.match[1];
        if (targetuser != userID) {
            ctx.answerCbQuery('You can only change your own RSVP');
            return;
        }

    
        let user = await this.db.get(chatID + '/users',targetuser);

        if (!user) {
            ctx.answerCbQuery('User not active, please complete a task to activate.');
            return;
        }

        if (typeof user.participated !== 'object') {
            user.participated = {}
            console.log('participate was not an object')
        }

        if (user.participated[messageID] == undefined) {
            user.participated[messageID] = false;
        }

        user.participated[messageID] = !user.participated[messageID];

        await this.db.put(chatID + '/users', user);
        let users = await this.db.getAll(chatID + '/users');
  
        ctx.editMessageReplyMarkup({
            chat_id: chatID,
            message_id: messageID,
            inline_keyboard: createList(users, messageID)
            
        }).catch((error) => { console.log(error) });

    }
}

function createList(users, messageID) {
    let mu = []
    users.forEach(function (user) {
        if (typeof user.participated !== 'object') {
            user.participated = {};
            console.log('participated is not an object')
        }
        let name = (user.first_name ? user.first_name : user.username) + (user.second_name ? ' ' + user.second_name : '');
        mu.push([Markup.button.callback((user.participated[messageID] ? '✅ ' : '☑️ ') + name, `participate_${user.id}`)])
    })
    return mu;

}
