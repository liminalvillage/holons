import { Markup } from 'telegraf';
import i18next from 'i18next';
import { getChatId, getMessageId, capitalize, getDisplayName, isBotAdmin, getHolonName, createPaddedCaption } from './utilities.js';
import { Calendar } from './Calendar.js';
import { Scenes } from 'telegraf';
import { log } from './utils/logger.js';

/**
 * Optimized Quest Management System
 * Reduced from 4,385 lines to ~1,800 lines (59% reduction)
 *
 * Environment Variables:
 * - SHOW_QUESTS_AS_IMAGES: 'true' for image display, 'false' for text-only
 */
export default class Quests {
    constructor(bot, db, users, settings) {
        this.bot = bot;
        this.db = db;
        this.users = users;
        this.settings = settings;
        this.calendar = new Calendar(bot, {
            date_format: 'YYYY/MM/DD HH:mm:ss',
            time_selector_mod: true,
            language: 'en',
            bot_api: 'telegraf'
        });
        
        // External dependencies
        this.expenses = null;
        this.checklists = null;
        this.ui = null;
        this.scheduler = null;
        
        // Cache management
        this.questImageCache = new Map();
        this.imageUpdateQueue = new Map();
        this.imageUpdateTimer = null;

        // Operation queue to prevent race conditions on rapid clicks
        this.questOperationQueues = new Map(); // Map<questKey, Promise>

        // Performance caches
        this.languageCache = new Map();
        this.userCache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes

        // Start cache cleanup timer
        this.startCacheCleanup();

        this.setupScenes();
        this.registerCommands();
        this.registerActions();
    }

    /**
     * Wrap handler functions with error protection
     * Prevents bot from crashing on unhandled errors
     */
    safeHandler(fn) {
        return async (ctx, next) => {
            try {
                await fn.call(this, ctx, next);
            } catch (error) {
                log.error('Quest handler error', {
                    error: error.message,
                    stack: error.stack,
                    handler: fn.name,
                    userId: ctx.from?.id,
                    chatId: ctx.chat?.id,
                    data: ctx.callbackQuery?.data,
                });

                // Try to notify the user
                try {
                    if (ctx.answerCbQuery) {
                        await ctx.answerCbQuery('⚠️ An error occurred. Please try again.').catch(() => {});
                    } else if (ctx.reply) {
                        await ctx.reply('⚠️ An error occurred. Please try again.').catch(() => {});
                    }
                } catch {}

                // Don't rethrow - let the bot continue
            }
        };
    }

    setupScenes() {
        this.descriptionScene = new Scenes.BaseScene('description_scene');
        this.descriptionScene.enter(async (ctx) => {
            const quest = await this.db.get(ctx.scene.state.chatId + '/quests', ctx.scene.state.questId.toString());
            const promptMessage = await ctx.reply('📝 Reply with a description for this task.');
            ctx.scene.state.promptMessageId = promptMessage.message_id;
        });
        
        this.descriptionScene.on('text', async (ctx) => {
            try {
                const quest = await this.db.get(ctx.scene.state.chatId + '/quests', ctx.scene.state.questId.toString());
                if (!await this.questExists(quest, ctx, ctx.scene.state.questId)) {
                    return ctx.scene.leave();
                }
                
                quest.description = ctx.message.text;
                await this.db.put(ctx.scene.state.chatId + '/quests', quest);
                
                const botHasAdminRights = await isBotAdmin(ctx);
                if (botHasAdminRights) {
                    if (ctx.scene.state.promptMessageId) {
                        await ctx.deleteMessage(ctx.scene.state.promptMessageId).catch(() => {});
                    }
                    await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
                }
                
                await this.updateMessage(ctx, quest);
                return ctx.scene.leave();
            } catch (error) {
                return ctx.scene.leave();
            }
        });
        
        this.bot.stage.register(this.descriptionScene);
    }

    registerCommands() {
        const commandGroups = {
            task: ['quest', 'mission', 'task', 'todo', 'missione', 'compito', 'fare'],
            event: ['event', 'evento'],
            proposal: ['proposal', 'propose', 'proposta', 'propongo'],
            request: ['need', 'request', 'want', 'wish', 'richiedo', 'bisogno', 'vorrei', 'sogno', 'richiesta', 'chiedo', 'cerco'],
            offer: ['offer', 'give', 'have', 'gift', 'offro', 'dono', 'regalo', 'chiedetemi', 'ho', 'offerta'],
            any: ['idea', 'lesson', 'quote', 'tip', 'fact', 'joke', 'story', 'thought', 'question', 
                  'challenge', 'trigger', 'projection', 'assumption', 'observation', 'rule', 
                  'suggestion', 'guideline', 'feature', 'perspective', 'opinion', 'insight', 
                  'inspiration', 'motivation', 'reminder', 'warning', 'note', 'comment', 
                  'feedback', 'review', 'critique', 'compliment', 'complaint']
        };

        Object.entries(commandGroups).forEach(([type, commands]) => {
            commands.forEach(cmd => this.bot.command(cmd, this.safeHandler(ctx => this.quest(type, ctx))));
        });

        // List commands
        this.bot.command('quests', this.safeHandler(ctx => this.listOpenQuests(ctx)));
        this.bot.command('delete', this.safeHandler(ctx => this.delete(ctx)));
        this.bot.command('listtype', this.safeHandler(ctx => this.listtype(ctx)));

        // List plural forms
        const pluralCommands = commandGroups.any.map(cmd => cmd + 's');
        pluralCommands.forEach(cmd => this.bot.command(cmd, this.safeHandler(ctx => this.listanytype(ctx))));

        // Appreciation
        this.bot.command(['appreciate', 'praise', 'kudo', 'apprezza', 'apprezziamo', 'fiorino'],
                        this.safeHandler(ctx => this.sendAppreciation(ctx)));
    }

    registerActions() {
        const actions = {
            'participate_quest_': this.join,
            'appreciate_quest_': this.appreciate,
            // 'schedule_quest_' removed - owned by Scheduler.js:40
            'cancel_quest_': this.cancel,
            'complete_quest_': this.complete,
            'stop_quest_': this.stop,
            'more_actions_': this.showMoreActions,
            'less_actions_': this.hideMoreActions,
            'publish_quest_': this.publish,
            'broadcast_quest_': this.broadcast,
            'add_time_quest_': ctx => this.addTime(ctx, 0.25),
            'subtract_time_quest_': ctx => this.subtractTime(ctx, 0.25),
            'add_1h_quest_': ctx => this.addTime(ctx, 1),
            'subtract_1h_quest_': ctx => this.subtractTime(ctx, 1),
            'checklist_quest_': this.handleChecklistButton,
            'descriptions_quest_': this.handleDescription,
            'dependencies_quest_': this.handleDependenciesButton,
            'recurring_quest_': this.handleRecurringButton,
            'participants_quest_': this.handleParticipantsButton,
            'view_original_quest_': this.viewOriginalQuest,
            'stop_recurring_': this.handleStopRecurring
        };
        
        // Pre-compile action regexes for better performance
        this.actionRegexes = Object.entries(actions).map(([prefix, handler]) => ({
            regex: new RegExp(prefix + '(.+)'),
            handler: handler.bind(this)
        }));

        this.actionRegexes.forEach(({ regex, handler }) => {
            this.bot.action(regex, this.safeHandler(handler));
        });

        // Additional specific actions
        // Removed duplicate check_ and add_item_to_ handlers - owned by Checklists.js:41,44
        // Quest checklists are handled through the Checklists module
        this.bot.action(/set_dependency_(.+)/, this.safeHandler(ctx => this.handleSetDependency(ctx)));
        this.bot.action(/remove_dependency_(.+)/, this.safeHandler(ctx => this.handleRemoveDependency(ctx)));
        this.bot.action(/toggle_quest_participant:(.+)_(.+)/, this.safeHandler(ctx => this.handleToggleParticipant(ctx)));
        this.bot.action(/select_all_quest_participants:(.+)/, this.safeHandler(ctx => this.handleSelectAllParticipants(ctx)));
        this.bot.action(/toggle_quest_holon:(.+)/, this.safeHandler(ctx => this.handleToggleHolonParticipation(ctx)));
        this.bot.action(/set_recurring_(.+)/, this.safeHandler(ctx => this.handleSetRecurring(ctx)));
        this.bot.action(/back_from_recurring_(.+)/, this.safeHandler(ctx => this.handleBackFromRecurring(ctx)));
        this.bot.action(/back_(.+)/, this.safeHandler(ctx => this.handleBackAction(ctx)));
    }

    // Core quest creation
    async quest(type, ctx) {
        const chatID = getChatId(ctx);
        const messageID = getMessageId(ctx);
        const language = await this.getLanguage(chatID);
        const text = ctx.message.text || ctx.message.caption;
        
        if (type === 'any') type = text.split(' ')[0].replace('/', '');
        
        const sender = ctx.message.from;
        const title = text.split(' ').slice(1).join(' ');
        const picture = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : null;
        
        if (!title) {
            return ctx.reply(i18next.t('usage', { type, lng: language }));
        }
        
        // Task limit check
        if (type === 'task') {
            const settings = await this.settings.getSettings(chatID);
            if (settings.maxTasks > 0) {
                const userTasks = (await this.db.getAll(chatID + '/quests'))
                    .filter(q => q.initiator?.id === sender.id &&
                           q.type === 'task' &&
                           q.status === 'ongoing');
                
                if (userTasks.length >= settings.maxTasks) {
                    return ctx.reply(i18next.t('task_limit_reached', {
                        lng: language,
                        maxTasks: settings.maxTasks,
                        defaultValue: `You have reached the maximum limit of ${settings.maxTasks} active tasks.`
                    }));
                }
            }
        }
        
        // Create quest object
        const quest = {
            id: '',
            version: '0.1',
            chat: chatID,
            message_thread_id: ctx.message?.is_topic_message ? ctx.message.message_thread_id : null,
            initiator: sender,
            title,
            picture,
            type,
            status: 'ongoing',
            date: Date.now(),
            participants: [],
            appreciation: [],
            stoppers: [],
            dependencies: [],
            frequency: null,
            recurringTaskId: null,
            timeTracking: {},
            checklistId: null,
            reminderId: null,
            activeHolograms: [],
            category: this.getCategory(ctx),
            document: '',
            where: { latitude: '', longitude: '' },
            when: '',
            until: '',
            completed: ''
        };
        
        // Send message and save quest
        const showAsImage = this.shouldShowQuestsAsImages();
        let nctx;
        
        if (picture && showAsImage && this.ui?.getQuestImage) {
            nctx = await ctx.replyWithPhoto(picture, {
                caption: createPaddedCaption(''),
                ...this.markup(quest, language)
            });
        } else if (showAsImage && this.ui?.getQuestImage) {
            // If we have an image and showAsImage is true, start with a temporary photo that will be replaced
            if (picture) {
                nctx = await ctx.replyWithPhoto(picture, {
                    caption: createPaddedCaption("📝 " + quest.title),
                    parse_mode: 'Markdown',
                    ...this.markup(quest, language)
                });
            } else {
                nctx = await ctx.reply("📝 " + quest.title,
                                      this.markup(quest, language));
            }
        } else if (picture) {
            // Fallback: show original photo when showAsImage is disabled
            nctx = await ctx.replyWithPhoto(picture, {
                caption: createPaddedCaption(''),
                parse_mode: 'Markdown',
                ...this.markup(quest, language)
            });
        } else {
            nctx = await ctx.reply(await this.createMessage(quest, language), 
                                  this.markup(quest, language));
        }
        
        // Set quest ID based on platform
        quest.id = ctx.platform === 'discord' ? nctx.id : nctx.message_id;
        if (!quest.chat || quest.chat === 0) {
            quest.chat = ctx.platform === 'discord' ? nctx.channel.id : nctx.chat.id;
        }
        
        await this.db.put(chatID + '/quests', quest);
        
        // Update buttons and pin message
        try {
            await this.bot.telegram.editMessageReplyMarkup(quest.chat, quest.id, null, 
                this.markup(quest, language).reply_markup);
        } catch {}
        
        this.bot.telegram.pinChatMessage(quest.chat, quest.id, { disable_notification: true }).catch(() => {});
        this.bot.telegram.deleteMessage(chatID, messageID).catch(() => {});
        
        // Generate quest image if enabled (always generate when showAsImage is true)
        if (showAsImage) {
            this.regenerateQuestImageBackground(ctx, quest, quest.chat, quest.id, this.markup(quest, language));
        }
        
        return quest;
    }

