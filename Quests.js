import { Markup } from 'telegraf';
import i18next from 'i18next';
import { getUserName, getUser, getChatId, getMessageId, capitalize, isAdmin } from './utilities.js';
import { Calendar } from './Calendar.js';
import Users from './Users.js';


export default class Quests {

    constructor(bot, db, settings) {

        this.bot = bot;
        this.db = db;
        this.calendar = new Calendar(bot, {
            date_format: 'YYYY/MM/DD HH:mm:ss',
            time_selector_mod: true,
            language: 'en',
            bot_api: 'telegraf'
        });
        this.settings = settings
        this.users = new Users(bot, db)
        //----------------------------- QUESTS -----------------------------
        this.bot.command('quest', async (ctx) => this.quest('task', ctx))
        this.bot.command('mission', async (ctx) => this.quest('task', ctx))
        this.bot.command('task', async (ctx) => this.quest('task', ctx))
        this.bot.command('event', async (ctx) => this.quest('event', ctx))
        this.bot.command('proposal', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('propose', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('todo', async (ctx) => this.quest('todo', ctx))
        this.bot.command('recurring', async (ctx) => this.quest('recurring', ctx))

        this.bot.command(['need', 'request', 'want', 'wish'], async (ctx) => this.quest('request', ctx))
        this.bot.command(['offer', 'give', 'have', 'gift'], async (ctx) => this.quest('offer', ctx))
        this.bot.command(['idea', 'lesson', 'quote', 'tip', 'fact', 'joke', 'story', 'thought', 'question', 'challenge', 'trigger', 'projection', 'assumption', 'observation', 'rule', 'suggestion', 'guideline', 'feature', 'perspective', 'opinion', 'insight', 'inspiration', 'motivation', 'reminder', 'warning', 'note', 'comment', 'feedback', 'review', 'critique', 'compliment', 'complaint'], async (ctx) => this.quest('any', ctx))
        this.bot.command(['ideas', 'lessons', 'quotes', 'tips', 'facts', 'jokes', 'stories', 'thoughts', 'questions', 'challenges', 'triggers', 'projections', 'assumptions', 'observations', 'rules', 'suggestions', 'guidelines', 'features', 'perspectives', 'opinions', 'insights', 'inspirations', 'motivations', 'reminders', 'warnings', 'notes', 'comments', 'feedbacks', 'reviews', 'critiques', 'compliments', 'complaints'], async (ctx) => this.listanytype(ctx))
        this.bot.command('listtype', async (ctx) => this.listtype(ctx))
        this.bot.command('refresh', async (ctx) => this.refresh(ctx))

        // ITALIAN
        this.bot.command('missione', async (ctx) => this.quest('task', ctx))
        this.bot.command('compito', async (ctx) => this.quest('task', ctx))
        this.bot.command('evento', async (ctx) => this.quest('event', ctx))
        this.bot.command('proposta', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('propongo', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('fare', async (ctx) => this.quest('todo', ctx))
        this.bot.command('ricorrente', async (ctx) => this.quest('recurring', ctx))

        //create new request/offer
        this.bot.command(['richiedo', 'bisogno', 'vorrei', 'sogno', 'richiesta', 'chiedo', 'cerco'], async (ctx) => this.quest('request', ctx))
        this.bot.command(['offro', 'dono', 'regalo', 'chiedetemi', 'ho', 'offerta'], async (ctx) => this.quest('offer', ctx))

        //this.bot.command('lista', async (ctx) => this.list(ctx))

        // QUEST ACTIONS ====================================================

        this.bot.action(/join_quest_(.+)/, (ctx) => this.join(ctx));
        this.bot.action(/appreciate_quest_(.+)/, (ctx) => this.appreciate(ctx))
        this.bot.action(/schedule_quest_(.+)/, (ctx) => this.schedule(ctx));
        this.bot.action(/cancel_quest_(.+)/, (ctx) => this.cancel(ctx));
        this.bot.action(/complete_quest_(.+)/, (ctx) => this.complete(ctx));
        this.bot.action(/stop_quest_(.+)/, (ctx) => this.stop(ctx));

        //--------------------------------------------------------------------
    }
    // this.bot.on('location', async (ctx) => this.location(ctx));
    // async location(ctx) {
    //     console.log("LOCATION ACTION");
    //     let chatID = ctx.message.chat.id;
    //     let messageID = ctx.message.message_id;
    //     let quest = await this.db.get(chatID + '/quests',messageID.toString())
    //     if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }
    //     quest.where = ctx.message.location
    //     this.db.put(chatID + '/quests', quest)
    //     this.updateMessage(ctx, quest)
    // }

    // resends all active tasks in the chat
    async refresh(ctx) {
        let chatID = ctx.message.chat.id;
        let messageID = ctx.message.message_id;
        const language = await this.settings.getLanguage(chatID)
        let quests = await this.db.getAll(chatID + '/quests');
        //quests = ((doc) => doc.status === 'ongoing' || doc.status === 'scheduled')
        if (quests.length === 0) {
            ctx.reply(i18next.t('noquestsfound', { lng: language }));
            return;
        }
        else {
            for (let i = 0; i < quests.length; i++) {
                //delete and unpin existing messages
                await ctx.telegram.unpinChatMessage(chatID, quests[i].id).catch((err) => { });
                await ctx.deleteMessage(quests[i].id.toString()).catch((err) => { });
                //resend the message
                const quest = quests[i];
                await ctx.telegram.sendMessage(chatID, createMessage(quest, language), markup(quest, language)).catch((err) => { console.log(err) }).then(async (nctx) => {
                    this.db.del(chatID + '/quests', quest.id.toString())
                    // Add the message id to the quest
                    quest.id = nctx.message_id;
                    quest.chat = nctx.chat.id;
                    await this.db.put(chatID + '/quests', quest)
                    //Pin the message
                    ctx.telegram.pinChatMessage(quest.chat, quest.id, { disable_notification: true }).catch((err) => { });
                    // update the markup
                    await this.updateMessage(ctx, quest, language)
                })
            }
        }
    }

    async list(ctx) {

        let type = ctx.message.text.split(' ')[1];
        if (type && type[type.length - 1] === 's')
            type = type.slice(0, -1);
        this.listtype(ctx, type)
    }

    async listanytype(ctx) {

    }

    async listtype(ctx) {
        let type = ctx.message.text.split(' ')[0].replace('/', '');
        if (type && type[type.length - 1] === 's')
            type = type.slice(0, -1);

        if (type == undefined) {
            ctx.reply(i18next.t('listtypeusage', { lng: language }));
            return
        }

        console.log("LIST TYPE: " + type);
        let chatID = ctx.message.chat.id;
        let messageID = ctx.message.message_id;
        const language = await this.settings.getLanguage(chatID)
        let quests = await this.db.getAll(chatID + '/quests')
        // quests = quests.filter((doc) => doc.type === type && doc.status === 'ongoing' || doc.status === 'scheduled');
        if (quests.length === 0) {
            ctx.reply(i18next.t('notypefound', { type: type, lng: language }));
            return;
        }
        let message = '*' + capitalize(type) + 's*:\n\n';
        for (let i = 0; i < quests.length; i++) {
            const quest = quests[i];
            if (quest.type == type)
                // link to the quest message
                message += `~${quest.title}~ \t 👍:${quest.appreciation.length} \n`;
            //message += createMessage(quest, language) + '\n';
        }
        ctx.reply(message, { parse_mode: 'Markdown' });
    }


    async quest(type, ctx) {

        console.log('NEW QUEST')
        // Get the message text and sender from the context
        let chatID = ctx.message.chat.id;
        let messageID = ctx.message.message_id;
        const language = await this.settings.getLanguage(chatID)
        const text = ctx.message.text ? ctx.message.text : ctx.message.caption;
        if (type == 'any')
            type = ctx.message.text.split(' ')[0].replace('/', '');
        const sender = ctx.message.from;

        const title = text.split(' ').slice(1).join(' ');
        const picture = ctx.message.photo ? ctx.message.photo[0].file_id : null;

        if (!title) {
            ctx.reply(i18next.t('usage', { type: type, lng: language }))
            return;
        }

        // Get category from chat topic if available
        let category = '';
        if (ctx.message.chat.type === 'supergroup' || ctx.message.chat.type === 'channel') {
            try {
                if (ctx.message.message_thread_id) {
                    // Get forum topic info using correct method name
                    const forumTopicInfo = await ctx.telegram.getForumTopicByID(
                        chatID,
                        ctx.message.message_thread_id
                    );
                    if (forumTopicInfo?.name) {
                        category = forumTopicInfo.name;
                    }
                }
            } catch (err) {
                console.log('Error getting forum topic:', err);
                // Fallback: try to get the thread name directly from the message if available
                if (ctx.message.reply_to_message?.forum_topic_created?.name) {
                    category = ctx.message.reply_to_message.forum_topic_created.name;
                }
            }
        }

        // Create a quest object
        let quest = {
            id: '',
            version: '0.1',
            chat: '',
            initiator: sender,
            title: title,
            picture: picture,
            document: '',
            where: { latitude: '', longitude: '' },
            date: new Date().getTime(),
            when: '',
            completed: '',
            participants: [],
            appreciation: [],
            stoppers: [],
            type: type,
            status: 'ongoing',
            category: category
        }

        if (picture)
            ctx.replyWithPhoto(picture,
                {
                    caption: createMessage(quest, language),
                    parse_mode: 'Markdown',
                    ...markup(quest, language)
                }).catch((err) => { console.log(err) }).then(async (nctx) => {
                    // Add the message id to the quest
                    quest.id = nctx.message_id;
                    quest.chat = nctx.chat.id;
                    this.db.put(chatID + '/quests', quest)
                    //Pin the message
                    ctx.telegram.pinChatMessage(quest.chat, quest.id, { disable_notification: true }).catch((err) => { });
                    // update the markup
                    //await ctx.telegram.editMessageRe(quest.chat, quest.id,null, markup(quest, language)).catch((err) => { console.log(err) });
                    await this.updateMessage(ctx, quest, language)
                    //delete the original message
                    ctx.deleteMessage(messageID.toString()).catch((err) => { });

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
                await this.users.saveUserAction(sender, "offers", quest.title, 0, chatID)
            }
            if (type == 'request') {
                quest.appreciation.push(sender);
                await this.users.saveUserAction(sender, "wants", quest.title, 0, chatID)
            }
            ctx.reply(createMessage(quest, language), markup(quest, language)).then(async (nctx) => {
                if (ctx.platform !== 'discord') {
                    quest.id = nctx.message_id;
                    quest.chat = nctx.chat.id;
                }
                if (ctx.platform == 'discord') {
                    quest.id = nctx.id;
                    quest.chat = nctx.channel.id;
                    return //TODO: remove this by fixing below for multi platforms
                }

                await this.db.put(chatID + '/quests', quest)

                //Pin the message
                ctx.telegram.pinChatMessage(quest.chat, quest.id, { disable_notification: true }).catch((err) => { });
                // update the markup
                //await ctx.telegram.editMessageRe(quest.chat, quest.id,null, markup(quest, language)).catch((err) => { console.log(err) });
                await this.updateMessage(ctx, quest, language)
                //delete the original message
                ctx.deleteMessage(messageID.toString()).catch((err) => { });

                // REPLICATE IN FEDERATED CHATS

                let notifyChats = (await this.db.get('federation', chatID))

                if (!notifyChats || notifyChats == '') { console.log('FEDERATION IS NOT FOUND') }
                else
                    notifyChats = notifyChats.notify

                if (notifyChats && notifyChats.length > 0) {
                    let id = quest.chat * 2 + quest.id //*2 is a hack not to return similar indexes
                    let fedinfo = this.db.get('federation', id)
                    console.log(fedinfo)
                    if (!fedinfo || fedinfo == '' || fedinfo == undefined)
                        fedinfo = { id: id, all: [{ chat: quest.chat.toString(), id: quest.id.toString() }], type: 'quest' }  //TODO UPDATE JSON SCHEMA
                    //TODO CHECK FOR PROMISES TO RETURN
                    for (let i = 0; i < notifyChats.length; i++) {
                        const federatedChat = notifyChats[i];
                        await ctx.telegram.sendMessage(federatedChat, createMessage(quest, language), markup(quest, language)).catch((err) => { console.log(err) }).then(async (fctx) => {
                            // save the federated message id
                            fedinfo.all.push({ chat: federatedChat.toString(), id: fctx.message_id.toString() })
                        })
                    }
                    console.log(fedinfo)
                    this.db.put('federation', fedinfo) // Add federated message ids to the DB
                }
            })
        }
    }


    // ========================== ACTIONS ==========================

    async join(ctx) {
        console.log("JOIN ACTION");
        try {
            let chatID = ctx.callbackQuery.data.split('_')[2];
            let messageID = ctx.callbackQuery.data.split('_')[3];
            console.log(ctx.callbackQuery.data)

            const language = await this.settings.getLanguage(chatID)

            let quest = await this.db.get(chatID + '/quests', messageID.toString())

            if (!quest) {
                console.log('QUEST IS NOT FOUND');
                ctx.answerCbQuery('Quest not found').catch(err => console.error('Error answering callback query:', err));
                return;
            }

            if (quest.status == 'completed') {
                ctx.answerCbQuery(`Quest "${quest.title}" has already been completed`, { reply_to_message_id: messageID })
                    .catch(err => console.error('Error answering callback query:', err));
                return;
            }
            console.log("Quest:", quest)

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
            this.updateMessage(ctx, quest, language);

            // Update the db
            this.db.put(chatID + '/quests', quest);
        } catch (error) {
            console.error('Error in join function:', error);

        }
    }

    async appreciate(ctx) {
        console.log("APPRECIATE ACTION");
        // Get the quest  from the callback data
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

        // Get the user who reacted
        const sender = ctx.callbackQuery.from;

        // Check if the user has already joined the quest, remove it
        const userindex = quest.participants.findIndex(user => user.id === sender.id)
        if (userindex > -1) {
            //ctx.answerCbQuery(`${sender.first_name} has been removed from the quest "${quest.title}"`, { reply_to_message_id: messageID });
            if (quest.status === "completed") {
                ctx.answerCbQuery(`You cannot appreciate a ${quest.type} that you participated in`);
                return;
            }
            quest.participants.splice(userindex, 1);
        }

        // Check if the user has already appreciated the quest, remove if so
        const appreciationindex = quest.appreciation.findIndex(user => user.id === sender.id)
        if (appreciationindex > -1) {
            if (quest.status === "completed") {
                ctx.answerCbQuery(`You have already appreciated this ${quest.type}`);
            }
            else {
                ctx.answerCbQuery(`${sender.first_name}'s appreciation for "${quest.title}" has been removed`);
                quest.appreciation.splice(appreciationindex, 1);
            }
        } else {
            // Add the user to the quest
            quest.appreciation.push(sender);
            // Send a message to confirm that the user joined the quest
            ctx.answerCbQuery(`${sender.first_name} appreciates the quest "${quest.title}"`);
            // share appreciation "after the fact"
            if (quest.status === "completed") {
                await this.users.saveUserAction(sender, "sent", quest.title, 0, chatID)
                for (let i = 0; i < quest.participants.length; i++) {
                    console.log(quest.participants.length)
                    if (quest.participants[i]?.id) { //TODO: check why this is needed sometimes otherwise it crashes
                        await this.users.saveUserAction(quest.participants[i], "received", quest.title, 0, chatID)
                    } else {
                        console.log('Bug: participant has no id: ' + quest.participants[i])
                    }
                }
            }
        }


        // Update the message 
        this.updateMessage(ctx, quest, language);

        // Update the db
        this.db.put(chatID + '/quests', quest);
    }

    async cancel(ctx) {
        console.log("CANCEL ACTION");

        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

        // Handle the reaction to the quest
        if (quest.initiator.id === ctx.from.id || isAdmin(ctx.from.id, chatID)) {
            //delete quest from database
            this.db.del(chatID + '/quests', messageID.toString())

            //unpin the message
            ctx.telegram.unpinChatMessage(chatID, messageID).catch((err) => { });
            //delete the telegram message
            ctx.deleteMessage(messageID.toString()).catch((err) => { });

        } else {
            ctx.answerCbQuery(i18next.t('onlyinitatorcancel', { lng: language }), { reply_to_message_id: messageID })

        }
    }

    async stop(ctx,) {
        console.log("STOP ACTION");

        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())

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
        this.updateMessage(ctx, quest, language);

        // Update the db
        this.db.put(chatID + '/quests', quest);
    }


    async complete(ctx) {
        console.log("COMPLETE ACTION");

        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }
        if (!quest.status == 'stopped') { ctx.answerCbQuery(i18next.t('cannotcompletestopped', { lng: language }), { reply_to_message_id: messageID })
            return 
        }
        // Handle the reaction to the quest (only initiator or participants can complete the quest)
        if (quest.initiator.id === ctx.from.id || quest.participants.findIndex(user => user.id === ctx.from.id) > -1 || isAdmin(ctx.from.id, chatID)) {
            quest.status = "completed";
            // Update the message 
            this.updateMessage(ctx, quest, language);
            // Update the db
            this.db.put(chatID + '/quests', quest);
            //unpin the message
            ctx.telegram.unpinChatMessage(chatID, messageID).catch((err) => { })

        } else {
            ctx.answerCbQuery(i18next.t('onlyinitiatorcomplete', { lng: language }))
            return;
        }
        // ================================ RECORD ACTIONS ========================== 

        await this.users.saveUserAction(quest.initiator, "initiated", quest.title, 0, chatID)

        // loop through all users and add the completed quest to their account
        for (let i = 0; i < quest.participants.length; i++) {
            let user = quest.participants[i];
            await this.users.saveUserAction(user, "completed", quest.title, 0, chatID)
        }

        //loop through all users and add appreciation to their account
        for (let i = 0; i < quest.appreciation.length; i++) {
            let sender = quest.appreciation[i];
            // appreciation.appreciate(sender, receivers)
            await this.users.saveUserAction(sender, "sent", quest.title, 0, chatID)
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
                //await recieveToken(recipient, appreciationPerUser, chatID)
                // save user with action to the database
                await this.users.saveUserAction(recipient, "received", quest.title, 0, chatID)
            }
        }
        // ================================ APPRECIATION ==========================
        ctx.reply(`Quest "${quest.title}" completed! 🎊 `, { reply_to_message_id: messageID }).catch((err) => { });
    }

    async schedule(ctx) {
        console.log("SCHEDULE ACTION");
        let language = await this.settings.getLanguage(ctx.callbackQuery.message.chat.id)
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];
        this.calendar.startNavCalendar(ctx, language);//TODO: pass quest information to recreate message
        this.calendar.chats.set(getChatId(ctx) * 100, getMessageId(ctx)); //TODO: fix this, use a different method to store the message id
    }

