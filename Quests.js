import { Markup } from 'telegraf';
import i18next from 'i18next';
import UI from './UI.js';
import { getUserName, getUser, getChatId, getMessageId } from './utilities.js';
import { Calendar } from './Calendar.js';
import  Users  from './Users.js';


export default class Quests {

    constructor(bot, orbitdb, settings) {

        this.bot = bot;
        this.orbitdb = orbitdb;
        this.calendar = new Calendar(bot, {
            date_format: 'YYYY/MM/DD HH:mm:ss',
            time_selector_mod: true,
            language: 'en',
            bot_api: 'telegraf'
        });
        this.settings = settings
        this.users = new Users(bot, orbitdb)
        //----------------------------- QUESTS -----------------------------
        this.bot.command('quest', async (ctx) => this.quest('quest', ctx))
        this.bot.command('mission', async (ctx) => this.quest('quest', ctx))
        this.bot.command('task', async (ctx) => this.quest('task', ctx))
        this.bot.command('proposal', async (ctx) => this.quest('proposal', ctx)
        )
        this.bot.command('propose', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('todo', async (ctx) => this.quest('todo', ctx))
        this.bot.command('recurring', async (ctx) => this.quest('recurring', ctx))

        this.bot.command(['need', 'request', 'want', 'wish'], async (ctx) => this.quest('request', ctx))
        this.bot.command(['offer', 'give', 'have', 'gift'], async (ctx) => this.quest('offer', ctx))

        this.bot.command(['idea'], async (ctx) => this.quest('idea', ctx))
        
        // ITALIAN
        this.bot.command('missione', async (ctx) => this.quest('quest', ctx))
        this.bot.command('compito', async (ctx) => this.quest('task', ctx))
        this.bot.command('proposta', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('propongo', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('fare', async (ctx) => this.quest('todo', ctx))
        this.bot.command('ricorrente', async (ctx) => this.quest('recurring', ctx))

        //create new request/offer
        this.bot.command(['richiedo', 'bisogno', 'vorrei', 'sogno', 'richiesta', 'chiedo'], async (ctx) => this.quest('request', ctx))
        this.bot.command(['offro', 'dono', 'regalo', 'chiedetemi', 'ho', 'offerta'], async (ctx) => this.quest('offer', ctx))

        // QUEST ACTIONS ====================================================
       
        this.bot.action(/join_quest_(.+)/, (ctx) => this.join(ctx));
        this.bot.action(/appreciate_quest_(.+)/, (ctx) => this.appreciate(ctx))
        this.bot.action(/schedule_quest_(.+)/, (ctx) => this.schedule(ctx));
        this.bot.action(/cancel_quest_(.+)/, (ctx) => this.cancel(ctx));
        this.bot.action(/complete_quest_(.+)/, (ctx) => this.complete(ctx));
        this.bot.action(/stop_quest_(.+)/, (ctx) => this.stop(ctx));

        //----------------------------------------------------
    }


    async quest(type, ctx) {

        console.log('NEW QUEST')
        // Get the message text and sender from the context
        let chatID = ctx.message.chat.id;
        let messageID = ctx.message.message_id;
        const language = await this.settings.getLanguage(chatID)
        const text = ctx.message.text ? ctx.message.text : ctx.message.caption;
        const sender = ctx.message.from;

        let questsDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
        await questsDB.load()

        let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
        await usersDB.load()

        const title = text.split(' ').slice(1).join(' ');
        const picture = ctx.message.photo ? ctx.message.photo[0].file_id : null;

        if (!title) {
            ctx.reply(i18next.t('usage', { type: type, lng: language }))
            return;
        }

        // Create a quest object

        let quest = {
            _id: '',
            version: '0.1',
            chat: '',
            initiator: sender,
            title: title,
            picture: picture,
            document: '',
            date: new Date().getTime(),
            when: '',
            participants: [],
            appreciation: [],
            stoppers: [],
            type: type,
            status: 'ongoing'
        }

        // let path = await ui.questImage(quest)
        // ctx.replyWithPhoto({ source: fs.createReadStream(path) },markup).then((ctx) => {
        //     // Add the message id to the quest
        //     questObj._id = ctx.message_id;

        //     questsDB.put(questObj)

        //   }); 
        if (picture)
            ctx.replyWithPhoto(picture,
                {
                    caption: createMessage(quest, language),
                    parse_mode: 'Markdown',
                    ...markup(quest, language)
                }).catch((err) => { console.log(err) }).then((nctx) => {
                    // Add the message id to the quest
                    quest._id = nctx.message_id;
                    quest.chat = nctx.chat.id;
                    questsDB.put(quest)
                    //Pin the message
                    ctx.telegram.pinChatMessage(quest.chat, quest._id, { disable_notification: true }).catch((err) => { console.log(err) });

                });
        else {
            // let path = await ui.getQuestImage(quest,chatID)
            // ctx.telegram.editMessageMedia(ctx.chat.id, ctx.message.message_id,null, {
            //     type: 'photo',
            //     media: path,
            //     caption: markup(quest,language)
            //   });

            if (type == 'offer') {
                quest.participants.push(sender);
                await this.users.saveUserAction(sender, "offers", quest.title, 0 , usersDB)
            }
            if (type == 'request') {
                quest.appreciation.push(sender);
                await this.users.saveUserAction(sender, "wants", quest.title, 0 , usersDB)
            }
            ctx.reply(createMessage(quest, language), markup(quest, language)).then(async (nctx) => {
                // Add the message id to the quest
                quest._id = nctx.message_id;
                quest.chat = nctx.chat.id;

                await questsDB.put(quest)

                //Pin the message
                ctx.telegram.pinChatMessage(quest.chat, quest._id, { disable_notification: true }).catch((err) => { });
                // update the markup
                //await ctx.telegram.editMessageRe(quest.chat, quest._id,null, markup(quest, language)).catch((err) => { console.log(err) });
                await this.updateMessage(ctx, quest)
                //delete the original message
                ctx.deleteMessage(messageID.toString()).catch((err) => { });

                // REPLICATE IN FEDERATED CHATS
                let federationDB = await this.orbitdb.docs('WeQuest.federation')
                await federationDB.load()

                let notifyChats = (await federationDB.get(chatID.toString())[0])
        
                if (!notifyChats || notifyChats == '') { console.log('FEDERATION IS NOT FOUND')}
                else
                    notifyChats = notifyChats.notify

                if (notifyChats && notifyChats.length > 0) {
                    let id = ''+quest.chat*2+quest._id //*2 is a hack not to return similar indexes
                    let fedinfo = federationDB.get(id)[0]
                    console.log(fedinfo)
                    if (!fedinfo || fedinfo == ''|| fedinfo == undefined)
                        fedinfo = { _id: id, all: [{chat:quest.chat.toString(),id:quest._id.toString()}], type: 'quest' }  //TODO UPDATE JSON SCHEMA
                    //TODO CHECK FOR PROMISES TO RETURN
                    for (let i = 0; i < notifyChats.length; i++) {
                        const federatedChat = notifyChats[i];
                        await ctx.telegram.sendMessage(federatedChat, createMessage(quest, language), markup(quest, language)).catch((err) => { console.log(err) }).then(async (fctx) => {
                            // save the federated message id
                            fedinfo.all.push({ chat: federatedChat.toString(), id: fctx.message_id.toString() })
                            })
                    }
                    console.log(fedinfo)
                    await federationDB.put(fedinfo) // Add federated message ids to the DB
                }
            })
        }
    }


    // ========================== ACTIONS ==========================

    async join(ctx) {
        console.log("JOIN ACTION");
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];
 
        const language = await this.settings.getLanguage(chatID)
        let questsDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
        await questsDB.load()

        let quest = await questsDB.get(messageID.toString())[0]

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

        if (quest.status == 'completed') {
            ctx.answerCbQuery(`Quest "${quest.title}" has already been completed`, { reply_to_message_id: messageID })
            return;
        }

        // Get the user who reacted
        const sender = ctx.callbackQuery.from;

        // Check if the user has already joined the quest
        const userindex = quest.participants.findIndex(user => user.id === sender.id)
        if (userindex > -1) {
            ctx.answerCbQuery(`${sender.first_name}, left the quest "${quest.title}"`, { reply_to_message_id: messageID }).catch((err) => { console.log(err) });
            quest.participants.splice(userindex, 1);
        }
        else {
            // Add the user to the quest
            quest.participants.push(sender);
            // Send a message to confirm that the user joined the quest
            ctx.answerCbQuery(`${sender.first_name} has joined the quest "${quest.title}"`, { reply_to_message_id: messageID }).catch((err) => { console.log(err) });
        }

        // Check if the user has already appreciated the quest, remove if so
        const appreciationindex = quest.appreciation.findIndex(user => user.id === sender.id)
        if (appreciationindex > -1) {
            //asctx.answerCbQuery(`${sender.first_name}'s appreciation for "${quest.title}" has been removed`, { reply_to_message_id: messageID }).catch(   (err) => { console.log(err) } );
            quest.appreciation.splice(appreciationindex, 1);
        }

        // Update the message 
        this.updateMessage(ctx, quest);

        // Update the db
        questsDB.put(quest);
    }

    async appreciate(ctx) {
        console.log("APPRECIATE ACTION");
        // Get the quest  from the callback data
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];
 
        const language = await this.settings.getLanguage(chatID)

        let questsDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
        await questsDB.load()

        let quest = await questsDB.get(messageID.toString())[0]

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

        // Get the user who reacted
        const sender = ctx.callbackQuery.from;

        // Check if the user has already joined the quest, remove it
        const userindex = quest.participants.findIndex(user => user.id === sender.id)
        if (userindex > -1) {
            //ctx.answerCbQuery(`${sender.first_name} has been removed from the quest "${quest.title}"`, { reply_to_message_id: messageID });
            if (quest.status === "completed"){
                ctx.answerCbQuery(`You cannot appreciate a ${quest.type} that you participated in`, { reply_to_message_id: messageID });
                return;
            }
            quest.participants.splice(userindex, 1);
        }
      
        // Check if the user has already appreciated the quest, remove if so
        const appreciationindex = quest.appreciation.findIndex(user => user.id === sender.id)
        if (appreciationindex > -1) {
            if (quest.status === "completed") {
                ctx.answerCbQuery(`You have already appreciated this ${quest.type}`, { reply_to_message_id: messageID });
            }
            else {
                ctx.answerCbQuery(`${sender.first_name}'s appreciation for "${quest.title}" has been removed`, { reply_to_message_id: messageID });
                quest.appreciation.splice(appreciationindex, 1);
            }
        } else {
            // Add the user to the quest
            quest.appreciation.push(sender);
            // Send a message to confirm that the user joined the quest
            ctx.answerCbQuery(`${sender.first_name} appreciates the quest "${quest.title}"`, { reply_to_message_id: messageID });
            // share appreciation "after the fact"
            if (quest.status === "completed")
            {
                let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
                await usersDB.load()
                await this.users.saveUserAction(sender, "sent", quest.title, 0 , usersDB)
                for (let i = 0; quest.participants.length; i++) {
                    console.log(quest.participants.length)
                    await this.users.saveUserAction(quest.participants[i], "received", quest.title, 0 , usersDB)
                }
            }
        }
  

        // Update the message 
        this.updateMessage(ctx, quest);

        // Update the db
        questsDB.put(quest);
    }

    async cancel(ctx) {
        console.log("CANCEL ACTION");

        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];
 
        const language = await this.settings.getLanguage(chatID)

        let questsDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
        await questsDB.load()

        let quest = await questsDB.get(messageID.toString())[0]

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

        // Handle the reaction to the quest
        if (quest.initiator.id === ctx.from.id) {
            //delete quest from database
            questsDB.del(messageID.toString())

            //unpin the message
            ctx.telegram.unpinChatMessage(chatID, messageID).catch((err) => { });
            //delete the telegram message
            ctx.deleteMessage(messageID.toString()).catch((err) => { });

        } else {
            ctx.answerCbQuery(`Only the creator of the quest can cancel the quest.`, { reply_to_message_id: messageID }).catch((err) => { console.log(err) });

        }
    }