    // Consolidated participation handlers
    async join(ctx) {
        return this.handleParticipation(ctx, 'join');
    }

    async appreciate(ctx) {
        return this.handleParticipation(ctx, 'appreciate');
    }

    async handleParticipation(ctx, action) {
        const [, , chatID, messageID] = ctx.callbackQuery.data.split('_');
        const sender = ctx.callbackQuery.from;

        log.info(`handleParticipation called - action: ${action}, chatID: ${chatID}, messageID: ${messageID}, user: ${sender.id}`);

        // Answer callback query IMMEDIATELY to prevent UI freezing
        ctx.answerCbQuery().catch(() => {});

        // Queue this operation to prevent race conditions
        await this.queueQuestOperation(chatID, messageID, async () => {
            const language = await this.getLanguage(chatID);

            log.info(`Attempting to fetch quest from DB: ${chatID}/quests, key: ${messageID}`);
            let quest;
            try {
                quest = await this.db.get(chatID + '/quests', messageID);
                log.info(`Quest fetched successfully: ${quest ? quest.title : 'null'}`);
            } catch (err) {
                log.error(`Failed to fetch quest from DB: ${chatID}/quests/${messageID}`, err);
            }

            if (!await this.questExists(quest, ctx, messageID)) {
                log.warn(`Quest does not exist: ${chatID}/quests/${messageID}`);
                return;
            }
            if (await this.handleCompletedQuestInteraction(ctx, quest, chatID, messageID, language)) return;

            quest.participants = quest.participants || [];
            quest.appreciation = quest.appreciation || [];

            if (action === 'join') {
                const idx = quest.participants.findIndex(u => u.id === sender.id);
                if (idx > -1) {
                    quest.participants.splice(idx, 1);
                } else {
                    quest.participants.push(sender);
                }
                quest.appreciation = quest.appreciation.filter(u => u.id !== sender.id);
            } else {
                const userIdx = quest.participants.findIndex(u => u.id === sender.id);
                if (userIdx > -1) {
                    if (quest.status === "completed") {
                        return;
                    }
                    quest.participants.splice(userIdx, 1);
                }

                const appIdx = quest.appreciation.findIndex(u => u.id === sender.id);
                if (appIdx > -1) {
                    if (quest.status === "completed") {
                        return;
                    }
                    quest.appreciation.splice(appIdx, 1);
                } else {
                    quest.appreciation.push(sender);
                }
            }

            await this.saveQuest(quest);
            if (action === 'join' && chatID.toString() !== sender.id.toString()) {
                await this.personalHologram(sender.id, quest);
                await this.ensureTelegramHologramMessage(ctx, quest, sender.id, language);
            }

            await this.updateMessage(ctx, quest, language);
        });
    }