    async sendAppreciation(ctx) {
        console.log("SEND APPRECIATION ACTION");

        const chatID = ctx.message.chat.id;
        const language = await this.settings.getLanguage(chatID)
        const sender = getUser(ctx);
        const entities = ctx.message.entities;

        // Setup the necessary databases
        const mentions = entities.filter((entity) => (entity.type === 'mention' || entity.type === 'text_mention'));
        if (mentions.length === 0) {
            ctx.reply(i18next.t('appreciationusage', { lng: language }), { reply_to_message_id: ctx.message.message_id });
            return
        }

        const lastMention = mentions[mentions.length - 1];
        let action = ctx.message.text.substring(lastMention.offset + lastMention.length).trim();

        if (action.startsWith('for')) {
            action = action.substring(3).trim();
        }

        if (action === '') { action = 'appreciated' }
        let receivers = mentions.length
        // Check if the message contains a mention
        for (let i = 0; i < mentions.length; i++) {
            const entity = mentions[i];
            let recipient = {}
            let username = ctx.message.text.substring(entity.offset + 1, entity.offset + entity.length)
            if (entity.type === 'text_mention')
                recipent = await ctx.telegram.getFullUser(entity.user.id)// ctx.text.substring(entity.offset, entity.offset + entity.length)
            if (entity.type === 'mention') {
                // get the user from the database
                recipient = await this.users.getUsers(chatID).then(users => users.filter(user => user.username === username)[0])
                // recipient = await this.db.query((user) => user.username == username)[0]
            }

            // if ( !recipient || recipient == ''|| !recipient.id) { 
            //     recipient = {}
            //     recipient.id = ctx.message.text.substring(entity.offset + 1, entity.offset + entity.length)
            //     recipient.first_name = ctx.message.text.substring(entity.offset + 1, entity.offset + entity.length)
            // }

            if (!recipient || recipient == '') {
                ctx.reply(i18next.t(`appreciationunknownuser`, { lng: language, user: username })).catch((err) => { });
                receivers -= 1;
                // register the user in the database
                return;
            }

            if (entity.type === 'mention')
                recipient = { id: recipient.id ? recipient.id : recipient.id, username: recipient.username, first_name: recipient.username }

            // Check if the recipient is the sender
            if (recipient.id === sender.id) {
                ctx.reply(i18next.t("appreciationself", { lng: language })).catch((err) => { });
                receivers -= 1;
                return;
            }


            // Send the appreciation to the recipient
            //await recieveToken(recipient, 1, chatID)
            // save the user action
            await this.users.saveUserAction(recipient, "received", action, 1, chatID)
        }

        // Update the sent appreciation of the sender
        //await sendToken(sender, 1, chatID)
        if (receivers > 0) {
            await this.users.saveUserAction(sender, "sent", action, 1, chatID)
            ctx.reply(i18next.t('appreciationsuccess', { lng: language, sender: sender.username, receivers: receivers, action: action })).catch((error) => console.log(error));
        }
        else
            ctx.reply(i18next.t('appreciationfailed', { lng: language }), { reply_to_message_id: ctx.message.message_id });
    }

