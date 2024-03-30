import i18next from "i18next";
import fs from 'fs';
import locales from "./data/locales.json" assert { type: "json" };
import * as utils from './utilities.js'
import { Markup } from 'telegraf';
import exp from "constants";

export default class Settings{
    constructor(bot,db){
        this.db = db
        this.bot = bot
        // ================= ADMIN ===========================
        this.bot.command('chats', async (ctx) => {
            //TODO; check if the user is an admin
            let chats = await this.getChats(ctx)
            ctx.reply('Chats: ' + chats)
        })
        this.bot.command(['restart','reset'], async (ctx) => {
            if (utils.isAdmin(ctx)) {
                let chatID = utils.getChatId(ctx)
                // try{
                //  await ctx.getChatAdministrators(chatID).then((admins) => {console.log(admins)}) //TODO: check if the user is an admin (crashes in private chats)
                // }catch(e){ console.log(e)}
                await this.db.drop(chatID + '/shopping')
                await this.db.drop(chatID + '/quests')
                await this.db.drop(chatID + '/offers')
                await this.db.drop(chatID + '/users')
                await this.db.drop(chatID + '/tags')
                await this.db.drop(chatID + '/expenses')
      
               // this.db.put('settings', this.getDefaultSettings(chatID))
                ctx.reply('WeQuest resetted')
            } else {
                ctx.reply('Only a chat admin can perform this action')
            }
        })
        
        this.bot.command(['federate','spoon'], async (ctx) => {
            if (utils.isAdmin(ctx)) this.federate(ctx)
            else ctx.reply('Only a chat admin can perform this action')
         }
        )

        this.bot.command('federation', async (ctx) => {
       
            await this.getFederation(ctx)

         } 
        )


        this.bot.command(['separate','fork','spork'], async (ctx) => {
            if (utils.isAdmin(ctx)) await this.separate(ctx)
            else ctx.reply('Only a chat admin can perform this action')
         }
        )

        this.bot.command('setLanguage', async (ctx) => {
            if (utils.isAdmin(ctx)) await this.setLanguage(ctx)
            else ctx.reply('Only a chat admin can perform this action')
        })
        
        this.bot.command('setTheme', async (ctx) => {
            if (utils.isAdmin(ctx)) this.setTheme(ctx)
            else ctx.reply('Only a chat admin can perform this action')
        })
        
        this.bot.command('setAdmin', async (ctx) => {
            //TODO; check if the user is an admin
            await this.setAdmin(ctx)
        })
        
        this.bot.command(['valueweights','weights','weight','equation'], async (ctx) => {
            if (utils.isAdmin(ctx)) {
            let weights = await this.getValueEquation(utils.getChatId(ctx))
            ctx.reply('Value Equation:', this.equationInlineKeyboard(weights));
            } else {
                ctx.reply('Only a chat admin can perform this action')
            }

        })

        this.bot.command('setHex', async (ctx) => ctx.reply("New hex: "+ await this.setHex(ctx)))
        this.bot.command('getHexContent', async (ctx) => ctx.reply( await this.getHexContent(ctx)))
        
        this.bot.command('setroles', async (ctx) => ctx.reply("New roles: "+ await this.setRoles(ctx)))
        this.bot.command('getroles', async (ctx) => { let roles = await this.getRoles(utils.getChatId(ctx)); ctx.reply(roles ? roles : 'No roles specified') })
        
        this.bot.command('setvalues', async (ctx) => ctx.reply("New values: "+ await this.setValues(utils.getChatId(ctx), utils.getParameters(ctx))))
        this.bot.command('getvalues', async (ctx) => { let values = await this.getValues(utils.getChatId(ctx)); ctx.reply(values ? values : 'No values specified') })
        
        this.bot.command('whitelist', async (ctx) =>{
            let settings = await this.getSettings(utils.getChatId(ctx))[0]
            settings.whitelisted = true
            this.db.put('settings',settings)
          })

        this.bot.action(/increment_(.+)/, async (ctx) => {
            const callbackData = ctx.callbackQuery.data;
            let chatID = ctx.callbackQuery.message.chat.id;
            let weights = await this.getValueEquation(chatID)
            const weightName = callbackData.substring(10);
            weights[weightName] = parseInt(weights[weightName]) + 1;
            // Save the updated weights back to your database
            await this.setValueEquation(chatID, weights);
        
            // Update the message with the new inline keyboard
            await ctx.editMessageText('Update weights:', this.equationInlineKeyboard(weights));
        })

        this.bot.action(/decrement_(.+)/, async (ctx) => {
            const callbackData = ctx.callbackQuery.data;
            let chatID = ctx.callbackQuery.message.chat.id;
            let weights = await this.getValueEquation(chatID)
            const weightName = callbackData.substring(10);
            weights[weightName] = parseInt(weights[weightName]) - 1;
            // Save the updated weights back to your database
            await this.setValueEquation(chatID, weights);
        
            // Update the message with the new inline keyboard
            await ctx.editMessageText('Update weights:', this.equationInlineKeyboard(weights)).catch((e)=>{console.log(e)});
        })

    }