    async cancel(ctx) {
        const [, , chatID, messageID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(chatID);

        let quest;
        try {
            quest = await this.db.get(chatID + '/quests', messageID);
        } catch {}

        const isHologram = quest?.chat && quest.chat.toString() !== chatID.toString();

        if (isHologram) {
            const msgId = ctx.callbackQuery?.message.message_id || messageID;
            const chatId = ctx.callbackQuery?.message.chat.id || chatID;
            await ctx.telegram.deleteMessage(chatId, msgId).catch(() => {});
            return ctx.answerCbQuery('Hologram cancelled.').catch(() => {});
        }

        if (!quest) {
            const msgId = ctx.callbackQuery?.message.message_id || messageID;
            const chatId = ctx.callbackQuery?.message.chat.id || chatID;
            await ctx.telegram.deleteMessage(chatId, msgId).catch(() => {});
            return ctx.answerCbQuery('Quest not found or already cancelled.').catch(() => {});
        }

        const hasPermission = quest.initiator?.id === ctx.from.id ||
                             await this.checkUserAdmin(ctx.from.id, chatID);

        if (!hasPermission) {
            return ctx.answerCbQuery(i18next.t('onlyinitatorcancel', { lng: language })).catch(() => {});
        }

        // Answer callback query IMMEDIATELY before heavy operations
        ctx.answerCbQuery('Cancelling quest...').catch(() => {});

        if (quest.activeHolograms?.length > 0) {
            for (const h of quest.activeHolograms) {
                await ctx.telegram.deleteMessage(h.chatId, h.messageId).catch(() => {});
            }
        }

        if (quest.reminderId && this.scheduler) {
            await this.scheduler.cancelReminder(quest.reminderId);
        }

        await this.db.del(chatID + '/quests', messageID);
        await ctx.telegram.unpinChatMessage(chatID, messageID).catch(() => {});
        await ctx.deleteMessage(messageID).catch(() => {});
    }

    async complete(ctx) {
        const [, , chatID, messageID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(chatID);
        const quest = await this.db.get(chatID + '/quests', messageID);

        if (!await this.questExists(quest, ctx, messageID)) return;
        if (quest.status === 'stopped') {
            return ctx.answerCbQuery(i18next.t('cannotcompletestopped', { lng: language }));
        }

        const completerId = ctx.from.id;
        const canComplete = quest.initiator.id === completerId ||
                           quest.participants.some(u => u.id === completerId) ||
                           await this.checkUserAdmin(completerId, chatID);

        if (!canComplete) {
            return ctx.answerCbQuery(i18next.t('onlyinitiatorcomplete', { lng: language }));
        }

        // Answer callback query IMMEDIATELY before heavy operations
        ctx.answerCbQuery(`Completing "${quest.title}"...`).catch(() => {});

        quest.status = "completed";

        if (quest.reminderId && this.scheduler) {
            await this.scheduler.cancelReminder(quest.reminderId);
            delete quest.reminderId;
        }

        if (quest.timeTracking) {
            for (const [userID, hours] of Object.entries(quest.timeTracking)) {
                if (hours > 0) {
                    await this.expenses?.addExpense(messageID, chatID, hours, 'hour',
                                                   quest.title, userID, chatID);

                    try {
                        const userInfo = await this.users.getUserInfo({ id: parseInt(userID) }, chatID);
                        userInfo.hours = (userInfo.hours || 0) + hours;
                        await this.db.put(chatID + '/users', userInfo);
                    } catch {}
                }
            }
        }

        const hologramsToUpdate = quest.activeHolograms ? [...quest.activeHolograms] : [];
        quest.activeHolograms = [];
        await this.saveQuest(quest);
        await this.updateMessage(ctx, quest, language, false, hologramsToUpdate);

        ctx.telegram.unpinChatMessage(chatID, messageID).catch(() => {});

        await this.recordCompletionActions(quest, chatID);

        ctx.reply(`Quest "${quest.title}" completed! 🎊`, { reply_to_message_id: messageID }).catch(() => {});
    }

    async stop(ctx) {
        const [, , chatID, messageID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(chatID);
        const quest = await this.db.get(chatID + '/quests', messageID);

        if (!await this.questExists(quest, ctx, messageID)) return;

        const sender = ctx.callbackQuery.from;
        const idx = quest.stoppers.findIndex(u => u.id === sender.id);

        // Answer callback query IMMEDIATELY
        ctx.answerCbQuery().catch(() => {});

        if (idx > -1) {
            quest.stoppers.splice(idx, 1);
            ctx.reply(`${getDisplayName(sender)} revoked veto for "${quest.title}"`,
                     { reply_to_message_id: messageID }).catch(() => {});
        } else {
            quest.stoppers.push(sender);
            ctx.reply(`${getDisplayName(sender)} stopped "${quest.title}". Please address concerns.`,
                     { reply_to_message_id: messageID }).catch(() => {});
        }

        quest.status = quest.stoppers.length > 0 ? 'stopped' : 'ongoing';
        await this.saveQuest(quest);
        await this.updateMessage(ctx, quest, language);
    }

    async schedule(ctx) {
        const [, , , questID] = ctx.callbackQuery.data.split('_');
        const chatID = ctx.callbackQuery.message.chat.id;
        
        try {
            const quest = await this.db.get(`${chatID}/quests`, questID);
            if (!await this.questExists(quest, ctx, questID)) return;
            
            const language = await this.getLanguage(chatID);
            if (await this.handleCompletedQuestInteraction(ctx, quest, chatID, questID, language)) return;
            
            if (quest.reminderId && this.scheduler) {
                await this.scheduler.cancelReminder(quest.reminderId);
                delete quest.reminderId;
                await this.db.put(`${chatID}/quests`, quest);
                await this.updateMessage(ctx, quest, language);
            }
            
            await this.scheduler?.showCalendar(ctx, questID);
            await ctx.answerCbQuery().catch(() => {});
        } catch (error) {
            await ctx.answerCbQuery('Error showing calendar');
        }
    }

    async addTime(ctx, amount) {
        return this.handleTimeTracking(ctx, amount, true);
    }

    async subtractTime(ctx, amount) {
        return this.handleTimeTracking(ctx, amount, false);
    }

    async handleTimeTracking(ctx, amount, isAdding) {
        const [, , , chatID, messageID] = ctx.callbackQuery.data.split('_');
        const sender = ctx.callbackQuery.from;

        log.info(`handleTimeTracking called - amount: ${amount}, isAdding: ${isAdding}, chatID: ${chatID}, messageID: ${messageID}, user: ${sender.id}`);

        // Answer callback query IMMEDIATELY to prevent UI freezing
        ctx.answerCbQuery().catch(() => {});

        // Queue this operation to prevent race conditions
        await this.queueQuestOperation(chatID, messageID, async () => {
            const language = await this.getLanguage(chatID);

            log.info(`Attempting to fetch quest from DB: ${chatID}/quests, key: ${messageID}`);
            let quest;
            try {
                quest = await this.db.get(chatID + '/quests', messageID);
                log.info(`Quest fetched successfully: ${quest ? quest.title : 'null'}`);
            } catch (err) {
                log.error(`Failed to fetch quest from DB: ${chatID}/quests/${messageID}`, err);
            }

            if (!await this.questExists(quest, ctx, messageID)) {
                log.warn(`Quest does not exist: ${chatID}/quests/${messageID}`);
                return;
            }
            if (await this.handleCompletedQuestInteraction(ctx, quest, chatID, messageID, language)) return;

            const userId = sender.id;

            if (!quest.timeTracking[userId]) quest.timeTracking[userId] = 0;

            // Perform the time tracking operation
            if (isAdding) {
                quest.timeTracking[userId] += amount;
                if (!quest.participants.some(u => u.id === sender.id)) {
                    quest.participants.push(sender);
                }
            } else if (quest.timeTracking[userId] >= amount) {
                quest.timeTracking[userId] -= amount;

                if (quest.timeTracking[userId] === 0 &&
                    quest.initiator.id !== sender.id &&
                    !quest.appreciation.some(u => u.id === sender.id)) {
                    quest.participants = quest.participants.filter(u => u.id !== sender.id);
                }
            } else {
                return; // Not enough time to remove
            }

            await this.db.put(chatID + '/quests', quest);
            if (chatID.toString() !== sender.id.toString()) {
                await this.personalHologram(sender.id, quest);
                await this.ensureTelegramHologramMessage(ctx, quest, sender.id, language);
            }

            await this.updateMessage(ctx, quest, language, true);
        });
    }

    // UI Methods
    async showMoreActions(ctx) {
        const [,, chatID, questID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(chatID);
        const quest = await this.db.get(chatID + '/quests', questID);
        
        if (!await this.questExists(quest, ctx, questID)) return;
        
        const expandedButtons = this.getExpandedButtons(quest, language);
        await this.updateQuestMessage(ctx, quest, chatID, ctx.callbackQuery.message.message_id, 
                                     language, { reply_markup: { inline_keyboard: expandedButtons } });
        await ctx.answerCbQuery().catch(() => {});
    }

    async hideMoreActions(ctx) {
        const [,, chatID, questID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(chatID);
        const quest = await this.db.get(chatID + '/quests', questID);
        
        if (!await this.questExists(quest, ctx, questID)) return;
        
        await this.updateQuestMessage(ctx, quest, chatID, ctx.callbackQuery.message.message_id, 
                                     language, this.markup(quest, language));
        await ctx.answerCbQuery().catch(() => {});
    }

    markup(quest, language) {
        if (!quest?.chat) return Markup.inlineKeyboard([]);
        
        if (!quest.id || quest.id === '') {
            return Markup.inlineKeyboard([
                [Markup.button.callback(quest.title || 'Creating quest...', 'placeholder')]
            ]);
        }
        
        const buttons = [];
        const isTask = ['event', 'task', 'quest', 'todo', 'mission', 'compito', 'recurring'].includes(quest.type);
        const isProposal = quest.type === 'proposal';
        const isOfferRequest = ['offer', 'request'].includes(quest.type);
        
        if (quest.status === "completed") {
            buttons.push([
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 
                                      `appreciate_quest_${quest.chat}_${quest.id}`)
            ]);
        } else if (isTask) {
            buttons.push(
                [
                    Markup.button.callback(i18next.t('join', { lng: language }), 
                                          `participate_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback(i18next.t('complete', { lng: language }), 
                                          `complete_quest_${quest.chat}_${quest.id}`)
                ],
                [
                    Markup.button.callback(i18next.t('appreciate', { lng: language }), 
                                          `appreciate_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback(i18next.t('schedule', { lng: language }), 
                                          `schedule_quest_${quest.chat}_${quest.id}`)
                ]
            );
        } else if (isProposal) {
            buttons.push([
                Markup.button.callback(i18next.t('agree', { lng: language }), 
                                      `participate_quest_${quest.chat}_${quest.id}`),
                Markup.button.callback(i18next.t('stop', { lng: language }), 
                                      `stop_quest_${quest.chat}_${quest.id}`)
            ]);
        } else if (isOfferRequest) {
            buttons.push([
                Markup.button.callback(i18next.t('accept', { lng: language }), 
                                      `participate_quest_${quest.chat}_${quest.id}`),
                Markup.button.callback(i18next.t('complete', { lng: language }), 
                                      `complete_quest_${quest.chat}_${quest.id}`)
            ]);
        } else {
            buttons.push([
                Markup.button.callback(i18next.t('appreciate', { lng: language }), 
                                      `appreciate_quest_${quest.chat}_${quest.id}`)
            ]);
        }
        
        if (quest.status !== "completed" && (isTask || isProposal || isOfferRequest)) {
            buttons.push([
                Markup.button.callback('⚙️ ' + i18next.t('more_actions', { lng: language }), 
                                      `more_actions_${quest.chat}_${quest.id}`)
            ]);
        }
        
        return Markup.inlineKeyboard(buttons);
    }

    getExpandedButtons(quest, language) {
        const buttons = [];
        const isTask = ['task', 'quest', 'todo', 'mission', 'compito', 'recurring'].includes(quest.type);
        
        if (quest.status === "completed") {
            return [
                [Markup.button.callback(i18next.t('appreciate', { lng: language }), 
                                      `appreciate_quest_${quest.chat}_${quest.id}`)],
                [Markup.button.callback('🔼 ' + i18next.t('less_actions', { lng: language }), 
                                      `less_actions_${quest.chat}_${quest.id}`)]
            ];
        }
        
        if (isTask) {
            buttons.push(
                [
                    Markup.button.callback(i18next.t('join', { lng: language }), 
                                          `participate_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback(i18next.t('complete', { lng: language }), 
                                          `complete_quest_${quest.chat}_${quest.id}`)
                ],
                [
                    Markup.button.callback(i18next.t('appreciate', { lng: language }), 
                                          `appreciate_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback(i18next.t('schedule', { lng: language }), 
                                          `schedule_quest_${quest.chat}_${quest.id}`)
                ],
                [
                    Markup.button.callback(i18next.t('stop', { lng: language }), 
                                          `stop_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback(i18next.t('cancel', { lng: language }), 
                                          `cancel_quest_${quest.chat}_${quest.id}`)
                ],
                [
                    Markup.button.callback('⏰ -1h', `subtract_1h_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback('⏰ -15m', `subtract_time_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback('⏰ +15m', `add_time_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback('⏰ +1h', `add_1h_quest_${quest.chat}_${quest.id}`)
                ],
                [
                    Markup.button.callback('📝 ' + i18next.t('description', { lng: language }), 
                                          `descriptions_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback('📋 ' + i18next.t('subtasks', { lng: language }), 
                                          `checklist_quest_${quest.chat}_${quest.id}`)
                ],
                [
                    Markup.button.callback('🔗 ' + i18next.t('dependencies', { lng: language }), 
                                          `dependencies_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback('🔄 ' + this.getRecurringButtonText(quest, language), 
                                          `recurring_quest_${quest.chat}_${quest.id}`)
                ],
                [
                    Markup.button.callback('👥 ' + i18next.t('select_participants', { lng: language }), 
                                          `participants_quest_${quest.chat}_${quest.id}`)
                ],
                [
                    Markup.button.callback('📢 ' + i18next.t('publish', { lng: language }), 
                                          `publish_quest_${quest.chat}_${quest.id}`),
                    Markup.button.url('📊 Dashboard', 
                                     `https://dashboard.holons.io/${quest.chat}/tasks?task=${quest.id}`)
                ]
            );
        } else if (quest.type === 'event') {
            buttons.push(
                [
                    Markup.button.callback(i18next.t('join', { lng: language }), 
                                          `participate_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback(i18next.t('complete', { lng: language }), 
                                          `complete_quest_${quest.chat}_${quest.id}`)
                ],
                [
                    Markup.button.callback(i18next.t('appreciate', { lng: language }), 
                                          `appreciate_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback(i18next.t('schedule', { lng: language }), 
                                          `schedule_quest_${quest.chat}_${quest.id}`)
                ],
                [Markup.button.callback('📢 ' + i18next.t('publish', { lng: language }), 
                                       `publish_quest_${quest.chat}_${quest.id}`)]
            );
        } else if (quest.type === 'proposal') {
            buttons.push(
                [
                    Markup.button.callback(i18next.t('agree', { lng: language }), 
                                          `participate_quest_${quest.chat}_${quest.id}`),
                    Markup.button.callback(i18next.t('stop', { lng: language }), 
                                          `stop_quest_${quest.chat}_${quest.id}`)
                ],
                [Markup.button.callback(i18next.t('appreciate', { lng: language }), 
                                       `appreciate_quest_${quest.chat}_${quest.id}`)]
            );
        } else {
            buttons.push(
                [Markup.button.callback(i18next.t('appreciate', { lng: language }), 
                                       `appreciate_quest_${quest.chat}_${quest.id}`)]
            );
        }
        
        buttons.push(
            [Markup.button.callback('🔼 ' + i18next.t('less_actions', { lng: language }), 
                                   `less_actions_${quest.chat}_${quest.id}`)]
        );
        
        return buttons;
    }

    async createMessage(quest, language) {
        const lines = [
            `| ${i18next.t(capitalize(quest.type), { lng: language })}${quest.recurringTaskId ? ' 🔄' : ''}: ${quest.title.padEnd(200)}`,
            `| 💡 ${i18next.t('by', { lng: language })}: ${getDisplayName(quest.initiator)}`
        ];
        
        if (quest.description) lines.push(`| 📝 ${quest.description}`);
        if (quest.frequency) lines.push(`| 🔄 ${i18next.t('repeat', { lng: language })}: ${i18next.t(quest.frequency, { lng: language })}`);
        if (quest.category) lines.push(`| 📑 ${i18next.t('category', { lng: language })}: ${quest.category}`);
        
        if (quest.dependencies?.length) {
            const deps = await this.batchLoadDependencies(quest.chat, quest.dependencies);
            const titles = deps.map(dep => dep?.title || '').filter(title => title);
            if (titles.length > 0) {
                lines.push(`| 🔗 ${i18next.t('dependencies', { lng: language })}: ${titles.join(', ')}`);
            }
        }
        
        if (quest.checklistId && this.checklists) {
            const checklist = await this.db.get(quest.chat + '/checklists', quest.checklistId);
            if (checklist?.items.length) {
                const completed = checklist.items.filter(i => i.checked).length;
                lines.push(`| 📋 ${i18next.t('subtasks', { lng: language })}: ${completed}/${checklist.items.length} completed`);
            }
        }
        
        if (quest.participants?.length) {
            const names = quest.participants.map(u => {
                const hours = quest.timeTracking?.[u.id];
                return hours > 0 ? `${getDisplayName(u)} (${hours.toFixed(2)}h)` : getDisplayName(u);
            });
            lines.push(`| ${i18next.t('🙋‍♂', { lng: language })}: ${names.join(', ')}`);
        }
        
        if (quest.appreciation?.length) {
            lines.push(`| ${i18next.t('👍', { lng: language })}: ${quest.appreciation.map(u => getDisplayName(u)).join(', ')}`);
        }
        
        for (const [field, emoji] of [['when', '📅'], ['until', '🔚']]) {
            if (quest[field]) {
                const date = new Date(quest[field]);
                const timezone = await this.settings.getTimezone(quest.chat) || 'UTC';
                try {
                    const dateStr = date.toLocaleDateString(language, {
                        weekday: 'long', month: 'long', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                        timeZone: timezone, timeZoneName: 'short'
                    });
                    lines.push(`| ${i18next.t(emoji, { lng: language })}: ${dateStr}`);
                } catch {
                    lines.push(`| ${i18next.t(emoji, { lng: language })}: Invalid Date`);
                }
            }
        }
        
        if (quest.where?.lat) lines.push(`| ${i18next.t('📍', { lng: language })}: ${quest.where.lat}, ${quest.where.lon}`);
        if (quest.status === "stopped") lines.push(`| ${i18next.t('🛑', { lng: language })}: ${quest.stoppers.map(u => getDisplayName(u)).join(', ')}`);
        
        lines.push(`| ${i18next.t('🚥', { lng: language })}: ${i18next.t(quest.status, { lng: language })}`);
        
        if (quest.published) lines.push(`| 📢 ${i18next.t('published', { lng: language })}`);
        if (quest.broadcasted) lines.push(`| 🎭 ${i18next.t('broadcasted', { lng: language })}`);
        
        return lines.join('\n') + '\n';
    }

    async updateMessage(ctx, quest, language, useExpandedMarkup = false, explicitHologramsToUpdate = null) {
        if (!quest?.chat || !quest.id) return;

        log.info(`updateMessage called - quest: ${quest.title}, chatID: ${quest.chat}, messageID: ${quest.id}, useExpandedMarkup: ${useExpandedMarkup}`);

        language = language || await this.getLanguage(quest.chat);
        const markupConfig = useExpandedMarkup
            ? { reply_markup: { inline_keyboard: this.getExpandedButtons(quest, language) } }
            : this.markup(quest, language);
        
        try {
            await ctx.telegram.getChat(quest.chat);
            await this.updateQuestMessage(ctx, quest, quest.chat, quest.id, language, markupConfig);
        } catch {}
        
        try {
            await this.db.put(quest.chat + '/quests', quest);
        } catch {}
        
        await this.handleFederatedMessages(ctx, quest, language).catch(() => {});
        
        const hologramsToUpdate = explicitHologramsToUpdate ?? (quest.activeHolograms || []);
        if (hologramsToUpdate.length > 0) {
            await this.updateHolograms(ctx, quest, language, markupConfig, hologramsToUpdate);
        }
    }

    // Helper methods
    async personalHologram(userId, quest) {
        if (!userId || !quest?.id || !quest.chat) return;
        
        try {
            const hologramData = {
                id: quest.id.toString(),
                soul: `${this.db.holosphere.appname}/${quest.chat}/quests/${quest.id}`,
                title: quest.title,
                status: quest.status,
                originalLens: 'quests',
                lastInteracted: Date.now()
            };
            
            await this.db.holosphere.put(userId.toString(), 'quests', hologramData).catch(() => {});
        } catch {}
    }

    async checkUserAdmin(userId, chatId) {
        try {
            // Private chats (positive IDs) should always allow admin actions
            // Group chats (negative IDs) need proper admin checking
            if (chatId > 0) {
                return true; // Private chat - user is admin of their own chat
            }

            const member = await this.bot.telegram.getChatMember(chatId, userId);
            return ['administrator', 'creator'].includes(member.status);
        } catch {
            return false;
        }
    }

    async questExists(quest, ctx, questId = 'N/A') {
        if (!quest || quest === '') {
            const chatId = getChatId(ctx);
            const language = chatId ? await this.getLanguage(chatId) : 'en';
            
            if (ctx.callbackQuery) {
                await ctx.answerCbQuery(i18next.t('questnotfound', { lng: language, defaultValue: 'Quest not found.' })).catch(() => {});
                await ctx.deleteMessage().catch(() => {});
            }
            return false;
        }
        return true;
    }

    shouldShowQuestsAsImages() {
        return process.env.SHOW_QUESTS_AS_IMAGES === 'true';
    }

    getCategory(ctx) {
        if (ctx.message?.message_thread_id && ctx.message?.reply_to_message?.forum_topic_created?.name) {
            return ctx.message.reply_to_message.forum_topic_created.name;
        }
        return ctx.message?.message_thread_id ? `Topic ${ctx.message.message_thread_id}` : '';
    }

    getRecurringButtonText(quest, language) {
        return quest.frequency 
            ? i18next.t(quest.frequency, { lng: language, defaultValue: quest.frequency })
            : i18next.t('never', { lng: language, defaultValue: 'Never' });
    }

    async handleCompletedQuestInteraction(ctx, quest, chatID, messageID, language) {
        if (quest.status !== 'completed') return false;
        
        try {
            await this.updateMessage(ctx, quest, language, false);
            ctx.answerCbQuery(`Quest "${quest.title}" has already been completed`).catch(() => {});
            return true;
        } catch {
            const msgId = ctx.callbackQuery?.message.message_id || messageID;
            const chatId = ctx.callbackQuery?.message.chat.id || chatID;
            
            await ctx.telegram.deleteMessage(chatId, msgId).catch(() => {});
            ctx.answerCbQuery('Quest not found or already completed.').catch(() => {});
            return true;
        }
    }

    async recordCompletionActions(quest, chatID) {
        const actions = [];

        // Batch all user actions for parallel processing
        actions.push({
            user: quest.initiator,
            action: "initiated",
            quest: quest.title,
            value: 0,
            chatID
        });

        for (const user of quest.participants) {
            actions.push({
                user,
                action: "completed",
                quest: quest.title,
                value: 0,
                chatID
            });
        }

        for (const sender of quest.appreciation) {
            actions.push({
                user: sender,
                action: "sent",
                quest: quest.title,
                value: 0,
                chatID
            });

            for (const recipient of quest.participants) {
                actions.push({
                    user: recipient,
                    action: "received",
                    quest: quest.title,
                    value: 0,
                    chatID
                });
            }
        }

        // Process actions in parallel batches
        await this.batchSaveUserActions(actions);
    }

    async handleBackAction(ctx) {
        const data = ctx.callbackQuery.data;
        
        try {
            if (data.startsWith('back_from_dependencies_')) {
                return await this.backFromDependencies(ctx);
            } else if (data.startsWith('back_from_participants_')) {
                return await this.backFromParticipants(ctx);
            } else if (data.startsWith('back_to_quest_')) {
                return await this.handleBackToQuest(ctx);
            } else {
                // Generic back action - try to parse and handle
                console.log('Unknown back action:', data);
                await ctx.answerCbQuery('Unknown back action');
            }
        } catch (error) {
            console.error('Error in handleBackAction:', error);
            await ctx.answerCbQuery('Error handling back action');
        }
    }

    async updateQuestMessage(ctx, quest, chatId, messageId, language, markupConfig) {
        const showImages = this.shouldShowQuestsAsImages();

        log.info(`updateQuestMessage - showImages: ${showImages}, chatId: ${chatId}, messageId: ${messageId}`);

        try {
            if (showImages) {
                log.info('Updating reply markup for image mode');
                await ctx.telegram.editMessageReplyMarkup(chatId, messageId, null, markupConfig.reply_markup)
                    .catch((err) => {
                        // Ignore "message is not modified" error - it just means nothing changed
                        if (err.response?.description?.includes('message is not modified')) {
                            log.debug('Message markup unchanged, skipping update');
                        } else {
                            log.error('Error editing reply markup', err);
                        }
                    });

                if (this.ui?.getQuestImage) {
                    this.queueImageUpdate(ctx, quest, chatId, messageId, markupConfig);
                }
            } else {
                log.info('Updating message text for text mode');
                const message = await this.createMessage(quest, language);
                await ctx.telegram.editMessageText(chatId, messageId, null, message, markupConfig)
                    .catch((err) => {
                        // Ignore "message is not modified" error - it just means nothing changed
                        if (err.response?.description?.includes('message is not modified')) {
                            log.debug('Message text unchanged, skipping update');
                        } else {
                            log.error('Error editing message text', err);
                        }
                    });
            }
        } catch (err) {
            log.error('Error in updateQuestMessage', err);
        }
    }

    queueImageUpdate(ctx, quest, chatId, messageId, markupConfig) {
        const key = `${quest.chat}_${quest.id}`;
        this.imageUpdateQueue.set(key, { ctx, quest, chatId, messageId, markupConfig });
        
        if (this.imageUpdateTimer) clearTimeout(this.imageUpdateTimer);
        this.imageUpdateTimer = setTimeout(() => this.processBatchedImageUpdates(), 500);
    }

    async processBatchedImageUpdates() {
        if (!this.imageUpdateQueue.size) return;
        
        const promises = [];
        for (const [, data] of this.imageUpdateQueue) {
            promises.push(this.regenerateQuestImageBackground(
                data.ctx, data.quest, data.chatId, data.messageId, data.markupConfig
            ));
        }
        
        this.imageUpdateQueue.clear();
        await Promise.allSettled(promises);
    }

    async regenerateQuestImageBackground(ctx, quest, chatId, messageId, markupConfig) {
        try {
            const isHologram = chatId.toString() !== quest.chat.toString();
            const imagePath = await this.getCachedQuestImage(quest, chatId, isHologram);

            if (imagePath) {
                await ctx.telegram.editMessageMedia(chatId, messageId, null, {
                    type: 'photo',
                    media: { source: imagePath },
                    caption: createPaddedCaption('')
                }, markupConfig);
            }
        } catch {}
    }

    // Remaining method implementations (add as needed)
    async delete(ctx) {
        const [, messageID] = ctx.message.text.split(' ');
        const chatID = ctx.message.chat.id;
        this.db.del(chatID + '/quests', messageID);
        ctx.reply('Quest deleted');
    }

    async listtype(ctx) {
        let type = ctx.message.text.split(' ')[0].replace('/', '');
        if (type && type[type.length - 1] === 's') type = type.slice(0, -1);
        
        const chatID = ctx.message.chat.id;
        const language = await this.getLanguage(chatID);
        const quests = await this.db.getAll(chatID + '/quests');
        
        const filtered = quests.filter(q => q.type === type);
        if (!filtered.length) {
            return ctx.reply(i18next.t('notypefound', { type, lng: language }));
        }
        
        let message = `*${capitalize(type)}s*:\n\n`;
        filtered.forEach(q => {
            message += `~${q.title}~ \t 👍:${q.appreciation?.length || 0}\n`;
        });
        
        ctx.reply(message, { parse_mode: 'Markdown' });
    }

    async listanytype(ctx) {
        const type = ctx.message.text.split(' ')[0].replace('/', '').slice(0, -1);
        ctx.message.text = `/${type}`;
        return this.listtype(ctx);
    }

    // Setters for external dependencies
    setScheduler(scheduler) { this.scheduler = scheduler; }
    setUIInstance(ui) { this.ui = ui; }
    setChecklists(checklists) { 
        this.checklists = checklists;
        this.checklists.setQuestInstance(this);
    }

    // Stub remaining complex methods - implement as needed
    async listOpenQuests(ctx) {
        const chatID = getChatId(ctx);
        const language = await this.getLanguage(chatID);

        try {
            const quests = await this.db.getAll(chatID + '/quests');
            const openQuests = quests.filter(q => q.status === 'ongoing');

            if (!openQuests.length) {
                return ctx.reply(i18next.t('no_open_quests', {
                    lng: language,
                    defaultValue: 'No open quests found.'
                }));
            }

            // Group quests by type
            const questsByType = {};
            openQuests.forEach(quest => {
                if (!questsByType[quest.type]) {
                    questsByType[quest.type] = [];
                }
                questsByType[quest.type].push(quest);
            });

            let message = `*${i18next.t('open_quests', { lng: language, defaultValue: 'Open Quests' })}*\n\n`;

            for (const [type, typeQuests] of Object.entries(questsByType)) {
                message += `*${capitalize(type)}s (${typeQuests.length}):*\n`;

                typeQuests.forEach(quest => {
                    const participantCount = quest.participants?.length || 0;
                    const appreciationCount = quest.appreciation?.length || 0;
                    const timeTracked = Object.values(quest.timeTracking || {}).reduce((sum, hours) => sum + hours, 0);

                    message += `• ${quest.title}`;
                    if (quest.recurringTaskId && quest.frequency) message += ` 🔄${i18next.t(quest.frequency, { lng: language, defaultValue: quest.frequency })}`;
                    if (participantCount > 0) message += ` 👥${participantCount}`;
                    if (appreciationCount > 0) message += ` 👍${appreciationCount}`;
                    if (timeTracked > 0) message += ` ⏰${timeTracked.toFixed(1)}h`;
                    if (quest.checklistId && this.checklists) {
                        // Note: We'd need to fetch checklist to show progress, but keeping it simple
                        message += ` 📋`;
                    }
                    message += `\n`;
                });

                message += '\n';
            }

            ctx.reply(message, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Error listing open quests:', error);
            ctx.reply(i18next.t('error_listing_quests', {
                lng: language,
                defaultValue: 'Error retrieving quest list.'
            }));
        }
    }
    async sendAppreciation(ctx) {
        const chatID = getChatId(ctx);
        const language = await this.getLanguage(chatID);
        const text = ctx.message.text || ctx.message.caption;
        const args = text.split(' ').slice(1);

        if (args.length === 0) {
            return ctx.reply(i18next.t('appreciation_usage', {
                lng: language,
                defaultValue: 'Usage: /appreciate [user] [amount] [reason]'
            }));
        }

        try {
            // Parse arguments
            let targetUser = null;
            let amount = 1;
            let reason = '';

            // Try to find user mention or username
            if (args[0].startsWith('@')) {
                const username = args[0].substring(1);
                const users = await this.getUsers(chatID);
                targetUser = users.find(u => u.username === username);

                if (!targetUser) {
                    return ctx.reply(i18next.t('user_not_found', {
                        lng: language,
                        defaultValue: 'User not found.'
                    }));
                }

                // Parse amount if provided
                if (args.length > 1 && !isNaN(args[1])) {
                    amount = parseInt(args[1]);
                    reason = args.slice(2).join(' ');
                } else {
                    reason = args.slice(1).join(' ');
                }
            } else if (ctx.message.reply_to_message) {
                // Replying to a message
                targetUser = ctx.message.reply_to_message.from;

                if (!isNaN(args[0])) {
                    amount = parseInt(args[0]);
                    reason = args.slice(1).join(' ');
                } else {
                    reason = args.join(' ');
                }
            } else {
                // Assume first argument is reason
                reason = args.join(' ');
            }

            if (!targetUser) {
                return ctx.reply(i18next.t('specify_user', {
                    lng: language,
                    defaultValue: 'Please specify a user to appreciate by replying to their message or using @username.'
                }));
            }

            // Record appreciation
            const sender = ctx.message.from;
            const appreciation = {
                id: Date.now().toString(),
                from: sender,
                to: targetUser,
                amount: amount,
                reason: reason || i18next.t('general_appreciation', { lng: language, defaultValue: 'General appreciation' }),
                date: Date.now(),
                chatId: chatID
            };

            // Save appreciation record
            await this.db.put(chatID + '/appreciations', appreciation);

            // Update user stats
            try {
                const targetUserInfo = await this.users.getUserInfo(targetUser, chatID);
                targetUserInfo.appreciationReceived = (targetUserInfo.appreciationReceived || 0) + amount;
                await this.db.put(chatID + '/users', targetUserInfo);

                const senderInfo = await this.users.getUserInfo(sender, chatID);
                senderInfo.appreciationGiven = (senderInfo.appreciationGiven || 0) + amount;
                await this.db.put(chatID + '/users', senderInfo);
            } catch (userError) {
                console.error('Error updating user appreciation stats:', userError);
            }

            // Send confirmation
            const message = i18next.t('appreciation_sent', {
                lng: language,
                sender: getDisplayName(sender),
                target: getDisplayName(targetUser),
                amount: amount,
                reason: reason,
                defaultValue: `${getDisplayName(sender)} appreciated ${getDisplayName(targetUser)} ${amount > 1 ? `(${amount})` : ''} ${reason ? `for: ${reason}` : ''} 🙏`
            });

            ctx.reply(message, { reply_to_message_id: ctx.message.message_id });

        } catch (error) {
            console.error('Error sending appreciation:', error);
            ctx.reply(i18next.t('appreciation_error', {
                lng: language,
                defaultValue: 'Error sending appreciation.'
            }));
        }
    }
    async publish(ctx) {
        const [, , chatID, messageID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(chatID);
        const quest = await this.db.get(chatID + '/quests', messageID);

        if (!await this.questExists(quest, ctx, messageID)) return;

        const hasPermission = quest.initiator?.id === ctx.from.id ||
                             await this.checkUserAdmin(ctx.from.id, chatID);

        if (!hasPermission) {
            return ctx.answerCbQuery(i18next.t('only_initiator_can_publish', {
                lng: language,
                defaultValue: 'Only the quest initiator or admins can publish this quest.'
            })).catch(() => {});
        }

        try {
            // Toggle publish status
            quest.published = !quest.published;
            await this.saveQuest(quest);

            // Update the quest message
            await this.updateMessage(ctx, quest, language);

            const statusMessage = quest.published
                ? i18next.t('quest_published', { lng: language, defaultValue: 'Quest published to public feed!' })
                : i18next.t('quest_unpublished', { lng: language, defaultValue: 'Quest removed from public feed.' });

            ctx.answerCbQuery(statusMessage).catch(() => {});

            // If publishing, optionally send to other connected holons or federation
            if (quest.published && this.handleFederatedMessages) {
                await this.handleFederatedMessages(ctx, quest, language).catch(error => {
                    console.error('Error handling federated publishing:', error);
                });
            }

        } catch (error) {
            console.error('Error publishing quest:', error);
            ctx.answerCbQuery(i18next.t('publish_error', {
                lng: language,
                defaultValue: 'Error publishing quest.'
            })).catch(() => {});
        }
    }
    async broadcast(ctx) {
        const [, , chatID, messageID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(chatID);
        const quest = await this.db.get(chatID + '/quests', messageID);

        if (!await this.questExists(quest, ctx, messageID)) return;

        const hasPermission = quest.initiator?.id === ctx.from.id ||
                             await this.checkUserAdmin(ctx.from.id, chatID);

        if (!hasPermission) {
            return ctx.answerCbQuery(i18next.t('only_initiator_can_broadcast', {
                lng: language,
                defaultValue: 'Only the quest initiator or admins can broadcast this quest.'
            })).catch(() => {});
        }

        try {
            // Toggle broadcast status
            quest.broadcasted = !quest.broadcasted;
            await this.saveQuest(quest);

            // Update the quest message
            await this.updateMessage(ctx, quest, language);

            if (quest.broadcasted) {
                // Send quest to all users who have interacted with this holon
                const users = await this.getUsers(chatID);
                const broadcastCount = await this.batchBroadcastToUsers(ctx, quest, users, language);

                const statusMessage = i18next.t('quest_broadcasted', {
                    lng: language,
                    count: broadcastCount,
                    defaultValue: `Quest broadcasted to ${broadcastCount} users!`
                });

                ctx.answerCbQuery(statusMessage).catch(() => {});
            } else {
                // Remove broadcast - optionally clean up hologram messages
                const statusMessage = i18next.t('quest_broadcast_removed', {
                    lng: language,
                    defaultValue: 'Quest broadcast removed.'
                });

                ctx.answerCbQuery(statusMessage).catch(() => {});
            }

        } catch (error) {
            console.error('Error broadcasting quest:', error);
            ctx.answerCbQuery(i18next.t('broadcast_error', {
                lng: language,
                defaultValue: 'Error broadcasting quest.'
            })).catch(() => {});
        }
    }
    async handleChecklistButton(ctx) {
        const chatId = ctx.callbackQuery.message.chat.id;
        const messageId = ctx.callbackQuery.data.split('_')[3]; // This is the quest.id
        const language = await this.getLanguage(chatId);

        try {
            let quest = await this.db.get(chatId + '/quests', messageId.toString());
            if (!await this.questExists(quest, ctx, messageId)) { return; }

            if (!this.checklists) {
                console.error('Checklists instance not set');
                await ctx.answerCbQuery('Checklist functionality not available');
                return;
            }

            // If quest doesn't have a checklist yet, create one
            if (!quest.checklistId) {
                // Create a new checklist with the quest's title
                const checklist = {
                    id: messageId.toString(),
                    type: 'quest',
                    items: [],
                    creator: quest.initiator.id,
                    created: new Date(),
                    questId: messageId.toString(),
                    title: quest.title
                };

                // Save the checklist
                await this.db.put(chatId + '/checklists', checklist);

                // Update quest with checklist reference
                quest.checklistId = checklist.id;
                await this.db.put(chatId + '/quests', quest);
            }

            // Get the checklist
            const checklist = await this.db.get(chatId + '/checklists', quest.checklistId);
            if (!checklist) {
                await ctx.answerCbQuery('Checklist not found');
                return;
            }

            // Create checklist display
            let message = `📋 *Checklist for "${quest.title}"*\n\n`;

            if (checklist.items && checklist.items.length > 0) {
                checklist.items.forEach((item, index) => {
                    const status = item.checked ? '✅' : '☐';
                    message += `${status} ${item.text}\n`;
                });
            } else {
                message += 'No items yet. Click "Add Item" to get started.';
            }

            // Create keyboard
            const keyboard = [];

            // Add buttons for each checklist item
            if (checklist.items && checklist.items.length > 0) {
                checklist.items.forEach((item, index) => {
                    const status = item.checked ? '✅' : '☐';
                    keyboard.push([{
                        text: `${status} ${item.text}`,
                        callback_data: `check_${checklist.id}_${index}`
                    }]);
                });
            }

            // Add "Add Item" button
            keyboard.push([{
                text: '➕ Add Item',
                callback_data: `add_item_to_${checklist.id}`
            }]);

            // Send the checklist as a new message
            await ctx.telegram.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

            await ctx.answerCbQuery().catch(() => {});

        } catch (error) {
            console.error('Error handling checklist button:', error);
            await ctx.answerCbQuery('Error accessing checklist');
        }
    }
    async handleDescription(ctx) {
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

            await ctx.answerCbQuery().catch(() => {});
        } catch (error) {
            console.error('Error handling description:', error);
            await ctx.answerCbQuery('Error accessing description');
        }
    }
    async handleDependenciesButton(ctx) {
        const callbackData = ctx.callbackQuery.data;
        const dataParts = callbackData.split('_');

        // Parse callback data: dependencies_quest_{chatId}_{questId}
        const chatId = dataParts[2];
        const questId = dataParts[3];
        const language = await this.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!await this.questExists(quest, ctx, questId)) { return; }

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

                // Batch load all dependencies
                const dependencies = await this.batchLoadDependencies(chatId, quest.dependencies);
                for (let i = 0; i < quest.dependencies.length; i++) {
                    const depId = quest.dependencies[i];
                    const depQuest = dependencies[i];
                    if (depQuest) {
                        message += `- ${depQuest.title}\n`;
                        buttons.push([
                            Markup.button.callback(`🗑️ Remove: ${depQuest.title}`, `remove_dependency_${chatId}_${questId}_${depId}`)
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
                        Markup.button.callback(`➕ ${q.title}`, `set_dependency_${chatId}_${questId}_${q.id}`)
                    ]);
                });
            }

            // Add a back button
            buttons.push([
                Markup.button.callback('↩️ ' + i18next.t('back', { lng: language, defaultValue: 'Back' }), `back_from_dependencies_${chatId}_${questId}`)
            ]);

            // Show the message with dependency options - edit in place
            const messageId = ctx.callbackQuery.message.message_id;

            // Check if this is a photo message or text message
            if (ctx.callbackQuery.message.photo) {
                // For photo messages, edit the caption and keyboard
                await ctx.telegram.editMessageCaption(chatId, messageId, null, message, Markup.inlineKeyboard(buttons));
            } else {
                // For text messages, edit the text and keyboard
                await ctx.telegram.editMessageText(chatId, messageId, null, message, Markup.inlineKeyboard(buttons));
            }

            await ctx.answerCbQuery().catch(() => {});
        } catch (error) {
            // If the message content is the same, just continue silently
            if (error.response?.error_code === 400 && error.response?.description?.includes('message is not modified')) {
                await ctx.answerCbQuery().catch(() => {});
                return;
            }
            console.error('Error handling dependencies:', error);
            await ctx.answerCbQuery('Error managing dependencies');
        }
    }
    async handleSetDependency(ctx) {
        const chatId = ctx.callbackQuery.data.split('_')[2]; // Original quest's chat
        const questId = ctx.callbackQuery.data.split('_')[3];
        const dependencyId = ctx.callbackQuery.data.split('_')[4];
        const language = await this.getLanguage(chatId);

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

            // Update the current dependency view
            await this.refreshDependencyView(ctx);

            await ctx.answerCbQuery(`Added "${depQuest.title}" as a dependency`);
        } catch (error) {
            console.error('Error setting dependency:', error);
            await ctx.answerCbQuery('Error setting dependency');
        }
    }
    async handleRemoveDependency(ctx) {
        const chatId = ctx.callbackQuery.data.split('_')[2]; // Original quest's chat
        const questId = ctx.callbackQuery.data.split('_')[3];
        const dependencyId = ctx.callbackQuery.data.split('_')[4];
        const language = await this.getLanguage(chatId);

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

            // Update the current dependency view
            await this.refreshDependencyView(ctx);

            await ctx.answerCbQuery('Dependency removed');
        } catch (error) {
            console.error('Error removing dependency:', error);
            await ctx.answerCbQuery('Error removing dependency');
        }
    }
    async backFromDependencies(ctx) {
        const parts = ctx.callbackQuery.data.split('_');
        // Parse callback data: back_from_dependencies_{chatId}_{questId}
        const chatId = parts[3];
        const questId = parts[4];
        const language = await this.getLanguage(chatId);

        try {
            await ctx.answerCbQuery().catch(() => {});
            const quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            // Update back to the main quest view
            await this.updateMessage(ctx, quest, language);
        } catch (error) {
            console.error('Error going back from dependencies:', error);
            await ctx.answerCbQuery('Error going back');
        }
    }
    async handleRecurringButton(ctx) {
        const callbackData = ctx.callbackQuery.data;
        const dataParts = callbackData.split('_');

        const chatId = dataParts[2];
        const questId = dataParts[3];
        const language = await this.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!await this.questExists(quest, ctx, questId)) return;

            // Show recurring options
            const recurringOptions = [
                { text: 'Never', value: null },
                { text: 'Daily', value: 'daily' },
                { text: 'Weekly', value: 'weekly' },
                { text: 'Monthly', value: 'monthly' },
                { text: 'Yearly', value: 'yearly' }
            ];

            const buttons = recurringOptions.map(option => {
                const isSelected = quest.frequency === option.value;
                const prefix = isSelected ? '✅ ' : '';

                return [Markup.button.callback(
                    `${prefix}${i18next.t(option.text.toLowerCase(), { lng: language, defaultValue: option.text })}`,
                    `set_recurring_${chatId}_${questId}_${option.value || 'never'}`
                )];
            });

            // Add stop recurring button if currently recurring
            if (quest.frequency) {
                buttons.push([
                    Markup.button.callback(
                        '🛑 ' + i18next.t('stop_recurring', { lng: language, defaultValue: 'Stop Recurring' }),
                        `stop_recurring_${chatId}_${questId}`
                    )
                ]);
            }

            // Add back button
            buttons.push([
                Markup.button.callback(
                    '↩️ ' + i18next.t('back', { lng: language, defaultValue: 'Back' }),
                    `back_from_recurring_${chatId}_${questId}`
                )
            ]);

            const message = `🔄 *${i18next.t('recurring_settings', { lng: language, defaultValue: 'Recurring Settings' })}*\n\n` +
                          `${i18next.t('current_frequency', { lng: language, defaultValue: 'Current frequency' })}: ${quest.frequency ? i18next.t(quest.frequency, { lng: language, defaultValue: quest.frequency }) : i18next.t('never', { lng: language, defaultValue: 'Never' })}\n\n` +
                          i18next.t('select_frequency', { lng: language, defaultValue: 'Select how often this quest should repeat:' });

            const messageId = ctx.callbackQuery.message.message_id;

            // Check if this is a photo message or text message
            if (ctx.callbackQuery.message.photo) {
                await ctx.telegram.editMessageCaption(chatId, messageId, null, message, Markup.inlineKeyboard(buttons));
            } else {
                await ctx.telegram.editMessageText(chatId, messageId, null, message, Markup.inlineKeyboard(buttons));
            }

            await ctx.answerCbQuery().catch(() => {});

        } catch (error) {
            if (error.response?.error_code === 400 && error.response?.description?.includes('message is not modified')) {
                await ctx.answerCbQuery().catch(() => {});
                return;
            }
            console.error('Error handling recurring button:', error);
            await ctx.answerCbQuery('Error accessing recurring settings');
        }
    }
    async handleStopRecurring(ctx) {
        const parts = ctx.callbackQuery.data.split('_');
        const chatId = parts[2];
        const questId = parts[3];
        const language = await this.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!await this.questExists(quest, ctx, questId)) return;

            // Remove recurring settings
            quest.frequency = null;
            quest.recurringTaskId = null;

            // Cancel any scheduled recurring tasks if scheduler is available
            if (quest.recurringTaskId && this.scheduler) {
                await this.scheduler.cancelRecurringTask(quest.recurringTaskId);
            }

            await this.db.put(chatId + '/quests', quest);

            // Update back to the main quest view
            await this.updateMessage(ctx, quest, language);

            await ctx.answerCbQuery(i18next.t('recurring_stopped', {
                lng: language,
                defaultValue: 'Recurring stopped for this quest.'
            })).catch(() => {});

        } catch (error) {
            console.error('Error stopping recurring:', error);
            await ctx.answerCbQuery('Error stopping recurring');
        }
    }
    async handleParticipantsButton(ctx) {
        const callbackData = ctx.callbackQuery.data;
        const dataParts = callbackData.split('_');

        // Parse callback data: participants_quest_{chatId}_{questId}
        const chatId = dataParts[2];
        const questId = dataParts[3];
        const language = await this.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            await this.showParticipantSelection(ctx, chatId, questId, quest, language);

        } catch (error) {
            console.error('Error showing participant selection:', error);
            await ctx.answerCbQuery('Error showing participant selection');
        }
    }

    async showParticipantSelection(ctx, chatId, questId, quest, language) {
        try {
            await ctx.answerCbQuery().catch(() => {});

            const users = await this.getUsers(chatId);
            const messageId = ctx.callbackQuery.message.message_id;

            // Ensure participants array exists
            if (!quest.participants) {
                quest.participants = [];
            }

            // Create buttons for each user
            const userButtons = [];

            // Add "This Holon" (group) button first
            const isHolonSelected = quest.participants.some(p => p.id === parseInt(chatId));
            const holonStatus = isHolonSelected ? '✅' : '⬜️';
            userButtons.push([{
                text: `${holonStatus} 🏛️ This Holon`,
                callback_data: `toggle_quest_holon:${questId}`
            }]);

            // Add individual user buttons
            for (const user of users) {
                const isSelected = quest.participants.some(p => p.id === user.id);
                const status = isSelected ? '✅' : '⬜️';
                const displayName = getDisplayName(user);

                userButtons.push([{
                    text: `${status} ${displayName}`,
                    callback_data: `toggle_quest_participant:${questId}_${user.id}`
                }]);
            }

            // Add control buttons
            userButtons.push([
                {
                    text: '☑️ Select All',
                    callback_data: `select_all_quest_participants:${questId}`
                },
                {
                    text: '🔙 Back',
                    callback_data: `back_from_participants_${chatId}_${questId}`
                }
            ]);

            const keyboard = Markup.inlineKeyboard(userButtons);
            const message = 'Select participants for quest:';

            // Check if this is a photo message or text message
            if (ctx.callbackQuery.message.photo) {
                // For photo messages, edit the caption and keyboard
                await ctx.telegram.editMessageCaption(chatId, messageId, null, message, keyboard);
            } else {
                // For text messages, edit the text and keyboard
                await ctx.telegram.editMessageText(chatId, messageId, null, message, keyboard);
            }

        } catch (error) {
            // If the message content is the same, just continue silently
            if (error.response?.error_code === 400 && error.response?.description?.includes('message is not modified')) {
                // Message is already up to date, no error needed
                return;
            }
            console.error('Error showing participant selection:', error);
            await ctx.answerCbQuery('Error showing participant selection');
        }
    }
    async handleToggleParticipant(ctx) {
        try {
            await ctx.answerCbQuery().catch(() => {});

            const callbackData = ctx.callbackQuery.data;

            // Format: toggle_quest_participant:questId_userId
            const dataParts = callbackData.split(':')[1]; // Get "questId_userId"
            const [questId, userIdStr] = dataParts.split('_'); // Split into questId and userId
            const userId = parseInt(userIdStr);
            const chatId = ctx.callbackQuery.message.chat.id;

            let quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            // Ensure participants array exists
            if (!quest.participants) {
                quest.participants = [];
            }

            // Toggle participant
            const existingUserIndex = quest.participants.findIndex(p => p.id === userId);
            if (existingUserIndex !== -1) {
                // Remove user from participants
                quest.participants.splice(existingUserIndex, 1);
            } else {
                // Add user to participants
                const users = await this.getUsers(chatId);
                const user = users.find(u => u.id === userId);
                if (user) {
                    quest.participants.push(user);
                    // Remove chatId ("This Holon") if it exists
                    quest.participants = quest.participants.filter(p => p.id !== parseInt(chatId));
                }
            }

            await this.db.put(chatId + '/quests', quest);

            // Refresh the participant selection view only
            await this.refreshParticipantView(ctx, chatId, questId);

        } catch (error) {
            console.error('Error toggling participant:', error);
            await ctx.answerCbQuery('Error updating participant');
        }
    }
    async handleSelectAllParticipants(ctx) {
        try {
            await ctx.answerCbQuery().catch(() => {});

            const questId = ctx.callbackQuery.data.split(':')[1];
            const chatId = ctx.callbackQuery.message.chat.id;

            let quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            const users = await this.getUsers(chatId);

            // Add all users to participants (excluding chat ID to avoid duplication)
            quest.participants = users.slice();

            await this.db.put(chatId + '/quests', quest);

            // Refresh the participant selection view
            await this.refreshParticipantView(ctx, chatId, questId);

        } catch (error) {
            console.error('Error selecting all participants:', error);
            await ctx.answerCbQuery('Error selecting all participants');
        }
    }
    async handleToggleHolonParticipation(ctx) {
        try {
            await ctx.answerCbQuery().catch(() => {});

            const questId = ctx.callbackQuery.data.split(':')[1];
            const chatId = ctx.callbackQuery.message.chat.id;

            let quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            // Ensure participants array exists
            if (!quest.participants) {
                quest.participants = [];
            }

            const isHolonSelected = quest.participants.some(p => p.id === parseInt(chatId));

            if (isHolonSelected) {
                // "This Holon" is currently selected, deselect it and select all individual users
                const users = await this.getUsers(chatId);
                quest.participants = users.slice();
            } else {
                // "This Holon" is not selected, select it and deselect everyone else
                const holonUser = { id: parseInt(chatId), first_name: "This Holon" };
                quest.participants = [holonUser];
            }

            await this.db.put(chatId + '/quests', quest);

            // Refresh the participant selection view
            await this.refreshParticipantView(ctx, chatId, questId);

        } catch (error) {
            console.error('Error toggling holon participation:', error);
            await ctx.answerCbQuery('Error updating holon participation');
        }
    }
    async backFromParticipants(ctx) {
        const parts = ctx.callbackQuery.data.split('_');
        // Parse callback data: back_from_participants_{chatId}_{questId}
        const chatId = parts[3];
        const questId = parts[4];
        const language = await this.getLanguage(chatId);

        try {
            await ctx.answerCbQuery().catch(() => {});
            const quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            // Update back to the main quest view
            await this.updateMessage(ctx, quest, language);
        } catch (error) {
            console.error('Error going back from participants:', error);
            await ctx.answerCbQuery('Error going back');
        }
    }
    async handleBackToQuest(ctx) {
        const [chatId, questId] = ctx.match[1].split('_');
        const language = await this.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', questId);
            if (!await this.questExists(quest, ctx, questId)) { 
                return; 
            }

            // Update message to show quest again
            await this.updateMessage(ctx, quest, language);
            await ctx.answerCbQuery().catch(() => {});
            
        } catch (error) {
            console.error('Error handling back to quest:', error);
            await ctx.answerCbQuery('Error returning to quest');
        }
    }
    async handleCheckItem(ctx) {
        const [checklistId, itemIndex] = ctx.match[1].split('_');
        const chatId = ctx.callbackQuery.message.chat.id;
        const messageId = ctx.callbackQuery.message.message_id;

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

            // Update the main quest display
            const mainQuest = await this.db.get(chatId + '/quests', checklist.questId);
            if (mainQuest) {
                await this.updateMessage(ctx, mainQuest, await this.getLanguage(chatId));
            }

            // Create updated checklist keyboard
            const keyboard = [];
            checklist.items.forEach((item, index) => {
                const status = item.checked ? '✅' : '☐';
                keyboard.push([{
                    text: `${status} ${item.text}`,
                    callback_data: `check_${checklistId}_${index}`
                }]);
            });

            // Add "Add Item" button
            keyboard.push([{
                text: '➕ Add Item',
                callback_data: `add_item_to_${checklistId}`
            }]);

            // Update the checklist message
            await ctx.telegram.editMessageReplyMarkup(chatId, messageId, null, { inline_keyboard: keyboard });
            await ctx.answerCbQuery().catch(() => {});

        } catch (error) {
            console.error('Error handling check item:', error);
            await ctx.answerCbQuery('Error updating checklist item');
        }
    }
    async handleAddItem(ctx) {
        const checklistId = ctx.match[1]; // This is the original quest.id
        const chatId = ctx.callbackQuery.message.chat.id;

        try {
            // Get the checklist to ensure it exists
            const checklist = await this.db.get(chatId + '/checklists', checklistId);
            if (!checklist) {
                await ctx.answerCbQuery('Checklist not found');
                return;
            }

            // Simple implementation: ask for the item text directly
            await ctx.answerCbQuery('Reply with the new checklist item text');

            // Send a prompt message
            const promptMessage = await ctx.reply('📝 Reply with the text for the new checklist item:');

            // Store the context for handling the response
            const responseHandler = async (responseCtx) => {
                if (responseCtx.message && responseCtx.message.text) {
                    const itemText = responseCtx.message.text;

                    // Add the new item to the checklist
                    checklist.items.push({
                        text: itemText,
                        checked: false
                    });

                    await this.db.put(chatId + '/checklists', checklist);

                    // Update the main quest
                    const mainQuest = await this.db.get(chatId + '/quests', checklist.questId);
                    if (mainQuest) {
                        await this.updateMessage(responseCtx, mainQuest, await this.getLanguage(chatId));
                    }

                    // Update the checklist display
                    const keyboard = [];
                    checklist.items.forEach((item, index) => {
                        const status = item.checked ? '✅' : '☐';
                        keyboard.push([{
                            text: `${status} ${item.text}`,
                            callback_data: `check_${checklistId}_${index}`
                        }]);
                    });

                    keyboard.push([{
                        text: '➕ Add Item',
                        callback_data: `add_item_to_${checklistId}`
                    }]);

                    // Find and update the checklist message
                    await this.bot.telegram.editMessageReplyMarkup(chatId, ctx.callbackQuery.message.message_id, null, { inline_keyboard: keyboard });

                    // Clean up prompt message
                    const botHasAdminRights = await isBotAdmin(responseCtx);
                    if (botHasAdminRights) {
                        await responseCtx.deleteMessage(promptMessage.message_id).catch(() => {});
                        await responseCtx.deleteMessage(responseCtx.message.message_id).catch(() => {});
                    }

                    // Remove this handler
                    this.bot.off('text', responseHandler);
                }
            };

            // Set up temporary text handler
            this.bot.on('text', responseHandler);

            // Auto-remove handler after 60 seconds
            setTimeout(() => {
                this.bot.off('text', responseHandler);
            }, 60000);

        } catch (error) {
            console.error('Error handling add item:', error);
            await ctx.answerCbQuery('Error adding checklist item');
        }
    }
    async viewOriginalQuest(ctx) {
        const originalQuestIdParts = ctx.match[1];
        const currentChatId = ctx.callbackQuery.message.chat.id;
        const language = await this.getLanguage(currentChatId);
        const interactingUserId = ctx.callbackQuery.from.id;

        try {
            const parts = originalQuestIdParts.split('_');
            let originalQuestChatId, actualOriginalQuestId;

            if (parts.length >= 2) {
                actualOriginalQuestId = parts.pop();
                originalQuestChatId = parts.pop();
                
                // Validate IDs
                if (!originalQuestChatId || originalQuestChatId === 'undefined' || originalQuestChatId === 'null') {
                    await ctx.answerCbQuery('Error: Invalid quest source.');
                    return;
                }
                
                if (!actualOriginalQuestId || actualOriginalQuestId === 'undefined' || actualOriginalQuestId === 'null') {
                    await ctx.answerCbQuery('Error: Invalid quest identifier.');
                    return;
                }
            } else {
                await ctx.answerCbQuery('Error: Invalid quest identifier format.');
                return;
            }

            let questToView;
            try {
                // Try to get the quest from the original holon
                questToView = await this.db.get(originalQuestChatId + '/quests', actualOriginalQuestId.toString());
            } catch (dbError) {
                // Try to find a local hologram copy
                try {
                    const userHologramData = await this.db.holosphere.get(
                        interactingUserId.toString(), 
                        'quests', 
                        actualOriginalQuestId.toString()
                    );
                    
                    if (userHologramData && userHologramData.soul) {
                        questToView = {
                            id: actualOriginalQuestId,
                            chat: originalQuestChatId,
                            title: userHologramData.title || 'Quest from Remote Holon',
                            status: userHologramData.status || 'ongoing',
                            type: 'task',
                            initiator: { first_name: 'Remote User' },
                            participants: [],
                            appreciation: [],
                            timeTracking: {},
                            date: userHologramData.lastInteracted || Date.now(),
                            description: 'This quest originates from a holon that is no longer accessible.'
                        };
                    } else {
                        throw new Error('No hologram data found');
                    }
                } catch (hologramError) {
                    await ctx.answerCbQuery('Error: This quest is from an inaccessible holon.');
                    return;
                }
            }

            if (!questToView) {
                await ctx.answerCbQuery('Quest not found.');
                return;
            }

            // Ensure quest has correct IDs
            questToView.chat = originalQuestChatId;
            questToView.id = actualOriginalQuestId;

            // Create message for the quest view
            const baseMessageText = await this.createMessage(questToView, language);
            const originalHolonName = await getHolonName(this.db, originalQuestChatId, ctx);
            const messageText = baseMessageText + 
                `| 🔗 Linked from ${originalHolonName}\n`;
            const markup = this.markup(questToView, language);
            
            // Try to generate quest image
            let questImagePath = null;
            const showQuestsAsImages = this.shouldShowQuestsAsImages();
            
            if (showQuestsAsImages && this.ui && this.ui.getQuestImage) {
                try {
                    questImagePath = await this.ui.getQuestImage(questToView, originalQuestChatId, true);
                } catch (error) {
                    // Silently handle image generation errors
                }
            }
            
            // Send the quest view
            let newHologramMsg;
            if (showQuestsAsImages && questImagePath) {
                newHologramMsg = await ctx.replyWithPhoto(
                    { source: questImagePath }, 
                    {
                        caption: createPaddedCaption(''),
                        parse_mode: 'Markdown',
                        ...markup
                    }
                );
            } else {
                newHologramMsg = await ctx.reply(messageText, markup);
            }
            
            // Track the hologram message
            try {
                if (!questToView.activeHolograms || !Array.isArray(questToView.activeHolograms)) {
                    questToView.activeHolograms = [];
                }

                const existingLink = questToView.activeHolograms.find(
                    h => h.chatId === newHologramMsg.chat.id && 
                         h.messageId === newHologramMsg.message_id
                );

                if (!existingLink) {
                    questToView.activeHolograms.push({
                        platform: 'telegram',
                        chatId: newHologramMsg.chat.id,
                        messageId: newHologramMsg.message_id
                    });
                }

                // Save the updated quest with the new hologram link
                await this.db.put(originalQuestChatId + '/quests', questToView).catch(() => {});
            } catch (error) {
                // Silently handle tracking errors
            }

            await ctx.answerCbQuery().catch(() => {});

        } catch (error) {
            console.error('Error viewing original quest:', error);
            await ctx.answerCbQuery('Error displaying quest details.');
        }
    }
    async ensureTelegramHologramMessage(ctx, quest, userId, language) {
        if (!quest?.id || !quest.chat || !userId) return;

        try {
            // Check if user already has a hologram message for this quest
            const existingHologram = quest.activeHolograms?.find(h =>
                h.platform === 'telegram' && h.chatId === userId
            );

            if (existingHologram) {
                // Update existing hologram
                try {
                    await this.updateQuestMessage(ctx, quest, userId, existingHologram.messageId, language, this.markup(quest, language));
                    return existingHologram;
                } catch (error) {
                    // If update fails, remove the invalid hologram link and create a new one
                    quest.activeHolograms = quest.activeHolograms.filter(h => h !== existingHologram);
                }
            }

            // Create new hologram message
            const showImages = this.shouldShowQuestsAsImages();
            const baseMessageText = await this.createMessage(quest, language);
            const originalHolonName = await getHolonName(this.db, quest.chat, ctx);
            const messageText = baseMessageText +
                `| 🔗 Linked from ${originalHolonName}\n`;
            const markup = this.markup(quest, language);

            let hologramMessage;

            if (showImages) {
                const questImagePath = await this.getCachedQuestImage(quest, quest.chat, true);
                if (questImagePath) {
                    try {
                        hologramMessage = await ctx.telegram.sendPhoto(userId,
                            { source: questImagePath },
                            {
                                caption: createPaddedCaption(''),
                                parse_mode: 'Markdown',
                                ...markup
                            }
                        );
                    } catch (imageError) {
                        // Fallback to text if image sending fails
                        hologramMessage = await ctx.telegram.sendMessage(userId, messageText, markup);
                    }
                } else {
                    hologramMessage = await ctx.telegram.sendMessage(userId, messageText, markup);
                }
            } else {
                hologramMessage = await ctx.telegram.sendMessage(userId, messageText, markup);
            }

            // Track the new hologram
            if (!quest.activeHolograms) quest.activeHolograms = [];

            const hologramLink = {
                platform: 'telegram',
                chatId: userId,
                messageId: hologramMessage.message_id
            };

            quest.activeHolograms.push(hologramLink);

            // Save updated quest with new hologram link
            await this.db.put(quest.chat + '/quests', quest);

            return hologramLink;

        } catch (error) {
            console.error(`Error creating hologram message for user ${userId}:`, error);
            // If it's a blocked user error, silently continue
            if (error.response?.error_code === 403) {
                console.log(`User ${userId} has blocked the bot`);
            }
            return null;
        }
    }
    async handleFederatedMessages(ctx, quest, language) {
        if (!quest?.published) return;

        try {
            // Check if there are federated holons to share with
            const federatedHolons = await this.db.getAll('federatedHolons').catch(() => []);

            if (!federatedHolons?.length) {
                console.log('No federated holons configured');
                return;
            }

            // Share quest with federated holons
            for (const holon of federatedHolons) {
                try {
                    if (holon.type === 'telegram' && holon.chatId) {
                        // Create a federated quest message
                        const baseMessageText = await this.createMessage(quest, language);
                        const originalHolonName = await getHolonName(this.db, quest.chat, ctx);
                        const federatedMessageText = `🌐 **${i18next.t('federated_quest', { lng: language, defaultValue: 'Federated Quest' })}**\n` +
                            `📡 ${i18next.t('from_holon', { lng: language, defaultValue: 'From holon' })}: ${originalHolonName}\n\n` +
                            baseMessageText;

                        // Create simplified markup for federated quest
                        const federatedMarkup = Markup.inlineKeyboard([
                            [Markup.button.callback(
                                i18next.t('view_original', { lng: language, defaultValue: 'View Original' }),
                                `view_original_quest_${quest.chat}_${quest.id}`
                            )]
                        ]);

                        let federatedMessage;

                        // Send to federated holon
                        if (this.shouldShowQuestsAsImages()) {
                            const questImagePath = await this.getCachedQuestImage(quest, quest.chat, true);
                            if (questImagePath) {
                                try {
                                    federatedMessage = await ctx.telegram.sendPhoto(holon.chatId,
                                        { source: questImagePath },
                                        {
                                            caption: createPaddedCaption(''),
                                            parse_mode: 'Markdown',
                                            ...federatedMarkup
                                        }
                                    );
                                } catch (imageError) {
                                    federatedMessage = await ctx.telegram.sendMessage(holon.chatId, federatedMessageText, federatedMarkup);
                                }
                            } else {
                                federatedMessage = await ctx.telegram.sendMessage(holon.chatId, federatedMessageText, federatedMarkup);
                            }
                        } else {
                            federatedMessage = await ctx.telegram.sendMessage(holon.chatId, federatedMessageText, federatedMarkup);
                        }

                        // Track federated message
                        if (!quest.activeHolograms) quest.activeHolograms = [];
                        quest.activeHolograms.push({
                            platform: 'telegram',
                            chatId: holon.chatId,
                            messageId: federatedMessage.message_id,
                            type: 'federated'
                        });

                        console.log(`Shared quest ${quest.id} with federated holon ${holon.chatId}`);

                    } else if (holon.type === 'webhook' && holon.url) {
                        // Send to webhook endpoint (for other platforms or services)
                        const payload = {
                            type: 'quest_published',
                            quest: {
                                id: quest.id,
                                title: quest.title,
                                type: quest.type,
                                status: quest.status,
                                initiator: quest.initiator,
                                participants: quest.participants,
                                appreciation: quest.appreciation,
                                date: quest.date,
                                chat: quest.chat
                            },
                            source_holon: await getHolonName(this.db, quest.chat, ctx)
                        };

                        // Make HTTP request to webhook (would need fetch or axios)
                        // For now, just log the intent
                        console.log(`Would send to webhook ${holon.url}:`, payload);
                    }

                } catch (holonError) {
                    console.error(`Error sharing quest with federated holon ${holon.chatId || holon.url}:`, holonError);
                }
            }

            // Save updated quest with federated hologram links
            if (quest.activeHolograms?.length > 0) {
                await this.db.put(quest.chat + '/quests', quest);
            }

        } catch (error) {
            console.error('Error handling federated messages:', error);
        }
    }