    async stop(ctx,) {
        console.log("STOP ACTION");

        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];
 
        const language = await this.settings.getLanguage(chatID)

        let questsDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
        await questsDB.load()

        let quest = await questsDB.get(messageID.toString())[0]

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

        // Get the user who reacted
        const sender = ctx.callbackQuery.from;

        const stopperindex = quest.stoppers.findIndex(user => user.id === sender.id)
        if (stopperindex > -1) {
            ctx.reply(`${sender.first_name} has revoked its veto for the quest "${quest.title}"`, { reply_to_message_id: messageID }).catch((err) => { console.log(err) });
            quest.stoppers.splice(stopperindex, 1);
        }
        else {
            // Add the user to the quest
            quest.stoppers.push(sender);
            // Send a message to confirm that the user joined the quest
            ctx.reply(`${sender.first_name} has stopped the quest "${quest.title}". Please get in touch to address any concerns.`, { reply_to_message_id: messageID }).catch((err) => { console.log(err) });
        }
        if (quest.stoppers.length > 0)
            quest.status = 'stopped'
        else
            quest.status = 'ongoing'

        // Update the message 
        this.updateMessage(ctx, quest);

        // Update the db
        await questsDB.put(quest);
    }


    async complete(ctx) {
        console.log("COMPLETE ACTION");

        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];
 
        const language = await this.settings.getLanguage(chatID)

        let questsDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
        await questsDB.load()

        let quest = await questsDB.get(messageID.toString())[0]

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }
        if (!quest.status == 'stopped') {ctx.answerCbQuery(`You cannot complete a quest that has been stopped. Ask to remove the stop before completing the quest.`, { reply_to_message_id: messageID }).catch((err) => { console.log(err) }); return }

        // Handle the reaction to the quest (only initiator or participants can complete the quest)
        if (quest.initiator.id === ctx.from.id || quest.participants.findIndex(user => user.id === ctx.from.id) > -1) {
            quest.status = "completed";
            // Update the message 
            this.updateMessage(ctx, quest);
            // Update the db
            questsDB.put(quest);
            //unpin the message
            ctx.telegram.unpinChatMessage(chatID, messageID).catch((err) => {})

        } else {
            ctx.answerCbQuery(`Only the initiator of the quest or a participant can mark it as completed.`).catch((err) => { });
            return;
        }
        // ================================ RECORD ACTIONS ========================== 

        let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
        await usersDB.load()

        await this.users.saveUserAction(quest.initiator, "initiated", quest.title, 0 , usersDB)

        // loop through all users and add the completed quest to their account
        for (let i = 0; i < quest.participants.length; i++) {
            let user = quest.participants[i];
            await this.users.saveUserAction(user, "completed", quest.title, 0 , usersDB)
        }

        //loop through all users and add appreciation to their account
        for (let i = 0; i < quest.appreciation.length; i++) {
            let sender = quest.appreciation[i];
            // appreciation.appreciate(sender, receivers)
            await this.users.saveUserAction(sender, "sent", quest.title, 0 , usersDB)
            // Calculate the number of appreciation to send to each user
            const appreciationPerUser = 1  // / quest.participants.length;

            // Send the appreciation to each user
            for (let j = 0; j < quest.participants.length; j++) {
                // Get the recipient
                const recipient = quest.participants[j]
                // Check if the recipient is the sender
                // if (recipient.id === sender.id) {
                //     continue;
                // }
                // Send the appreciation to each user
                //await recieveToken(recipient, appreciationPerUser, usersDB)
                // save user with action to the database
                await this.users.saveUserAction(recipient, "received", quest.title, 0 , usersDB)
            }
        }
        // ================================ APPRECIATION ==========================
        ctx.reply(`Quest "${quest.title}" completed! 🎊 `, { reply_to_message_id: messageID }).catch((err) => { });
    }

    async schedule(ctx) {
        console.log("SCHEDULE ACTION");
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];
        this.calendar.startNavCalendar(ctx);//TODO: pass quest information to recreate message
        this.calendar.chats.set(getChatId(ctx) * 100, getMessageId(ctx)); //TODO: fix this, use a different method to store the message id
    }

    async sendAppreciation(ctx) {
        console.log("SEND APPRECIATION ACTION");
        const chatID = ctx.message.chat.id;
        const language = await this.settings.getLanguage(chatID)
        const sender = getUser(ctx);
        const entities = ctx.message.entities;

        // Setup the necessary databases
        const usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
        await usersDB.load()
        const mentions = entities.filter((entity) => (entity.type === 'mention' || entity.type === 'text_mention'));
        if (mentions.length === 0) {
            ctx.reply(`Please mention the name of the user(s) you want to send appreciation to using '@', followed by the reason.`, { reply_to_message_id: ctx.message.message_id });
            return
        }

        const lastMention = mentions[mentions.length - 1];
        let action = ctx.message.text.substring(lastMention.offset + lastMention.length).trim();
        if (action === '') { action = 'appreciated' }

        // Check if the message contains a mention
        for (let i = 0; i < mentions.length; i++) {
            const entity = mentions[i];
            let recipient = {}

            if (entity.type === 'text_mention')
                recipent = await ctx.telegram.this.users.getFullUser(entity.user.id)// ctx.text.substring(entity.offset, entity.offset + entity.length)
            if (entity.type === 'mention') {
                // get the user from the database
                recipient = await usersDB.get(ctx.message.text.substring(entity.offset + 1, entity.offset + entity.length))[0]
            }

            // if ( !recipient || recipient == ''|| !recipient.id) { 
            //     recipient = {}
            //     recipient.id = ctx.message.text.substring(entity.offset + 1, entity.offset + entity.length)
            //     recipient.first_name = ctx.message.text.substring(entity.offset + 1, entity.offset + entity.length)
            // }

            if (!recipient || recipient == '') {
                ctx.reply(`The user has not interacted with this WeQuest yet. Ask the user to complete a task first.`).catch((err) => {  });
                // register the user in the database
                continue;
            }

            // Check if the recipient is the sender
            if (recipient.id === sender.id) {
                ctx.reply(i18next.t(`You cannot send appreciation to yourself.`)).catch((err) => { });
                continue;
            }


            // Send the appreciation to the recipient
            //await recieveToken(recipient, 1, usersDB)
            // save the user action
            await this.users.saveUserAction(recipient, "received", action, 0 , usersDB)
        }

        // Update the sent appreciation of the sender
        //await sendToken(sender, 1, usersDB)
        await this.users.saveUserAction(sender, "sent", action, 0 , usersDB)
        ctx.reply(`${sender} sent appreciation to ${mentions.map(u => '@' + u).join(', ')}.`).catch((error) => console.log(error));
    }

    // ============== UTILITY FUNCTIONS
   

    //remind the user that a quest is due
    async remind(ctx, quest) {
        console.log("REMIND ACTION");
        //TODO Notify federated chats
        ctx.reply(`⏰ The ${quest.type} "${quest.title}" is starting!`, { reply_to_message_id: quest._id });
    }

    // Function to update messages for a quest
    async updateMessage(ctx, quest, language) {
            let federationDB = await this.orbitdb.docs('WeQuest.federation')
            await federationDB.load()
            let fedinfo = await federationDB.get(''+quest.chat*2+quest._id)[0] //* 2 hack not to return similar 
            let message_id 
            let chat_id
            if (!fedinfo || fedinfo == '')
            {
                message_id = quest._id
                chat_id = quest.chat
                if (quest.picture) {
                    await ctx.telegram.editMessageMedia(
                        chat_id,
                        message_id,
                        null,
                        {
                            type: 'photo',
                            media: quest.picture,
                            caption: createMessage(quest, language)
                        },
                        markup(quest, language)
                    ).catch((err) => { });
                }
                else
                    await ctx.telegram.editMessageText(
                        chat_id,
                        message_id,
                        null,
                        createMessage(quest, language),
                        markup(quest, language)
                    ).catch((err) => { }); 
                
            } else
            {
            for (let i = 0; i < fedinfo.all.length; i++) {
                message_id = fedinfo.all[i].id
                chat_id = fedinfo.all[i].chat
            // Update the message 
                if (quest.picture) {
                    await ctx.telegram.editMessageMedia(
                        chat_id,
                        message_id,
                        null,
                        {
                            type: 'photo',
                            media: quest.picture,
                            caption: createMessage(quest, language)
                        },
                        markup(quest, language)
                    ).catch((err) => { });
                }
                else
                    await ctx.telegram.editMessageText(
                        chat_id,
                        message_id,
                        null,
                        createMessage(quest, language),
                        markup(quest, language)
                    ).catch((err) => { }); 
            }
        }
    }

}



