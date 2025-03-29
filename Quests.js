import { Markup } from 'telegraf';
import i18next from 'i18next';
import { getUserName, getUser, getChatId, getMessageId, capitalize, isAdmin, getDisplayName } from './utilities.js';
import { Calendar } from './Calendar.js';
import Users from './Users.js';
import { Scenes } from 'telegraf';


export default class Quests {

    constructor(bot, db, users, settings) {

        this.bot = bot;
        this.db = db;
        this.calendar = new Calendar(bot, {
            date_format: 'YYYY/MM/DD HH:mm:ss',
            time_selector_mod: true,
            language: 'en',
            bot_api: 'telegraf'
        });
        this.settings = settings
        this.users = users
        this.expenses = null // Will be set from outside after construction
        this.checklists = null // Will be set from outside after construction

        // Initialize scenes
        this.descriptionScene = new Scenes.BaseScene('description_scene');
        this.setupDescriptionScene();
        this.bot.stage.register(this.descriptionScene);

        //----------------------------- QUESTS -----------------------------
        this.bot.command('delete', async (ctx) => this.delete(ctx))
        this.bot.command('quest', async (ctx) => this.quest('task', ctx))
        this.bot.command('mission', async (ctx) => this.quest('task', ctx))
        this.bot.command('task', async (ctx) => this.quest('task', ctx))
        this.bot.command('event', async (ctx) => this.quest('event', ctx))
        this.bot.command('proposal', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('propose', async (ctx) => this.quest('proposal', ctx))
        this.bot.command('todo', async (ctx) => this.quest('todo', ctx))

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

        //create new request/offer
        this.bot.command(['richiedo', 'bisogno', 'vorrei', 'sogno', 'richiesta', 'chiedo', 'cerco'], async (ctx) => this.quest('request', ctx))
        this.bot.command(['offro', 'dono', 'regalo', 'chiedetemi', 'ho', 'offerta'], async (ctx) => this.quest('offer', ctx))

        // QUEST ACTIONS ====================================================

        this.bot.action(/participate_quest_(.+)/, (ctx) => {return this.join(ctx);});
        this.bot.action(/appreciate_quest_(.+)/, (ctx) => this.appreciate(ctx))
        this.bot.action(/schedule_quest_(.+)/, (ctx) => this.schedule(ctx));
        this.bot.action(/cancel_quest_(.+)/, (ctx) => this.cancel(ctx));
        this.bot.action(/complete_quest_(.+)/, (ctx) => this.complete(ctx));
        this.bot.action(/stop_quest_(.+)/, (ctx) => this.stop(ctx));
        this.bot.action(/more_actions_(.+)/, (ctx) => this.showMoreActions(ctx));
        this.bot.action(/less_actions_(.+)/, (ctx) => this.hideMoreActions(ctx));
        this.bot.action(/publish_quest_(.+)/, (ctx) => this.publish(ctx));
        this.bot.action(/broadcast_quest_(.+)/, (ctx) => this.broadcast(ctx));
        this.bot.action(/add_time_quest_(.+)/, (ctx) => this.addTime(ctx));
        this.bot.action(/subtract_time_quest_(.+)/, (ctx) => this.subtractTime(ctx));

        // Add checklist action handler
        this.bot.action(/checklist_quest_(.+)/, (ctx) => this.handleChecklistButton(ctx));
        this.bot.action(/check_(.+)/, (ctx) => this.handleCheckItem(ctx));
        this.bot.action(/add_item_to_(.+)/, (ctx) => this.handleAddItem(ctx));

        // Add description action handler
        this.bot.action(/description_quest_(.+)/, (ctx) => this.handleDescription(ctx));
        
        // Add dependency action handlers
        this.bot.action(/dependencies_quest_(.+)/, (ctx) => this.handleDependenciesButton(ctx));
        this.bot.action(/set_dependency_(.+)/, (ctx) => this.handleSetDependency(ctx));
        this.bot.action(/back_from_dependencies_(.+)/, (ctx) => this.backFromDependencies(ctx));
        this.bot.action(/remove_dependency_(.+)/, (ctx) => this.handleRemoveDependency(ctx));
        
        // Add recurring action handlers
        this.bot.action(/recurring_quest_(.+)/, (ctx) => this.handleRecurringButton(ctx));
        this.bot.action(/stop_recurring_(.+)/, (ctx) => this.handleStopRecurring(ctx));

        // Add scheduler reference
        this.scheduler = null; // This should be set from outside after construction
    }

    // Method to set scheduler reference
    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    async delete(ctx) {
        console.log("DELETE ACTION");
        let chatID = ctx.message.chat.id;
        let messageID = ctx.message.text.split(' ')[1];
        this.db.del(chatID + '/quests', messageID.toString())
        ctx.reply('Quest deleted')
    }

    // Find the method that handles calendar date selection and add:
    async handleCalendarDate(ctx, date) {
        // ... existing date handling code ...

        // If this is a recurring task, update its schedule
        if (ctx.quest?.type === 'recurring') {
            await this.scheduler?.updateTaskSchedule(
                ctx.quest.chat,
                ctx.quest.title,
                date
            );
        }

        // ... rest of the date handling code ...
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
                await ctx.telegram.sendMessage(chatID, await this.createMessage(quest, language), await this.markup(quest, language)).catch((err) => { console.log(err) }).then(async (nctx) => {
                    this.db.del(chatID + '/quests', quest.id.toString())
                    // Add the message id to the quest
                    quest.id = nctx.message_id;
                    quest.chat = nctx.chat.id;

                    //Pin the message
                    ctx.telegram.pinChatMessage(quest.chat, quest.id, { disable_notification: true }).catch((err) => { });

                    // Update message and propagate to federated spaces
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
        let chatID = getChatId(ctx);
        let messageID = getMessageId(ctx);
        console.log('CHAT ID: ' + chatID)
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
        if (ctx.message?.chat?.type) 
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
            chat: chatID,  // Initialize with the chat ID immediately
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
            dependencies: [], // Initialize empty dependencies array
            frequency: null, // Initialize with no recurring frequency
            recurringTaskId: null, // Initialize with no recurring task reference
            type: type,
            status: 'ongoing',
            category: category,
            timeTracking: {}, // Add time tracking object to store user contributions
            checklistId: null, // Add checklist ID field
            reminderId: null // Add reminder ID field
        }


        if (picture)
            ctx.replyWithPhoto(picture,
                {
                    caption: await this.createMessage(quest, language),
                    parse_mode: 'Markdown',
                    ...this.markup(quest, language)
                }).catch((err) => { console.log(err) }).then(async (nctx) => {
                    // Add the message id to the quest
                    quest.id = nctx.message_id;
                    // Only update chat ID if it's valid and not already set
                    if (!quest.chat && nctx.chat.id) {
                        quest.chat = nctx.chat.id;
                    }
                    console.log('Saving quest with ID:', quest.id, 'and chat ID:', quest.chat);
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

            // Send message and get the message ID
            const nctx = await ctx.reply(await this.createMessage(quest, language), this.markup(quest, language));

            if (ctx.platform !== 'discord') {
                quest.id = nctx.message_id;
                // Only update chat ID if it's valid and not already set correctly
                if (!quest.chat || quest.chat === 0) {
                    quest.chat = nctx.chat.id;
                }
            }
            if (ctx.platform == 'discord') {
                quest.id = nctx.id;
                // Only update chat ID if it's valid and not already set correctly
                if (!quest.chat || quest.chat === 0) {
                    quest.chat = nctx.channel.id;
                }
            }

            console.log('Saving quest with ID:', quest.id, 'and chat ID:', quest.chat);
            await this.db.put(chatID + '/quests', quest)
            //update the new message
            await this.updateMessage(ctx, quest, language)
            
            //Pin the message
            this.bot.telegram.pinChatMessage(quest.chat, quest.id, { disable_notification: true }).catch((err) => { });

            //delete the original message
            this.bot.telegram.deleteMessage(chatID, messageID.toString()).catch((err) => { });

            return quest
        }
    }


    // ========================== ACTIONS ==========================

    async join(ctx) {
        console.log("JOIN ACTION - START");
        console.log("Callback data:", ctx.callbackQuery.data);
        try {
            let chatID = ctx.callbackQuery.data.split('_')[2];
            let messageID = ctx.callbackQuery.data.split('_')[3];
    
            const language = await this.settings.getLanguage(chatID)

            let quest = await this.db.get(chatID + '/quests', messageID.toString())
    
          

            if (!quest) {
                console.log('QUEST IS NOT FOUND');
                ctx.answerCbQuery('Quest not found').catch(err => console.error('Error answering callback query:', err));
                return;
            }

            if (quest.status == 'completed') {
                console.log("Quest already completed");
                ctx.answerCbQuery(`Quest "${quest.title}" has already been completed`, { reply_to_message_id: messageID })
                    .catch(err => console.error('Error answering callback query:', err));
                return;
            }

            // Make sure participants array exists
            if (!quest.participants) {
                quest.participants = [];
            }

            // Get the user who reacted
            const sender = ctx.callbackQuery.from;

            // Check if the user has already joined the quest
            const userindex = quest.participants.findIndex(user => user.id === sender.id)

            
            if (userindex > -1) {
                ctx.answerCbQuery(`${getDisplayName(sender)} left the quest "${quest.title}"`)
                    .catch((err) => { console.log(err) });
                quest.participants.splice(userindex, 1);
            } else {
                quest.participants.push(sender);
                ctx.answerCbQuery(`${getDisplayName(sender)} has joined the quest "${quest.title}"`)
                    .catch((err) => { console.log(err) });
            }

            // Check if the user has already appreciated the quest, remove if so
            if (!quest.appreciation) {
                quest.appreciation = [];
            }
            const appreciationindex = quest.appreciation.findIndex(user => user.id === sender.id)
            if (appreciationindex > -1) {
                quest.appreciation.splice(appreciationindex, 1);
            }

            // Save the updated quest to the database first
            await this.db.put(chatID + '/quests', quest);

            // Update message and propagate to federated spaces
            await this.updateMessage(ctx, quest, language);

        } catch (error) {
            console.error('Error in join function:', error);
            ctx.answerCbQuery("Error processing join action").catch(err => console.log(err));
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
            } else {
                ctx.answerCbQuery(`${getDisplayName(sender)}'s appreciation for "${quest.title}" has been removed`);
                quest.appreciation.splice(appreciationindex, 1);
            }
        } else {
            // Add the user to the quest
            quest.appreciation.push(sender);
            // Send a message to confirm that the user joined the quest
            ctx.answerCbQuery(`${getDisplayName(sender)} appreciates the quest "${quest.title}"`);
        }


        // Update message 
        await this.updateMessage(ctx, quest, language);
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
            try {
                // Cancel any scheduled reminder
                if (quest.reminderId && this.scheduler) {
                    console.log(`Cancelling reminder ${quest.reminderId} for quest being deleted`);
                    await this.scheduler.cancelReminder(quest.reminderId);
                }
                
                // First, check if there are federated messages for this quest
                const federationKey = `${chatID}_${messageID}_fedmsgs`;
                const federatedMessages = await this.db.get('federation_messages', federationKey);

                // If there are federated messages, unpin and delete them
                if (federatedMessages && federatedMessages.messages && federatedMessages.messages.length > 0) {
                    for (const msgInfo of federatedMessages.messages) {
                        try {
                            // Unpin the message
                            await ctx.telegram.unpinChatMessage(msgInfo.chatId, msgInfo.messageId)
                                .catch(err => { });

                            // Delete the message
                            await ctx.telegram.deleteMessage(msgInfo.chatId, msgInfo.messageId)
                                .catch(err => console.error(`Error deleting message in federated chat ${msgInfo.chatId}:`, err));

                            console.log(`Removed federated message in chat ${msgInfo.chatId}`);
                        } catch (error) {
                            console.error(`Failed to remove federated message in chat ${msgInfo.chatId}:`, error);
                        }
                    }

                    // Remove the federation messages tracking record
                    await this.db.del('federation_messages', federationKey);
                }

                // Now delete quest from database
                this.db.del(chatID + '/quests', messageID.toString());

                // Unpin the original message
                ctx.telegram.unpinChatMessage(chatID, messageID).catch((err) => { });

                // Delete the telegram message
                ctx.deleteMessage(messageID.toString()).catch((err) => { });
            } catch (error) {
                console.error('Error cancelling quest and its federated messages:', error);
            }
        } else {
            ctx.answerCbQuery(i18next.t('onlyinitatorcancel', { lng: language }), { reply_to_message_id: messageID });
        }
    }

    async stop(ctx) {
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
            ctx.reply(`${getDisplayName(sender)} has revoked its veto for the quest "${quest.title}"`,
                { reply_to_message_id: messageID }).catch((err) => { console.log(err) });
            quest.stoppers.splice(stopperindex, 1);
        } else {
            quest.stoppers.push(sender);
            ctx.reply(`${getDisplayName(sender)} has stopped the quest "${quest.title}". Please get in touch to address any concerns.`,
                { reply_to_message_id: messageID }).catch((err) => { console.log(err) });
        }
        if (quest.stoppers.length > 0)
            quest.status = 'stopped'
        else
            quest.status = 'ongoing'

        // Update the message 
        await this.updateMessage(ctx, quest, language);
    }