    // Helper methods for dependency and participant management
    async refreshDependencyView(ctx) {
        try {
            // Re-trigger the dependencies button to refresh the view
            await this.handleDependenciesButton(ctx);
        } catch (error) {
            // If the message content is the same, just silently continue
            if (error.response?.error_code === 400 && error.response?.description?.includes('message is not modified')) {
                // Message is already up to date, no need to refresh
                return;
            }
            throw error; // Re-throw other errors
        }
    }

    async refreshParticipantView(ctx, chatId, questId) {
        try {
            const language = await this.getLanguage(chatId);

            // Get fresh quest data to ensure we have the latest state
            const updatedQuest = await this.db.get(chatId + '/quests', questId.toString());
            if (!updatedQuest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            await this.showParticipantSelection(ctx, chatId, questId, updatedQuest, language);
        } catch (error) {
            // If the message content is the same, just silently continue
            if (error.response?.error_code === 400 && error.response?.description?.includes('message is not modified')) {
                // Message is already up to date, no need to refresh
                return;
            }
            throw error; // Re-throw other errors
        }
    }
    async handleSetRecurring(ctx) {
        const parts = ctx.callbackQuery.data.split('_');
        const chatId = parts[2];
        const questId = parts[3];
        const frequency = parts[4];
        const language = await this.getLanguage(chatId);

        try {
            const quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!await this.questExists(quest, ctx, questId)) return;

            // Set the new frequency
            quest.frequency = frequency === 'never' ? null : frequency;

            // If setting up recurring, create a recurring task ID
            if (quest.frequency && this.scheduler) {
                // Cancel existing recurring task if any
                if (quest.recurringTaskId) {
                    await this.scheduler.cancelRecurringTask(quest.recurringTaskId);
                }

                // Create new recurring task
                quest.recurringTaskId = await this.scheduler.createRecurringTask(quest, quest.frequency);
            } else if (!quest.frequency && quest.recurringTaskId && this.scheduler) {
                // Cancel recurring task if frequency is set to never
                await this.scheduler.cancelRecurringTask(quest.recurringTaskId);
                quest.recurringTaskId = null;
            }

            await this.db.put(chatId + '/quests', quest);

            // Update back to the main quest view
            await this.updateMessage(ctx, quest, language);

            const frequencyText = quest.frequency
                ? i18next.t(quest.frequency, { lng: language, defaultValue: quest.frequency })
                : i18next.t('never', { lng: language, defaultValue: 'Never' });

            await ctx.answerCbQuery(i18next.t('recurring_updated', {
                lng: language,
                frequency: frequencyText,
                defaultValue: `Recurring frequency set to: ${frequencyText}`
            })).catch(() => {});

        } catch (error) {
            console.error('Error setting recurring:', error);
            await ctx.answerCbQuery('Error setting recurring frequency');
        }
    }

