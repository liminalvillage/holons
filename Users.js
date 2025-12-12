import { t } from "i18next";
import * as utils from './utilities.js';
import { Markup } from 'telegraf';

class Users {
  constructor(bot, db) {
    this.bot = bot;
    this.db = db;
    this.bot.command(['value', 'ivalue'], (ctx) => this.addValue(ctx));
    this.bot.command(['need', 'ineed', 'weneed'], (ctx) => this.addNeed(ctx));
    this.bot.command("join", (ctx) => this.join(ctx));
    this.bot.command("leave", (ctx) => this.leave(ctx));

  }

  async join(ctx) {
    let userinfo = await this.getUserInfo(ctx.message.from, ctx.message.chat.id)
    if (userinfo.username == undefined) {
      ctx.reply('Please set a username in your telegram settings to join the group.');
    }
    else {
      ctx.reply('🎉 Welcome ' + ctx.message.from.first_name + '! 🎉');
    }
  }

  async leave(ctx) {
    const holonId = ctx.message.chat.id;
    const user = ctx.message.from;
    await this.db.del(holonId + '/users', user.id)
    ctx.reply('Goodbye ' + user.first_name + '!');
  }


  async addValue(ctx) {
    const holonId = ctx.message.chat.id;
    const user = ctx.message.from;
    const values = utils.parseList(ctx.message.text);
    if (!values) {
      ctx.reply('Please specify a value or list of values to add. eg: /value freedom, non-violence');
      return;
    }

    let userinfo = await this.getUserInfo(user, holonId)
    if (!userinfo.values) userinfo.values = []
    userinfo.values = Array.from(new Set(userinfo.values.concat(values)))

    await this.db.put(holonId + '/users', userinfo)
    ctx.reply(`Added ${values.join(', ')} to your values.`);
  }

  async addNeed(ctx) {
    const holonId = ctx.message.chat.id;
    const user = ctx.message.from;
    const needs = utils.parseList(ctx.message.text);
    if (!needs) {
      ctx.reply('Please specify a need or comma separated list of needs to add. eg: /need hugs, massages');
      return;
    }

    let userinfo = await this.getUserInfo(user, holonId)
    if (!userinfo.needs) userinfo.needs = []
    userinfo.needs = Array.from(new Set(userinfo.needs.concat(needs)))

    await this.db.put(holonId + '/users', userinfo)
    ctx.reply(`Added ${needs.join(', ')} to your needs.`);
  }



  async listUsersActions(ctx) {
    const holonId = ctx.message.chat.id;
    let users = await this.db.getAll(holonId + '/users')

    let message = ''
    for (let i = 0; i < users.length; i++) {
      let user = users[i];
      if (user?.completed?.length > 0) {
        message += user.username + ':' + user.completed.join(', ') + '\n'
      }
    }
    return message
  }


  // save user action
  async saveUserAction(user, type, action, amount, holonId) {
    let userinfo = await this.getUserInfo(user, holonId)
    switch (type) {
      case 'offers':
        userinfo.offers.push(action);
        break;
      case 'wants':
        userinfo.wants.push(action);
        break;
      case 'initiated':
        userinfo.initiated.push(action);
        break;
      case 'completed':
        userinfo.completed.push(action)
        break;
      case 'appreciated':
        userinfo.appreciated.push(action)
        break;
      case 'sent':
        userinfo.sent += 1;
        break;
      case 'received':
        userinfo.received += 1;
        break;
      case 'collaborated':
        userinfo.collaboration.push({ action: action, amount: amount });
        break;
      default:
        break;
    }
    if (userinfo.actions == undefined) userinfo.actions = []
    userinfo.actions.push({ type: type, action: action, amount: amount, timestamp: new Date() });

    await this.db.put(holonId + '/users', userinfo)
  }

  async getUsers(holonId) {
    return this.db.getAll(holonId + '/users')
  }

  //gets an existing user or  creates a new one
  async getUserInfo(user, holonId) {
    let userinfo = await this.db.get(holonId + '/users', user.id)
    // Initialize the receiver's points if they do not exist yet
    if (!userinfo || userinfo == '') {
      userinfo = {
        id: user.id,
        version: '0.1',
        username: user.username ? user.username : user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        participated: {},
        actions: [],
        initiated: [],
        received: 0,
        sent: 0,
        wants: [],
        offers: [],
        needs: [],
        values: [],
        appreciated: [],
        completed: [],
        collaboration: [],
        hours: 0,
        money: 0,
        voice: 0
      }
      await this.db.put(holonId + '/users', userinfo)
    }
    return userinfo
  }
}

export default Users;