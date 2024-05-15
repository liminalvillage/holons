import { Markup } from 'telegraf';
import * as utils from './utilities.js';
import Users from './Users.js';

export default class Roles {

    constructor(bot, db) {
        this.bot = bot;
        this.db = db;

        this.bot.command('roles', async (ctx) => await this.roles(ctx));
        bot.action(/joinrole_(.+)/, async (ctx) => { this.joinrole(ctx) });
        bot.action(/clearroles_(.+)/, async (ctx) => { this.clearroles(ctx) })
        this.bot.command('addrole', (ctx) => this.addrole(ctx));
        this.bot.command('removerole', (ctx) => this.removerole(ctx));
        this.bot.command('clearroles', (ctx) => this.clearroles(ctx));
        this.bot.command('resetroles', (ctx) => this.resetroles(ctx));
    }

    async roles(ctx) {
        // Load all users
        let chatID = ctx.chat.id;
        let roles = await this.db.getAll(chatID + '/roles');
        //let users = await this.db.getAll(chatID + '/users');
        if (roles.length == 0) {
            ctx.reply('No roles found, use /addrole to create one.');
            return;
        }
        // Create participation list
        ctx.reply("Today's roles:", Markup.inlineKeyboard(createroles(roles))).catch((error) => { console.log(error) });

    }

    async addrole(ctx) {
        if (!utils.isAdmin(ctx)) {
            ctx.reply('Only admins can add roles');
            return;
        }

        let chatID = ctx.chat.id;
        let title = ctx.message.text.split(' ').slice(1).join(' ');
        if (!title) {
            ctx.reply('Please provide a title for the role. Eg: /addrole Space Angel');
            return;
        }
        
        let messageID = ctx.message.message_id;
        let role = {
            title: title,
            id: messageID,
            participants: []
        }
        await this.db.put(chatID + '/roles', role);
        ctx.reply('Role ' + title + ' added');
    }
    //clears participants in all roles
    async clearroles(ctx) {
        let chatID = ctx.callbackQuery.message.chat.id;
        let messageID = ctx.callbackQuery.message.message_id;
        if (!utils.isAdmin(ctx)) {
            ctx.answerCbQuery('Only admins can clear all roles');
            return;
        }
        let roles = await this.db.getAll(chatID + '/roles');
        roles.forEach(role => {
            //TODO: save actions for currrent settings before removing them
            role.participants.forEach(user => {
                this.db.get(chatID + '/users', user).then(user => {
                    if (user) {
                        user[role] += 1;
                        this.db.put(chatID + '/users', user);
                    }
                }
                )

            })
            role.participants = []; 
            this.db.put(chatID + '/roles', role)
        });

         roles = await this.db.getAll(chatID + '/roles');

        ctx.editMessageReplyMarkup({
            chat_id: chatID,
            message_id: messageID,
            inline_keyboard: createroles(roles, messageID)

        }).catch((error) => { console.log(error) });
        ctx.answerCbQuery('All roles cleared');
    }
    // finds role by its title and removes it
    async removerole(ctx) {
        let chatID = ctx.chat.id;
        if (!utils.isAdmin(ctx)) {
            ctx.answerCbQuery('Only admins can remove roles');
            return;
        }
        let title = ctx.message.text.split(' ').slice(1).join(' ');
        let roles = await this.db.getAll(chatID + '/roles');
        let role = roles.find(role => role.title == title);
        if (role) {
            await this.db.del(chatID + '/roles', role.id);
            ctx.reply('Role ' + title + ' removed');
        }
        else {
            ctx.reply('Role ' + title + ' not found');
        }
    }

    async resetroles(ctx) {
        let chatID = ctx.chat.id;
        if (!utils.isAdmin(ctx)) {
            ctx.answerCbQuery('Only admins can reset all roles');
            return;
        }
        this.db.drop(chatID + '/roles');
        // let roles = await this.db.getAll(chatID + '/roles');
        // roles.forEach(role => this.db.del(chatID + '/roles', role.id));
        ctx.reply('All roles removed');
    }

    async joinrole(ctx) {
        let topic = ctx.match[1];
        let chatID = ctx.callbackQuery.message.chat.id
        let userID = ctx.callbackQuery.from.id;
        let username = ctx.callbackQuery.from.username;
        let messageID = ctx.callbackQuery.message.message_id;
        let roleid = ctx.match[1];

        let role = await this.db.get(chatID + '/roles', roleid);

        if (role.participants.includes(username)) {
            role.participants = role.participants.filter(user => user != username);
            ctx.answerCbQuery('You have removed yourself from this role');
        }
        else {
            role.participants.push(username)
            ctx.answerCbQuery('You joined the role');
        }

        await this.db.put(chatID + '/roles', role); // saves changes to the role

        // user.participated[messageID] = !user.participated[messageID];

        // await this.db.put(chatID + '/users', user);


        let roles = await this.db.getAll(chatID + '/roles');

        ctx.editMessageReplyMarkup({
            chat_id: chatID,
            message_id: messageID,
            inline_keyboard: createroles(roles, messageID)

        }).catch((error) => { console.log(error) });

    }
}

function createroles(roles, messageID) {
    let mu = []
    roles.forEach(function (role) {
        mu.push([Markup.button.callback((role.title + (role.participants.length ? ':' + role.participants.map(user => '@' + user).join(',') : ' ')), `joinrole_${role.id}`)])
    })
    mu.push([Markup.button.callback('🧹 Clear all roles 🧹', `clearroles_${messageID}`)])
    return mu;

}