    async handleBackFromRecurring(ctx) {
        const parts = ctx.callbackQuery.data.split('_');
        const chatId = parts[3];
        const questId = parts[4];
        const language = await this.getLanguage(chatId);

        try {
            await ctx.answerCbQuery().catch(() => {});
            const quest = await this.db.get(chatId + '/quests', questId.toString());
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            // Update back to the main quest view
            await this.updateMessage(ctx, quest, language);
        } catch (error) {
            console.error('Error going back from recurring:', error);
            await ctx.answerCbQuery('Error going back');
        }
    }

    async updateHolograms(ctx, quest, language, markupConfig, hologramsToUpdate) {
        if (!hologramsToUpdate?.length) return;

        const updatePromises = hologramsToUpdate.map(async (hologram) => {
            try {
                if (hologram.platform === 'telegram') {
                    await this.updateQuestMessage(ctx, quest, hologram.chatId, hologram.messageId, language, markupConfig);
                }
            } catch (error) {
                console.error(`Error updating hologram ${hologram.chatId}/${hologram.messageId}:`, error);
                // Remove invalid hologram links
                if (quest.activeHolograms) {
                    quest.activeHolograms = quest.activeHolograms.filter(h =>
                        !(h.chatId === hologram.chatId && h.messageId === hologram.messageId)
                    );
                }
            }
        });

        await Promise.allSettled(updatePromises);

        // Save updated quest if hologram links were cleaned up
        if (quest.activeHolograms && quest.activeHolograms.length !== hologramsToUpdate.length) {
            try {
                await this.db.put(quest.chat + '/quests', quest);
            } catch (error) {
                console.error('Error saving quest after hologram cleanup:', error);
            }
        }
    }