// send appreciation 
async function recieveToken(recipient, amount, db) {
    if (!db) return
    let recipientinfo = await this.users.getUserInfo(recipient, db)
    recipientinfo.received += amount;
    await db.put(recipientinfo)
}

async function sendToken(sender, amount, db) {
    if (!db) return
    let senderinfo = await this.users.getUserInfo(sender, db)
    senderinfo.sent += amount;
    await db.put(senderinfo)
}




// Function to create the message for a quest TODO 
function createMessage(quest, language) {
    let message = `| ${quest.type.charAt(0).toUpperCase() + quest.type.slice(1)}: ${quest.title} \n`;
    message += `| 💡 : @${quest.initiator.username} \n`;
    if (quest.participants.length > 0)
        message += `| 🙋‍♂ : ${[...quest.participants].map(u => '@' + u.username).join(', ')} \n`;
    if (quest.appreciation.length > 0)
        message += `| 👍 : ${[...quest.appreciation].map(u => '@' + u.username).join(', ')} \n`;
    if (quest.when)
        message += `| 📅 : ${quest.when} \n`;
    if (quest.status === "stopped")
        message += `| 🛑 : ${[...quest.stoppers].map(u => '@' + u.username).join(', ')} \n`;
    message += `| 🚥 : ${quest.status}\n`;
    return message;
}

