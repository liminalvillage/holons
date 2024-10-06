import { Markup } from 'telegraf';
import * as utils from './utilities.js';
import Users from './Users.js';


class Announcements {
    constructor(bot, db,settings, users) {
        this.bot = bot;
        this.db = db;
        this.settings = settings;
        this.users = users
        this.bot.command(['announce','announcement','annuncia','annuncio'], (ctx) => this.announce(ctx));

    }

    async announce(ctx) {
        let chatID = ctx.chat.id;
        let messageID = ctx.message.message_id;
        const language = await this.settings.getLanguage(chatID)
        const message = ctx.message.text.split(' ').slice(1).join(' ')
        if (!message || message.length === 0 || message === '') {
            ctx.reply(utils.i18next.t('announcementusage', { lng: language }));
            return;
        }

        let announcement = { id: messageID, from: ctx.from.username , date: new Date(), image: await this.users.getUserPicture(ctx.from.id), content: message }
       
        await this.db.put(chatID + '/announcements', announcement );
        ctx.reply(utils.i18next.t('announced', { message: message ,lng: language }));
    }

    
}

export default Announcements;