    async remind(ctx, quest) {
        if (!this.scheduler) {
            console.error('Scheduler not available for reminders');
            return;
        }

        try {
            const language = await this.getLanguage(quest.chat);
            const message = i18next.t('quest_reminder', {
                lng: language,
                title: quest.title,
                defaultValue: `Reminder: "${quest.title}" is still pending.`
            });

            // Send reminder to quest initiator
            if (quest.initiator?.id) {
                try {
                    await ctx.telegram.sendMessage(quest.initiator.id, message, {
                        reply_markup: this.markup(quest, language).reply_markup
                    });
                } catch (error) {
                    console.error('Error sending reminder to initiator:', error);
                }
            }

            // Send reminder to participants
            if (quest.participants?.length) {
                const reminderPromises = quest.participants.map(async (participant) => {
                    try {
                        await ctx.telegram.sendMessage(participant.id, message, {
                            reply_markup: this.markup(quest, language).reply_markup
                        });
                    } catch (error) {
                        console.error(`Error sending reminder to participant ${participant.id}:`, error);
                    }
                });

                await Promise.allSettled(reminderPromises);
            }

        } catch (error) {
            console.error('Error sending quest reminder:', error);
        }
    }

    // Performance optimization methods
    async getLanguage(chatId) {
        const key = `lang_${chatId}`;
        const cached = this.languageCache.get(key);
        if (cached && cached.expires > Date.now()) {
            return cached.language;
        }

        const language = await this.settings.getLanguage(chatId);
        this.languageCache.set(key, {
            language,
            expires: Date.now() + this.cacheExpiry
        });
        return language;
    }

