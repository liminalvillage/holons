import { Markup } from 'telegraf';
import i18next from 'i18next';
import { getUserName, getUser, getChatId, getMessageId, capitalize, isAdmin, getDisplayName, isBotAdmin, getHolonName } from './utilities.js';
import { Calendar } from './Calendar.js';
import Users from './Users.js';
import { Scenes } from 'telegraf';

/**
 * Quest Management System
 * 
 * Environment Variables:
 * - SHOW_QUESTS_AS_IMAGES: Set to 'true' to display quests as generated images, 'false' or unset for text-only display
 * 
 * Usage Examples:
 * - To enable image display: export SHOW_QUESTS_AS_IMAGES=true
 * - To disable image display: export SHOW_QUESTS_AS_IMAGES=false (or unset the variable)
 * 
 * Note: When set to 'true', requires UI instance to be available for image generation.
 * When set to 'false' or unset, all quests will be displayed as text only.
 */

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
        this.ui = null // Will be set from outside after construction for image generation

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
        this.bot.command('quests', async (ctx) => this.listOpenQuests(ctx)); // Add /quests command

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

        //Send  Appreciation
        this.bot.command(['appreciate', 'praise', 'kudo', 'apprezza', 'apprezziamo', 'fiorino'], async (ctx) => this.sendAppreciation(ctx));

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
        this.bot.action(/add_time_quest_(.+)/, (ctx) => this.addTime(ctx, 0.25));
        this.bot.action(/subtract_time_quest_(.+)/, (ctx) => this.subtractTime(ctx, 0.25));
        this.bot.action(/add_1h_quest_(.+)/, (ctx) => this.addTime(ctx,1));
        this.bot.action(/subtract_1h_quest_(.+)/, (ctx) => this.subtractTime(ctx,1));

        // Add checklist action handler
        this.bot.action(/checklist_quest_(.+)/, (ctx) => this.handleChecklistButton(ctx));
        this.bot.action(/check_(.+)/, (ctx) => this.handleCheckItem(ctx));
        this.bot.action(/add_item_to_(.+)/, (ctx) => this.handleAddItem(ctx));

        // Add description action handler
        this.bot.action(/descriptions_quest_(.+)/, (ctx) => this.handleDescription(ctx));
        
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

        this.bot.action(/view_original_quest_(.+)/, async (ctx) => this.viewOriginalQuest(ctx));
    }

    async personalHologram(userId, quest) {
        if (!userId || !quest || !quest.id || !quest.chat) {
            console.warn('[personalHologram] Missing userId or crucial quest details. Skipping hologram creation for quest:', quest ? quest.id : 'Unknown ID');
            return;
        }
        try {
            const userHolonId = userId.toString();
            const userLens = 'quests'; // Lens for storing these holograms

            const hologramData = {
                id: quest.id.toString(), // Key for the item in the user's lens (original quest ID)
                soul: `${this.db.holosphere.appname}/${quest.chat}/${userLens}/${quest.id.toString()}`,
                title: quest.title, 
                status: quest.status, 
                originalLens: 'quests', // Explicitly store the original lens
                lastInteracted: new Date().getTime()
            };

            await this.db.holosphere.put(userHolonId, userLens, hologramData);
            console.log(`[personalHologram] Ensured/updated hologram for quest ${quest.id} in user holon ${userHolonId}/${userLens}`);
        } catch (error) {
            console.error(`[personalHologram] Error creating/updating hologram for quest ${quest.id} in user holon ${userId}:`, error);
        }
    }

    // Method to set scheduler reference
    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    // Method to set UI instance reference
    setUIInstance(ui) {
        this.ui = ui;
    }

    // Helper method to check if a user is admin in a specific chat
    async checkUserAdmin(userId, chatId) {
        try {
            const chatMember = await this.bot.telegram.getChatMember(chatId, userId);
            return ['administrator', 'creator'].includes(chatMember.status) || (chatId > 0); // chatId > 0 means private chat
        } catch (error) {
            console.error('Error checking admin status:', error);
            return false;
        }
    }

    async delete(ctx) {
        console.log("DELETE ACTION");
        let chatID = ctx.message.chat.id;
        let messageID = ctx.message.text.split(' ')[1];
        this.db.del(chatID + '/quests', messageID.toString())
        ctx.reply('Quest deleted')
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


    async list(ctx) {

        let type = ctx.message.text.split(' ')[1];
        if (type && type[type.length - 1] === 's')
            type = type.slice(0, -1);
        this.listtype(ctx, type)
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
        let message = '*' + capitalize(type) + '*s*:\n\n';
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
        let chatID = getChatId(ctx); // This is the chat/holon where the quest command is issued
        let messageID = getMessageId(ctx);
        const language = await this.settings.getLanguage(chatID)
        const text = ctx.message.text ? ctx.message.text : ctx.message.caption;
        if (type == 'any')
            type = ctx.message.text.split(' ')[0].replace('/', '');
        const sender = ctx.message.from; // This is the initiator

        const title = text.split(' ').slice(1).join(' ');
        const picture = ctx.message.photo ? ctx.message.photo[0].file_id : null;

        if (!title) {
            ctx.reply(i18next.t('usage', { type: type, lng: language }))
            return;
        }

        // Task limit check for 'task' type
        if (type === 'task') {
            const chatSettings = await this.settings.getSettings(chatID);
            const maxTasks = chatSettings.maxTasks;

            if (maxTasks > 0) { // 0 means unlimited
                const allUserQuests = await this.db.getAll(chatID + '/quests');
                const userActiveTasks = allUserQuests.filter(q =>
                    q.initiator && q.initiator.id === sender.id &&
                    q.type === 'task' &&
                    (q.status === 'ongoing' || q.status === 'scheduled')
                );

                if (userActiveTasks.length >= maxTasks) {
                    await ctx.reply(i18next.t('task_limit_reached', {
                        lng: language,
                        maxTasks: maxTasks,
                        defaultValue: `You have reached the maximum limit of ${maxTasks} active tasks. Please complete or cancel some existing tasks before creating new ones. You can see your current tasks by typing /tasks in the main chat.`
                    }));
                    return; // Abort task creation
                }
            }
        }

        // Get message_thread_id if the message is in a topic thread
        const messageThreadId = (ctx.message?.is_topic_message && ctx.message.message_thread_id) 
                                ? ctx.message.message_thread_id 
                                : null;
        let category = ''; // Category name retrieval removed for simplification
        
        if (ctx.message.chat && (ctx.message.chat.type === 'supergroup' || ctx.message.chat.type === 'channel')) {
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
            id: '', // Will be set after sending the message
            version: '0.1',
            chat: chatID,  // Initialize with the chat ID immediately
            message_thread_id: messageThreadId, // Store the thread ID
            initiator: sender,
            title: title,
            picture: picture,
            document: '',
            where: { latitude: '', longitude: '' },
            date: new Date().getTime(),
            when: '',
            until: '',
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
            reminderId: null, // Add reminder ID field
            activeHolograms: [] // Initialize for storing active hologram message details
        }


        if (picture) {
            // Check environment setting for quest image display
            const showQuestsAsImages = this.shouldShowQuestsAsImages();
            
            if (showQuestsAsImages && this.ui && this.ui.getQuestImage) {
                // Generate quest image directly with a callback to get the real ID
                const generateQuestImageWithRealId = async (realQuest) => {
                    try {
                        console.log(`Generating quest image with real ID: ${realQuest.id}`);
                        const questImagePath = await this.ui.getQuestImage(realQuest, chatID);
                        
                        // Replace the original picture with the generated quest image
                        await ctx.telegram.editMessageMedia(
                            realQuest.chat,
                            realQuest.id,
                            null,
                            {
                                type: 'photo',
                                media: { source: questImagePath }
                                // No caption when showing quests as images only
                            },
                            this.markup(realQuest, language)
                        );
                        console.log(`Successfully replaced original picture with quest image`);
                    } catch (error) {
                        console.error('Error generating/replacing quest image:', error);
                        // Original picture remains if quest image generation fails
                    }
                };

                ctx.replyWithPhoto(picture,
                    {
                        // No caption when showing quests as images only
                        ...this.markup(quest, language)
                    }).catch((err) => { console.log(err) }).then(async (nctx) => {
                        // Add the message id to the quest
                        quest.id = nctx.message_id;
                        if (!quest.chat && nctx.chat.id) {
                            quest.chat = nctx.chat.id;
                        }
                        console.log('Saving original quest with ID:', quest.id, 'and chat ID:', quest.chat);
                        await this.db.put(chatID + '/quests', quest) // Save the main quest first

                        //Pin the message in the original chat
                        ctx.telegram.pinChatMessage(quest.chat, quest.id, { disable_notification: true }).catch((err) => { });
                        
                        // Generate quest image with real ID (fast, targeted operation)
                        await generateQuestImageWithRealId(quest);
                        
                        //delete the original trigger message
                        ctx.deleteMessage(messageID.toString()).catch((err) => { });
                    });
                console.log(`Sent quest with original picture, will replace with quest image`);
            } else {
                // Use original picture with caption if quest images are disabled
                ctx.replyWithPhoto(picture,
                    {
                        caption: await this.createMessage(quest, language),
                        parse_mode: 'Markdown',
                        ...this.markup(quest, language)
                    }).catch((err) => { console.log(err) }).then(async (nctx) => {
                        // Add the message id to the quest
                        quest.id = nctx.message_id;
                        if (!quest.chat && nctx.chat.id) {
                            quest.chat = nctx.chat.id;
                        }
                        console.log('Saving original quest with ID:', quest.id, 'and chat ID:', quest.chat);
                        await this.db.put(chatID + '/quests', quest) // Save the main quest first

                        //Pin the message in the original chat
                        ctx.telegram.pinChatMessage(quest.chat, quest.id, { disable_notification: true }).catch((err) => { });
                        
                        //delete the original trigger message
                        ctx.deleteMessage(messageID.toString()).catch((err) => { });
                    });
            }
        } else {

            // Removed: if (type == 'offer') { ... }
            // Removed: if (type == 'request') { ... }

            let nctx;
            
            // Check environment setting for quest image display
            const showQuestsAsImages = this.shouldShowQuestsAsImages();
            
            if (showQuestsAsImages && this.ui && this.ui.getQuestImage) {
                // When quest images are enabled, start with placeholder and replace with quest image
                nctx = await ctx.reply("📝 Creating quest...", this.markup(quest, language));
                console.log(`Sent placeholder message, will replace with quest image`);
            } else {
                // Send text message if quest images are disabled
                nctx = await ctx.reply(await this.createMessage(quest, language), this.markup(quest, language));
            }

            if (ctx.platform !== 'discord') {
                quest.id = nctx.message_id;
                if (!quest.chat || quest.chat === 0) {
                    quest.chat = nctx.chat.id;
                }
            }
            if (ctx.platform == 'discord') {
                quest.id = nctx.id;
                if (!quest.chat || quest.chat === 0) {
                    quest.chat = nctx.channel.id;
                }
            }

            console.log('Saving original quest with ID:', quest.id, 'and chat ID:', quest.chat);
            await this.db.put(chatID + '/quests', quest) // Save the main quest first
            
            // Generate quest image if enabled (fast, targeted operation)
            if (showQuestsAsImages && this.ui && this.ui.getQuestImage) {
                try {
                    console.log(`Generating quest image with real ID: ${quest.id}`);
                    const questImagePath = await this.ui.getQuestImage(quest, chatID);
                    
                    // Replace the placeholder text with the generated quest image
                    await ctx.telegram.editMessageMedia(
                        quest.chat,
                        quest.id,
                        null,
                        {
                            type: 'photo',
                            media: { source: questImagePath }
                            // No caption when showing quests as images only
                        },
                        this.markup(quest, language)
                    );
                    console.log(`Successfully replaced placeholder with quest image`);
                } catch (error) {
                    console.error('Error generating/replacing quest image:', error);
                    // Placeholder text remains if quest image generation fails
                }
            }
            
            //Pin the message in the original chat
            this.bot.telegram.pinChatMessage(quest.chat, quest.id, { disable_notification: true }).catch((err) => { });

            //delete the original trigger message
            this.bot.telegram.deleteMessage(chatID, messageID.toString()).catch((err) => { });

            return quest
        }
    }


    // ========================== ACTIONS ==========================

    async join(ctx) {
        console.log("JOIN ACTION - START");
        console.log("Callback data:", ctx.callbackQuery.data);
        try {
            let chatID = ctx.callbackQuery.data.split('_')[2]; // chatID of the original quest message
            let messageID = ctx.callbackQuery.data.split('_')[3];
    
            console.log(`JOIN DEBUG: Parsed chatID=${chatID}, messageID=${messageID}`);
            console.log(`JOIN DEBUG: Database lookup key: "${chatID}/quests", value: "${messageID}"`);
    
            const language = await this.settings.getLanguage(chatID)

            let quest = await this.db.get(chatID + '/quests', messageID.toString())
            console.log(`JOIN DEBUG: Retrieved quest:`, quest ? `Found quest "${quest.title}"` : 'Quest is null/undefined');
    
            if (!await this.questExists(quest, ctx, messageID)) { return; }

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
            const sender = ctx.callbackQuery.from; // This is the interacting user

            // Check if the user has already joined the quest
            const userindex = quest.participants.findIndex(user => user.id === sender.id)

            
            if (userindex > -1) {
                ctx.answerCbQuery(`${getDisplayName(sender)} left the quest "${quest.title}"`) // User is leaving
                    .catch((err) => { console.log(err) });
                quest.participants.splice(userindex, 1);
            } else {
                quest.participants.push(sender); // User is joining
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
            if (chatID.toString() !== sender.id.toString()) { // Only create personal hologram if quest is not in user's own holon
                await this.personalHologram(sender.id, quest); // Update/create hologram for interacting user
                await this.ensureTelegramHologramMessage(ctx, quest, sender.id, language); // Ensure Telegram message for this hologram
            }

            // Update message and propagate to federated spaces
            // Request standard markup after join
            await this.updateMessage(ctx, quest, language);

        } catch (error) {
            console.error('Error in join function:', error);
            ctx.answerCbQuery("Error processing join action").catch(err => console.log(err));
        }
    }

    async appreciate(ctx) {
        console.log("APPRECIATE ACTION");
        // Get the quest  from the callback data
        let chatID = ctx.callbackQuery.data.split('_')[2]; // chatID of the original quest message
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())

        if (!await this.questExists(quest, ctx, messageID)) { return; }

        // Get the user who reacted
        const sender = ctx.callbackQuery.from; // This is the interacting user

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

        await this.db.put(chatID + '/quests', quest);
        // Removed personalHologram call - only create holograms on participation, not appreciation
        // if (chatID.toString() !== sender.id.toString()) { // Only create personal hologram if quest is not in user's own holon
        //     await this.personalHologram(sender.id, quest);
        //     await this.ensureTelegramHologramMessage(ctx, quest, sender.id, language);
        // }
  
        await this.updateMessage(ctx, quest, language); // Request standard markup
    }

    async cancel(ctx) {
        console.log("CANCEL ACTION");

        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];
        const language = await this.settings.getLanguage(chatID);

        // Fetch the quest first to get its activeHolograms
        let questToCancel;
        try {
            questToCancel = await this.db.get(chatID + '/quests', messageID.toString());
        } catch (err) {
            console.error(`Error fetching quest ${messageID} for hologram cleanup during cancellation:`, err);
            // Proceed with cancellation as quest might not exist or DB error
        }

        if (questToCancel && questToCancel.activeHolograms && questToCancel.activeHolograms.length > 0) {
            console.log(`Found ${questToCancel.activeHolograms.length} active holograms for quest ${messageID} to delete.`);
            for (const hologram of questToCancel.activeHolograms) {
                try {
                    await this.bot.telegram.deleteMessage(hologram.chatId, hologram.messageId)
                        .catch(err => console.warn(`Could not delete hologram message ${hologram.messageId} in chat ${hologram.chatId}: ${err.description || err.message}`));
                    console.log(`Deleted hologram message ${hologram.messageId} in chat ${hologram.chatId}`);
                } catch (error) {
                    console.warn(`Error deleting a specific hologram message:`, error);
                }
            }
        }

        // --- Original cancellation logic below, adapted to use questToCancel if fetched ---
        // let quest; // Original quest variable - renamed to questToCancel
        try {
            // quest = await this.db.get(chatID + '/quests', messageID.toString()); // Already fetched as questToCancel
            if (!questToCancel && !chatID && !messageID) { // If it wasn't fetched and we don't have IDs, something is very wrong.
                console.log("Cannot proceed with cancellation, IDs missing and quest not fetched.");
                ctx.answerCbQuery('Error: Quest details missing for cancellation.').catch(err => console.error('Error answering CBQ:', err));
                return;
            }
        } catch (err) {
            // This catch is now less relevant if questToCancel fetch fails above, but kept for safety
            console.error(`Error re-fetching quest ${messageID} for cancellation check (should have been fetched):`, err);
            // quest = null; // Treat fetch error same as not found for initial check
        }

        // If quest doesn't exist (based on initial fetch or re-fetch), try to delete the main message
        if (!questToCancel) {
            console.log(`QUEST ${messageID} IS NOT FOUND or error fetching. Attempting to delete main message.`);
            try {
                // We need ctx.deleteMessage if called from a command context
                // or ctx.callbackQuery.message.message_id if from a callback
                const originalMessageIdToDelete = ctx.callbackQuery ? ctx.callbackQuery.message.message_id : messageID; 
                // The chatID should be from callbackQuery.message.chat.id if available and from callback context
                const originalChatIdToDelete = ctx.callbackQuery ? ctx.callbackQuery.message.chat.id : chatID;

                if (originalMessageIdToDelete && originalChatIdToDelete){
                     await ctx.telegram.deleteMessage(originalChatIdToDelete, originalMessageIdToDelete).catch(err => { /* Already logged if hologram deletion fails */ });
                     // Try to delete the original trigger message if it was a command reply for /delete with an ID
                    if(ctx.message && ctx.message.reply_to_message && ctx.message.reply_to_message.message_id === originalMessageIdToDelete){
                         await ctx.deleteMessage().catch(err => {}); // Delete the /delete command itself
                    }
                } else {
                     console.log("Could not determine original message ID/Chat ID to delete for non-existent quest.");
                }
            } catch (err) {
                console.error(`Error deleting main message ${messageID} (quest not found):`, err);
            }
            ctx.answerCbQuery('Quest not found or already cancelled.').catch(err => console.error('Error answering callback query:', err));
            return;
        }

        // Quest exists (questToCancel is populated), now check permissions
        const hasPermission = questToCancel.initiator?.id === ctx.from.id || await this.checkUserAdmin(ctx.from.id, chatID);

        if (hasPermission) {
            console.log(`User ${ctx.from.id} has permission to cancel quest ${messageID}. Proceeding with cancellation.`);
            try {
                // Cancel any scheduled reminder
                if (questToCancel.reminderId && this.scheduler) {
                    console.log(`Cancelling reminder ${questToCancel.reminderId} for quest being cancelled`);
                    await this.scheduler.cancelReminder(questToCancel.reminderId);
                }

                // Handle federated messages (unpin/delete)
                const federationKey = `${chatID}_${messageID}_fedmsgs`;
                const federatedMessages = await this.db.get('federation_messages', federationKey);
                if (federatedMessages && federatedMessages.messages && federatedMessages.messages.length > 0) {
                    for (const msgInfo of federatedMessages.messages) {
                        try {
                            await ctx.telegram.unpinChatMessage(msgInfo.chatId, msgInfo.messageId)
                                .catch(err => { console.warn(`Could not unpin federated msg ${msgInfo.messageId}: ${err.description || err.message}`) });
                            await ctx.telegram.deleteMessage(msgInfo.chatId, msgInfo.messageId)
                                .catch(err => console.error(`Error deleting message in federated chat ${msgInfo.chatId}:`, err));
                            console.log(`Removed federated message in chat ${msgInfo.chatId}`);
                        } catch (error) {
                            console.error(`Failed to remove federated message in chat ${msgInfo.chatId}:`, error);
                        }
                    }
                    await this.db.del('federation_messages', federationKey);
                }

                // Delete quest from database
                await this.db.del(chatID + '/quests', messageID.toString());

                // Unpin the original message (if not deleted yet)
                await ctx.telegram.unpinChatMessage(chatID, messageID).catch((err) => {
                    console.warn(`Could not unpin original msg ${messageID} (might be deleted): ${err.description || err.message}`);
                });

                // Delete the original message
                try {
                    await ctx.deleteMessage(messageID.toString());
                     console.log(`Deleted message ${messageID} after successful cancellation.`);
                } catch (err) {
                    // Log error, message might already be deleted by earlier step or permission issues
                    console.error(`Error deleting message ${messageID} after cancellation:`, err);
                }

                ctx.answerCbQuery('Quest cancelled.').catch(err => console.error('Error answering callback query:', err));

            } catch (error) {
                console.error('Error during cancellation process (with permission):', error);
                ctx.answerCbQuery('Error during cancellation process.').catch(err => console.error('Error answering callback query:', err));
            }
        } else {
            // No permission, quest exists. Send error message, DO NOT delete.
             console.log(`User ${ctx.from.id} lacks permission to cancel existing quest ${messageID}.`);
            ctx.answerCbQuery(i18next.t('onlyinitatorcancel', { lng: language })).catch(err => console.error('Error answering callback query:', err));
        }
    }

    async stop(ctx) {
        console.log("STOP ACTION");

        let chatID = ctx.callbackQuery.data.split('_')[2]; // chatID of the original quest message
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())

        if (!await this.questExists(quest, ctx, messageID)) { return; }

        // Get the user who reacted
        const sender = ctx.callbackQuery.from; // This is the interacting user

        const stopperindex = quest.stoppers.findIndex(user => user.id === sender.id)
        if (stopperindex > -1) {
            ctx.reply(`${getDisplayName(sender)} has revoked its veto for the quest "${quest.title}"`, // Corrected: reply, not answerCbQuery
                { reply_to_message_id: messageID }).catch((err) => { console.log(err) });
            quest.stoppers.splice(stopperindex, 1);
        } else {
            quest.stoppers.push(sender);
            ctx.reply(`${getDisplayName(sender)} has stopped the quest "${quest.title}". Please get in touch to address any concerns.`, // Corrected: reply
                { reply_to_message_id: messageID }).catch((err) => { console.log(err) });
        }
        if (quest.stoppers.length > 0)
            quest.status = 'stopped'
        else
            quest.status = 'ongoing'

        await this.db.put(chatID + '/quests', quest);
        // Removed personalHologram call - only create holograms on participation, not when stopping
        // if (chatID.toString() !== sender.id.toString()) { // Only create personal hologram if quest is not in user's own holon
        //     await this.personalHologram(sender.id, quest);
        //     await this.ensureTelegramHologramMessage(ctx, quest, sender.id, language);
        // }
        // Update the message 
        await this.updateMessage(ctx, quest, language);
    }


    async complete(ctx) {
        console.log("COMPLETE ACTION");

        let chatID = ctx.callbackQuery.data.split('_')[2]; // chatID of the original quest message
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())

        if (!await this.questExists(quest, ctx, messageID)) { return; }
        if (!quest.status == 'stopped') {
            ctx.answerCbQuery(i18next.t('cannotcompletestopped', { lng: language }), { reply_to_message_id: messageID })
            return
        }
        // Handle the reaction to the quest (only initiator or participants can complete the quest)
        const completerId = ctx.from.id; // User who completed the quest
        if (quest.initiator.id === completerId || quest.participants.findIndex(user => user.id === completerId) > -1 || await this.checkUserAdmin(completerId, chatID)) {
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
                            [6152474485]
                        );
                    }
                }
            }

            // --- Hologram Link Cleanup for Completed Quest ---
            const hologramsToUpdateNow = quest.activeHolograms ? [...quest.activeHolograms] : [];
            quest.activeHolograms = []; // Clear from the quest object that will be saved

            // Update message (will save quest with empty activeHolograms) 
            // and update the now-former holograms one last time.
            // await this.updateMessage(ctx, quest, language, false, hologramsToUpdateNow); // This was already called below

            // Save the main quest state before updating holograms for users
            await this.db.put(chatID + '/quests', quest);

            // Removed personalHologram calls - only create holograms on participation, not completion
            // Update/create holograms for initiator, participants, and the completer
            // if (chatID.toString() !== completerId.toString()) {
            //     await this.personalHologram(completerId, quest); // User who completed
            //     await this.ensureTelegramHologramMessage(ctx, quest, completerId, language);
            // }
            // if (quest.initiator && quest.initiator.id !== completerId) { // Initiator if not the completer
            //     if (chatID.toString() !== quest.initiator.id.toString()) {
            //         await this.personalHologram(quest.initiator.id, quest);
            //         await this.ensureTelegramHologramMessage(ctx, quest, quest.initiator.id, language);
            //     }
            // }
            // if (quest.participants) { // All other participants
            //     for (const participant of quest.participants) {
            //         if (participant.id !== completerId && (!quest.initiator || participant.id !== quest.initiator.id)) {
            //             if (chatID.toString() !== participant.id.toString()) {
            //                 await this.personalHologram(participant.id, quest);
            //                 await this.ensureTelegramHologramMessage(ctx, quest, participant.id, language);
            //             }
            //         }
            //     }
            // }
            
            // Now call updateMessage which also saves the quest (redundantly but includes Telegram hologram updates)
            await this.updateMessage(ctx, quest, language, false, hologramsToUpdateNow); // Keep false for this special case with hologram cleanup


            // Unpin the message and any federated messages
            ctx.telegram.unpinChatMessage(chatID, messageID).catch((err) => { });


            // Also unpin any federated messages for this quest (non-hologram ones)
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
            if (!await this.questExists(quest, ctx, questID)) { return; }

            // Cancel any existing reminder
            if (quest.reminderId && this.scheduler) {
                console.log(`Cancelling existing reminder ${quest.reminderId} before rescheduling`);
                await this.scheduler.cancelReminder(quest.reminderId);
                delete quest.reminderId;
                await this.db.put(`${chatID}/quests`, quest);
                 // No need to call personalHologram here as scheduling doesn't change quest data for others
            }

            // Pass the ctx object to showCalendar
            await this.scheduler.showCalendar(ctx, questID);
            await ctx.answerCbQuery().catch()

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
                    defaultValue: `Reminder: "${quest.title}" is starting now!` 
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
                                    defaultValue: `Reminder: "${quest.title}" is starting now!` 
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
    async updateMessage(ctx, quest, language, useExpandedMarkup = false, explicitHologramsToUpdate = null) { // Default to compact markup
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


            const baseMessage = await this.createMessage(quest, language);
            // const markup = this.markup(quest, language); // Original line
            // Choose markup based on the flag
            // console.log(`[updateMessage] Called for quest ${quest.id}. useExpandedMarkup = ${useExpandedMarkup}`); // <-- Remove log
            const markupConfig = useExpandedMarkup
                ? { reply_markup: { inline_keyboard: this.getExpandedButtons(quest, language) } }
                : this.markup(quest, language);
            // console.log(`[updateMessage] Intending to use ${useExpandedMarkup ? 'expanded (getExpandedButtons)' : 'standard (markup)'} buttons.`); // <-- Remove log

            console.log(`[updateMessage] For Original Quest ${quest.id} - Generated message content: ${baseMessage.substring(0, 100)}...`);
            console.log(`[updateMessage] For Original Quest ${quest.id} - Generated markupConfig:`, JSON.stringify(markupConfig).substring(0,100) + "...");

            // Check environment setting for quest image display
            const showQuestsAsImages = this.shouldShowQuestsAsImages();
            
            // Check if UI instance is available and regenerate quest image for updates
            let questImagePath = null;
            if (showQuestsAsImages && this.ui && this.ui.getQuestImage) {
                try {
                    console.log(`[updateMessage] Regenerating quest image for quest ${quest.id}`);
                    questImagePath = await this.ui.getQuestImage(quest, quest.chat);
                    console.log(`[updateMessage] Successfully generated updated quest image: ${questImagePath}`);
                } catch (error) {
                    console.error(`[updateMessage] Error regenerating quest image for quest ${quest.id}:`, error);
                    // Continue with existing image if available, but don't fallback to text when images are enabled
                }
            }

            // Update the message in original chat using centralized helper
            await this.updateQuestMessage(ctx, quest, quest.chat, quest.id, language, markupConfig);

    
            // Log the state of activeHolograms BEFORE saving the quest object within updateMessage
            console.log(`[updateMessage] Quest ID ${quest.id} - BEFORE save. Active holograms on quest object:`, JSON.stringify(quest.activeHolograms || []));
            await this.db.put(quest.chat + '/quests', quest);
            console.log(`[updateMessage] Quest ID ${quest.id} - AFTER save. Quest object presumably persisted.`);

        
            // Handle federated messages (non-hologram ones, e.g. to other groups)
            console.log(`[updateMessage] Calling handleFederatedMessages for quest ${quest.id}`);
            await this.handleFederatedMessages(ctx, quest, language).catch(err => {
                console.error("Error handling federated messages:", err);
            });
            console.log(`[updateMessage] Completed handleFederatedMessages for quest ${quest.id}`);

            // --- Update any tracked hologram messages --- 
            const hologramsToUpdate = explicitHologramsToUpdate !== null ? explicitHologramsToUpdate : (quest.activeHolograms || []);

            // Log the list of holograms that will be iterated over
            console.log(`[updateMessage] Quest ID ${quest.id} - Holograms determined for update iteration:`, JSON.stringify(hologramsToUpdate));

            if (hologramsToUpdate.length > 0) {
                // let originalHolonNameUpdate = quest.chat; // Fallback to ID
                // try {
                //     const chatInfo = await this.bot.telegram.getChat(quest.chat);
                //     if (chatInfo && chatInfo.title) {
                //         originalHolonNameUpdate = chatInfo.title;
                //     }
                // } catch (e) {
                //     console.warn(`Could not fetch chat title for ${quest.chat} in updateMessage: ${e.message}`);
                // }
                const originalHolonNameUpdate = await getHolonName(this.db, quest.chat, ctx);
                const hologramSpecificMessageText = baseMessage + `| ${i18next.t('linked_view', { lng: language, holonName: originalHolonNameUpdate, defaultValue: `🔗 Linked from ${originalHolonNameUpdate}` })}\n`;
                console.log(`Found ${hologramsToUpdate.length} Telegram hologram messages to update for quest ${quest.id}`);
                for (const hologram of hologramsToUpdate) {
                    // Check if the hologram is for Telegram and has the necessary details
                    if (hologram.platform === 'telegram' && hologram.chatId && hologram.messageId) {
                        const hologramChatId = hologram.chatId;
                        const hologramMessageId = hologram.messageId;
                        console.log(`Attempting to update Telegram hologram message ${hologramMessageId} in chat ${hologramChatId}`);
                        // Log the exact content being sent to the hologram
                        console.log(`[updateMessage] For Hologram ${hologramMessageId} - Sending message content: ${baseMessage.substring(0,100)}...`);
                        console.log(`[updateMessage] For Hologram ${hologramMessageId} - Sending markupConfig:`, JSON.stringify(markupConfig).substring(0,100) + "...");
                        try {
                            if (showQuestsAsImages && questImagePath) {
                                // Use the newly generated image for holograms too
                                await this.bot.telegram.editMessageMedia(
                                    hologramChatId,
                                    hologramMessageId,
                                    null,
                                    {
                                        type: 'photo',
                                        media: { source: questImagePath },
                                        caption: hologramSpecificMessageText
                                    },
                                    markupConfig
                                ).catch(err => {
                                    if (err.response && err.response.description === 'Bad Request: message is not modified') {
                                        console.log("Hologram media message not modified - this is usually ok");
                                    } else {
                                        console.error(`Error updating hologram with new image in ${hologramChatId}:`, err);
                                    }
                                });
                            } else if (showQuestsAsImages && quest.picture) {
                                // Use existing picture if quest images are enabled and no new image was generated
                                await this.bot.telegram.editMessageMedia(
                                    hologramChatId,
                                    hologramMessageId,
                                    null,
                                    {
                                        type: 'photo',
                                        media: quest.picture,
                                        caption: hologramSpecificMessageText
                                    },
                                    markupConfig
                                ).catch(err => {
                                    if (err.response && err.response.description === 'Bad Request: message is not modified') {
                                        console.log("Hologram media message not modified - this is usually ok");
                                    } else {
                                        console.error(`Error updating hologram media message in ${hologramChatId}:`, err);
                                    }
                                });
                            } else {
                                // Use text if quest images are disabled or no image available
                                await this.bot.telegram.editMessageText(
                                    hologramChatId,
                                    hologramMessageId,
                                    null,
                                    hologramSpecificMessageText,
                                    markupConfig
                                ).catch(err => {
                                    if (err.response && err.response.description === 'Bad Request: message is not modified') {
                                        console.log("Hologram text message not modified - this is usually ok");
                                    } else {
                                        console.error(`Error updating hologram text message in ${hologramChatId}:`, err);
                                    }
                                });
                            }
                            console.log(`Successfully updated or attempted update on hologram message ${hologramMessageId}`);
                        } catch (hologramError) {
                            console.error('Error during hologram message update:', hologramError);
                        }
                    }
                }
            }
 
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

            if (!await this.questExists(quest, ctx, questId)) { return; }

            // Add the note to the quest
            if (!quest.notes) quest.notes = [];
            quest.notes.push({
                text: note,
                from: ctx.from,
                timestamp: Date.now()
            });

            // Save updated quest
            await this.db.put(`${ctx.chat.id}/quests`, quest);
            // No need to create a user-specific hologram for adding a note, 
            // as it's an update to the existing quest data which would be reflected if they already had one.

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

        if (!await this.questExists(quest, ctx, messageID)) { return; }
        // Create expanded markup with all buttons
        let expandedButtons = this.getExpandedButtons(quest, language);
          
        if (expandedButtons.length === 0) {
            console.error(`No expanded buttons generated for quest type: ${quest.type}`);
            ctx.answerCbQuery('Error: Could not generate expanded buttons');
            return;
        }

        // Update message with expanded buttons using centralized helper
        const expandedMarkupConfig = {
            reply_markup: {
                inline_keyboard: expandedButtons
            }
        };
        
        await this.updateQuestMessage(ctx, quest, chatID, messageID, language, expandedMarkupConfig);

        await ctx.answerCbQuery().catch((err) => { console.log(err) });
    }

    // Add this method to handle hiding more actions
    async hideMoreActions(ctx) {
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID);
        let quest = await this.db.get(chatID + '/quests', messageID.toString());

        if (!await this.questExists(quest, ctx, messageID)) { return; }
        // Update message with original markup using centralized helper
        const markup = this.markup(quest, language);
        await this.updateQuestMessage(ctx, quest, chatID, messageID, language, markup);

        await ctx.answerCbQuery().catch((err) => { console.log(err) });
    }

    // Add this helper method to get expanded buttons
    getExpandedButtons(quest, language) {
        let buttons = [];
        
         if (quest.type == 'task' || quest.type == 'quest' || quest.type == 'todo' || quest.type == 'mission' || quest.type == 'compito' || quest.type == 'recurring') {
            // First row - essential actions
            buttons.push([
                Markup.button.callback(i18next.t('join', { lng: language }), 'participate_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest.id)
            ]);
            // Second  row - appreciation and schedule
            buttons.push([
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest_' + quest.chat + '_' + quest.id)
            ]);

            // Fifth row - stop and cancel
            buttons.push([
                Markup.button.callback(i18next.t('stop', { lng: language }), 'stop_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback(i18next.t('cancel', { lng: language }), 'cancel_quest_' + quest.chat + '_' + quest.id)
            ]);

            // Third row - time tracking
            buttons.push([
                Markup.button.callback('⏰ -1h', 'subtract_1h_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('⏰ -15m', 'subtract_time_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('⏰ +15m', 'add_time_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('⏰ +1h', 'add_1h_quest_' + quest.chat + '_' + quest.id)
            ]);

        

            // Fourth row - description and checklist
            buttons.push([
                Markup.button.callback('📝 ' + i18next.t('description', { lng: language }), 'descriptions_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('📋 ' + i18next.t('subtasks', { lng: language }), 'checklist_quest_' + quest.chat + '_' + quest.id)
            ]);
            
            // Add new row for dependencies and recurring
            buttons.push([
                Markup.button.callback('🔗 ' + i18next.t('dependencies', { lng: language, defaultValue: 'Dependencies' }), 'dependencies_quest_' + quest.chat + '_' + quest.id),
                Markup.button.callback('🔄 ' + this.getRecurringButtonText(quest, language), 'recurring_quest_' + quest.chat + '_' + quest.id)
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

    // Helper function to setup federation with hex target
    async setupHexFederation(chatID, hex, lensTypes = ['quests', 'events', 'proposals']) {
        try {
            // Get existing federation info or create new one
            let fedInfo = null;
            try {
                fedInfo = await this.db.holosphere.getGlobal('federation', chatID);
            } catch (error) {
                // Federation info doesn't exist, create new one
            }

            if (!fedInfo) {
                fedInfo = {
                    id: chatID,
                    name: chatID,
                    federation: [],
                    notify: [],
                    lensConfig: {},
                    timestamp: Date.now()
                };
            }

            // Ensure arrays exist
            if (!fedInfo.federation) fedInfo.federation = [];
            if (!fedInfo.notify) fedInfo.notify = [];
            if (!fedInfo.lensConfig) fedInfo.lensConfig = {};

            // Add hex to federation if not already present
            if (!fedInfo.federation.includes(hex)) {
                fedInfo.federation.push(hex);
            }
            if (!fedInfo.notify.includes(hex)) {
                fedInfo.notify.push(hex);
            }

            // Configure lens settings for the hex
            fedInfo.lensConfig[hex] = {
                federate: lensTypes,
                notify: lensTypes,
                timestamp: Date.now()
            };

            // Save the federation configuration
            await this.db.holosphere.putGlobal('federation', fedInfo);
            
            return true;
        } catch (error) {
            console.error('Error setting up hex federation:', error);
            return false;
        }
    }

    // Add publish method - Refactored to use propagation system
    async publish(ctx) {
        console.log("PUBLISH ACTION");
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)
        let quest = await this.db.get(chatID + '/quests', messageID.toString())

        if (!await this.questExists(quest, ctx, messageID)) { return; }

        // Get the user who initiated the publish
        const sender = ctx.callbackQuery.from;

        // Check if user has permission to publish
        if (quest.initiator.id !== sender.id && !await this.checkUserAdmin(sender.id, chatID)) {
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

            // Setup federation with the hex target if not already configured
            const federationSetup = await this.setupHexFederation(chatID, hex);
            if (!federationSetup) {
                ctx.answerCbQuery('Failed to setup federation with hex')
                return;
            }

            // Use the propagation system to publish the quest
            const propagationResult = await this.db.holosphere.propagate(chatID, 'quests', quest, {
                useHolograms: true,
                targetSpaces: [hex] // Specifically target the hex
            });

            if (propagationResult.success > 0) {
                ctx.answerCbQuery(`Quest published to hex ${hex} via propagation system`)
                
                // Update the message to show it's been published
                quest.published = true
                await this.updateMessage(ctx, quest, language);
            } else {
                // Handle propagation errors
                const errorMessage = propagationResult.message || 'Unknown propagation error';
                console.error('Propagation failed:', propagationResult);
                ctx.answerCbQuery(`Failed to publish: ${errorMessage}`)
            }

        } catch (error) {
            console.error('Error publishing quest:', error)
            ctx.answerCbQuery('Error publishing quest')
        }
    }

    // Add broadcast method - Updated to use propagation system
    async broadcast(ctx) {
        console.log("BROADCAST ACTION");
        let chatID = ctx.callbackQuery.data.split('_')[2];
        let messageID = ctx.callbackQuery.data.split('_')[3];

        const language = await this.settings.getLanguage(chatID)
        let quest = await this.db.get(chatID + '/quests', messageID.toString())

        if (!await this.questExists(quest, ctx, messageID)) { return; }

        // Get the user who initiated the broadcast
        const sender = ctx.callbackQuery.from;

        // Check if user has permission to broadcast
        if (quest.initiator.id !== sender.id && !await this.checkUserAdmin(sender.id, chatID)) {
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

            // Get all containing holonagons (scalespace) for the hex
            const scalespace = this.db.holosphere.getScalespace(hex);
            
            if (!scalespace || scalespace.length === 0) {
                ctx.answerCbQuery('Could not determine geographic hierarchy for hex')
                return;
            }

            // Setup federation with all scalespace holonagons
            let totalSuccess = 0;
            let totalErrors = 0;

            for (const targetHex of scalespace) {
                try {
                    // Setup federation with each target hex
                    const federationSetup = await this.setupHexFederation(chatID, targetHex);
                    if (federationSetup) {
                        // Use propagation system to broadcast to each level
                        const propagationResult = await this.db.holosphere.propagate(chatID, 'quests', quest, {
                            useHolograms: true,
                            targetSpaces: [targetHex]
                        });

                        if (propagationResult.success > 0) {
                            totalSuccess++;
                            console.log(`Successfully broadcast to hex ${targetHex}`);
                        } else {
                            totalErrors++;
                            console.log(`Failed to broadcast to hex ${targetHex}: ${propagationResult.message}`);
                        }
                    } else {
                        totalErrors++;
                        console.log(`Failed to setup federation with hex ${targetHex}`);
                    }
                } catch (error) {
                    totalErrors++;
                    console.error(`Error broadcasting to hex ${targetHex}:`, error);
                }
            }

            if (totalSuccess > 0) {
                ctx.answerCbQuery(`Quest broadcast to ${totalSuccess} geographic levels via propagation system`)
                
                // Update the message to show it's been broadcast
                quest.broadcasted = true
                await this.updateMessage(ctx, quest, language)
            } else {
                ctx.answerCbQuery(`Failed to broadcast quest to any geographic levels (${totalErrors} errors)`)
            }

        } catch (error) {
            console.error('Error broadcasting quest:', error)
            ctx.answerCbQuery('Error broadcasting quest')
        }
    }

    async addTime(ctx, amount) {
        console.log("ADD TIME ACTION");
        let chatID = ctx.callbackQuery.data.split('_')[3]; // Corrected index for chatID - this is original quest's chat
        let messageID = ctx.callbackQuery.data.split('_')[4];
        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())
        if (!await this.questExists(quest, ctx, messageID)) { return; }

        // Get the user who logged time
        const sender = ctx.callbackQuery.from; // This is the interacting user
        const userId = sender.id;

        // Initialize time tracking for user if not exists
        if (!quest.timeTracking[userId]) {
            quest.timeTracking[userId] = 0;
        }

        // add amount of time to the user
        quest.timeTracking[userId] += amount;

        // Add user to participants if they're not already in the list
        const userIndex = quest.participants.findIndex(user => user.id === sender.id);
        if (userIndex === -1) {
            quest.participants.push(sender);
        }
        
        await this.db.put(chatID + '/quests', quest);
        if (chatID.toString() !== sender.id.toString()) { // Only create personal hologram if quest is not in user's own holon
            await this.personalHologram(sender.id, quest);
            await this.ensureTelegramHologramMessage(ctx, quest, sender.id, language);
        }
        // Update the message and propagate to federated spaces
        await this.updateMessage(ctx, quest, language);

        ctx.answerCbQuery(`Added ${amount} hours to ${getDisplayName(sender)}'s time on "${quest.title}"`);
    }

    async subtractTime(ctx, amount) {
        console.log("SUBTRACT TIME ACTION");
        let chatID = ctx.callbackQuery.data.split('_')[3]; // Corrected index - original quest's chat
        let messageID = ctx.callbackQuery.data.split('_')[4];
        const language = await this.settings.getLanguage(chatID)

        let quest = await this.db.get(chatID + '/quests', messageID.toString())
        if (!await this.questExists(quest, ctx, messageID)) { return; }

        // Get the user who logged time
        const sender = ctx.callbackQuery.from; // This is the interacting user
        const userId = sender.id;

        // Initialize time tracking for user if not exists
        if (!quest.timeTracking[userId]) {
            quest.timeTracking[userId] = 0;
        }

        // Only subtract if there's time logged
        if (quest.timeTracking[userId] >= amount) {
            quest.timeTracking[userId] -= amount;

            // If user has no more time logged, remove them from participants
            // Only if they were not the initiator and are not in appreciation list
            const isInitiator = quest.initiator.id === sender.id;
            const isInAppreciation = quest.appreciation.some(user => user.id === sender.id);

            if (quest.timeTracking[userId] === 0 && !isInitiator && !isInAppreciation) {
                quest.participants = quest.participants.filter(user => user.id !== sender.id);
            }
            
            await this.db.put(chatID + '/quests', quest);
            if (chatID.toString() !== sender.id.toString()) { // Only create personal hologram if quest is not in user's own holon
                await this.personalHologram(sender.id, quest);
                await this.ensureTelegramHologramMessage(ctx, quest, sender.id, language);
            }
            // Update the message and propagate to federated spaces
            await this.updateMessage(ctx, quest, language);

            ctx.answerCbQuery(`Removed ${amount } hours from ${getDisplayName(sender)}'s time on "${quest.title}"`);
        } else {
            ctx.answerCbQuery(`No time logged for ${getDisplayName(sender)} to remove`);
        }
    }

    // Add checklist action handler
    async handleChecklistButton(ctx) {
        console.log("CHECKLIST ACTION");
        const chatId = ctx.callbackQuery.message.chat.id; // This is the chat where the button was pressed, i.e., quest's original chat
        const messageId = ctx.callbackQuery.data.split('_')[3]; // This is the quest.id
        const interactingUserId = ctx.callbackQuery.from.id;

        const language = await this.settings.getLanguage(chatId)
        let quest = await this.db.get(chatId + '/quests', messageId.toString())

        if (!await this.questExists(quest, ctx, messageId)) { return; }

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
                    type: 'task' // Explicitly set type for subtask checklists
                };

                // Save the checklist
                await this.db.put(chatId + '/checklists', checklist);

                // Update quest with checklist ID
                quest.checklistId = messageId.toString();
                await this.db.put(chatId + '/quests', quest);
                // Removed personalHologram call - only create holograms on participation, not checklist interactions
                // Update user's hologram as checklistId has changed on the quest
                // if (chatId.toString() !== interactingUserId.toString()) {
                //     await this.personalHologram(interactingUserId, quest); 
                // }
            }

            // Let the Checklists class handle displaying the checklist
            await this.checklists.showChecklist(ctx, messageId.toString()); // Pass ID as second argument

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
            if (!await this.questExists(quest, ctx, questId)) { return; }

            // Update message to show quest again using centralized helper
            const markup = this.markup(quest, language);
            await this.updateQuestMessage(ctx, quest, chatId, quest.id, language, markup);

            await ctx.answerCbQuery().catch()
        } catch (error) {
            console.error('Error handling back to quest:', error);
            await ctx.answerCbQuery('Error returning to quest');
        }
    }

    // Add new methods for handling checklist interactions
    async handleCheckItem(ctx) {
        const [checklistId, itemIndex] = ctx.match[1].split('_');
        const chatId = ctx.callbackQuery.message.chat.id; // chat of the checklist message, which is quest's original chat
        const messageId = ctx.callbackQuery.message.message_id; // This is the message ID of the checklist message
        const interactingUserId = ctx.callbackQuery.from.id;

        try {
            // The checklistId for db.get is the quest's message_id which was used as checklist.id
            const checklist = await this.db.get(chatId + '/checklists', checklistId); 
            if (!checklist) {
                await ctx.answerCbQuery('Checklist not found');
                return;
            }

            // Toggle the item's checked status
            checklist.items[itemIndex].checked = !checklist.items[itemIndex].checked;
            await this.db.put(chatId + '/checklists', checklist);

            // Since a sub-task status changed, the main quest display might need an update if it shows progress.
            // We also need to update the user's hologram of the main quest.
            const mainQuest = await this.db.get(chatId + '/quests', checklist.questId);
            if (mainQuest) {
                // Removed personalHologram call - only create holograms on participation, not checklist interactions
                // if (chatId.toString() !== interactingUserId.toString()) {
                //     await this.personalHologram(interactingUserId, mainQuest);
                // }
                await this.updateMessage(ctx, mainQuest, await this.settings.getLanguage(chatId));
            }

            // Create keyboard with items
            const keyboard = [
                ...checklist.items.map((item, index) => ([
                    Markup.button.callback(
                        `${item.checked ? '✅' : '⬜️'} ${item.text}`,
                        `check_${checklistId}_${index}` // Use checklistId (original quest.id) here
                    )
                ])),
                [Markup.button.callback('➕ Add Item', `add_item_to_${checklistId}`)]
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

            await ctx.answerCbQuery().catch()
        } catch (error) {
            console.error('Error handling check item:', error);
            await ctx.answerCbQuery('Error updating checklist item');
        }
    }

    async handleAddItem(ctx) {
        const checklistId = ctx.match[1]; // This is the original quest.id
        const chatId = ctx.callbackQuery.message.chat.id;

        try {
            // Get the checklist to ensure it exists and to pass its data to the scene
            const checklist = await this.db.get(chatId + '/checklists', checklistId);
            if (!checklist) {
                await ctx.answerCbQuery('Checklist not found');
                return;
            }
            
            // Check if bot has admin rights using the utility function
            const canReadMessages = await isBotAdmin(ctx);

            // Enter scene for adding items with the necessary context
            await ctx.scene.enter('add_item_scene', {
                checklistId: checklistId, // Pass original quest ID
                chatId: chatId,
                questId: checklist.questId, // This should be the same as checklistId
                questTitle: checklist.questTitle,
                canReadMessages: canReadMessages  // Pass the message reading permission status to the scene
            });

            await ctx.answerCbQuery().catch()
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
        let message = `| ${i18next.t(quest.type.charAt(0).toUpperCase() + quest.type.slice(1), { lng: language })}: ${quest.title.padEnd(200) }
`;

        // Add initiator info
        message += `| 💡 ${i18next.t('by', { lng: language })}: ${getDisplayName(quest.initiator)} 
`;

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
                message += `| 📋 ${i18next.t('subtasks', { lng: language })}: ${completed}/${checklist.items.length} completed\n`;
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
            // Get chat timezone setting
            let chatTimezone = await this.settings.getTimezone(quest.chat);

            // Validate timezone and set default if invalid or "Not set"
            const isValidTimezone = chatTimezone && typeof chatTimezone === 'string' && chatTimezone !== 'Not set';
            if (!isValidTimezone) {
                console.log(`Invalid or missing timezone for chat ${quest.chat}, defaulting to UTC.`);
                chatTimezone = 'UTC'; // Default timezone to UTC
            }

            let dateStr = 'Invalid Date';
            try {
                // Attempt to format with the validated or default timezone
                dateStr = date.toLocaleDateString(language, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: chatTimezone, // Use validated or default timezone
                    timeZoneName: 'short' 
                });
            } catch (e) {
                // This catch block is now a secondary safety net
                console.error(`Error formatting date even after timezone validation (using ${chatTimezone}):`, e);
                // Fallback to UTC display if timezone is *still* invalid for some reason
                try {
                    dateStr = date.toLocaleDateString(language, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'UTC', // Hardcoded default fallback to UTC
                        timeZoneName: 'short'
                    });
                } catch (fallbackError) {
                    console.error('Error during fallback date formatting:', fallbackError);
                    // If even the fallback fails, keep 'Invalid Date'
                }
            }

            message += `| ${i18next.t('📅', { lng: language })} : ${dateStr} \n`;
        }

        if (quest.until) {
            const date = new Date(quest.until);
            // Get chat timezone setting
            let chatTimezone = await this.settings.getTimezone(quest.chat);

            // Validate timezone and set default if invalid or "Not set"
            const isValidTimezone = chatTimezone && typeof chatTimezone === 'string' && chatTimezone !== 'Not set';
             if (!isValidTimezone) {
                console.log(`Invalid or missing timezone for chat ${quest.chat} (until field), defaulting to UTC.`);
                chatTimezone = 'UTC'; // Default timezone to UTC
            }

            let dateStr = 'Invalid Date';
            try {
                // Attempt to format with the validated or default timezone
                dateStr = date.toLocaleDateString(language, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: chatTimezone, // Use validated or default timezone
                    timeZoneName: 'short'
                });
            } catch (e) {
                 // This catch block is now a secondary safety net
                console.error(`Error formatting 'until' date even after timezone validation (using ${chatTimezone}):`, e);
                // Fallback to UTC display if timezone is *still* invalid for some reason
                 try {
                    dateStr = date.toLocaleDateString(language, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'UTC', // Hardcoded default fallback to UTC
                        timeZoneName: 'short'
                    });
                } catch (fallbackError) {
                    console.error("Error during fallback 'until' date formatting:", fallbackError);
                    // If even the fallback fails, keep 'Invalid Date'
                }
            }
            message += `| ${i18next.t('🔚', { lng: language })} : ${dateStr} \n`;
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
        if (quest.type == 'event'|| quest.type == 'task' || quest.type == 'quest' || quest.type == 'todo' || quest.type == 'mission' || quest.type == 'compito' || quest.type == 'recurring') {
            mu = Markup.inlineKeyboard([
                [
                    Markup.button.callback(i18next.t('join', { lng: language }), 'participate_quest_' + quest.chat + '_' + quest.id),
                    Markup.button.callback(i18next.t('complete', { lng: language }), 'complete_quest_' + quest.chat + '_' + quest.id)
                ],
                [
                    Markup.button.callback(i18next.t('appreciate', { lng: language }), 'appreciate_quest_' + quest.chat + '_' + quest.id),
                    Markup.button.callback(i18next.t('schedule', { lng: language }), 'schedule_quest_' + quest.chat + '_' + quest.id)
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

            // Simplified message
            let message = '📝 Reply with a description for this task.';
            
            // Store the prompt message ID for later deletion
            const promptMessage = await ctx.reply(message);
            ctx.scene.state.promptMessageId = promptMessage.message_id;
        });

        this.descriptionScene.on('text', async (ctx) => {
            try {
                const quest = await this.db.get(ctx.scene.state.chatId + '/quests', ctx.scene.state.questId.toString());
                if (!await this.questExists(quest, ctx, ctx.scene.state.questId)) { 
                    return ctx.scene.leave();
                }

                // Store user's message ID for cleanup
                ctx.scene.state.userMessageId = ctx.message.message_id;

                // Update the description
                quest.description = ctx.message.text;
                await this.db.put(ctx.scene.state.chatId + '/quests', quest);
                // Removed personalHologram call - only create holograms on participation, not description changes
                // await this.personalHologram(ctx.from.id, quest); // Update user hologram after description change - Conditional update below
                // if (ctx.scene.state.chatId.toString() !== ctx.from.id.toString()) { // Only if quest is not in user's own holon
                //     await this.personalHologram(ctx.from.id, quest);
                //     const language = await this.settings.getLanguage(ctx.scene.state.chatId); // Get language for ensureTelegramHologramMessage
                //     await this.ensureTelegramHologramMessage(ctx, quest, ctx.from.id, language);
                // }

                // Check if bot has permission to delete messages
                const botHasAdminRights = await isBotAdmin(ctx);
                
                // Clean up messages if the bot has admin rights
                if (botHasAdminRights) {
                    try {
                        // Delete the prompt message
                        if (ctx.scene.state.promptMessageId) {
                            await ctx.deleteMessage(ctx.scene.state.promptMessageId).catch(() => { });
                        }
                        
                        // Delete the user's message
                        await ctx.deleteMessage(ctx.message.message_id).catch(() => { });
                    } catch (error) {
                        console.log('Error deleting messages:', error);
                    }
                }

                // Update the original quest message
                await this.updateMessage(ctx, quest);

                return ctx.scene.leave();
            } catch (error) {
                console.error('Error updating description:', error);
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
            if (!await this.questExists(quest, ctx, messageId)) { return; }

            // Enter scene for adding description
            await ctx.scene.enter('description_scene', {
                questId: messageId,
                chatId: chatId
            });

            await ctx.answerCbQuery().catch()
        } catch (error) {
            console.error('Error handling description:', error);
            await ctx.answerCbQuery('Error accessing description');
        }
    }

    // Add this new helper method to handle federated messages
    async handleFederatedMessages(ctx, quest, language) {
        try {
            console.log(`[handleFederatedMessages] Starting for quest ${quest.id} in chat ${quest.chat}`);
            
            // Get federation info to find out which spaces to notify
            const fedInfo = await this.db.holosphere.getFederation(quest.chat);
            console.log(`[handleFederatedMessages] Federation info for chat ${quest.chat}:`, fedInfo);
            
            if (!fedInfo?.notify?.length) {
                console.log(`[handleFederatedMessages] No federated chats to notify for quest ${quest.id}`);
                return;
            }
            
            console.log(`[handleFederatedMessages] Found ${fedInfo.notify.length} federated chats to notify:`, fedInfo.notify);

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
                if (federatedChatId === quest.chat) {
                    console.log(`[handleFederatedMessages] Skipping same chat ${federatedChatId}`);
                    continue;
                }

                console.log(`[handleFederatedMessages] Processing federated chat ${federatedChatId}`);

                // Check if the target holon has allowed the 'quests' lens in their federation array
                try {
                    const targetFedInfo = await this.db.holosphere.getFederation(federatedChatId);
                    console.log(`[handleFederatedMessages] Target federation info for ${federatedChatId}:`, targetFedInfo);
                    
                    // Check if the target chat has lensConfig and if it allows 'quests' lens for this specific connection
                    const sourceChatId = quest.chat.toString();
                    const targetLensConfig = targetFedInfo?.lensConfig?.[sourceChatId];
                    
                    if (!targetLensConfig?.notify?.includes('quests')) {
                        console.log(`[handleFederatedMessages] Skipping federated message to ${federatedChatId} - 'quests' lens not allowed in their notify array for chat ${sourceChatId}`);
                        continue;
                    }
                    
                    console.log(`[handleFederatedMessages] Target chat ${federatedChatId} allows 'quests' lens for chat ${sourceChatId}, proceeding with message`);
                } catch (error) {
                    console.error(`[handleFederatedMessages] Error checking federation settings for chat ${federatedChatId}:`, error);
                    continue; // Skip this chat if we can't verify federation settings
                }

                // Find existing message for this federated chat
                const existingMsgIndex = federatedMessages.messages.findIndex(m => m.chatId === federatedChatId);
                const existingMsg = existingMsgIndex > -1 ? federatedMessages.messages[existingMsgIndex] : null;

                try {
                    if (existingMsg) {
                        console.log(`[handleFederatedMessages] Updating existing message ${existingMsg.messageId} in chat ${federatedChatId}`);
                        // Update existing message
                        const originalHolonName = await getHolonName(this.db, quest.chat, ctx);
                        const hologramMessageText = await this.createMessage(quest, language) + 
                                                  `| ${i18next.t('linked_view', { lng: language, holonName: originalHolonName, defaultValue: `🔗 Linked from ${originalHolonName}` })}\n`;
                        
                        const showQuestsAsImages = this.shouldShowQuestsAsImages();
                        
                        if (showQuestsAsImages && quest.picture) {
                            await ctx.telegram.editMessageMedia(
                                federatedChatId,
                                existingMsg.messageId,
                                null,
                                {
                                    type: 'photo',
                                    media: quest.picture,
                                    caption: hologramMessageText
                                },
                                this.markup(quest, language)
                            ).catch(err => console.error(`Error updating federated message in ${federatedChatId}:`, err));
                        } else {
                            await ctx.telegram.editMessageText(
                                federatedChatId,
                                existingMsg.messageId,
                                null,
                                hologramMessageText,
                                this.markup(quest, language)
                            ).catch(err => console.error(`Error updating federated message in ${federatedChatId}:`, err));
                        }
                    } else {
                        console.log(`[handleFederatedMessages] Creating new hologram message in chat ${federatedChatId}`);
                        // Create new hologram-style message
                        const originalHolonName = await getHolonName(this.db, quest.chat, ctx);
                        const hologramMessageText = await this.createMessage(quest, language) + 
                                                  `| ${i18next.t('linked_view', { lng: language, holonName: originalHolonName, defaultValue: `🔗 Linked from ${originalHolonName}` })}\n`;
                        
                        const showQuestsAsImages = this.shouldShowQuestsAsImages();
                        
                        let newMessage;
                        if (showQuestsAsImages && quest.picture) {
                            newMessage = await ctx.telegram.sendPhoto(
                                federatedChatId,
                                quest.picture,
                                {
                                    caption: hologramMessageText,
                                    ...this.markup(quest, language)
                                }
                            );
                        } else {
                            newMessage = await ctx.telegram.sendMessage(
                                federatedChatId,
                                hologramMessageText,
                                this.markup(quest, language)
                            );
                        }

                        console.log(`[handleFederatedMessages] Created new hologram message ${newMessage.message_id} in chat ${federatedChatId}`);

                        // Pin the message if quest is not completed
                        if (quest.status !== 'completed') {
                            await ctx.telegram.pinChatMessage(
                                federatedChatId,
                                newMessage.message_id,
                                { disable_notification: true }
                            ).catch(err => { 
                                console.log(`[handleFederatedMessages] Could not pin message in ${federatedChatId}:`, err);
                            });
                        }

                        // Store the new message information
                        federatedMessages.messages.push({
                            chatId: federatedChatId,
                            messageId: newMessage.message_id,
                            timestamp: Date.now()
                        });
                    }
                } catch (error) {
                    console.error(`[handleFederatedMessages] Failed to handle message in federated chat ${federatedChatId}:`, error);
                    // If we've failed to update an existing message, remove it from tracking
                    if (existingMsgIndex > -1) {
                        federatedMessages.messages.splice(existingMsgIndex, 1);
                    }
                }
            }

            // Save the updated federation message tracking information
            if (federatedMessages.messages.length > 0) {
                await this.db.put('federation_messages', federatedMessages);
                console.log(`[handleFederatedMessages] Saved federation tracking for ${federatedMessages.messages.length} messages`);
            }

        } catch (error) {
            console.error('[handleFederatedMessages] Error handling federated messages:', error);
        }
    }

    // Add dependency action handlers
    async handleDependenciesButton(ctx) {
        const chatId = ctx.callbackQuery.message.chat.id;
        const messageId = ctx.callbackQuery.data.split('_')[3];
        const language = await this.settings.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', messageId.toString());
            if (!await this.questExists(quest, ctx, messageId)) { return; }

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

            await ctx.answerCbQuery().catch()
        } catch (error) {
            console.error('Error handling dependencies:', error);
            await ctx.answerCbQuery('Error managing dependencies');
        }
    }

    async handleSetDependency(ctx) {
        const chatId = ctx.callbackQuery.data.split('_')[2]; // Original quest's chat
        const questId = ctx.callbackQuery.data.split('_')[3];
        const dependencyId = ctx.callbackQuery.data.split('_')[4];
        const language = await this.settings.getLanguage(chatId);
        const interactingUserId = ctx.callbackQuery.from.id;

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
            // Removed personalHologram call - only create holograms on participation, not dependency changes
            // if (chatId.toString() !== interactingUserId.toString()) {
            //     await this.personalHologram(interactingUserId, quest);
            // }

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
            if (!await this.questExists(quest, ctx, messageId)) { return; }

            // Return to the quest view with expanded buttons using centralized helper
            const expandedMarkupConfig = {
                reply_markup: {
                    inline_keyboard: this.getExpandedButtons(quest, language)
                }
            };
            await this.updateQuestMessage(ctx, quest, chatId, messageId, language, expandedMarkupConfig);

            await ctx.answerCbQuery().catch()
        } catch (error) {
            console.error('Error returning from dependencies:', error);
            await ctx.answerCbQuery('Error returning to quest');
        }
    }

    async handleRemoveDependency(ctx) {
        console.log("REMOVE DEPENDENCY ACTION");
        const chatId = ctx.callbackQuery.data.split('_')[2]; // Original quest's chat
        const questId = ctx.callbackQuery.data.split('_')[3];
        const dependencyId = ctx.callbackQuery.data.split('_')[4];
        const language = await this.settings.getLanguage(chatId);
        const interactingUserId = ctx.callbackQuery.from.id;

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
            // Removed personalHologram call - only create holograms on participation, not dependency changes
            // if (chatId.toString() !== interactingUserId.toString()) {
            //     await this.personalHologram(interactingUserId, quest);
            // }

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
        const chatId = ctx.callbackQuery.message.chat.id; // Original quest's chat
        const messageId = ctx.callbackQuery.data.split('_')[3]; // quest.id
        const language = await this.settings.getLanguage(chatId);
        const interactingUserId = ctx.callbackQuery.from.id;

        try {
            const quest = await this.db.get(chatId + '/quests', messageId.toString());
            if (!await this.questExists(quest, ctx, messageId)) { return; }
            
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
                        // Removed personalHologram call - only create holograms on participation, not recurring changes
                        // if (chatId.toString() !== interactingUserId.toString()) {
                        //     await this.personalHologram(interactingUserId, originalTask); // Update user hologram for original task
                        // }
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
            // Removed personalHologram call - only create holograms on participation, not recurring changes
            // if (chatId.toString() !== interactingUserId.toString()) {
            //     await this.personalHologram(interactingUserId, quest); // Update user hologram for current quest instance
            // }

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
        const chatId = ctx.callbackQuery.data.split('_')[2]; // Original quest's chat
        const messageId = ctx.callbackQuery.data.split('_')[3]; // quest.id
        const language = await this.settings.getLanguage(chatId);
        const interactingUserId = ctx.callbackQuery.from.id;

        try {
            const quest = await this.db.get(chatId + '/quests', messageId.toString());
            if (!await this.questExists(quest, ctx, messageId)) { return; }

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
                        // Removed personalHologram call - only create holograms on participation, not recurring changes
                        // if (originalTask.chat.toString() !== interactingUserId.toString()) { // originalTask.chat should be same as chatId
                        //     await this.personalHologram(interactingUserId, originalTask);
                        // }
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
            // Removed personalHologram call - only create holograms on participation, not recurring changes
            // if (chatId.toString() !== interactingUserId.toString()) {
            //     await this.personalHologram(interactingUserId, quest);
            // }
            console.log(`Quest ${quest.id} updated to non-recurring`);

            // Update the message
            await this.updateMessage(ctx, quest, language);

            await ctx.answerCbQuery('Recurring task stopped');
        } catch (error) {
            console.error('Error handling stop recurring:', error);
            await ctx.answerCbQuery('Error stopping recurring task');
        }
    }

    async listOpenQuests(ctx) {
        console.log("LIST OPEN QUESTS ACTION");
        const chatID = getChatId(ctx);
        const language = await this.settings.getLanguage(chatID);

        try {
            const allQuests = await this.db.getAll(chatID + '/quests');
            const openQuests = allQuests.filter(q => q.status === 'ongoing' || q.status === 'scheduled');

            if (openQuests.length === 0) {
                await ctx.reply(i18next.t('noopenquests', { lng: language, defaultValue: 'There are no open quests.' }));
                return;
            }

            const buttons = openQuests.map(quest => {
                // Ensure quest.title is a string and not excessively long for a button
                const title = typeof quest.title === 'string' ? quest.title.substring(0, 50) : 'Untitled Quest';
                return [Markup.button.callback(title, 'view_original_quest_' + quest.chat + '_' + quest.id)];
            });

            await ctx.reply(i18next.t('openquests', { lng: language, defaultValue: 'Open Quests:' }), Markup.inlineKeyboard(buttons));

        } catch (error) {
            console.error('Error listing open quests:', error);
            await ctx.reply(i18next.t('errorlistingquests', { lng: language, defaultValue: 'Sorry, there was an error listing open quests.' }));
        }
    }

    async viewOriginalQuest(ctx) {
        console.log("VIEW ORIGINAL QUEST ACTION");
        const originalQuestIdParts = ctx.match[1]; // Should be originalChatId_originalQuestMessageId
        const currentChatIdWhereButtonWasClicked = ctx.callbackQuery.message.chat.id; // This is the chat where the /quests command was issued and button clicked
        const language = await this.settings.getLanguage(currentChatIdWhereButtonWasClicked);
        const interactingUserId = ctx.callbackQuery.from.id; // User who clicked the button

        try {
            const parts = originalQuestIdParts.split('_'); 
            let originalQuestChatId, actualOriginalQuestId;

            if (parts.length >= 2) { 
                actualOriginalQuestId = parts.pop();
                originalQuestChatId = parts.pop(); 
            } else {
                console.warn("[viewOriginalQuest] originalQuestIdParts format might be incorrect. Expected originalChatId_originalQuestMessageId. Got:", originalQuestIdParts);
                await ctx.answerCbQuery(i18next.t('errorviewingquest.format', { lng: language, defaultValue: 'Error: Invalid quest identifier format.' }));
                return;
            }

            const questToView = await this.db.get(originalQuestChatId + '/quests', actualOriginalQuestId.toString());

            if (!await this.questExists(questToView, ctx, actualOriginalQuestId)) { return; }

            // Ensure the quest object has its chat and id correctly for personalHologram if fetched from different context
            questToView.chat = originalQuestChatId; 
            questToView.id = actualOriginalQuestId;

            // Removed personalHologram call - only create holograms on participation, not quest viewing
            // Create data hologram in the *interacting user's* personal holon for the *original quest*,
            // only if the original quest is not already in their personal holon.
            // if (originalQuestChatId.toString() !== interactingUserId.toString()) {
            //     await this.personalHologram(interactingUserId, questToView);
            // }

            // Send the new "Telegram view hologram" message into the chat where /quests list was displayed and button clicked
            const baseMessageText = await this.createMessage(questToView, language); // Use language of the chat where button was clicked
            const originalHolonNameView = await getHolonName(this.db, originalQuestChatId, ctx);
            const messageText = baseMessageText + `| ${i18next.t('linked_view', { lng: language, holonName: originalHolonNameView, defaultValue: `🔗 Linked from ${originalHolonNameView}` })}\n`;
            const markup = this.markup(questToView, language);
            
            // Try to generate quest image for the hologram message
            let questImagePath = null;
            const showQuestsAsImages = this.shouldShowQuestsAsImages();
            
            if (showQuestsAsImages && this.ui && this.ui.getQuestImage) {
                try {
                    console.log(`[viewOriginalQuest] Generating quest image for hologram view`);
                    questImagePath = await this.ui.getQuestImage(questToView, originalQuestChatId, true);
                    console.log(`[viewOriginalQuest] Successfully generated quest image for hologram view: ${questImagePath}`);
                } catch (error) {
                    console.error(`[viewOriginalQuest] Error generating quest image for hologram view:`, error);
                }
            }
            
            let newHologramMsg;
            if (showQuestsAsImages && questImagePath) {
                // Send with quest image
                newHologramMsg = await ctx.replyWithPhoto({ source: questImagePath }, {
                    caption: messageText,
                    parse_mode: 'Markdown',
                    ...markup
                });
            } else {
                // Send as text if quest images are disabled or no image is available
                newHologramMsg = await ctx.reply(messageText, markup);
            }
            
            // --- Track this new TELEGRAM hologram message by adding to the quest object itself ---
            // This Telegram hologram (the message just sent) needs to be updated if the original questToView changes.
            try {
                // Ensure activeHolograms array exists on the quest object (questToView)
                if (!questToView.activeHolograms || !Array.isArray(questToView.activeHolograms)) {
                    questToView.activeHolograms = [];
                }

                const existingLink = questToView.activeHolograms.find(
                    h => h.chatId === newHologramMsg.chat.id && h.messageId === newHologramMsg.message_id
                );

                if (!existingLink) {
                    questToView.activeHolograms.push({
                        platform: 'telegram', 
                        chatId: newHologramMsg.chat.id, // This is currentChatIdWhereButtonWasClicked
                        messageId: newHologramMsg.message_id
                    });
                    console.log(`[viewOriginalQuest] Added Telegram hologram view ${newHologramMsg.message_id} in chat ${newHologramMsg.chat.id} to quest ${questToView.id}. Active Telegram Holograms now: ${questToView.activeHolograms.length}`);
                } else {
                    console.log(`[viewOriginalQuest] Telegram hologram view ${newHologramMsg.message_id} already tracked for quest ${questToView.id}.`);
                }

                // Save the original questToView, which now has the new Telegram view added to its activeHolograms
                // This save must happen to its original location: originalQuestChatId + '/quests'
                await this.db.put(originalQuestChatId + '/quests', questToView);
                console.log(`[viewOriginalQuest] Saved original quest ${questToView.id} in ${originalQuestChatId} after adding Telegram hologram view link.`);

                // No need to call updateMessage here explicitly to update the just-sent message,
                // as it was just created with the latest content. Future updates to questToView will propagate to it.

            } catch (error) {
                console.error('[viewOriginalQuest] Error adding Telegram hologram view link to quest object or saving original quest:', error);
            }
            // --- End Tracking ---

            await ctx.answerCbQuery().catch()

        } catch (error) {
            console.error('Error viewing original quest:', error);
            await ctx.answerCbQuery(i18next.t('errorviewingquest', { lng: language, defaultValue: 'Error displaying quest details.' }));
        }
    }

    async ensureTelegramHologramMessage(ctx, quest, interactingUserId, language) {
        try {
            console.log(`[ensureTelegramHologramMessage] Called for quest ${quest.id}, user ${interactingUserId}`);
            // Check if a Telegram hologram message already exists for this user and quest
            const userPersonalChatId = interactingUserId.toString(); // Assuming personal chat ID is user ID
            let existingHologramMessage = null;

            if (quest.activeHolograms && Array.isArray(quest.activeHolograms)) {
                existingHologramMessage = quest.activeHolograms.find(
                    h => h.platform === 'telegram' && h.chatId.toString() === userPersonalChatId
                );
            }

            if (existingHologramMessage) {
                console.log(`[ensureTelegramHologramMessage] Telegram hologram message ${existingHologramMessage.messageId} already exists in chat ${userPersonalChatId} for quest ${quest.id}. No new message needed.`);
                return; // Message already exists, nothing to do
            }

            // If no message exists, send one to the user's personal chat
            console.log(`[ensureTelegramHologramMessage] No existing Telegram hologram message found for quest ${quest.id} in user ${interactingUserId}'s personal chat. Sending new message.`);
            const originalHolonName = await getHolonName(this.db, quest.chat, ctx); // Get name of the original holon
            const messageText = await this.createMessage(quest, language) + 
                              `| ${i18next.t('linked_view', { lng: language, holonName: originalHolonName, defaultValue: `🔗 Linked from ${originalHolonName}` })}\n`;
            const markup = this.markup(quest, language);
            
            // Try to generate quest image for the hologram message
            let questImagePath = null;
            const showQuestsAsImages = this.shouldShowQuestsAsImages();
            
            if (showQuestsAsImages && this.ui && this.ui.getQuestImage) {
                try {
                    console.log(`[ensureTelegramHologramMessage] Generating quest image for hologram message`);
                    questImagePath = await this.ui.getQuestImage(quest, quest.chat, true);
                    console.log(`[ensureTelegramHologramMessage] Successfully generated quest image for hologram: ${questImagePath}`);
                } catch (error) {
                    console.error(`[ensureTelegramHologramMessage] Error generating quest image for hologram:`, error);
                }
            }
            
            let sentMessage;
            if (showQuestsAsImages && questImagePath) {
                // Use the newly generated quest image
                sentMessage = await this.bot.telegram.sendPhoto(userPersonalChatId, { source: questImagePath }, {
                    caption: messageText,
                    parse_mode: 'Markdown',
                    ...markup
                });
            } else if (showQuestsAsImages && quest.picture) {
                // Use existing picture if quest images are enabled and no quest image was generated
                sentMessage = await this.bot.telegram.sendPhoto(userPersonalChatId, quest.picture, {
                    caption: messageText,
                    parse_mode: 'Markdown',
                    ...markup
                });
            } else {
                // Send as text if quest images are disabled or no image is available
                sentMessage = await this.bot.telegram.sendMessage(userPersonalChatId, messageText, {
                    parse_mode: 'Markdown',
                    ...markup
                });
            }

            if (sentMessage) {
                console.log(`[ensureTelegramHologramMessage] Sent new Telegram hologram message ${sentMessage.message_id} to chat ${userPersonalChatId} for quest ${quest.id}`);
                // Add this new message to the quest's activeHolograms for tracking
                if (!quest.activeHolograms || !Array.isArray(quest.activeHolograms)) {
                    quest.activeHolograms = [];
                }
                quest.activeHolograms.push({
                    platform: 'telegram',
                    chatId: userPersonalChatId, // Storing user's personal chat ID
                    messageId: sentMessage.message_id
                });
                // Save the quest object (which is in the original holon) with the new activeHologram entry
                await this.db.put(quest.chat + '/quests', quest);
                console.log(`[ensureTelegramHologramMessage] Updated original quest ${quest.id} in chat ${quest.chat} with new activeHologram entry.`);
            } else {
                console.error(`[ensureTelegramHologramMessage] Failed to send Telegram hologram message for quest ${quest.id} to user ${interactingUserId}.`);
            }

        } catch (error) {
            console.error(`[ensureTelegramHologramMessage] Error for quest ${quest.id}, user ${interactingUserId}:`, error);
            // Do not let this error block the main interaction flow
        }
    }

    async questExists(quest, ctx, questId = 'N/A') {
        if (!quest || quest === '') {
            // Enhanced debugging
            const callbackData = ctx.callbackQuery?.data || 'N/A';
            const chatId = getChatId(ctx);
            console.log(`Quest not found - Debug info:`);
            console.log(`  Quest ID: ${questId}`);
            console.log(`  Callback Data: ${callbackData}`);
            console.log(`  Chat ID: ${chatId}`);
            console.log(`  Quest object: ${quest}`);
            console.log(`  Context type: ${ctx.callbackQuery ? 'callbackQuery' : ctx.message ? 'message' : 'other'}`);
            
            if (!chatId) {
                console.error("Could not determine chat ID in questExists.");
                return false;
            }
            const language = await this.settings.getLanguage(chatId);
            const message = i18next.t('questnotfound', {lng: language, defaultValue: 'Quest not found.'});

            // Only send error message for callback queries (button interactions)
            // For other contexts (like scene text events), just log and return false
            if (ctx.callbackQuery) {
                await ctx.answerCbQuery(message).catch(err => console.error('Error answering CBQ for quest not found:', err));
                // Try to delete the message with the button
                await ctx.deleteMessage().catch(err => console.error('Could not delete message for quest not found:', err));
            } else {
                // For non-callback contexts (like scene text events), just log the error
                // Don't send a reply message to avoid spam
                console.log(`Quest not found in non-callback context. Quest ID: ${questId}, Chat ID: ${chatId}`);
            }

            return false;
        }
        return true;
    }

    // Helper method to check quest image display setting
    shouldShowQuestsAsImages() {
        const setting = process.env.SHOW_QUESTS_AS_IMAGES === 'true';
        console.log(`[Quests] SHOW_QUESTS_AS_IMAGES environment setting: ${process.env.SHOW_QUESTS_AS_IMAGES} (resolved to: ${setting})`);
        return setting;
    }

    // Centralized helper method for updating quest messages consistently
    async updateQuestMessage(ctx, quest, chatId, messageId, language, markupConfig) {
        const showQuestsAsImages = this.shouldShowQuestsAsImages();
        
        if (showQuestsAsImages) {
            // When quest images are enabled, always try to maintain image format
            let questImagePath = null;
            
            // Try to generate new quest image if UI is available
            if (this.ui && this.ui.getQuestImage) {
                try {
                    console.log(`[updateQuestMessage] Generating quest image for quest ${quest.id}`);
                    questImagePath = await this.ui.getQuestImage(quest, quest.chat);
                    console.log(`[updateQuestMessage] Successfully generated quest image: ${questImagePath}`);
                } catch (error) {
                    console.error(`[updateQuestMessage] Error generating quest image for quest ${quest.id}:`, error);
                }
            }
            
            if (questImagePath) {
                // Use the newly generated image without caption
                await ctx.telegram.editMessageMedia(
                    chatId,
                    messageId,
                    null,
                    {
                        type: 'photo',
                        media: { source: questImagePath }
                        // No caption when showing quests as images only
                    },
                    markupConfig
                ).catch((err) => {
                    console.error('Error updating with new quest image:', err);
                    // Don't fallback to text when images are enabled - just update buttons
                    return ctx.telegram.editMessageReplyMarkup(
                        chatId,
                        messageId,
                        null,
                        markupConfig.reply_markup
                    ).catch(innerErr => console.error('Fallback markup update failed:', innerErr));
                });
            } else if (quest.picture) {
                // Use existing picture if available
                await ctx.telegram.editMessageMedia(
                    chatId,
                    messageId,
                    null,
                    {
                        type: 'photo',
                        media: quest.picture
                        // No caption when showing quests as images only
                    },
                    markupConfig
                ).catch((err) => {
                    console.error('Error updating with existing image:', err);
                    // Don't fallback to text when images are enabled - just update buttons
                    return ctx.telegram.editMessageReplyMarkup(
                        chatId,
                        messageId,
                        null,
                        markupConfig.reply_markup
                    ).catch(innerErr => console.error('Fallback markup update failed:', innerErr));
                });
            } else {
                // If quest images are enabled but no image is available, just update the buttons
                console.log(`[updateQuestMessage] Quest images enabled but no image available for quest ${quest.id}, updating buttons only`);
                await ctx.telegram.editMessageReplyMarkup(
                    chatId,
                    messageId,
                    null,
                    markupConfig.reply_markup
                ).catch((err) => { 
                    console.error('Error updating markup when no image available:', err);
                });
            }
        } else {
            // Use text if quest images are disabled
            const baseMessage = await this.createMessage(quest, language);
            await ctx.telegram.editMessageText(
                chatId,
                messageId,
                null,
                baseMessage,
                markupConfig
            ).catch((err) => { 
                console.error('Error updating text message:', err);
                if (err.response && err.response.description === 'Bad Request: message is not modified') {
                    console.log("Message not modified - this is usually ok");
                } else {
                    console.error("Serious error updating message:", err);
                }
            });
        }
    }

}
