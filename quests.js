import { Markup } from 'telegraf';
import i18next from 'i18next';
import UI from './UI.js';
import { getUserName, getUser, getChatId, getMessageId } from './utilities.js';
import { Calendar } from './Calendar.js';


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
        //----------------------------- QUESTS -----------------------------
        this.bot.command('quest', async (ctx) => this.quest('quest', ctx))
        this.bot.command('mission', async (ctx) => this.quest('quest', ctx))
        this.bot.command('task', async (ctx) => this.quest('task', ctx))
        this.bot.command('proposal', async (ctx) => this.quest('proposal', ctx)
        )
        this.bot.command('propose', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('todo', async (ctx) => this.quest('todo', ctx))

        this.bot.command(['need', 'request', 'want', 'wish'], async (ctx) => this.quest('request', ctx))
        this.bot.command(['offer', 'give', 'have', 'gift'], async (ctx) => this.quest('offer', ctx))
        
        // ITALIAN
        this.bot.command('missione', async (ctx) => this.quest('quest', ctx))
        this.bot.command('compito', async (ctx) => this.quest('task', ctx))
        this.bot.command('proposta', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('propongo', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('fare', async (ctx) => this.quest('todo', ctx))

        //create new request/offer
        this.bot.command(['richiedo', 'bisogno', 'vorrei', 'sogno', 'richiesta', 'chiedo'], async (ctx) => this.quest('request', ctx))
        this.bot.command(['offro', 'dono', 'regalo', 'chiedetemi', 'ho', 'offerta'], async (ctx) => this.quest('offer', ctx))

        // QUEST ACTIONS ====================================================

        this.bot.action('join_quest', (ctx) => this.join(ctx));
        this.bot.action('appreciate_quest', (ctx) => this.appreciate(ctx))
        this.bot.action('schedule_quest', (ctx) => this.schedule(ctx));
        this.bot.action('cancel_quest', (ctx) => this.cancel(ctx));
        this.bot.action('complete_quest', (ctx) => this.complete(ctx));
        this.bot.action('stop_quest', (ctx) => this.stop(ctx));

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
            chat: '',
            initiator: sender,
            title: title,
            picture: picture,
            date: new Date().getTime(),
            when: '',
            participants: [],
            appreciation: [],
            stoppers: [],
            type: type,
            status: 'ongoing'
        }
        // // Add the sender to the list of users


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
                await saveUserAction(sender, "offers", quest.title, usersDB)
            }
            if (type == 'request') {
                quest.appreciation.push(sender);
                await saveUserAction(sender, "wants", quest.title, usersDB)
            }
            ctx.reply(createMessage(quest, language), markup(quest, language)).then(async (nctx) => {
                // Add the message id to the quest
                quest._id = nctx.message_id;
                quest.chat = nctx.chat.id;

                questsDB.put(quest)

                //Pin the message
                ctx.telegram.pinChatMessage(quest.chat, quest._id, { disable_notification: true }).catch((err) => { console.log(err) });

                //delete the original message
                ctx.deleteMessage(messageID.toString()).catch((err) => { console.log(err) });
            });
        }

    }


    // ========================== ACTIONS ==========================

    async join(ctx) {
        console.log("JOIN ACTION");
        // Get the index from the callback data
        let chatID = ctx.callbackQuery.message.chat.id;
        let messageID = ctx.callbackQuery.message.message_id;
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
        let chatID = ctx.callbackQuery.message.chat.id;
        let messageID = ctx.callbackQuery.message.message_id;
        const language = await this.settings.getLanguage(chatID)

        let questsDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
        await questsDB.load()

        let quest = await questsDB.get(messageID.toString())[0]

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

        // Get the user who reacted
        const sender = ctx.callbackQuery.from;

        // Check if the user has already appreciated the quest, remove if so
        const appreciationindex = quest.appreciation.findIndex(user => user.id === sender.id)
        if (appreciationindex > -1) {
            ctx.answerCbQuery(`${sender.first_name}'s appreciation for "${quest.title}" has been removed`, { reply_to_message_id: messageID });
            quest.appreciation.splice(appreciationindex, 1);
        } else {
            // Add the user to the quest
            quest.appreciation.push(sender);
            // Send a message to confirm that the user joined the quest
            ctx.answerCbQuery(`${sender.first_name} appreciates the quest "${quest.title}"`, { reply_to_message_id: messageID });
        }
        // Check if the user has already joined the quest
        const userindex = quest.participants.findIndex(user => user.id === sender.id)
        if (userindex > -1) {
            //ctx.answerCbQuery(`${sender.first_name} has been removed from the quest "${quest.title}"`, { reply_to_message_id: messageID });
            quest.participants.splice(userindex, 1);
        }


        // Update the message 
        this.updateMessage(ctx, quest);

        // Update the db
        questsDB.put(quest);
    }

    async cancel(ctx) {
        console.log("CANCEL ACTION");

        let chatID = ctx.callbackQuery.message.chat.id;
        let messageID = ctx.callbackQuery.message.message_id;
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
            ctx.telegram.unpinChatMessage(chatID, messageID).catch((err) => { console.log(err) });
            //delete the telegram message
            ctx.deleteMessage(messageID.toString()).catch((err) => { console.log(err) });

        } else {
            ctx.answerCbQuery(`Only the creator of the quest can cancel the quest.`, { reply_to_message_id: messageID }).catch((err) => { console.log(err) });

        }
    }

    async stop(ctx,) {
        console.log("STOP ACTION");

        let chatID = ctx.callbackQuery.message.chat.id;
        let messageID = ctx.callbackQuery.message.message_id;
        const language = await this.settings.getLanguage(chatID)

        let questsDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
        await questsDB.load()

        let quest = await questsDB.get(messageID.toString())[0]

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

        // Get the user who reacted
        const sender = ctx.callbackQuery.from;

        const stopperindex = quest.stoppers.findIndex(user => user.id === sender.id)
        if (stopperindex > -1) {
            ctx.reply(`${sender.first_name} has revoked its veto for the quest "${quest.title}"`, { reply_to_message_id: messageID });
            quest.stoppers.splice(stopperindex, 1);
        }
        else {
            // Add the user to the quest
            quest.stoppers.push(sender);
            // Send a message to confirm that the user joined the quest
            ctx.reply(`${sender.first_name} has stopped the quest "${quest.title}"`, { reply_to_message_id: messageID });
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

        let chatID = ctx.callbackQuery.message.chat.id;
        let messageID = ctx.callbackQuery.message.message_id;
        const language = await this.settings.getLanguage(chatID)

        let questsDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
        await questsDB.load()

        let quest = await questsDB.get(messageID.toString())[0]

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

        // Handle the reaction to the quest (only initiator or participants can complete the quest)
        if (quest.initiator.id === ctx.from.id || quest.participants.findIndex(user => user.id === ctx.from.id) > -1) {
            quest.status = "completed";
            // Update the message 
            this.updateMessage(ctx, quest);
            // Update the db
            questsDB.put(quest);
            //unpin the message
            ctx.telegram.unpinChatMessage(chatID, messageID).catch((err) => console.log(err))

        } else {
            ctx.answerCbQuery(`Only the initiator of the quest or a participant can mark it as completed.`, { reply_to_message_id: messageID }).catch((err) => { console.log(err) });
            return;
        }
        // ================================ RECORD ACTIONS ========================== 

        let usersDB = await this.orbitdb.docs('WeQuest.' + chatID.toString() + '.users')
        await usersDB.load()

        await saveUserAction(quest.initiator, "initiated", quest.title, usersDB)

        // loop through all users and add the completed quest to their account
        for (let i = 0; i < quest.participants.length; i++) {
            let user = quest.participants[i];
            await saveUserAction(user, "completed", quest.title, usersDB)
        }

        //loop through all users and add appreciation to their account
        for (let i = 0; i < quest.appreciation.length; i++) {
            let sender = quest.appreciation[i];
            appreciation.appreciate(sender, receivers)
            await saveUserAction(sender, "sent", quest.title, usersDB)
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
                await saveUserAction(recipient, "received", quest.title, usersDB)
            }
        }
        // ================================ APPRECIATION ==========================
        ctx.reply(`Quest "${quest.title}" completed! 🎊 `, { reply_to_message_id: messageID });
    }

    async schedule(ctx) {
        console.log("SCHEDULE ACTION");
        this.calendar.startNavCalendar(ctx);
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
                recipent = await ctx.telegram.users.getFullUser(entity.user.id)// ctx.text.substring(entity.offset, entity.offset + entity.length)
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
                ctx.reply(`The user has not interacted with this WeQuest yet. Ask the user to complete a task first.`, { reply_to_message_id: ctx.message.message_id }).catch((err) => { console.log(err) });
                // register the user in the database
                continue;
            }

            // Check if the recipient is the sender
            if (recipient.id === sender.id) {
                ctx.reply(i18next.t(`You cannot send appreciation to yourself.`), { reply_to_message_id: ctx.message.message_id }).catch((err) => { console.log(err) });
                continue;
            }


            // Send the appreciation to the recipient
            //await recieveToken(recipient, 1, usersDB)
            // save the user action
            await saveUserAction(recipient, "received", action, usersDB)
        }

        // Update the sent appreciation of the sender
        //await sendToken(sender, 1, usersDB)
        await saveUserAction(sender, "sent", action, usersDB)
        ctx.reply(`You have sent 1 appreciation to ${mentions.length} ${mentions.length > 1 ? 'users' : 'user'}.`, { reply_to_message_id: ctx.message.message_id }).catch((error) => console.log(error));
    }

    // ============== UTILITY FUNCTIONS
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

    //remind the user that a quest is due
    async remind(ctx, quest) {
        console.log("REMIND ACTION");
        ctx.reply(`⏰ The ${quest.type} "${quest.title}" is starting!`, { reply_to_message_id: quest._id });
    }

    // Function to update messages for a quest
    async updateMessage(ctx, quest, language) {
        try {
            // Update the message 
            if (quest.picture) {
                await ctx.telegram.editMessageMedia(
                    ctx.update.callback_query.message.chat.id,
                    ctx.update.callback_query.message.message_id,
                    null,
                    {
                        type: 'photo',
                        media: quest.picture,
                        caption: createMessage(quest, language)
                    },
                    markup(quest, language)
                );
            }
            else
                await ctx.telegram.editMessageText(
                    ctx.update.callback_query.message.chat.id,
                    ctx.update.callback_query.message.message_id,
                    null,
                    createMessage(quest, language),
                    markup(quest, language)
                );
        } catch (e) {
            console.log(e);
        }
    }

}