    async setHex(ctx) {
        const chatID = ctx.message.chat.id;
        const hex = ctx.message.text.split(' ')[1];
        let settings =  await this.getSettings(chatID)
        settings.hex = hex
        console.log("hex: " + hex)
        this.db.put(chatID+'/settings',settings)

        this.db.holosphere.put(hex,'chats', {id:chatID})

        return hex
    }

    async getHexContent(ctx){
    const chatID = ctx.message.chat.id;
    let settings =  await this.getSettings(chatID)
    let hex = settings.hex
    let content = await this.db.getAll(hex+'/tags')
    //console.log(content)
    return content?content[0].id:'not found'
    }


    // TODO: move to utilities or UI
     equationInlineKeyboard (weights) {
        return Markup.inlineKeyboard([
          [
            Markup.button.callback('Initiated:', 'null'),
            Markup.button.callback('<', 'decrement_initiated'),
            Markup.button.callback(weights.initiated, 'null'),
            Markup.button.callback('>', 'increment_initiated')
          ],
          [
            Markup.button.callback('Completed:', 'null'),
            Markup.button.callback('<', 'decrement_completed'),
            Markup.button.callback(weights.completed, 'null'),
            Markup.button.callback('>', 'increment_completed')
          ],
          [
            Markup.button.callback('Sent:', 'null'),
            Markup.button.callback('<', 'decrement_sent'),
            Markup.button.callback(weights.sent, 'null'),
            Markup.button.callback('>', 'increment_sent')
          ],
          [
            Markup.button.callback('Received:', 'null'),
            Markup.button.callback('<', 'decrement_received'),
            Markup.button.callback(weights.received, 'null'),
            Markup.button.callback('>', 'increment_received')
          ],
          [
            Markup.button.callback('Done', 'removekeyboard'),
          ]
        ]);
      }