function markup(quest, language) {

    let mu

    if (quest.type == 'task' || quest.type == 'quest' || quest.type == 'todo') {
         mu = Markup.inlineKeyboard([
            [
                Markup.button.callback(i18next.t('join', { lng: language }), 'join_quest_' + quest.chat + '_' + quest._id),
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest._id)
            ],
            [
                Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest_' + quest.chat + '_' + quest._id),
                Markup.button.callback(i18next.t('stop', { lng: language }), 'stop_quest_' + quest.chat + '_' + quest._id)
            ],
            [
                Markup.button.callback(i18next.t('cancel', { lng: language }), 'cancel_quest_' + quest.chat + '_' + quest._id),
                Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest._id)
            ]
            // ,[
            //     Markup.button.webApp(i18next.t('Share',{lng:language}), `https://t.me/WeQuestBot?start=${quest._id}`),
            //     Markup.button.webApp(i18next.t('Pick a Time',{lng:language}), `https://robertovalenti.github.io/datepicker/index.html`)
            // ]
        ])
    }   

    if (quest.type == 'proposal') {
        mu = Markup.inlineKeyboard([
            [
                Markup.button.callback(i18next.t('agree', { lng: language }), 'join_quest_' + quest.chat + '_' + quest._id),
                Markup.button.callback(i18next.t('stop', { lng: language }), 'stop_quest_' + quest.chat + '_' + quest._id)
            ],
            [
                Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest_' + quest.chat + '_' + quest._id),
                Markup.button.callback(i18next.t('cancel', { lng: language }), 'cancel_quest_' + quest.chat + '_' + quest._id)
            ]
        ])
    }

    if (quest.type == 'idea' )
        mu = Markup.inlineKeyboard([
            [
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest._id)
            ]
        ])
            

    if (quest.type == 'offer' || quest.type == 'request') {
        mu = Markup.inlineKeyboard([
            [
                Markup.button.callback(i18next.t('accept', { lng: language }), 'join_quest_' + quest.chat + '_' + quest._id),
                Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest_' + quest.chat + '_' + quest._id)
            ],
            [
                Markup.button.callback(i18next.t('cancel', { lng: language }), 'cancel_quest_' + quest.chat + '_' + quest._id),
                Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest._id),
            ]
        ])
    }

    if (quest.status === "completed") // only show appreciation button
    {
        mu = Markup.inlineKeyboard(
            [
                Markup.button.callback(i18next.t('appreciate',{lng:language}), 'appreciate_quest_' + quest.chat + '_' + quest._id)
            ]
        )
    }

    return mu
}
// Function to update messages for a quest
async function updateQuestImage(ctx, quest) {
    try {
        // update the image
        let path = await ui.getQuestImage(quest)
        await ctx.telegram.editMessageMedia(
            ctx.update.callback_query.message.chat.id,
            ctx.update.callback_query.message.message_id,
            null,
            {
                source: fs.createReadStream
                    (path)
            },
        );
    } catch (e) {
        console.log(e);
    }
}