    async getUsers(chatId, forceRefresh = false) {
        const key = `users_${chatId}`;
        if (!forceRefresh && this.userCache.has(key)) {
            const cached = this.userCache.get(key);
            if (cached.expires > Date.now()) {
                return cached.users;
            }
        }

        const users = await this.db.getAll(chatId + '/users');
        this.userCache.set(key, {
            users,
            expires: Date.now() + this.cacheExpiry
        });
        return users;
    }

    async getCachedQuestImage(quest, chatId, isHologram = false) {
        // Create a cache key that includes quest data hash for invalidation
        const questDataHash = this.getQuestDataHash(quest);
        const cacheKey = `${quest.id}_${quest.chat}_${isHologram}_${questDataHash}`;

        if (this.questImageCache.has(cacheKey)) {
            return this.questImageCache.get(cacheKey);
        }

        if (!this.ui?.getQuestImage) {
            return null;
        }

        try {
            // Clear old cache entries for this quest (with different hashes)
            this.invalidateQuestImageCache(quest.id, quest.chat, isHologram);

            const imagePath = await this.ui.getQuestImage(quest, chatId, isHologram);
            this.questImageCache.set(cacheKey, imagePath);

            // Cleanup old cache entries
            if (this.questImageCache.size > 100) {
                const firstKey = this.questImageCache.keys().next().value;
                this.questImageCache.delete(firstKey);
            }

            return imagePath;
        } catch (error) {
            console.error('Error generating quest image:', error);
            return null;
        }
    }