 getDefaultSettings(chatID) {
    return {
      id: chatID,
      hex: chatID,
      version: 0.1,
      name:'',
      timezone:'',
      whitelisted: false,
      language: 'en',
      theme: 'dark',
      level: 0,
      admin: '', 
      roles: [], 
      values:[],
      valueEquation:
      { 
        initiated: 1,
        completed: 1,
        sent: 1,
        received: 1,
        hours: 1,
        collaboration: 1,
        wants: 1,
        offers: 1,
        money: 1 
      }
    }
} 

async init (){
i18next
  .init({
    lng: 'en',
    resources: locales,
    fallbackLng: 'en',
  });
}

// get language from the database
async getLanguage(chatID) {
    let settings = await this.getSettings(chatID)
    return settings.language
}

async setLanguage(ctx) {
    const chatID = ctx.message.chat.id;
    const language = ctx.message.text.split(' ')[1];
   
    if (language === undefined || language === null) {
            ctx.reply('Please specify the language. Example: /setLanguage en')
            return
    }
    if ( language !== 'en' && language !== 'it') {
        ctx.reply('Please specify "it" or "en". Example: /setLanguage en')
        return
    }

    let settings = await this.getSettings(chatID)
    settings.language = language
    this.db.put('settings',settings)
    ctx.reply('Language changed to ' + language)
}

async getTheme(chatID) {
    let settings = await this.getSettings(chatID)
    
    if (settings.theme === 'light') {
          //return themelight
          return fs.readFileSync('themes/theme-light.css', 'utf8');
    } else {
        //return themedark
          return fs.readFileSync('themes/theme-dark.css',  'utf8');
    }
}


async setTheme(ctx) {
    const chatID = ctx.message.chat.id; 
    const theme = ctx.message.text.split(' ')[1];
    
    if (theme === undefined || theme === null) {
        ctx.reply('Please specify the theme. Example: /setTheme light')
        return
    }
    if ( theme !== 'light' && theme !== 'dark') {
        ctx.reply('Please specify "light" or "dark". Example: /setTheme light')
        return
    }
    let settings = await this.getSettings(chatID)
    settings.theme = theme
    this.db.put('settings',settings)
    ctx.reply('Theme changed to ' + theme)
}

async getLevel(chatID) {
    let settings = await this.getSettings(chatID)
    return settings.level
}

async setLevel(ctx) {
    const chatID = ctx.message.chat.id;
    const level = ctx.message.text.split(' ')[1];

    if (level === undefined || level === null) {
            ctx.reply('Please specify the level. Example: /setLevel 1')
            return
          }
    if ( level !== '1' && level !== '2' && level !== '3') {
    ctx.reply('Please specify "1", "2" or "3". Example: /setLevel 1')
    return
    }

    let settings =  await this.getSettings(chatID)
    settings.level = level
    this.db.put('settings',settings)
    ctx.reply('Level changed to ' + level)

}

async getAdmin(chatID) {
    let settings =  await this.getSettings(chatID)
    return settings.admin
}

async setAdmin(ctx) {
    const chatID = ctx.message.chat.id;
    const admin = ctx.message.text.split(' ')[1];
    if (admin === undefined || admin === null) {
            ctx.reply('Please specify the admin. Example: /setAdmin @admin')
            return
          }
    let settings =  await this.getSettings(chatID)
    settings.admin = admin
    this.db.put('settings',settings)
    ctx.reply('Admin changed to ' + admin)
}

async federate(ctx) {
    const chatID = ctx.message.chat.id;
    const federationID = ctx.message.text.split(' ')[1];

    if (federationID === undefined || federationID === null) {
            ctx.reply('Please specify the ID you would like to federate with. Example: /federate 123456. This chat ID is ' + chatID)
            return
    }

    // Save federation info into the chat database
    let fedinfo = await this.db.get('federation', chatID)

    if (fedinfo && fedinfo.federation) {
        
        if (fedinfo.federation.includes(federationID)) {
            ctx.reply('This chat is already federated with ' + federationID)
            return
        } else {
            fedinfo.federation.push(federationID.toString())
            this.db.put('federation',fedinfo)
        }
    } else {
        this.db.put('federation',{
            id: chatID,
            name: ctx.message.chat.title,
            federation: [federationID.toString()],
            notify: []
        })
    }
    // save who needs to be notified in the federation database
    fedinfo = await this.db.get(federationID.toString())[0]
    if (fedinfo) {
        if (fedinfo.notify.includes(chatID)) {
            ctx.reply('This chat is already federated with ' + federationID)
            return
        } else {
            fedinfo.notify.push(chatID)
            this.db.put('federation',fedinfo)
        }
    } else {
        this.db.put('federation',{
            id: federationID.toString(),
            name: await utils.getChatName(ctx, federationID),
            federation: [],
            notify: [chatID]
        })
    }


    // //federate one way
    // let settings =  await this.getSettings(chatID)
    // settings.federation.push(federationID)
    // this.this.db.put(settings)
    //federate the other way
    // let settings =  await this.getSettings(federationID)
    // settings.federation.push(chatID)
    // this.this.db.put(settings)

    ctx.reply('This chat has been federated with ' + federationID)
    return
}

// get the federation list from the database
async separate(ctx) {
    const chatID = ctx.message.chat.id;
    const federationID = ctx.message.text.split(' ')[1];
    if (federationID === undefined || federationID === null) {
            ctx.reply('Please specify who you would like to revoke the federation with. Example: /separate 123456.')
            return
    }
    // Save federation info into the chat database
    let fedinfo = await this.db.get('federation', chatID)
    if (!fedinfo || !fedinfo.federation) {
        ctx.reply('You are not federated with ' + federationID)
        return
    }
     //TODO REMOVE NOTIFY
     
     //TODO REMOVE FEDERATION
   

    // let settings =  await this.getSettings(federationID)
    // let newfederation = settings.federation.filter(item => item !== chatID)
    // if (newfederation.length === settings.federation.length) {
    //     ctx.reply('You are not federated with ' + federationID)
    //     return
    // }
    // await this.this.db.put(settings)


    ctx.reply('Federation with ' + federationID + ' has been revoked')
    return
}

async getFederation(chatID) {
    let federation = await this.db.get('federation', chatID)
    console.log('federation',federation)
    if (!federation || federation == []) {
        return []
    }
    else
    //federation = federation.filter(item => item.id === chatID)[0]
    //console.log('This chat is federated with: ' + federation.federation + ' and will notify: ' + federation.notify)
    return federation.federation
}