// save user action
async function saveUserAction(userobj, type, action, db) {
    console.log('SAVE USER ACTION: ' + type)
    if (!db) return
    let userinfo = await getUserInfo(userobj, db)
    console.log(userinfo)
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

// send appreciation 
async function recieveToken(recipient, amount, db) {
    if (!db) return
    let recipientinfo = await getUserInfo(recipient, db)
    recipientinfo.received += amount;
    await db.put(recipientinfo)
}

async function sendToken(sender, amount, db) {
    if (!db) return
    let senderinfo = await getUserInfo(sender, db)
    senderinfo.sent += amount;
    await db.put(senderinfo)
}



//gets an existing user or  creates a new one
async function getUserInfo(user, db) {
    if (!db) return
    let userinfo = await db.get(user.id)[0]
    // Initialize the receiver's points if they do not exist yet
    if (!userinfo || userinfo == '') {
        userinfo = {
            _id: user.id,
            username: user.username ? user.username : user.id,
            values :[],
            initiated: [],
            received: 0,
            sent: 0,
            wants: [],
            offers: [],
            appreciated: [],
            completed: [],
            collaboration: [],
            hours: 0,
            money: 0
        }
        await db.put(userinfo)
    }
    return userinfo
}




// Function to create the message for a quest TODO 
function createMessage(quest, language) {
    let message = `| ${quest.type.charAt(0).toUpperCase() + quest.type.slice(1)}: ${quest.title} \n`;
    message += `| 💡: @${quest.initiator.username} \n`;
    if (quest.participants.length > 0)
        message += `| 🙋‍♂: ${[...quest.participants].map(u => '@' + u.username).join(', ')} \n`;
    if (quest.appreciation.length > 0)
        message += `| 👍: ${[...quest.appreciation].map(u => '@' + u.username).join(', ')} \n`;
    if (quest.when)
        message += `| 📅: ${quest.when} \n`;
    if (quest.status === "stopped")
        message += `| 🛑: ${[...quest.stoppers].map(u => '@' + u.username).join(', ')} \n`;
    message += `| Status: ${quest.status}\n`;
    return message;
}

function markup(quest, language) {
    let mu = Markup.inlineKeyboard([[
        Markup.button.callback(i18next.t('join', { lng: language }), 'join_quest'),
        Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest')],
    [
        Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest'),
        Markup.button.callback(i18next.t('stop', { lng: language }), 'stop_quest')
    ], [
        Markup.button.callback(i18next.t('cancel', { lng: language }), 'cancel_quest'),
        Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest')
    ]
        // ,[
        //     Markup.button.webApp(i18next.t('Share',{lng:language}), `https://t.me/WeQuestBot?start=${quest._id}`),
        //     Markup.button.webApp(i18next.t('Pick a Time',{lng:language}), `https://robertovalenti.github.io/datepicker/index.html`)
        // ]
    ])

    if (quest.status == 'completed') // only show appreciation button
    {
        mu = Markup.inlineKeyboard([
                    Markup.button.callback(i18next.t('appreciate',{lng:language}), 'appreciate_quest')]
                    )
    }

    // if (quest.type === "request" || quest.type === "offer") {
    //     mu = Markup.inlineKeyboard([[
    //         Markup.button.callback(i18next.t('schedule',{lng:language}), 'schedule_quest'),
    //         Markup.button.callback(i18next.t('participate',{lng:language}), 'join_quest'),
    //         Markup.button.callback(i18next.t('Cancel',{lng:language}), 'cancel_quest'),
    //     ]])
    // }

    if (quest.status === "completed") {
        return null
    }
    else return mu
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
