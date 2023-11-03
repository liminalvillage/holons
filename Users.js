import { t } from "i18next";
import * as utils from './utilities.js';

class Users {
  constructor(bot, orbitdb) {
    this.bot = bot;
    this.orbitdb = orbitdb;
    this.bot.command(['value','ivalue'], (ctx) => this.addValue(ctx));
    this.bot.command(['spent','paid'], (ctx) => this.paid(ctx));
    this.bot.command('gotpaid', (ctx) => this.gotpaid(ctx));
    this.bot.command('collaborated', (ctx) => this.collaborated(ctx));
    this.bot.command('wallet', (ctx) => this.wallet(ctx));
    this.bot.command('balance', (ctx) => this.balance(ctx));
  }

 
  async balance(ctx) {
    const chatID = ctx.message.chat.id;
    const user = ctx.message.from;
    let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
    await usersDB.load()
    let users = await usersDB.get('')
    let message = ''
    let total = 0
    for (let i = 0; i < users.length; i++) {
      total += users[i].money 
    }
    const peruser = total / users.length
    message += 'Total spent: ' + total +' euros, ('+ users.length+ ' users, ' + peruser +' euros per user)\n \n'
    //loop through users and compute the balance with respect to other users
    for (let i = 0; i < users.length; i++) {
      let user = users[i];
      //let balance = 0
      // for (let j = 0; j < users.length; j++) {
      //   let otheruser = users[j];
      //   if (user.username != otheruser.username) {
      //     balance += this.computeBalance(user, otheruser)
      //   }
      // }
      message += '@'+user.username + ': spent ' + user.money + ' euros ( balance: '+ (user.money - peruser) +' )\n'
    }
    ctx.reply(message);

  }


  //implments a credit clearing system
  computeBalance(user, otheruser) {
    let balance = 0
    //check if user has received from otheruser
    if (user.received > 0) {
      if (otheruser.sent > 0) {
        if (user.received > otheruser.sent) {
          balance += user.received - otheruser.sent
        }
      }
    }
    //check if user has sent to otheruser
    if (user.sent > 0) {
      if (otheruser.received > 0) {
        if (user.sent > otheruser.received) {
          balance -= otheruser.received - user.sent
        }
      }
    }
    return balance
  }



  async gothours(ctx) {
    const chatID = ctx.message.chat.id;
    const user = ctx.message.from;
    const amount = ctx.message.text.split(' ')[1]
    if (!amount) {
      ctx.reply('Please specify an amount and a reason. eg: /gothours 10 for community shopping');
      return;
    }
    //check if amount is a number
    if (isNaN(amount)) {
      ctx.reply('Please specify a number in your currency unit. eg: /gothours 10 for building a website');
      return;
    }
    let action = ctx.message.text.split(' ').slice(2).join(' ')
    console.log (action)
    let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
    await usersDB.load()
    this.saveUserAction(user, 'gothours', action, parseInt(amount), usersDB)
    ctx.send(`You got ${amount} hours - ${action}.`);
  }

  async spenthours(ctx) {
    const chatID = ctx.message.chat.id;
    const user = ctx.message.from;
    const amount = ctx.message.text.split(' ')[1]
    if (!amount) {
      ctx.reply('Please specify an amount and a reason. eg: /spenthours 10 for community shopping');
      return;
    }
    //check if amount is a number
    if (isNaN(amount)) {
      ctx.reply('Please specify a number in your currency unit. eg: /spenthours 10 for building a website');
      return;
    }
    let action = ctx.message.text.split(' ').slice(2).join(' ')
    console.log (action)
    let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
    await usersDB.load()
    this.saveUserAction(user, 'spenthours', action, parseInt(amount), usersDB)
    ctx.reply(`You spent ${amount} hours - ${action}.`);
  }
  

  async wallet(ctx) {
    const chatID = ctx.message.chat.id;
    const user = ctx.message.from;
    let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
    await usersDB.load()
    let userinfo = await this.getUserInfo(user, usersDB)
    let message = `You have ${userinfo.money} currency units and ${userinfo.hours} hours in your wallet.`
    ctx.reply(message);

  }

  async paid(ctx) {
    const chatID = ctx.message.chat.id;
    const user = ctx.message.from;
    const command = ctx.message.text.split(' ')[0]
    const amount = ctx.message.text.split(' ')[1]
    const currentsee = ctx.message.text.split(' ')[2]
    if (!amount) {
      ctx.reply('Please specify an amount and a reason. eg: /paid 10 euros for community shopping');
      return;
    }

    if (!currentsee || (!currentsee.startsWith('euro') && !currentsee.startsWith('hour'))) {
      ctx.reply(`Please specify the currency. eg: ${command} 10 euros for community shopping`);
      return;
    }

    //check if amount is a number
    if (isNaN(amount)) {
      ctx.reply('Please specify a number in your currency unit. eg: /paid 10 euros for community shopping');
      return;
    }
    let action = ctx.message.text.split(' ').slice(3).join(' ')

    let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
    await usersDB.load()
    if (currentsee.startsWith('euro')) {
      this.saveUserAction(user, 'spentmoney', action, parseInt(amount), usersDB)
    }
    else if (currentsee.startsWith('hour')) {
      this.saveUserAction(user, 'spenthours', action, parseInt(amount), usersDB)
    }

    ctx.reply(`You ${command.substring(1)} ${amount} ${currentsee} - ${action}.`);
  }

  async gotpaid(ctx) {
    const chatID = ctx.message.chat.id;
    const user = ctx.message.from;
    const amount = ctx.message.text.split(' ')[1]
    if (!amount) {
      ctx.reply('Please specify an amount and a reason. eg: /gotpaid 10 for building a website');
      return;
    }
    //check if amount is a number
    if (isNaN(amount)) {
      ctx.reply('Please specify a number in your currency unit. eg: /gotpaid 10 for building a website');
      return;
    }
    let action = ctx.message.text.split(' ').slice(2).join(' ')
    console.log (action)
    let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
    await usersDB.load()
    this.saveUserAction(user, 'gotmoney', action, amount, usersDB)
    ctx.reply(`You got paid ${amount} - ${action}.`);
  }


  async addValue(ctx) {
    const chatID = ctx.message.chat.id;
    const user = ctx.message.from;
    const values = utils.parseList(ctx.message.text);
    if (!values) {
      ctx.reply('Please specify a value or list of values to add. eg: /value freedom, non-violence');
      return;
    }
    let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
    await usersDB.load()

    let userinfo = await this.getUserInfo(user, usersDB)
    //if (!userinfo.values) userinfo.values = []
    userinfo.values = values
    
    await usersDB.put(userinfo)
    ctx.reply(`Added ${values.join(', ')} to your values.`);
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
  async saveUserAction(userobj, type, action, amount , db) {
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
      case 'spentmoney':
        userinfo.money += amount;
        break;
      case 'gotmoney':
          userinfo.money -= amount;
        break;
      case 'collaborated':
          userinfo.collaboration.push({action: action, amount: amount});
        break;
      case 'spenthours':
          userinfo.hours += amount;
      case 'gothours':
          userinfo.hours -= amount;
      break;
   
      break;
      default:
        break;
    }
    if (userinfo.actions == undefined) userinfo.actions = []
    userinfo.actions.push({type: type, action: action, amount: amount});

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
        actions: [],
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