 async setRoles(ctx) {
    const chatID = ctx.message.chat.id;
    const roles = utils.parseList(ctx.message.text)

    if (roles === undefined || roles === null || roles === '') {
        return ('Please specify the roles. Example: /setRoles role1 role2')
    }
    let settings =   await this.getSettings(chatID)
    settings.roles = roles
    this.db.put('settings',settings)
    return settings.roles
}

async getRoles(chatID) {
    let settings = await this.getSettings(chatID)
    return settings.roles
}

async setValues(chatID, values) {
   
    if (values === undefined || values === null || values === '') {
        return ('Please specify the values. Example: /setValues collaboration communication pro-activity')
    }
    let settings  = await this.getSettings(chatID)
    settings.values = values.split(' ')
    this.db.put('settings',settings)
    return settings.values
}

async getValues(chatID) {
    let settings = await this.getSettings(chatID)
    return settings.values
}


async getChats(ctx){
    let chats = await this.db.getAll('settings')
    return await Promise.all( chats.map( async function (chat) {return chat.id}))
}

async getSettings(chatID) {
    let settings =  await this.db.get('settings', chatID)
    if (!settings || settings == '') {
        settings =  this.getDefaultSettings(chatID)
        this.db.put('settings',settings)
    }
    return settings
}

async setSettings(settings) {
    this.db.put('settings', settings)
}

async setValueEquation(chatID, equation) {
    let settings = await this.getSettings(chatID)
    settings.valueEquation = equation
    await this.db.put('settings', settings)
}

async getValueEquation(chatID) {
    let settings = await this.getSettings(chatID)
    return settings.valueEquation
}

async whitelisted(ctx){
    let settings = await settings.getSettings(utils.getChatId(ctx))
    if (settings.whitelisted) return ''
    else return ( "WeQuest Bot is still in development, and this chat is not whitelisted to use this function. Please apply for close beta at wequest.it")
  }
  

// async getSettingsButtons(chatID) {
//     return [
//         [{ text: 'Language:'}], [{ text: 'IT', setLanguage(chatID, 'it') }],[{ text: 'EN', setLanguage(ctx, 'en') }]
//         [{ text: 'Theme' }],
//         [{ text: 'Level', callback_data: 'level' }],
//         [{ text: 'Admin', callback_data: 'admin' }],
//         [{ text: 'Roles', callback_data: 'roles' }]
//     ]
// }
}