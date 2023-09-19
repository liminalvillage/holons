import { t } from "i18next";

class Users {
  constructor(bot, orbitdb) {
    this.bot = bot;
    this.orbitdb = orbitdb;
    this.bot.command('value', (ctx) => this.addValue(ctx));
  }

  async addValue(ctx) {
    const chatID = ctx.message.chat.id;
    const user = ctx.message.from;
    const value = ctx.message.text.split('/value ')[1];
    if (!value) {
      ctx.reply('Please specify a value to add. eg: /value freedom');
      return;
    }
    let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
    await usersDB.load()

    let userinfo = await this.getUserInfo(user, usersDB)
    userinfo.values.push(value)
    await usersDB.put(userinfo)
    ctx.reply(`Added ${value} to your values.`);


  }

  async listUsersActions(ctx) {
    const chatID = ctx.message.chat.id;
    const usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
    await usersDB.load()

    let users = await usersDB.get('')
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
  async saveUserAction(userobj, type, action, db) {
    console.log('SAVE USER ACTION: ' + type)
    if (!db) return
    let userinfo = await this.getUserInfo(userobj, db)
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
      default:
        break;
    }


    await db.put(userinfo)
  }


  //gets an existing user or  creates a new one
  async getUserInfo(user, db) {
    if (!db) return
    let userinfo = await db.get(user.id)[0]
    // Initialize the receiver's points if they do not exist yet
    if (!userinfo || userinfo == '') {
      userinfo = {
        _id: user.id,
        version: '0.1',
        username: user.username ? user.username : user.id,
        values: [],
        initiated: [],
        received: 0,
        sent: 0,
        wants: [],
        offers: [],
        values: [],
        appreciated: [],
        completed: [],
        collaboration: [],
        hours: 0,
        money: 0,
        voice: 0
      }
      await db.put(userinfo)
    }
    return userinfo
  }
}

export default Users;