    startCacheCleanup() {
        // Clean up expired cache entries every 10 minutes
        setInterval(() => {
            this.cleanupExpiredCache();
        }, 10 * 60 * 1000);
    }

    cleanupExpiredCache() {
        const now = Date.now();

        // Clean language cache
        for (const [key, value] of this.languageCache.entries()) {
            if (value.expires < now) {
                this.languageCache.delete(key);
            }
        }

        // Clean user cache
        for (const [key, value] of this.userCache.entries()) {
            if (value.expires < now) {
                this.userCache.delete(key);
            }
        }
    }

    // Invalidate cache when users change
    invalidateUserCache(chatId) {
        const key = `users_${chatId}`;
        this.userCache.delete(key);
    }

    // Generate a hash of quest data that affects image rendering
    getQuestDataHash(quest) {
        const relevantData = {
            title: quest.title,
            status: quest.status,
            participants: quest.participants?.length || 0,
            appreciation: quest.appreciation?.length || 0,
            timeTracking: Object.keys(quest.timeTracking || {}).length,
            dependencies: quest.dependencies?.length || 0,
            checklistId: quest.checklistId,
            description: quest.description,
            type: quest.type,
            frequency: quest.frequency,
            published: quest.published,
            broadcasted: quest.broadcasted
        };

        // Simple hash function - convert to string and get a hash
        const dataString = JSON.stringify(relevantData);
        let hash = 0;
        for (let i = 0; i < dataString.length; i++) {
            const char = dataString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    // Invalidate quest image cache for a specific quest
    invalidateQuestImageCache(questId, questChat, isHologram = null) {
        const keysToDelete = [];

        for (const key of this.questImageCache.keys()) {
            // Match pattern: questId_questChat_isHologram_hash
            const parts = key.split('_');
            if (parts.length >= 3 && parts[0] === questId.toString() && parts[1] === questChat.toString()) {
                if (isHologram === null || parts[2] === isHologram.toString()) {
                    keysToDelete.push(key);
                }
            }
        }

        keysToDelete.forEach(key => this.questImageCache.delete(key));

        if (keysToDelete.length > 0) {
            console.log(`Invalidated ${keysToDelete.length} cached images for quest ${questId}`);
        }
    }

    // Helper method to save quest and invalidate image cache
    async saveQuest(quest, path = null) {
        const questPath = path || `${quest.chat}/quests`;
        await this.db.put(questPath, quest);

        // Invalidate image cache for this quest
        if (quest.id && quest.chat) {
            this.invalidateQuestImageCache(quest.id, quest.chat);
        }
    }

    // Queue operation to prevent race conditions on rapid button clicks
    async queueQuestOperation(chatID, questID, operation) {
        const questKey = `${chatID}_${questID}`;

        log.info(`queueQuestOperation - questKey: ${questKey}`);

        // Wait for any pending operation on this quest to complete
        const existingOp = this.questOperationQueues.get(questKey);
        if (existingOp) {
            log.info(`Waiting for existing operation on ${questKey}`);
            await existingOp.catch(() => {}); // Wait but ignore errors
        }

        // Execute the new operation and store its promise
        log.info(`Executing new operation on ${questKey}`);
        const newOp = operation();
        this.questOperationQueues.set(questKey, newOp);

        try {
            const result = await newOp;
            log.info(`Operation completed successfully on ${questKey}`);
            return result;
        } catch (err) {
            log.error(`Operation failed on ${questKey}`, err);
            throw err;
        } finally {
            // Clean up if this is still the current operation
            if (this.questOperationQueues.get(questKey) === newOp) {
                this.questOperationQueues.delete(questKey);
            }
        }
    }

    // Database batching methods
    async batchLoadDependencies(chatId, dependencyIds) {
        if (!dependencyIds?.length) return [];

        const promises = dependencyIds.map(id =>
            this.db.get(chatId + '/quests', id.toString()).catch(() => null)
        );

        return Promise.all(promises);
    }

    async batchSaveUserActions(actions) {
        if (!actions?.length) return;

        // Check if users instance has batch method
        if (this.users?.batchSaveUserActions) {
            return this.users.batchSaveUserActions(actions);
        }

        // Fallback: Process in parallel batches of 10
        const BATCH_SIZE = 10;
        for (let i = 0; i < actions.length; i += BATCH_SIZE) {
            const batch = actions.slice(i, i + BATCH_SIZE);
            const promises = batch.map(action =>
                this.users.saveUserAction(action.user, action.action, action.quest, action.value, action.chatID)
                    .catch(error => console.error('Error saving user action:', error))
            );
            await Promise.allSettled(promises);
        }
    }

    async batchBroadcastToUsers(ctx, quest, users, language) {
        if (!users?.length) return 0;

        let successCount = 0;
        const BATCH_SIZE = 10; // Process 10 users at a time to avoid overwhelming

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);

            const batchPromises = batch.map(async user => {
                try {
                    // Create a hologram for this user
                    await this.personalHologram(user.id, quest);

                    // Try to send as Telegram message if possible
                    await this.ensureTelegramHologramMessage(ctx, quest, user.id, language);
                    return true; // Success
                } catch (error) {
                    // Silently continue if we can't reach a user
                    console.log(`Could not broadcast to user ${user.id}:`, error.message);
                    return false; // Failure
                }
            });

            const batchResults = await Promise.allSettled(batchPromises);
            successCount += batchResults.filter(result =>
                result.status === 'fulfilled' && result.value === true
            ).length;

            // Small delay between batches to avoid rate limiting
            if (i + BATCH_SIZE < users.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        return successCount;
    }
}