    async complete(ctx) {
        console.log("COMPLETE ACTION");

        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())

        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }
        if (!quest.status == 'stopped') {
            ctx.answerCbQuery(i18next.t('cannotcompletestopped', { lng: language }), { reply_to_message_id: messageID })
            return
        }
        // Handle the reaction to the quest (only initiator or participants can complete the quest)
        if (quest.initiator.id === ctx.from.id || quest.participants.findIndex(user => user.id === ctx.from.id) > -1 || isAdmin(ctx.from.id, chatID)) {
            quest.status = "completed";

            // Cancel any scheduled reminder
            if (quest.reminderId && this.scheduler) {
                console.log(`Cancelling reminder ${quest.reminderId} for completed quest`);
                await this.scheduler.cancelReminder(quest.reminderId);
                delete quest.reminderId;
            }

            // Create expense entries for all time tracked
            if (quest.timeTracking) {
                for (const [userID, hours] of Object.entries(quest.timeTracking)) {
                    if (hours > 0) {
                        // Create expense entry for the time logged, using chatID for splitWith
                        await this.expenses.addExpense(
                            messageID, // Unique ID
                            chatID,
                            hours, // Total hours logged
                            'hour',
                            quest.title,
                            userID,
                            [chatID]
                        );
                    }
                }
            }

            // Update the message and propagate to federated spaces
            await this.updateMessage(ctx, quest, language);

            // Unpin the message and any federated messages
            ctx.telegram.unpinChatMessage(chatID, messageID).catch((err) => { });

            // Also unpin any federated messages for this quest
            try {
                const federationKey = `${chatID}_${messageID}_fedmsgs`;
                const federatedMessages = await this.db.get('federation_messages', federationKey);

                if (federatedMessages && federatedMessages.messages && federatedMessages.messages.length > 0) {
                    for (const msgInfo of federatedMessages.messages) {
                        try {
                            // Unpin the federated message
                            await ctx.telegram.unpinChatMessage(msgInfo.chatId, msgInfo.messageId)
                                .catch(err => console.error(`Error unpinning completed quest in federated chat ${msgInfo.chatId}:`, err));

                            console.log(`Unpinned completed quest in federated chat ${msgInfo.chatId}`);
                        } catch (error) {
                            console.error(`Failed to unpin completed quest in federated chat ${msgInfo.chatId}:`, error);
                        }
                    }
                }
            } catch (error) {
                console.error('Error handling federated messages for completed quest:', error);
            }

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
        const chatID = ctx.callbackQuery.message.chat.id;
        const questID = ctx.callbackQuery.data.split('_')[3];

        try {
            // Verify quest exists
            const quest = await this.db.get(`${chatID}/quests`, questID);
            if (!quest) {
                console.log(`Quest ${questID} not found`);
                await ctx.answerCbQuery('Could not find the task');
                return;
            }

            // Cancel any existing reminder
            if (quest.reminderId && this.scheduler) {
                console.log(`Cancelling existing reminder ${quest.reminderId} before rescheduling`);
                await this.scheduler.cancelReminder(quest.reminderId);
                delete quest.reminderId;
                await this.db.put(`${chatID}/quests`, quest);
            }

            // Pass the ctx object to showCalendar
            await this.scheduler.showCalendar(ctx, questID);
            await ctx.answerCbQuery();

        } catch (error) {
            console.error('Error in schedule:', error);
            await ctx.answerCbQuery('Error showing calendar');
        }
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
            ctx.reply(i18next.t('appreciationsuccess', {
                lng: language,
                sender: getDisplayName(sender),
                receivers: receivers,
                action: action
            })).catch((error) => console.log(error));
        }
        else
            ctx.reply(i18next.t('appreciationfailed', { lng: language }), { reply_to_message_id: ctx.message.message_id });
    }

    // ============== UTILITY FUNCTIONS


    //remind the user that a quest is due
    async remind(ctx, quest) {
        console.log("REMIND ACTION for quest:", quest.id);
        
        try {
            // Get chat ID either from context or quest
            let chatId;
            if (ctx.callbackQuery && ctx.callbackQuery.message) {
                chatId = ctx.callbackQuery.message.chat.id;
            } else if (quest.chat) {
                chatId = quest.chat;
            } else {
                console.error("Cannot determine chat ID for reminder");
                return;
            }
            
            // Get language for the chat
            const language = await this.settings.getLanguage(chatId);
            
            // Create reply function if not available
            const reply = ctx.reply || (
                (text, options) => {
                    if (ctx.telegram) {
                        return ctx.telegram.sendMessage(chatId, text, options);
                    } else {
                        console.error("No telegram instance available for sending reminder");
                        return null;
                    }
                }
            );
            
            // Send reminder message
            console.log(`Sending reminder for task "${quest.title}" in chat ${chatId}`);
            
            // Determine which message ID to reply to
            let replyMessageId = quest.id;
            
            // Send the reminder
            await reply(
                i18next.t("taskstarting", { 
                    quest: quest, 
                    lng: language, 
                    defaultValue: `🔔 Reminder: "${quest.title}" is starting now!` 
                }), 
                { reply_to_message_id: replyMessageId }
            );
            
            console.log(`Reminder sent successfully for quest ${quest.id}`);
            
            // If the quest has federated messages, send reminders there too
            if (quest.federated && quest.federated.length > 0) {
                for (const fed of quest.federated) {
                    try {
                        if (ctx.telegram) {
                            await ctx.telegram.sendMessage(
                                fed.chat,
                                i18next.t("taskstarting", { 
                                    quest: quest, 
                                    lng: language, 
                                    defaultValue: `🔔 Reminder: "${quest.title}" is starting now!` 
                                }),
                                { reply_to_message_id: fed.message_id }
                            );
                            console.log(`Sent federated reminder to chat ${fed.chat}`);
                        }
                    } catch (error) {
                        console.error(`Error sending federated reminder to ${fed.chat}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error("Error in remind method:", error);
        }
    }

    // Function to update messages for a quest
    async updateMessage(ctx, quest, language) {
        try {
            if (!quest) {
                console.log("ERROR: Quest is null in updateMessage");
                return;
            }
            
            if (!quest.chat || !quest.id) {
                console.log("ERROR: Quest missing chat or id:", quest);
                return;
            }
            
            if (language == undefined || language == '') {
               
                language = await this.settings.getLanguage(quest.chat);
            }


            const message = await this.createMessage(quest, language);
            const markup = this.markup(quest, language);

            // Update the message in original chat
            if (quest.picture) {
                await ctx.telegram.editMessageMedia(
                    quest.chat,
                    quest.id,
                    null,
                    {
                        type: 'photo',
                        media: quest.picture,
                        caption: message
                    },
                    markup
                ).catch((err) => { 
                    console.error('Error updating media message:', err);
                    // Try alternative approach if this fails
                    return ctx.telegram.editMessageText(
                        quest.chat,
                        quest.id,
                        null,
                        message,
                        markup
                    ).catch(innerErr => console.error('Alternative update also failed:', innerErr));
                });
            }
            else {
                await ctx.telegram.editMessageText(
                    quest.chat,
                    quest.id,
                    null,
                    message,
                    markup
                ).catch((err) => { 
                    console.error('Error updating text message:', err);
                    if (err.response && err.response.description === 'Bad Request: message is not modified') {
                        console.log("Message not modified - this is usually ok");
                    } else {
                        console.error("Serious error updating message:", err);
                    }
                });
            }

    
            await this.db.put(quest.chat + '/quests', quest);

        
            // Handle federated messages
            await this.handleFederatedMessages(ctx, quest, language).catch(err => {
                console.error("Error handling federated messages:", err);
            });

 
        } catch (error) {
            console.error('Error in updateMessage:', error);
        }
    }

    // Add this method to handle notes added to quests
    async addNote(ctx) {
        let language = await this.settings.getLanguage(ctx.chat.id)
        try {
            const originalMessage = ctx.message.reply_to_message;
            const note = ctx.message.text;

            // Extract quest ID from the original message
            const questId = originalMessage.message_id;

            if (!questId) {
                console.log('Could not find quest ID');
                return;
            }

            // Get the quest from database
            const quest = await this.db.get(`${ctx.chat.id}/quests`, questId);

            if (!quest) {
                console.log('Quest not found');
                return;
            }

            // Add the note to the quest
            if (!quest.notes) quest.notes = [];
            quest.notes.push({
                text: note,
                from: ctx.from,
                timestamp: Date.now()
            });

            // Save updated quest
            await this.db.put(`${ctx.chat.id}/quests`, quest);

            // Update the original message to show the new note
            await this.updateMessage(ctx, quest, language);

        } catch (error) {
            console.error('Error adding note to quest:', error);
        }
    }

    // Add this new method to handle showing more actions
    async showMoreActions(ctx) {
        console.log("MORE ACTIONS");
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID);
        let quest = await this.db.get(chatID + '/quests', messageID.toString());

        if (!quest || quest == '') { 
            console.log('QUEST IS NOT FOUND');
            ctx.answerCbQuery('Quest not found');
            return;
        }

        console.log(`Showing expanded buttons for quest ${quest.id}, type: ${quest.type}, status: ${quest.status}`);
        console.log(`Quest details: title=${quest.title}, frequency=${quest.frequency}, recurringTaskId=${quest.recurringTaskId}`);

        // Create expanded markup with all buttons
        let expandedButtons = this.getExpandedButtons(quest, language);
        
        console.log(`Generated ${expandedButtons.length} button rows for expanded view`);
        
        if (expandedButtons.length === 0) {
            console.error(`No expanded buttons generated for quest type: ${quest.type}`);
            ctx.answerCbQuery('Error: Could not generate expanded buttons');
            return;
        }

        // Update message with expanded buttons - use the complete text + markup approach
        try {
            const message = await this.createMessage(quest, language);
            
            await ctx.editMessageText(
                message,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: expandedButtons
                    }
                }
            );
            console.log('Successfully updated message with expanded buttons');
        } catch (err) {
            console.error('Error updating message with expanded buttons:', err);
            
            // Fallback to just updating the markup if text update fails
            try {
                await ctx.editMessageReplyMarkup({
                    inline_keyboard: expandedButtons
                });
                console.log('Successfully updated message with fallback method');
            } catch (innerErr) { 
                console.error('Fallback markup update also failed:', innerErr);
                ctx.answerCbQuery('Error updating buttons. Please try again.');
            }
        }

        await ctx.answerCbQuery().catch((err) => { console.log(err) });
    }

    // Add this method to handle hiding more actions
    async hideMoreActions(ctx) {
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID);
        let quest = await this.db.get(chatID + '/quests', messageID.toString());

        if (!quest || quest == '') { 
            console.log('QUEST IS NOT FOUND');
            ctx.answerCbQuery('Quest not found');
            return;
        }

        console.log(`Hiding expanded buttons for quest ${quest.id}, type: ${quest.type}, status: ${quest.status}`);
        console.log(`Quest details: title=${quest.title}, frequency=${quest.frequency}, recurringTaskId=${quest.recurringTaskId}`);

        // Update message with original markup - use the complete text + markup approach
        try {
            const message = await this.createMessage(quest, language);
            const markup = this.markup(quest, language);
            
            await ctx.editMessageText(
                message,
                {
                    parse_mode: 'Markdown',
                    ...markup
                }
            );
        } catch (err) {
            console.error('Error updating message with standard buttons:', err);
            
            // Fallback to just updating the markup if text update fails
            await ctx.editMessageReplyMarkup(
                this.markup(quest, language).reply_markup
            ).catch((innerErr) => { 
                console.error('Fallback markup update also failed:', innerErr);
            });
        }

        await ctx.answerCbQuery().catch((err) => { console.log(err) });
    }

    // Add this helper method to get expanded buttons
    getExpandedButtons(quest, language) {
        let buttons = [];
        
        console.log(`Getting expanded buttons for quest type: ${quest.type}, status: ${quest.status}`);

        if (quest.type == 'task' || quest.type == 'quest' || quest.type == 'todo' || quest.type == 'mission' || quest.type == 'compito' || quest.type == 'recurring') {
            console.log(`Using task/recurring buttons layout for quest ${quest.id}`);
            // First row - essential actions
            buttons.push([
                Markup.button.callback(i18next.t('join', { lng: language }), 'participate_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest.id)
            ]);

            // Second row - time tracking
            buttons.push([
                Markup.button.callback('⏰ -15m', 'subtract_time_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('⏰ +15m', 'add_time_quest_' + quest.chat + '_' + quest.id)
            ]);

            // Third row - appreciation and schedule
            buttons.push([
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest_' + quest.chat + '_' + quest.id)
            ]);

            // Fourth row - description and checklist
            buttons.push([
                Markup.button.callback('📝 ' + i18next.t('description', { lng: language }), 'description_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('📋 ' + i18next.t('tasks', { lng: language }), 'checklist_quest_' + quest.chat + '_' + quest.id)
            ]);
            
            // Add new row for dependencies and recurring
            buttons.push([
                Markup.button.callback('🔗 ' + i18next.t('dependencies', { lng: language, defaultValue: 'Dependencies' }), 'dependencies_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('🔄 ' + this.getRecurringButtonText(quest, language), 'recurring_quest_' + quest.chat + '_' + quest.id)
            ]);
            
            // Fifth row - stop and cancel
            buttons.push([
                Markup.button.callback(i18next.t('stop', { lng: language }), 'stop_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('cancel', { lng: language }), 'cancel_quest_' + quest.chat + '_' + quest.id)
            ]);

            // Sixth row - publish and broadcast
            buttons.push([
                Markup.button.callback('📢 ' + i18next.t('publish', { lng: language }), 'publish_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('🎭 ' + i18next.t('broadcast', { lng: language }), 'broadcast_quest_' + quest.chat + '_' + quest.id)
            ]);

            // Last row - less actions button
            buttons.push([
                Markup.button.callback('🔼 ' + i18next.t('less_actions', { lng: language }), 'less_actions_' + quest.chat + '_' + quest.id)
            ]);
        } else if (quest.type == 'event') {
            console.log(`Using event buttons layout for quest ${quest.id}`);
            // First row - essential actions
            buttons.push([
                Markup.button.callback(i18next.t('join', { lng: language }), 'participate_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest.id)
            ]);

            // Second row - appreciation and schedule
            buttons.push([
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest_' + quest.chat + '_' + quest.id)
            ]);

            // Third row - publish and broadcast
            buttons.push([
                Markup.button.callback('📢 ' + i18next.t('publish', { lng: language }), 'publish_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('🎭 ' + i18next.t('broadcast', { lng: language }), 'broadcast_quest_' + quest.chat + '_' + quest.id)
            ]);
            
            // Last row - less actions button
            buttons.push([
                Markup.button.callback('🔼 ' + i18next.t('less_actions', { lng: language }), 'less_actions_' + quest.chat + '_' + quest.id)
            ]);
        } else if (quest.type == 'proposal') {
            console.log(`Using proposal buttons layout for quest ${quest.id}`);
            // First row
            buttons.push([
                Markup.button.callback(i18next.t('agree', { lng: language }), 'participate_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('stop', { lng: language }), 'stop_quest_' + quest.chat + '_' + quest.id)
            ]);
            
            // Second row - appreciation
            buttons.push([
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id)
            ]);
            
            // Last row - less actions button
            buttons.push([
                Markup.button.callback('🔼 ' + i18next.t('less_actions', { lng: language }), 'less_actions_' + quest.chat + '_' + quest.id)
            ]);
        } else if (quest.type == 'offer' || quest.type == 'request') {
            console.log(`Using offer/request buttons layout for quest ${quest.id}`);
            // First row
            buttons.push([
                Markup.button.callback(i18next.t('accept', { lng: language }), 'participate_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest.id)
            ]);
            
            // Second row - appreciation
            buttons.push([
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id)
            ]);

            // Third row - publish and broadcast
            buttons.push([
                Markup.button.callback('📢 ' + i18next.t('publish', { lng: language }), 'publish_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('🎭 ' + i18next.t('broadcast', { lng: language }), 'broadcast_quest_' + quest.chat + '_' + quest.id)
            ]);
            
            // Last row - less actions button
            buttons.push([
                Markup.button.callback('🔼 ' + i18next.t('less_actions', { lng: language }), 'less_actions_' + quest.chat + '_' + quest.id)
            ]);
        } else {
            console.log(`Using default buttons layout for quest ${quest.id} with type ${quest.type}`);
            // Default for other types - just appreciation and less actions
            buttons.push([
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id)
            ]);
            
            buttons.push([
                Markup.button.callback('🔼 ' + i18next.t('less_actions', { lng: language }), 'less_actions_' + quest.chat + '_' + quest.id)
            ]);
        }

        // Only show appreciation button for completed quests
        if (quest.status === "completed") {
            buttons = [
                [
                    Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id)
                ],
                [
                    Markup.button.callback('🔼 ' + i18next.t('less_actions', { lng: language }), 'less_actions_' + quest.chat + '_' + quest.id)
                ]
            ];
        }

        return buttons;
    }

    // Helper to get the recurring button text based on current frequency
    getRecurringButtonText(quest, language) {
        let frequencyText;
        
        if (quest.frequency === null || quest.frequency === undefined) {
            frequencyText = i18next.t('never', { lng: language, defaultValue: 'Never' });
        } else {
            frequencyText = i18next.t(quest.frequency, { lng: language, defaultValue: quest.frequency });
        }
        
        return i18next.t('recurring', { lng: language, defaultValue: 'Recurring' }) + ': ' + frequencyText;
    }

    // Add publish method
    async publish(ctx) {
        console.log("PUBLISH ACTION");
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)
        let quest = await this.db.get(chatID + '/quests', messageID.toString())

        if (!quest || quest == '') {
            console.log('QUEST IS NOT FOUND');
            ctx.answerCbQuery('Quest not found')
            return
        }

        // Get the user who initiated the publish
        const sender = ctx.callbackQuery.from;

        // Check if user has permission to publish
        if (quest.initiator.id !== sender.id && !isAdmin(sender.id, chatID)) {
            ctx.answerCbQuery(i18next.t('onlyinitiatorpublish', { lng: language }))
            return;
        }

        try {
            // Get the hex from settings
            let settings = await this.settings.getSettings(chatID)
            let hex = settings.hex

            if (!hex) {
                ctx.answerCbQuery('Hex not set. Please set hex using /setHex')
                return;
            }

            // Get the node from holosphere
            let node = await this.db.holosphere.getNode(chatID, 'quests', messageID)

            if (!node) {
                // Create node if it doesn't exist
                node = {
                    id: messageID,
                    type: quest.type,
                    title: quest.title,
                    initiator: quest.initiator,
                    participants: quest.participants,
                    status: quest.status,
                    when: quest.when,
                    where: quest.where,
                    category: quest.category
                }
            }

            // Publish to holosphere
            await this.db.holosphere.put(hex, "quests", { 'id': messageID, 'soul': this.db.holosphere.appname + '/' + chatID + '/quests/' + messageID })

            ctx.answerCbQuery('Quest published to hex ' + hex)

            // Update the message to show it's been published
            quest.published = true
            await this.updateMessage(ctx, quest, language)

        } catch (error) {
            console.error('Error publishing quest:', error)
            ctx.answerCbQuery('Error publishing quest')
        }
    }

    // Add broadcast method
    async broadcast(ctx) {
        console.log("BROADCAST ACTION");
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)
        let quest = await this.db.get(chatID + '/quests', messageID.toString())

        if (!quest || quest == '') {
            console.log('QUEST IS NOT FOUND');
            ctx.answerCbQuery('Quest not found')
            return
        }

        // Get the user who initiated the broadcast
        const sender = ctx.callbackQuery.from;

        // Check if user has permission to broadcast
        if (quest.initiator.id !== sender.id && !isAdmin(sender.id, chatID)) {
            ctx.answerCbQuery(i18next.t('onlyinitiatorbroadcast', { lng: language }))
            return;
        }

        try {
            // Get settings and hex
            let settings = await this.settings.getSettings(chatID)
            let hex = settings.hex

            if (!hex) {
                ctx.answerCbQuery('Hex not set. Please set hex using /setHex')
                return;
            }

            // Get the node
            let node = await this.db.holosphere.getNode(chatID, 'quests', messageID)

            if (!node) {
                // Create node if it doesn't exist
                node = {
                    id: messageID,
                    type: quest.type,
                    title: quest.title,
                    initiator: quest.initiator,
                    participants: quest.participants,
                    status: quest.status,
                    when: quest.when,
                    where: quest.where,
                    category: quest.category
                }
            }

            // Upcast to holosphere
            await this.db.holosphere.upcast(hex, 'quests', { id: messageID, soul: this.db.holosphere.appname + '/' + chatID + '/quests/' + messageID })

            ctx.answerCbQuery('Quest broadcast to hex ' + hex)

            // Update the message to show it's been broadcast
            quest.broadcasted = true
            await this.updateMessage(ctx, quest, language)

        } catch (error) {
            console.error('Error broadcasting quest:', error)
            ctx.answerCbQuery('Error broadcasting quest')
        }
    }

    async addTime(ctx) {
        console.log("ADD TIME ACTION");
        let chatID = ctx.callbackQuery.data.split('_')[3];
        let messageID = ctx.callbackQuery.data.split('_')[4];
        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())
        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

        // Get the user who logged time
        const sender = ctx.callbackQuery.from;
        const userId = sender.id;

        // Initialize time tracking for user if not exists
        if (!quest.timeTracking[userId]) {
            quest.timeTracking[userId] = 0;
        }

        // Add 15 minutes (0.25 hours)
        quest.timeTracking[userId] += 0.25;

        // Add user to participants if they're not already in the list
        const userIndex = quest.participants.findIndex(user => user.id === sender.id);
        if (userIndex === -1) {
            quest.participants.push(sender);
        }

        // Update the message and propagate to federated spaces
        await this.updateMessage(ctx, quest, language);

        ctx.answerCbQuery(`Added 15 minutes to ${getDisplayName(sender)}'s time on "${quest.title}"`);
    }

    async subtractTime(ctx) {
        console.log("SUBTRACT TIME ACTION");
        let chatID = ctx.callbackQuery.data.split('_')[3];
        let messageID = ctx.callbackQuery.data.split('_')[4];
        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())
        if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

        // Get the user who logged time
        const sender = ctx.callbackQuery.from;
        const userId = sender.id;

        // Initialize time tracking for user if not exists
        if (!quest.timeTracking[userId]) {
            quest.timeTracking[userId] = 0;
        }

        // Only subtract if there's time logged
        if (quest.timeTracking[userId] >= 0.25) {
            quest.timeTracking[userId] -= 0.25;

            // If user has no more time logged, remove them from participants
            if (quest.timeTracking[userId] === 0) {
                quest.participants = quest.participants.filter(user => user.id !== sender.id);
            }

            // Update the message and propagate to federated spaces
            await this.updateMessage(ctx, quest, language);

            ctx.answerCbQuery(`Removed 15 minutes from ${getDisplayName(sender)}'s time on "${quest.title}"`);
        } else {
            ctx.answerCbQuery(`No time logged for ${getDisplayName(sender)} to remove`);
        }
    }

    // Add checklist action handler
    async handleChecklistButton(ctx) {
        console.log("CHECKLIST ACTION");
        const chatId = ctx.callbackQuery.message.chat.id;
        const messageId = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatId)
        let quest = await this.db.get(chatId + '/quests', messageId.toString())

        if (!quest || quest == '') {
            console.log('QUEST IS NOT FOUND');
            ctx.answerCbQuery('Quest not found')
            return
        }

        if (!this.checklists) {
            console.error('Checklists instance not set');
            ctx.answerCbQuery('Checklist functionality not available');
            return;
        }

        try {
            // If quest doesn't have a checklist yet, create one
            if (!quest.checklistId) {
                // Create a new checklist with the quest's title
                const checklist = {
                    id: messageId.toString(),
                    items: [],
                    creator: quest.initiator.id,
                    created: new Date(),
                    questId: quest.id, // Store reference to the quest
                    questTitle: quest.title, // Store quest title for display
                    chatId: chatId, // Store chat ID for navigation
                    isTaskChecklist: true // Flag to indicate this is a task's checklist
                };

                // Save the checklist
                await this.db.put(chatId + '/checklists', checklist);

                // Update quest with checklist ID
                quest.checklistId = messageId.toString();
                await this.db.put(chatId + '/quests', quest);
            }

            // Let the Checklists class handle displaying the checklist
            await this.checklists.showChecklist(ctx, messageId.toString());

        } catch (error) {
            console.error('Error handling checklist button:', error)
            await ctx.answerCbQuery('Error handling checklist button')
        }
    }

    // Add back to quest handler
    async handleBackToQuest(ctx) {
        const [chatId, questId] = ctx.match[1].split('_');
        const language = await this.settings.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', questId);
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            // Update message to show quest again
            await ctx.editMessageText(
                await this.createMessage(quest, language),
                this.markup(quest, language)
            );

            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error handling back to quest:', error);
            await ctx.answerCbQuery('Error returning to quest');
        }
    }

    // Add new methods for handling checklist interactions
    async handleCheckItem(ctx) {
        const [checklistId, itemIndex] = ctx.match[1].split('_');
        const chatId = ctx.callbackQuery.message.chat.id;
        const messageId = ctx.callbackQuery.message.message_id;

        try {
            const checklist = await this.db.get(chatId + '/checklists', messageId.toString());
            if (!checklist) {
                await ctx.answerCbQuery('Checklist not found');
                return;
            }

            // Toggle the item's checked status
            checklist.items[itemIndex].checked = !checklist.items[itemIndex].checked;
            await this.db.put(chatId + '/checklists', checklist);

            // Create keyboard with items
            const keyboard = [
                ...checklist.items.map((item, index) => ([
                    Markup.button.callback(
                        `${item.checked ? '✅' : '⬜️'} ${item.text}`,
                        `check_${messageId}_${index}`
                    )
                ])),
                [Markup.button.callback('➕ Add Item', `add_item_to_${messageId}`)]
            ];

            // Add back button if this is a quest's checklist
            if (checklist.questId) {
                keyboard.push([
                    Markup.button.callback(i18next.t('back_to_task'), `back_to_quest_${checklist.chatId}_${checklist.questId}`)
                ]);
            }

            // Update the message with new keyboard
            await ctx.editMessageText(
                `📋 ${checklist.questTitle || 'Checklist'}:`,
                Markup.inlineKeyboard(keyboard)
            );

            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error handling check item:', error);
            await ctx.answerCbQuery('Error updating checklist item');
        }
    }

    async handleAddItem(ctx) {
        const messageId = ctx.match[1];
        const chatId = ctx.callbackQuery.message.chat.id;

        try {
            // Get the checklist to ensure it exists and to pass its data to the scene
            const checklist = await this.db.get(chatId + '/checklists', messageId.toString());
            if (!checklist) {
                await ctx.answerCbQuery('Checklist not found');
                return;
            }

            // Enter scene for adding items with the necessary context
            await ctx.scene.enter('add_item_scene', {
                checklistId: messageId,
                chatId: chatId,
                questId: checklist.questId,
                questTitle: checklist.questTitle
            });

            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error handling add item:', error);
            await ctx.answerCbQuery('Error adding checklist item');
        }
    }

    // Add method to set checklists instance
    setChecklists(checklists) {
        this.checklists = checklists;
        // Pass this quest instance to the checklists
        this.checklists.setQuestInstance(this);
    }

    // Function to create the message for a quest 
    async createMessage(quest, language) {
        let message = `| ${i18next.t(quest.type.charAt(0).toUpperCase() + quest.type.slice(1), { lng: language })}: ${quest.title} \n`;

        // Add initiator info
        message += `| 💡 ${i18next.t('by', { lng: language })}: ${getDisplayName(quest.initiator)} \n`;

        // Add description if it exists
        if (quest.description) {
            message += `| 📝 ${quest.description}\n`;
        }

        // Add frequency for recurring tasks
        if (quest.frequency !== null && quest.frequency !== undefined) {
            message += `| 🔄 ${i18next.t('repeat', { lng: language, defaultValue: 'Repeat' })}: ${i18next.t(quest.frequency, { lng: language, defaultValue: quest.frequency })} \n`;
        } else if (quest.recurringTaskId) {
            // If this is a recurring task instance but frequency is null, show "Not recurring"
            message += `| 🔄 ${i18next.t('repeat', { lng: language, defaultValue: 'Repeat' })}: ${i18next.t('never', { lng: language, defaultValue: 'Never' })} \n`;
        }

        if (quest.category) {
            message += `| 📑 ${i18next.t('category', { lng: language })}: ${quest.category} \n`;
        }

        // Add dependencies if they exist
        if (quest.dependencies && quest.dependencies.length > 0) {
            message += `| 🔗 ${i18next.t('dependencies', { lng: language, defaultValue: 'Dependencies' })}: `;
            const depTitles = [];
            for (const depId of quest.dependencies) {
                try {
                    const depQuest = await this.db.get(quest.chat + '/quests', depId.toString());
                    if (depQuest) {
                        depTitles.push(depQuest.title);
                    }
                } catch (error) {
                    console.error(`Error getting dependency ${depId}:`, error);
                }
            }
            message += depTitles.join(', ') + '\n';
        }

        // Add checklist progress if it exists
        if (quest.checklistId && this.checklists) {
            const checklist = await this.db.get(quest.chat + '/checklists', quest.checklistId);
            if (checklist && checklist.items.length > 0) {
                const completed = checklist.items.filter(item => item.checked).length;
                message += `| 📋 Checklist: ${completed}/${checklist.items.length} completed\n`;
            }
        }

        if (quest.participants.length > 0)
            message += `| ${i18next.t('🙋‍♂', { lng: language })} : ${[...quest.participants].map(u => getDisplayName(u)).join(', ')} \n`;

        // Add time tracking info if any time is logged
        if (quest.timeTracking && Object.keys(quest.timeTracking).length > 0) {
            message += `| ⏰ Time logged:\n`;
            for (const [userId, hours] of Object.entries(quest.timeTracking)) {
                if (hours > 0) {
                    const user = quest.participants.find(p => p.id === parseInt(userId)) || quest.initiator;
                    message += `|   ${getDisplayName(user)}: ${hours.toFixed(2)}h\n`;
                }
            }
        }

        if (quest.appreciation.length > 0)
            message += `| ${i18next.t('👍', { lng: language })} : ${[...quest.appreciation].map(u => getDisplayName(u)).join(', ')} \n`;

        // Format date in a human-friendly way
        if (quest.when) {
            const date = new Date(quest.when);
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            let dateStr;
            if (date.toDateString() === today.toDateString()) {
                dateStr = `Today at ${date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}`;
            } else if (date.toDateString() === tomorrow.toDateString()) {
                dateStr = `Tomorrow at ${date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}`;
            } else {
                dateStr = date.toLocaleDateString(language, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
            message += `| ${i18next.t('📅', { lng: language })} : ${dateStr} \n`;
        }

        if (quest.where?.lat)
            message += `| ${i18next.t('📍 ', { lng: language })}: ${quest.where.lat} : ${quest.where.lon}   \n`;
        if (quest.status === "stopped")
            message += `| ${i18next.t('🛑', { lng: language })} : ${[...quest.stoppers].map(u => getDisplayName(u)).join(', ')} \n`;
        message += `| ${i18next.t('🚥', { lng: language })} : ${i18next.t(quest.status, { lng: language })}\n`;

        // Add published and broadcast status
        if (quest.published)
            message += `| 📢 ${i18next.t('published', { lng: language })}\n`;
        if (quest.broadcasted)
            message += `| 🎭 ${i18next.t('broadcasted', { lng: language })}\n`;

        return message;
    }

    markup(quest, language) {
        let mu
        if (quest.type == 'task' || quest.type == 'quest' || quest.type == 'todo' || quest.type == 'mission' || quest.type == 'compito' || quest.type == 'recurring') {
            // Create button rows
            const buttons = [
                [
                    Markup.button.callback(i18next.t('join', { lng: language }), 'participate_quest_' + quest.chat + '_' + quest.id),
                    Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest.id)
                ],
                [
                    Markup.button.callback('⏰ -15m', 'subtract_time_quest_' + quest.chat + '_' + quest.id),
                    Markup.button.callback('⏰ +15m', 'add_time_quest_' + quest.chat + '_' + quest.id)
                ]
            ];

            // Add tasks and recurring buttons
            buttons.push([
                Markup.button.callback('📋 ' + i18next.t('subtasks', { lng: language }), 'checklist_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('🔄 ' + this.getRecurringButtonText(quest, language), 'recurring_quest_' + quest.chat + '_' + quest.id)
            ]);

            // Add more actions button
            buttons.push([
                Markup.button.callback('⚙️ ' + i18next.t('more_actions', { lng: language }), 'more_actions_' + quest.chat + '_' + quest.id)
            ]);

            mu = Markup.inlineKeyboard(buttons);
        }

        if (quest.type == 'event') {
            mu = Markup.inlineKeyboard([
                [
                    Markup.button.callback(i18next.t('join', { lng: language }), 'participate_quest_' + quest.chat + '_' + quest.id),
                    Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest.id)
                ],
                [
                    Markup.button.callback('⚙️ ' + i18next.t('more_actions', { lng: language }), 'more_actions_' + quest.chat + '_' + quest.id)
                ]
            ])
        }

        if (quest.type == 'proposal') {
            mu = Markup.inlineKeyboard([
                [
                    Markup.button.callback(i18next.t('agree', { lng: language }), 'participate_quest_' + quest.chat + '_' + quest.id),
                    Markup.button.callback(i18next.t('stop', { lng: language }), 'stop_quest_' + quest.chat + '_' + quest.id)
                ],
                [
                    Markup.button.callback('⚙️ ' + i18next.t('more_actions', { lng: language }), 'more_actions_' + quest.chat + '_' + quest.id)
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
                    Markup.button.callback(i18next.t('accept', { lng: language }), 'participate_quest_' + quest.chat + '_' + quest.id),
                    Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest.id)
                ],
                [
                    Markup.button.callback('⚙️ ' + i18next.t('more_actions', { lng: language }), 'more_actions_' + quest.chat + '_' + quest.id)
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
    async updateQuestImage(ctx, quest) {
        try {
            // update the image
            let path = await ui.getQuestImage(quest)
            await ctx.telegram.editMessageMedia(
                ctx.update.callback_query.message.chat.id,
                ctx.update.callback_query.message.message_id,
                null,
                {
                    type: 'photo',
                    media: path,
                    caption: await this.createMessage(quest, language)
                },
            );
        } catch (e) {
            console.log(e);
        }
    }

    setupDescriptionScene() {
        this.descriptionScene.enter(async (ctx) => {
            const quest = await this.db.get(ctx.scene.state.chatId + '/quests', ctx.scene.state.questId.toString());
            const currentDescription = quest.description || '';

            let message = '📝 *Description*\n\n';
            if (currentDescription) {
                message += currentDescription + '\n\n';
            }
            message += 'Reply to this message to add or update the description.';

            await ctx.reply(message, { parse_mode: 'Markdown' });
        });

        this.descriptionScene.on('text', async (ctx) => {
            try {
                const quest = await this.db.get(ctx.scene.state.chatId + '/quests', ctx.scene.state.questId.toString());
                if (!quest) {
                    await ctx.reply('Quest not found');
                    return ctx.scene.leave();
                }

                // Update the description
                quest.description = ctx.message.text;
                await this.db.put(ctx.scene.state.chatId + '/quests', quest);

                // Update the original quest message
                await this.updateMessage(ctx, quest);

                await ctx.reply('Description updated successfully!');
                return ctx.scene.leave();
            } catch (error) {
                console.error('Error updating description:', error);
                await ctx.reply('Error updating description');
                return ctx.scene.leave();
            }
        });
    }

    // Add description handler method
    async handleDescription(ctx) {
        console.log("DESCRIPTION ACTION");
        const chatId = ctx.callbackQuery.message.chat.id;
        const messageId = ctx.callbackQuery.data.split('_')[3];

        try {
            const quest = await this.db.get(chatId + '/quests', messageId.toString());
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            // Enter scene for adding/viewing description
            await ctx.scene.enter('description_scene', {
                questId: messageId,
                chatId: chatId,
                currentDescription: quest.description || ''
            });

            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error handling description:', error);
            await ctx.answerCbQuery('Error accessing description');
        }
    }

    // Add this new helper method to handle federated messages
    async handleFederatedMessages(ctx, quest, language) {
        try {
            // Get federation info to find out which spaces to notify
            const fedInfo = await this.db.holosphere.getFederation(quest.chat);
            if (!fedInfo?.notify?.length) {
                return;
            }

            // Get existing federation tracking info
            const federationKey = `${quest.chat}_${quest.id}_fedmsgs`;
            let federatedMessages = await this.db.get('federation_messages', federationKey) || {
                id: federationKey,
                chatId: quest.chat,
                questId: quest.id,
                messages: []
            };

            for (const federatedChatId of fedInfo.notify) {
                // Skip if it's the same chat as the original
                if (federatedChatId === quest.chat) continue;

                // Find existing message for this federated chat
                const existingMsgIndex = federatedMessages.messages.findIndex(m => m.chatId === federatedChatId);
                const existingMsg = existingMsgIndex > -1 ? federatedMessages.messages[existingMsgIndex] : null;

                try {
                    if (existingMsg) {
                        // Update existing message
                        if (quest.picture) {
                            await ctx.telegram.editMessageMedia(
                                federatedChatId,
                                existingMsg.messageId,
                                null,
                                {
                                    type: 'photo',
                                    media: quest.picture,
                                    caption: await this.createMessage(quest, language)
                                },
                                this.markup(quest, language)
                            ).catch(err => console.error(`Error updating federated message in ${federatedChatId}:`, err));
                        } else {
                            await ctx.telegram.editMessageText(
                                federatedChatId,
                                existingMsg.messageId,
                                null,
                                await this.createMessage(quest, language),
                                this.markup(quest, language)
                            ).catch(err => console.error(`Error updating federated message in ${federatedChatId}:`, err));
                        }
                    } else {
                        // Create new message
                        let newMessage;
                        if (quest.picture) {
                            newMessage = await ctx.telegram.sendPhoto(
                                federatedChatId,
                                quest.picture,
                                {
                                    caption: await this.createMessage(quest, language),
                                    ...this.markup(quest, language)
                                }
                            );
                        } else {
                            newMessage = await ctx.telegram.sendMessage(
                                federatedChatId,
                                await this.createMessage(quest, language),
                                this.markup(quest, language)
                            );
                        }

                        // Pin the message if quest is not completed
                        if (quest.status !== 'completed') {
                            await ctx.telegram.pinChatMessage(
                                federatedChatId,
                                newMessage.message_id,
                                { disable_notification: true }
                            ).catch(err => { });
                        }

                        // Store the new message information
                        federatedMessages.messages.push({
                            chatId: federatedChatId,
                            messageId: newMessage.message_id,
                            timestamp: Date.now()
                        });
                    }
                } catch (error) {
                    console.error(`Failed to handle message in federated chat ${federatedChatId}:`, error);
                    // If we've failed to update an existing message, remove it from tracking
                    if (existingMsgIndex > -1) {
                        federatedMessages.messages.splice(existingMsgIndex, 1);
                    }
                }
            }

            // Save the updated federation message tracking information
            if (federatedMessages.messages.length > 0) {
                await this.db.put('federation_messages', federatedMessages);
            }

        } catch (error) {
            console.error('Error handling federated messages:', error);
        }
    }

    // Add dependency action handlers
    async handleDependenciesButton(ctx) {
        const chatId = ctx.callbackQuery.message.chat.id;
        const messageId = ctx.callbackQuery.data.split('_')[3];
        const language = await this.settings.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', messageId.toString());
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            // Get all ongoing quests in this chat
            const allQuests = await this.db.getAll(chatId + '/quests');
            const openQuests = allQuests.filter(q => 
                q.status === 'ongoing' && 
                q.id !== quest.id &&
                (q.type === 'task' || q.type === 'quest' || q.type === 'todo' || q.type === 'mission') &&
                // Filter out quests that are already dependencies
                !(quest.dependencies && quest.dependencies.includes(q.id))
            );

            // Create a message showing current dependencies
            let message = `🔗 *Dependencies for "${quest.title}"*\n\n`;
            
            // Initialize buttons array
            const buttons = [];
            
            // Show current dependencies if any
            if (quest.dependencies && quest.dependencies.length > 0) {
                message += '*Current dependencies:*\n';
                
                // Add buttons to remove existing dependencies
                for (const depId of quest.dependencies) {
                    const depQuest = await this.db.get(chatId + '/quests', depId.toString());
                    if (depQuest) {
                        message += `- ${depQuest.title}\n`;
                        buttons.push([
                            Markup.button.callback(`🗑️ Remove: ${depQuest.title}`, `remove_dependency_${chatId}_${messageId}_${depId}`)
                        ]);
                    }
                }
                message += '\n';
            } else {
                message += '*No dependencies set*\n\n';
            }
            
            if (openQuests.length === 0 && (!quest.dependencies || quest.dependencies.length === 0)) {
                await ctx.answerCbQuery('No other open tasks available to set as dependencies');
                return;
            }
            
            // Add section header for adding new dependencies if we have open quests
            if (openQuests.length > 0) {
                message += 'Select a task to add as a dependency:';
                
                // Add buttons for each open quest that's not already a dependency
                openQuests.forEach(q => {
                    buttons.push([
                        Markup.button.callback(`➕ ${q.title}`, `set_dependency_${chatId}_${messageId}_${q.id}`)
                    ]);
                });
            }
            
            // Add a back button
            buttons.push([
                Markup.button.callback('↩️ Back', `back_from_dependencies_${chatId}_${messageId}`)
            ]);

            // Show the message with dependency options
            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            });

            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error handling dependencies:', error);
            await ctx.answerCbQuery('Error managing dependencies');
        }
    }

    async handleSetDependency(ctx) {
        const chatId = ctx.callbackQuery.data.split('_')[2];
        const questId = ctx.callbackQuery.data.split('_')[3];
        const dependencyId = ctx.callbackQuery.data.split('_')[4];
        const language = await this.settings.getLanguage(chatId);

        try {
            // Get the quest and dependency
            const quest = await this.db.get(chatId + '/quests', questId.toString());
            const depQuest = await this.db.get(chatId + '/quests', dependencyId.toString());
            
            if (!quest || !depQuest) {
                await ctx.answerCbQuery('Quest or dependency not found');
                return;
            }

            // Initialize dependencies array if it doesn't exist
            if (!quest.dependencies) {
                quest.dependencies = [];
            }

            // Check if dependency already exists
            if (quest.dependencies.includes(dependencyId)) {
                await ctx.answerCbQuery('This dependency already exists');
                return;
            }

            // Add the dependency
            quest.dependencies.push(dependencyId);

            // Save the updated quest
            await this.db.put(chatId + '/quests', quest);

            // Update the original quest message in the chat
            await this.updateMessage(ctx, quest, language);

            // Show updated dependencies view
            await this.handleDependenciesButton(ctx);
            
            await ctx.answerCbQuery(`Added "${depQuest.title}" as a dependency`);
        } catch (error) {
            console.error('Error setting dependency:', error);
            await ctx.answerCbQuery('Error setting dependency');
        }
    }

    async backFromDependencies(ctx) {
        console.log("BACK FROM DEPENDENCIES");
        const parts = ctx.callbackQuery.data.split('_');
        const chatId = parts[3]; 
        const messageId = parts[4];
        const language = await this.settings.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', messageId.toString());
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            // Return to the quest view with expanded buttons
            await ctx.editMessageText(
                await this.createMessage(quest, language),
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard(this.getExpandedButtons(quest, language))
                }
            );

            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error returning from dependencies:', error);
            await ctx.answerCbQuery('Error returning to quest');
        }
    }

    async handleRemoveDependency(ctx) {
        console.log("REMOVE DEPENDENCY ACTION");
        const chatId = ctx.callbackQuery.data.split('_')[2];
        const questId = ctx.callbackQuery.data.split('_')[3];
        const dependencyId = ctx.callbackQuery.data.split('_')[4];
        const language = await this.settings.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!quest || !quest.dependencies) {
                await ctx.answerCbQuery('Quest or dependencies not found');
                return;
            }

            // Remove the dependency
            quest.dependencies = quest.dependencies.filter(id => id !== dependencyId);

            // Save the updated quest
            await this.db.put(chatId + '/quests', quest);

            // Update the quest message
            await this.updateMessage(ctx, quest, language);

            // Show updated dependencies view
            await this.handleDependenciesButton(ctx);
            
            await ctx.answerCbQuery('Dependency removed');
        } catch (error) {
            console.error('Error removing dependency:', error);
            await ctx.answerCbQuery('Error removing dependency');
        }
    }

    async handleRecurringButton(ctx) {
        console.log("RECURRING ACTION");
        const chatId = ctx.callbackQuery.message.chat.id;
        const messageId = ctx.callbackQuery.data.split('_')[3];
        const language = await this.settings.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', messageId.toString());
            if (!quest) {
                console.log(`Quest not found for ID: ${messageId}`);
                await ctx.answerCbQuery('Quest not found');
                return;
            }
            
            console.log(`Handling recurring for quest ID: ${quest.id}, current frequency: ${quest.frequency}, has recurringTaskId: ${!!quest.recurringTaskId}, has originalTaskId: ${!!quest.originalTaskId}`);

            // Define the cycle of frequencies
            const frequencies = [
                null, // "Never" - no recurring
                'daily',
                'weekly',
                'monthly',
                'quarterly',
                'yearly'
            ];

            // Get current frequency index
            let currentIndex = frequencies.indexOf(quest.frequency);
            if (currentIndex === -1) currentIndex = 0; // Start at 'Never' if not found
            console.log(`Current frequency index: ${currentIndex}`);

            // Cycle to next frequency
            currentIndex = (currentIndex + 1) % frequencies.length;
            quest.frequency = frequencies[currentIndex];
            console.log(`New frequency: ${quest.frequency}`);

            // Get readable frequency name
            let frequencyName;
            if (quest.frequency === null) {
                frequencyName = i18next.t('never', { lng: language, defaultValue: 'Never' });
                
                // If changing from recurring to never, remove any existing recurring task
                if (quest.recurringTaskId) {
                    console.log(`Removing recurring task: ${quest.recurringTaskId}`);
                    const removed = await this.removeRecurringTask(quest.recurringTaskId);
                    console.log(`Recurring task removal ${removed ? 'succeeded' : 'failed'}`);
                    
                    // Remove the ID reference regardless of removal success
                    delete quest.recurringTaskId;
                }
            } else {
                frequencyName = i18next.t(quest.frequency, { lng: language, defaultValue: quest.frequency });
                
                // If this is a generated recurring quest (has recurringTaskId), we should update the original task instead
                if (quest.recurringTaskId && !quest.originalTaskId) {
                    console.log(`This quest has recurringTaskId ${quest.recurringTaskId}, updating that task's frequency instead of creating new one`);
                    
                    try {
                        // Get the recurring task
                        const task = await this.scheduler.getRecurringTask(quest.recurringTaskId);
                        if (task) {
                            // Update the task's frequency
                            await this.scheduler.updateRecurringTask(quest.recurringTaskId, {
                                frequency: quest.frequency
                            });
                            console.log(`Updated existing recurring task ${quest.recurringTaskId} with new frequency: ${quest.frequency}`);
                        } else {
                            console.log(`Recurring task ${quest.recurringTaskId} not found, will create new one`);
                            // Fall back to creating a new task
                            const taskId = await this.createOrUpdateRecurringTask(quest, language);
                            quest.recurringTaskId = taskId;
                        }
                    } catch (error) {
                        console.error('Error updating recurring task:', error);
                        // Fall back to creating a new task
                        const taskId = await this.createOrUpdateRecurringTask(quest, language);
                        quest.recurringTaskId = taskId;
                    }
                }
                // This is a regular quest (not generated and doesn't have recurringTaskId yet)
                else if (!quest.recurringTaskId && this.scheduler) {
                    console.log(`Creating new recurring task for frequency: ${quest.frequency}`);
                    const taskId = await this.createOrUpdateRecurringTask(quest, language);
                    quest.recurringTaskId = taskId;
                    console.log(`Task ID set to: ${taskId}`);
                }
            }

            // Check if this is a recurring instance and update the original task
            if (quest.originalTaskId) {
                try {
                    // Get the original task
                    const originalTask = await this.db.get(chatId + '/quests', quest.originalTaskId.toString());
                    if (originalTask) {
                        console.log(`Updating original task ${originalTask.id} with frequency: ${quest.frequency}`);
                        
                        // Sync the recurring state
                        originalTask.frequency = quest.frequency;
                        
                        if (!quest.frequency) {
                            // If setting to never, remove the recurring task
                            if (originalTask.recurringTaskId) {
                                console.log(`Removing original task's recurring task: ${originalTask.recurringTaskId}`);
                                const removed = await this.removeRecurringTask(originalTask.recurringTaskId);
                                console.log(`Original task's recurring task removal ${removed ? 'succeeded' : 'failed'}`);
                                delete originalTask.recurringTaskId;
                            }
                        } else if (this.scheduler) {
                            // Otherwise update the recurring task
                            const taskId = await this.createOrUpdateRecurringTask(originalTask, language);
                            originalTask.recurringTaskId = taskId;
                            console.log(`Updated original task's recurring task ID to: ${taskId}`);
                        }
                        
                        // Save the updated original task
                        await this.db.put(chatId + '/quests', originalTask);
                        console.log(`Original task ${originalTask.id} updated`);
                        
                        // Immediately update the original task's message
                        await this.updateMessage(ctx, originalTask, language);
                    }
                } catch (error) {
                    console.error('Error updating original task:', error);
                }
            }

            // Save the updated quest
            await this.db.put(chatId + '/quests', quest);

            // Update the message
            await this.updateMessage(ctx, quest, language);
            
            await ctx.answerCbQuery(`Set to repeat: ${frequencyName}`);
        } catch (error) {
            console.error('Error handling recurring button:', error);
            await ctx.answerCbQuery('Error setting recurring frequency');
        }
    }

    async createOrUpdateRecurringTask(quest, language) {
        if (!this.scheduler) {
            console.error('Scheduler not available');
            return null;
        }

        try {
            // Get when date (or use current time if not set)
            const whenDate = quest.when ? new Date(quest.when) : new Date();
            
            // Format the frequency for scheduler
            let schedulerFrequency;
            switch (quest.frequency) {
                case 'daily': schedulerFrequency = 'daily'; break;
                case 'weekly': schedulerFrequency = 'weekly'; break;
                case 'monthly': schedulerFrequency = 'monthly'; break;
                case 'quarterly': schedulerFrequency = 'quarterly'; break;
                case 'yearly': schedulerFrequency = 'yearly'; break;
                default: schedulerFrequency = 'daily'; // Default
            }

            // Check if there's an existing task to update
            if (quest.recurringTaskId) {
                console.log(`Updating existing recurring task ${quest.recurringTaskId} for quest ${quest.id}`);
                // Update existing task
                await this.scheduler.updateRecurringTask(quest.recurringTaskId, {
                    frequency: schedulerFrequency,
                    when: whenDate
                });
                return quest.recurringTaskId;
            } else {
                console.log(`Creating new recurring task for quest ${quest.id}`);
                // Create a new task object
                const task = {
                    id: quest.id,
                    chatID: quest.chat,
                    title: quest.title,
                    frequency: quest.frequency,
                    when: whenDate,
                    createdAt: new Date(),
                    initiator: quest.initiator,
                    questId: quest.id, // This is crucial for linking back to the original task
                    description: quest.description,
                    checklistId: quest.checklistId,
                    dependencies: quest.dependencies
                };

                // Save to database using scheduler
                const taskId = await this.scheduler.createRecurringTask(task);
                console.log(`Created recurring task with ID ${taskId}`);
                return taskId;
            }
        } catch (error) {
            console.error('Error creating/updating recurring task:', error);
            return null;
        }
    }

    async removeRecurringTask(taskId) {
        if (!this.scheduler) {
            console.error('Scheduler not available');
            return false;
        }

        try {
            return await this.scheduler.stopTask(taskId);
        } catch (error) {
            console.error('Error removing recurring task:', error);
            return false;
        }
    }

    async handleStopRecurring(ctx) {
        console.log("STOP RECURRING ACTION");
        const chatId = ctx.callbackQuery.data.split('_')[2];
        const messageId = ctx.callbackQuery.data.split('_')[3];
        const language = await this.settings.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', messageId.toString());
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            console.log(`Handling stop recurring for quest ID: ${quest.id}, has recurringTaskId: ${!!quest.recurringTaskId}, has originalTaskId: ${!!quest.originalTaskId}`);

            // Set frequency to null (never)
            quest.frequency = null;
            
            // Remove the recurring task
            if (quest.recurringTaskId) {
                console.log(`Removing recurring task: ${quest.recurringTaskId}`);
                const removed = await this.removeRecurringTask(quest.recurringTaskId);
                console.log(`Recurring task removal ${removed ? 'succeeded' : 'failed'}`);
                delete quest.recurringTaskId;
            } else {
                console.log(`Quest has no recurringTaskId to remove`);
            }
            
            // Check if this is a recurring instance and update the original task
            if (quest.originalTaskId) {
                try {
                    // Get the original task
                    const originalTask = await this.db.get(chatId + '/quests', quest.originalTaskId.toString());
                    if (originalTask) {
                        console.log(`Stopping recurring for original task ${originalTask.id}`);
                        
                        // Set frequency to null
                        originalTask.frequency = null;
                        
                        // Remove recurring task reference
                        if (originalTask.recurringTaskId) {
                            console.log(`Removing original task's recurring task: ${originalTask.recurringTaskId}`);
                            const removed = await this.removeRecurringTask(originalTask.recurringTaskId);
                            console.log(`Original task's recurring task removal ${removed ? 'succeeded' : 'failed'}`);
                            delete originalTask.recurringTaskId;
                        } else {
                            console.log(`Original task has no recurringTaskId to remove`);
                        }
                        
                        // Save the updated original task
                        await this.db.put(chatId + '/quests', originalTask);
                        console.log(`Original task ${originalTask.id} updated to non-recurring`);
                        
                        // Update the original task's message
                        await this.updateMessage(ctx, originalTask, language);
                    } else {
                        console.log(`Original task ${quest.originalTaskId} not found`);
                    }
                } catch (error) {
                    console.error('Error updating original task:', error);
                }
            }

            // Update the quest
            await this.db.put(chatId + '/quests', quest);
            console.log(`Quest ${quest.id} updated to non-recurring`);

            // Update the message
            await this.updateMessage(ctx, quest, language);

            await ctx.answerCbQuery('Recurring task stopped');
        } catch (error) {
            console.error('Error handling stop recurring:', error);
            await ctx.answerCbQuery('Error stopping recurring task');
        }
    }
}