    // ============== UTILITY FUNCTIONS


    //remind the user that a quest is due
    async remind(ctx, quest) {
        console.log("REMIND ACTION");
        let language = await this.settings.getLanguage(ctx.callbackQuery.message.chat.id)
        //TODO Notify federated chats
        ctx.reply(i18next.t("taskstarting", { quest: quest, lng: language }), { reply_to_message_id: quest.id });
    }

    // Function to update messages for a quest
    async updateMessage(ctx, quest, language) {
        let fedinfo = await this.db.get('federation', quest.chat * 2 + quest.id) //* 2 hack not to return similar 
        let message_id
        let chat_id
        if (language == undefined || language == '') {
            language = await this.settings.getLanguage(quest.chat)
        }
        if (!fedinfo || fedinfo == '') {
            message_id = quest.id
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

        } else {
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

// Function to create the message for a quest 
function createMessage(quest, language) {
    let message = `| ${i18next.t(quest.type.charAt(0).toUpperCase() + quest.type.slice(1), { lng: language })}: ${quest.title.padEnd(30, ' ')} \n`;
    // Add category to message if it exists
    if (quest.category) {
        message += `| 📑 ${i18next.t('category', { lng: language })}: ${quest.category} \n`;
    }
    //message += `| ${i18next.t('💡',{lng:language})} : @${quest.initiator.username} \n`;
    // if (quest.participants.length > 0)
    //     message += `| ${i18next.t('🙋‍♂',{lng:language})} : ${[...quest.participants].map(u => '@' + u.username).join(', ')} \n`;
    // if (quest.appreciation.length > 0)
    //     message += `| ${i18next.t('👍',{lng:language})} : ${[...quest.appreciation].map(u => '@' + u.username).join(', ')} \n`;
    if (quest.participants.length > 0)
        message += `| ${i18next.t('🙋‍♂', { lng: language })} : ${[...quest.participants].map(u => u.first_name + ' ' + u.last_name?.slice(0, 1) + '.').join(', ')} \n`;
    if (quest.appreciation.length > 0)
        message += `| ${i18next.t('👍', { lng: language })} : ${[...quest.appreciation].map(u => u.first_name + ' ' + u.last_name?.slice(0, 1) + '.').join(', ')} \n`;
    if (quest.when)
        message += `| ${i18next.t('📅', { lng: language })} : ${quest.when} \n`;
    if (quest.where?.lat)
        message += `| ${i18next.t('📍 ', { lng: language })}: ${quest.where.lat} : ${quest.where.lon}   \n`;
    if (quest.status === "stopped")
        message += `| ${i18next.t('🛑', { lng: language })} : ${[...quest.stoppers].map(u => '@' + u.username).join(', ')} \n`;
    message += `| ${i18next.t('🚥', { lng: language })} : ${i18next.t(quest.status, { lng: language })}\n`;
    return message;
}

function markup(quest, language) {

    let mu

    if (quest.type == 'task' || quest.type == 'quest' || quest.type == 'todo' || quest.type == 'mission' || quest.type == 'compito') {
        mu = Markup.inlineKeyboard([
            [
                Markup.button.callback(i18next.t('join', { lng: language }), 'join_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id)
            ],
            [
                Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('stop', { lng: language }), 'stop_quest_' + quest.chat + '_' + quest.id)
            ],
            [
                Markup.button.callback(i18next.t('cancel', { lng: language }), 'cancel_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest.id)
            ]//,
            // [
            //     Markup.button.webapp(i18next.t('Set Location', { lng: language }), `https://hexamap.holons.io?quest=${quest.id}`)
            // ]
            // ,[
            //     Markup.button.webApp(i18next.t('Share',{lng:language}), `https://t.me/WeQuestBot?start=${quest.id}`),
            //     Markup.button.webApp(i18next.t('Pick a Time',{lng:language}), `https://robertovalenti.github.io/datepicker/index.html`)
            // ]
        ])
    }

    if (quest.type == 'event') {
        mu = Markup.inlineKeyboard([
            [
                Markup.button.callback(i18next.t('join', { lng: language }), 'join_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id)
            ],
            [
                Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest.id)
            ]
            // [
            //     Markup.button.webApp(i18next.t('Set Location', { lng: language }), `https://hexamap.holons.io?quest=${quest.id}`)
            // ]
        ])
    }

    if (quest.type == 'proposal') {
        mu = Markup.inlineKeyboard([
            [
                Markup.button.callback(i18next.t('agree', { lng: language }), 'join_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('stop', { lng: language }), 'stop_quest_' + quest.chat + '_' + quest.id)
            ],
            [
                Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('cancel', { lng: language }), 'cancel_quest_' + quest.chat + '_' + quest.id)
            ]
        ])
    }

    if (quest.type == 'idea' || quest.type == 'lesson' || quest.type == 'quote' || quest.type == 'tip' || quest.type == 'fact' || quest.type == 'joke' || quest.type == 'story' || quest.type == 'thought' || quest.type == 'question' || quest.type == 'challenge' || quest.type == 'advice' || quest.type == 'trigger' || quest.type == 'projection' || quest.type == 'assumption' || quest.type == 'observation' || quest.type == 'rule' || quest.type == 'suggestion' || quest.type == 'guideline' || quest.type == 'feature' || quest.type == 'perspective' || quest.type == 'opinion' || quest.type == 'insight' || quest.type == 'inspiration' || quest.type == 'motivation' || quest.type == 'reminder' || quest.type == 'warning' || quest.type == 'alert' || quest.type == 'note' || quest.type == 'comment' || quest.type == 'feedback' || quest.type == 'review' || quest.type == 'critique' || quest.type == 'compliment' || quest.type == 'complaint')
        mu = Markup.inlineKeyboard([
            [
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id)
            ]
        ])


    if (quest.type == 'offer' || quest.type == 'request') {
        mu = Markup.inlineKeyboard([
            [
                Markup.button.callback(i18next.t('accept', { lng: language }), 'join_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest_' + quest.chat + '_' + quest.id)
            ],
            [
                Markup.button.callback(i18next.t('cancel', { lng: language }), 'cancel_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest.id),
            ]
        ])
    }

    if (quest.status === "completed") // only show appreciation button
    {
        mu = Markup.inlineKeyboard(
            [
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id)
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
