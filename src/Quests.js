import { Markup } from 'telegraf';
import i18next from 'i18next';
import { getholonId, getMessageId, capitalize, getDisplayName, getHolonName, createPaddedCaption } from './utilities.js';
import { Calendar } from './Calendar.js';
import { Scenes } from 'telegraf';
import { log } from '../utils/logger.js';

const DASHBOARD_ADDRESS = process.env.DASHBOARD_ADDRESS || 'https://dashboard.holons.io';

/**
 * Quest Management System for HolonsBot.
 *
 * @class Quests
 * @module src/Quests
 * @description Handles all quest-related functionality including creation, display,
 * completion, participation, scheduling, and hologram (reference) management.
 * Supports both image and text-based quest display modes.
 *
 * @property {Telegraf} bot - The Telegraf bot instance
 * @property {DB} db - Database instance
 * @property {Users} users - Users module instance
 * @property {Settings} settings - Settings module instance
 * @property {Calendar} calendar - Calendar instance for date/time selection
 * @property {Expenses|null} expenses - Expenses module (set after construction)
 * @property {Checklists|null} checklists - Checklists module (set after construction)
 * @property {UI|null} ui - UI module (set after construction)
 * @property {Scheduler|null} scheduler - Scheduler module (set after construction)
 * @property {Map<string, Object>} questImageCache - Cache for generated quest images
 * @property {Map<string, Promise>} questOperationQueues - Operation queues to prevent race conditions
 * @property {Map<string, {value: *, timestamp: number}>} languageCache - Language settings cache
 * @property {Map<string, {value: *, timestamp: number}>} userCache - User data cache
 *
 * @example
 * const quests = new Quests(bot, db, users, settings);
 * quests.expenses = expensesModule;
 * // Quest commands are now available: /quest, /task, /offer, etc.
 */
export default class Quests {
    /**
     * Gets the holon ID from a quest object with backward compatibility.
     * Supports both new 'holon' field and legacy 'chat' field.
     * @static
     * @param {Object} quest - The quest object
     * @returns {string|number|null} The holon ID
     */
    static getQuestHolon(quest) {
        return quest?.holon ?? quest?.chat ?? null;
    }

    // Parse callback data of the form `<prefix><holonId>_<questId>`. Holon IDs
    // are Telegram chat IDs (digits + optional leading `-`, no underscores), so
    // the holon is everything before the first `_`. Quest IDs from harvest can
    // contain `_` (e.g. `"1714510123456_abc123def"`), so the rest is the quest
    // id verbatim. Pass `prefix` when the handler runs through a generic
    // dispatcher that doesn't set ctx.match for the inner action.
    static parseQuestIds(ctx, prefix = null) {
        const data = ctx.callbackQuery?.data ?? '';
        const suffix = (typeof prefix === 'string' && data.startsWith(prefix))
            ? data.slice(prefix.length)
            : (ctx.match?.[1] ?? '');
        const sep = suffix.indexOf('_');
        if (sep < 0) return { holonId: suffix, questId: '' };
        return {
            holonId: suffix.slice(0, sep),
            questId: suffix.slice(sep + 1),
        };
    }

    // Same as parseQuestIds but for `<prefix><holonId>_<questId>_<tail>` where
    // <tail> is a known short token without `_` (e.g. a frequency word).
    static parseQuestIdsWithTail(ctx, prefix = null) {
        const data = ctx.callbackQuery?.data ?? '';
        const suffix = (typeof prefix === 'string' && data.startsWith(prefix))
            ? data.slice(prefix.length)
            : (ctx.match?.[1] ?? '');
        const last = suffix.lastIndexOf('_');
        if (last < 0) return { holonId: '', questId: '', tail: suffix };
        const tail = suffix.slice(last + 1);
        const head = suffix.slice(0, last);
        const first = head.indexOf('_');
        if (first < 0) return { holonId: head, questId: '', tail };
        return {
            holonId: head.slice(0, first),
            questId: head.slice(first + 1),
            tail,
        };
    }

    // Resolve the Telegram message_id that represents this quest in the given
    // holon. Returns null when no Telegram representation exists (e.g. a quest
    // created in harvest that has never been rendered as a Telegram hologram).
    //
    // quest.id is an opaque identifier — it equals the Telegram message_id only
    // for legacy bot-native quests created via /task, where the bot assigns
    // quest.id = sent.message_id. Harvest quests use string IDs that look
    // nothing like message_ids, so any code that needs to call editMessage*,
    // deleteMessage, pinChatMessage, etc. must go through this resolver.
    static resolveTelegramMessageId(quest, holonId) {
        if (!quest || holonId == null) return null;
        const target = String(holonId);
        const entry = (quest.activeHolograms || []).find(h =>
            String(h.holonId) === target &&
            (!h.platform || h.platform === 'telegram')
        );
        if (entry?.messageId != null) {
            const n = Number(entry.messageId);
            return Number.isFinite(n) ? n : null;
        }
        // Legacy bot-native quests: quest.id is the Telegram message_id of the
        // original message in the home holon.
        if (target === String(Quests.getQuestHolon(quest))) {
            const id = String(quest.id ?? '');
            if (/^-?\d+$/.test(id)) return Number(id);
        }
        return null;
    }

    /**
     * Creates a new Quests instance and registers all quest commands and actions.
     * @constructor
     * @param {Telegraf} bot - The Telegraf bot instance
     * @param {DB} db - The database instance
     * @param {Users} users - The users module instance
     * @param {Settings} settings - The settings module instance
     */
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

        // Cache cleanup interval ID (stored for cleanup on shutdown)
        this.cacheCleanupInterval = null;

        // Start cache cleanup timer
        this.startCacheCleanup();

        this.setupScenes();
        this.registerCommands();
        this.registerActions();
    }

    /**
     * Get the per-holon holosphere for database operations.
     * This ensures data is written with the holon's own key, not the master key.
     * @param {string|number} holonId - The holon identifier
     * @returns {Promise<HoloSphere>} The per-holon holosphere instance
     */
    async getHolonDB(holonId) {
        return this.db.forHolon(holonId);
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
                    holonId: ctx.chat?.id,
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
        // Migrated to InputScene - no custom scenes needed
    }

    registerCommands() {
        const commandGroups = {
            task: ['quest', 'mission', 'task', 'todo', 'missione', 'compito', 'fare'],
            // event commands now handled by Events.js
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
        this.bot.action(/set_recurring_(.+)/, this.safeHandler(ctx => this.handleSetRecurring(ctx)));
        this.bot.action(/back_from_recurring_(.+)/, this.safeHandler(ctx => this.handleBackFromRecurring(ctx)));
        this.bot.action(/back_(.+)/, this.safeHandler(ctx => this.handleBackAction(ctx)));
    }

    // Core quest creation
    async quest(type, ctx) {
        const holonId = getholonId(ctx);
        const messageId = getMessageId(ctx);
        const language = await this.getLanguage(holonId);
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
            const settings = await this.settings.getSettings(holonId);
            if (settings.maxTasks > 0) {
                const holonDB = await this.getHolonDB(holonId);
                const userTasks = (await holonDB.getAll(holonId, 'quests'))
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
            holon: holonId,
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

        if (showAsImage && this.ui?.getQuestImage) {
            // Image mode: show temporary message, will be replaced by generated image (with embedded picture if any)
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
            // Text mode with picture: show original photo with quest text as caption
            const caption = await this.createMessage(quest, language);
            nctx = await ctx.replyWithPhoto(picture, {
                caption: this.truncateCaption(caption),
                ...this.markup(quest, language)
            });
        } else {
            // Text-only mode without picture
            nctx = await ctx.reply(await this.createMessage(quest, language),
                                  this.markup(quest, language));
        }

        // Set quest ID based on platform
        quest.id = ctx.platform === 'discord' ? nctx.id : nctx.message_id;
        if (!quest.holon || quest.holon === 0) {
            quest.holon = ctx.platform === 'discord' ? nctx.channel.id : nctx.chat.id;
        }

        const holonDB = await this.getHolonDB(holonId);
        console.log('[QUEST_PERSIST_DEBUG] put', {
            holonId, holonIdType: typeof holonId,
            questId: quest.id, questIdType: typeof quest.id,
            appname: holonDB.appname,
            title: quest.title,
        });
        const putResult = await holonDB.put(holonId, 'quests', quest).catch(e => ({ error: e.message }));
        console.log('[QUEST_PERSIST_DEBUG] put.result', putResult);
        // Immediate read-back to verify what's in the graph right after write
        try {
            const verify = await holonDB.getAll(holonId.toString(), 'quests');
            console.log('[QUEST_PERSIST_DEBUG] verify.getAll', {
                holonId: holonId.toString(),
                count: Array.isArray(verify) ? verify.length : 'n/a',
                ids: Array.isArray(verify) ? verify.slice(0, 5).map(q => q?.id) : 'n/a',
                hasJustWritten: Array.isArray(verify) && verify.some(q => q?.id == quest.id),
            });
        } catch (e) {
            console.log('[QUEST_PERSIST_DEBUG] verify.error', e.message);
        }

        // Update buttons and pin message
        const questHolon = Quests.getQuestHolon(quest);
        try {
            await this.bot.telegram.editMessageReplyMarkup(questHolon, quest.id, null,
                this.markup(quest, language).reply_markup);
        } catch {}

        this.bot.telegram.pinChatMessage(questHolon, quest.id, { disable_notification: true }).catch(() => {});
        this.bot.telegram.deleteMessage(holonId, messageId).catch(() => {});

        // Generate quest image if image mode enabled (picture will be embedded in generated image)
        if (showAsImage) {
            this.regenerateQuestImageBackground(ctx, quest, questHolon, quest.id, this.markup(quest, language));
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
        const { holonId, questId: messageId } = Quests.parseQuestIds(ctx);
        const sender = ctx.callbackQuery.from;

        log.info(`handleParticipation called - action: ${action}, holonId: ${holonId}, messageId: ${messageId}, user: ${sender.id}`);

        // Answer callback query IMMEDIATELY to prevent UI freezing
        ctx.answerCbQuery().catch(() => {});

        // Queue this operation to prevent race conditions
        await this.queueQuestOperation(holonId, messageId, async () => {
            const language = await this.getLanguage(holonId);
            const holonDB = await this.getHolonDB(holonId);

            log.info(`Attempting to fetch quest from DB: ${holonId}/quests, key: ${messageId}`);
            let quest;
            try {
                quest = await holonDB.get(holonId, 'quests', messageId);
                log.info(`Quest fetched successfully: ${quest ? quest.title : 'null'}`);
            } catch (err) {
                log.error(`Failed to fetch quest from DB: ${holonId}/quests/${messageId}`, err);
            }

            if (!await this.questExists(quest, ctx, messageId)) {
                log.warn(`Quest does not exist: ${holonId}/quests/${messageId}`);
                return;
            }
            if (await this.handleCompletedQuestInteraction(ctx, quest, holonId, messageId, language)) return;

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

            // Unified save and update - pass interacting user for personal hologram on join
            const interactingUser = (action === 'join') ? sender : null;
            await this.updateMessage(ctx, quest, language, { interactingUser });
        });
    }

    async cancel(ctx) {
        const { holonId, questId: messageId } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);
        const holonDB = await this.getHolonDB(holonId);

        let quest;
        try {
            quest = await holonDB.get(holonId, 'quests', messageId);
        } catch {}

        const questHolonId = Quests.getQuestHolon(quest);
        const isHologram = questHolonId && questHolonId.toString() !== holonId;

        if (isHologram) {
            const msgId = ctx.callbackQuery?.message.message_id || messageId;
            const holonId = ctx.callbackQuery?.message.chat.id || holonId;
            await ctx.telegram.deleteMessage(holonId, msgId).catch(() => {});
            return ctx.answerCbQuery('Hologram cancelled.').catch(() => {});
        }

        if (!quest) {
            const msgId = ctx.callbackQuery?.message.message_id || messageId;
            const holonId = ctx.callbackQuery?.message.chat.id || holonId;
            await ctx.telegram.deleteMessage(holonId, msgId).catch(() => {});
            return ctx.answerCbQuery('Quest not found or already cancelled.').catch(() => {});
        }

        const hasPermission = quest.initiator?.id === ctx.from.id ||
                             await this.checkUserAdmin(ctx.from.id, holonId);

        if (!hasPermission) {
            return ctx.answerCbQuery(i18next.t('onlyinitatorcancel', { lng: language })).catch(() => {});
        }

        // Answer callback query IMMEDIATELY before heavy operations
        ctx.answerCbQuery('Cancelling quest...').catch(() => {});

        if (quest.activeHolograms?.length > 0) {
            for (const h of quest.activeHolograms) {
                await ctx.telegram.deleteMessage(h.holonId, h.messageId).catch(() => {});
            }
        }

        if (quest.reminderId && this.scheduler) {
            await this.scheduler.cancelReminder(quest.reminderId);
        }

        await holonDB.delete(holonId, 'quests', messageId);
        // unpin/delete need real Telegram message_ids — resolve from the quest's
        // active holograms (handles harvest quests where messageId is a string).
        const mainTgId = Quests.resolveTelegramMessageId(quest, holonId);
        if (mainTgId != null) {
            await ctx.telegram.unpinChatMessage(holonId, mainTgId).catch(() => {});
            await ctx.telegram.deleteMessage(holonId, mainTgId).catch(() => {});
        } else {
            // Fall back to deleting the message that was clicked.
            await ctx.deleteMessage().catch(() => {});
        }
    }

    async complete(ctx) {
        const { holonId, questId: messageId } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);
        const holonDB = await this.getHolonDB(holonId);
        const quest = await holonDB.get(holonId, 'quests', messageId);

        if (!await this.questExists(quest, ctx, messageId)) return;
        if (quest.status === 'stopped') {
            return ctx.answerCbQuery(i18next.t('cannotcompletestopped', { lng: language }));
        }

        const completerId = ctx.from.id;
        const canComplete = quest.initiator.id === completerId ||
                           quest.participants.some(u => u.id === completerId) ||
                           await this.checkUserAdmin(completerId, holonId);

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
                    await this.expenses?.addExpense(messageId, holonId, hours, 'hour',
                                                   quest.title, userID, holonId);

                    try {
                        const userInfo = await this.users.getUserInfo({ id: parseInt(userID) }, holonId);
                        userInfo.hours = (userInfo.hours || 0) + hours;
                        await holonDB.put(holonId, 'users', userInfo);
                    } catch {}
                }
            }
        }

        const hologramsToUpdate = quest.activeHolograms ? [...quest.activeHolograms] : [];
        quest.activeHolograms = [];
        // Unified save and update
        await this.updateMessage(ctx, quest, language, { explicitHologramsToUpdate: hologramsToUpdate });

        ctx.telegram.unpinChatMessage(holonId, messageId).catch(() => {});

        await this.recordCompletionActions(quest, holonId);

        ctx.reply(`Quest "${quest.title}" completed! 🎊`, { reply_to_message_id: messageId }).catch(() => {});
    }

    async stop(ctx) {
        const { holonId, questId: messageId } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);
        const holonDB = await this.getHolonDB(holonId);
        const quest = await holonDB.get(holonId, 'quests', messageId);

        if (!await this.questExists(quest, ctx, messageId)) return;

        const sender = ctx.callbackQuery.from;
        const idx = quest.stoppers.findIndex(u => u.id === sender.id);

        // Answer callback query IMMEDIATELY
        ctx.answerCbQuery().catch(() => {});

        if (idx > -1) {
            quest.stoppers.splice(idx, 1);
            ctx.reply(`${getDisplayName(sender)} revoked veto for "${quest.title}"`,
                     { reply_to_message_id: messageId }).catch(() => {});
        } else {
            quest.stoppers.push(sender);
            ctx.reply(`${getDisplayName(sender)} stopped "${quest.title}". Please address concerns.`,
                     { reply_to_message_id: messageId }).catch(() => {});
        }

        quest.status = quest.stoppers.length > 0 ? 'stopped' : 'ongoing';
        // Unified save and update
        await this.updateMessage(ctx, quest, language);
    }

    async schedule(ctx) {
        const { questId: questID } = Quests.parseQuestIds(ctx);
        const holonId = ctx.callbackQuery.message.chat.id;
        const holonDB = await this.getHolonDB(holonId);

        try {
            const quest = await holonDB.get(holonId, 'quests', questID);
            if (!await this.questExists(quest, ctx, questID)) return;

            const language = await this.getLanguage(holonId);
            if (await this.handleCompletedQuestInteraction(ctx, quest, holonId, questID, language)) return;

            if (quest.reminderId && this.scheduler) {
                await this.scheduler.cancelReminder(quest.reminderId);
                delete quest.reminderId;
                await holonDB.put(holonId, 'quests', quest);
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
        const { holonId, questId: messageId } = Quests.parseQuestIds(ctx);
        const sender = ctx.callbackQuery.from;

        log.info(`handleTimeTracking called - amount: ${amount}, isAdding: ${isAdding}, holonId: ${holonId}, messageId: ${messageId}, user: ${sender.id}`);

        // Answer callback query IMMEDIATELY to prevent UI freezing
        ctx.answerCbQuery().catch(() => {});

        // Queue this operation to prevent race conditions
        await this.queueQuestOperation(holonId, messageId, async () => {
            const language = await this.getLanguage(holonId);
            const holonDB = await this.getHolonDB(holonId);

            log.info(`Attempting to fetch quest from DB: ${holonId}/quests, key: ${messageId}`);
            let quest;
            try {
                quest = await holonDB.get(holonId, 'quests', messageId);
                log.info(`Quest fetched successfully: ${quest ? quest.title : 'null'}`);
            } catch (err) {
                log.error(`Failed to fetch quest from DB: ${holonId}/quests/${messageId}`, err);
            }

            if (!await this.questExists(quest, ctx, messageId)) {
                log.warn(`Quest does not exist: ${holonId}/quests/${messageId}`);
                return;
            }
            if (await this.handleCompletedQuestInteraction(ctx, quest, holonId, messageId, language)) return;

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

            // Unified save and update - pass interacting user for personal hologram
            await this.updateMessage(ctx, quest, language, {
                useExpandedMarkup: true,
                interactingUser: sender
            });
        });
    }

    // UI Methods
    async showMoreActions(ctx) {
        const { holonId, questId: questID } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);
        const holonDB = await this.getHolonDB(holonId);
        const quest = await holonDB.get(holonId, 'quests', questID);

        if (!await this.questExists(quest, ctx, questID)) return;

        // Use the chat where button was clicked, not the quest's source holon
        const clickedChatId = ctx.callbackQuery.message.chat.id;
        const expandedButtons = this.getExpandedButtons(quest, language);
        await this.updateQuestMessage(ctx, quest, clickedChatId, ctx.callbackQuery.message.message_id,
                                     language, { reply_markup: { inline_keyboard: expandedButtons } });
        await ctx.answerCbQuery().catch(() => {});
    }

    async hideMoreActions(ctx) {
        const { holonId, questId: questID } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);
        const holonDB = await this.getHolonDB(holonId);
        const quest = await holonDB.get(holonId, 'quests', questID);

        if (!await this.questExists(quest, ctx, questID)) return;

        // Use the chat where button was clicked, not the quest's source holon
        const clickedChatId = ctx.callbackQuery.message.chat.id;
        await this.updateQuestMessage(ctx, quest, clickedChatId, ctx.callbackQuery.message.message_id,
                                     language, this.markup(quest, language));
        await ctx.answerCbQuery().catch(() => {});
    }

    markup(quest, language) {
        const questHolon = Quests.getQuestHolon(quest);
        if (!questHolon) return Markup.inlineKeyboard([]);

        if (!quest.id || quest.id === '') {
            return Markup.inlineKeyboard([
                [Markup.button.callback(quest.title || 'Creating quest...', 'placeholder')]
            ]);
        }

        const buttons = [];
        // event type now handled by Events.js
        const isTask = ['task', 'quest', 'todo', 'mission', 'compito', 'recurring'].includes(quest.type);
        const isProposal = quest.type === 'proposal';
        const isOfferRequest = ['offer', 'request'].includes(quest.type);

        if (quest.status === "completed") {
            buttons.push([
                Markup.button.callback(i18next.t('appreciate', { lng: language }),
                                      `appreciate_quest_${questHolon}_${quest.id}`)
            ]);
        } else if (isTask) {
            buttons.push(
                [
                    Markup.button.callback(i18next.t('join', { lng: language }),
                                          `participate_quest_${questHolon}_${quest.id}`),
                    Markup.button.callback(i18next.t('complete', { lng: language }),
                                          `complete_quest_${questHolon}_${quest.id}`)
                ],
                [
                    Markup.button.callback(i18next.t('appreciate', { lng: language }),
                                          `appreciate_quest_${questHolon}_${quest.id}`),
                    Markup.button.callback(i18next.t('schedule', { lng: language }),
                                          `schedule_quest_${questHolon}_${quest.id}`)
                ]
            );
        } else if (isProposal) {
            buttons.push([
                Markup.button.callback(i18next.t('agree', { lng: language }),
                                      `participate_quest_${questHolon}_${quest.id}`),
                Markup.button.callback(i18next.t('stop', { lng: language }),
                                      `stop_quest_${questHolon}_${quest.id}`)
            ]);
        } else if (isOfferRequest) {
            buttons.push([
                Markup.button.callback(i18next.t('accept', { lng: language }),
                                      `participate_quest_${questHolon}_${quest.id}`),
                Markup.button.callback(i18next.t('complete', { lng: language }),
                                      `complete_quest_${questHolon}_${quest.id}`)
            ]);
        } else {
            buttons.push([
                Markup.button.callback(i18next.t('appreciate', { lng: language }),
                                      `appreciate_quest_${questHolon}_${quest.id}`)
            ]);
        }

        if (quest.status !== "completed" && (isTask || isProposal || isOfferRequest)) {
            buttons.push([
                Markup.button.callback('⚙️ ' + i18next.t('more_actions', { lng: language }),
                                      `more_actions_${questHolon}_${quest.id}`)
            ]);
        }

        return Markup.inlineKeyboard(buttons);
    }

    getExpandedButtons(quest, language) {
        const buttons = [];
        const isTask = ['task', 'quest', 'todo', 'mission', 'compito', 'recurring'].includes(quest.type);
        const questHolon = Quests.getQuestHolon(quest);

        if (quest.status === "completed") {
            return [
                [Markup.button.callback(i18next.t('appreciate', { lng: language }),
                                      `appreciate_quest_${questHolon}_${quest.id}`)],
                [Markup.button.callback('🔼 ' + i18next.t('less_actions', { lng: language }),
                                      `less_actions_${questHolon}_${quest.id}`)]
            ];
        }

        if (isTask) {
            buttons.push(
                [
                    Markup.button.callback(i18next.t('join', { lng: language }),
                                          `participate_quest_${questHolon}_${quest.id}`),
                    Markup.button.callback(i18next.t('complete', { lng: language }),
                                          `complete_quest_${questHolon}_${quest.id}`)
                ],
                [
                    Markup.button.callback(i18next.t('appreciate', { lng: language }),
                                          `appreciate_quest_${questHolon}_${quest.id}`),
                    Markup.button.callback(i18next.t('schedule', { lng: language }),
                                          `schedule_quest_${questHolon}_${quest.id}`)
                ],
                [
                    Markup.button.callback(i18next.t('stop', { lng: language }),
                                          `stop_quest_${questHolon}_${quest.id}`),
                    Markup.button.callback(i18next.t('cancel', { lng: language }),
                                          `cancel_quest_${questHolon}_${quest.id}`)
                ],
                [
                    Markup.button.callback('⏰ -1h', `subtract_1h_quest_${questHolon}_${quest.id}`),
                    Markup.button.callback('⏰ -15m', `subtract_time_quest_${questHolon}_${quest.id}`),
                    Markup.button.callback('⏰ +15m', `add_time_quest_${questHolon}_${quest.id}`),
                    Markup.button.callback('⏰ +1h', `add_1h_quest_${questHolon}_${quest.id}`)
                ],
                [
                    Markup.button.callback('📝 ' + i18next.t('description', { lng: language }),
                                          `descriptions_quest_${questHolon}_${quest.id}`),
                    Markup.button.callback('📋 ' + i18next.t('subtasks', { lng: language }),
                                          `checklist_quest_${questHolon}_${quest.id}`)
                ],
                [
                    Markup.button.callback('🔗 ' + i18next.t('dependencies', { lng: language }),
                                          `dependencies_quest_${questHolon}_${quest.id}`),
                    Markup.button.callback('🔄 ' + this.getRecurringButtonText(quest, language),
                                          `recurring_quest_${questHolon}_${quest.id}`)
                ],
                [
                    Markup.button.callback('👥 ' + i18next.t('select_participants', { lng: language }),
                                          `participants_quest_${questHolon}_${quest.id}`)
                ],
                [
                    Markup.button.callback('📢 ' + i18next.t('publish', { lng: language }),
                                          `publish_quest_${questHolon}_${quest.id}`),
                    Markup.button.url('📊 Dashboard',
                                     `${DASHBOARD_ADDRESS}/${questHolon}/tasks?task=${quest.id}`)
                ]
            );
        // event type now handled by Events.js
        } else if (quest.type === 'proposal') {
            buttons.push(
                [
                    Markup.button.callback(i18next.t('agree', { lng: language }),
                                          `participate_quest_${questHolon}_${quest.id}`),
                    Markup.button.callback(i18next.t('stop', { lng: language }),
                                          `stop_quest_${questHolon}_${quest.id}`)
                ],
                [Markup.button.callback(i18next.t('appreciate', { lng: language }),
                                       `appreciate_quest_${questHolon}_${quest.id}`)]
            );
        } else {
            buttons.push(
                [Markup.button.callback(i18next.t('appreciate', { lng: language }),
                                       `appreciate_quest_${questHolon}_${quest.id}`)]
            );
        }

        buttons.push(
            [Markup.button.callback('🔼 ' + i18next.t('less_actions', { lng: language }),
                                   `less_actions_${questHolon}_${quest.id}`)]
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
            const deps = await this.batchLoadDependencies(Quests.getQuestHolon(quest), quest.dependencies);
            const titles = deps.map(dep => dep?.title || '').filter(title => title);
            if (titles.length > 0) {
                lines.push(`| 🔗 ${i18next.t('dependencies', { lng: language })}: ${titles.join(', ')}`);
            }
        }
        
        if (quest.checklistId && this.checklists) {
            const questHolon = Quests.getQuestHolon(quest);
            const holonDB = await this.getHolonDB(questHolon);
            const checklist = await holonDB.get(questHolon, 'checklists', quest.checklistId);
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
                const timezone = await this.settings.getTimezone(Quests.getQuestHolon(quest)) || 'UTC';
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

    /**
     * Unified save and update function for quests.
     * Handles: saving quest, updating Telegram message, personal holograms, and federation.
     *
     * @param {Object} ctx - Telegraf context
     * @param {Object} quest - Quest object to save and update
     * @param {string} language - Language code
     * @param {Object} options - Options object
     * @param {boolean} options.useExpandedMarkup - Use expanded button layout
     * @param {Array} options.explicitHologramsToUpdate - Specific holograms to update
     * @param {Object} options.interactingUser - User who triggered the action (for personal hologram)
     */
    async updateMessage(ctx, quest, language, options = {}) {
        const questHolon = Quests.getQuestHolon(quest);
        if (!questHolon || !quest.id) return;
        const holonDB = await this.getHolonDB(questHolon);

        // Support old signature: updateMessage(ctx, quest, language, useExpandedMarkup, explicitHologramsToUpdate)
        let useExpandedMarkup = false;
        let explicitHologramsToUpdate = null;
        let interactingUser = null;

        if (typeof options === 'boolean') {
            // Old signature: options is useExpandedMarkup
            useExpandedMarkup = options;
            explicitHologramsToUpdate = arguments[4] || null;
        } else if (typeof options === 'object') {
            useExpandedMarkup = options.useExpandedMarkup || false;
            explicitHologramsToUpdate = options.explicitHologramsToUpdate || null;
            interactingUser = options.interactingUser || null;
        }

        log.info(`updateMessage called - quest: ${quest.title}, holonId: ${questHolon}, messageId: ${quest.id}, useExpandedMarkup: ${useExpandedMarkup}`);

        language = language || await this.getLanguage(questHolon);
        const markupConfig = useExpandedMarkup
            ? { reply_markup: { inline_keyboard: this.getExpandedButtons(quest, language) } }
            : this.markup(quest, language);

        // Track which messages we've updated to avoid duplicates
        const updatedMessages = new Set();

        // 1. Handle personal hologram for interacting user (before save, modifies quest.activeHolograms)
        // Only create personal hologram if the user is participating from a DIFFERENT holon
        // (e.g. clicked on a federated copy). Skip if they're in the quest's home holon.
        const clickedChatId = String(ctx.callbackQuery?.message?.chat?.id || '');
        const questHolonStr = String(questHolon);
        const userIdStr = String(interactingUser?.id || '');
        if (interactingUser && clickedChatId !== questHolonStr && userIdStr !== questHolonStr) {
            await this.personalHologram(interactingUser.id, quest);
            const hologramResult = await this.ensureTelegramHologramMessage(ctx, quest, interactingUser.id, language);
            if (hologramResult) {
                updatedMessages.add(`${hologramResult.holonId}_${hologramResult.messageId}`);
            }
        }

        // 2. Update the main Telegram message. For legacy bot-native quests
        // it lives at (questHolon, quest.id); for harvest quests (string
        // quest.id) we may need to bootstrap one — same hologram mechanism,
        // just rooted in the home holon. ensureMainTelegramMessage returns
        // the resolved/created message_id, or null if we have no chat to
        // send to.
        const mainMessageId = await this.ensureMainTelegramMessage(quest, questHolon, language, markupConfig);
        if (mainMessageId != null) {
            try {
                await ctx.telegram.getChat(questHolon);
                await this.updateQuestMessage(ctx, quest, questHolon, mainMessageId, language, markupConfig);
                updatedMessages.add(`${questHolon}_${mainMessageId}`);
            } catch {}
        }

        // 3. ONE unified save - triggers auto-propagation to federated holons
        try {
            await holonDB.put(questHolon, 'quests', quest);
        } catch {}

        // 4. Handle federated Telegram messages (only for group-to-group federation, not personal holograms)
        // Skip if we just created a personal hologram - that's already handled by ensureTelegramHologramMessage
        if (!interactingUser) {
            await this.handleFederatedMessages(ctx, quest, language).catch(() => {});
        }

        // 5. Update existing holograms (skip already updated messages)
        const hologramsToUpdate = explicitHologramsToUpdate ?? (quest.activeHolograms || []);
        if (hologramsToUpdate.length > 0) {
            await this.updateHolograms(ctx, quest, language, markupConfig, hologramsToUpdate, updatedMessages);
        }
    }

    // Helper methods
    async personalHologram(userId, quest) {
        const questHolon = Quests.getQuestHolon(quest);
        if (!userId || !quest?.id || !questHolon) return;

        try {
            // Use per-holon holosphere to match the keypair that wrote the data
            const holonDB = await this.getHolonDB(questHolon);

            const questData = {
                id: quest.id,
                ...quest
            };

            await holonDB.propagateData(
                questData,
                questHolon,    // sourceHolon - where the quest lives
                userId.toString(),         // targetHolon - user's personal holon
                'quests',
                { mode: 'reference' }      // options - create hologram reference
            ).catch(err => {
                console.warn(`[personalHologram] Failed to propagate quest ${quest.id} to user ${userId}:`, err.message);
            });
        } catch (err) {
            console.warn(`[personalHologram] Error:`, err.message);
        }
    }

    async checkUserAdmin(userId, holonId) {
        try {
            // Private chats (positive IDs) should always allow admin actions
            // Group chats (negative IDs) need proper admin checking
            if (holonId > 0) {
                return true; // Private chat - user is admin of their own chat
            }

            const member = await this.bot.telegram.getChatMember(holonId, userId);
            return ['administrator', 'creator'].includes(member.status);
        } catch {
            return false;
        }
    }

    async questExists(quest, ctx, questId = 'N/A') {
        if (!quest || quest === '') {
            const holonId = getholonId(ctx);
            const language = holonId ? await this.getLanguage(holonId) : 'en';
            
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

    // Truncate caption to Telegram's 1024 character limit
    truncateCaption(caption) {
        if (!caption || caption.length <= 1024) return caption;
        return caption.slice(0, 1021) + '...';
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

    async handleCompletedQuestInteraction(ctx, quest, holonId, messageId, language) {
        if (quest.status !== 'completed') return false;
        
        try {
            await this.updateMessage(ctx, quest, language, false);
            ctx.answerCbQuery(`Quest "${quest.title}" has already been completed`).catch(() => {});
            return true;
        } catch {
            const msgId = ctx.callbackQuery?.message.message_id || messageId;
            const holonId = ctx.callbackQuery?.message.chat.id || holonId;
            
            await ctx.telegram.deleteMessage(holonId, msgId).catch(() => {});
            ctx.answerCbQuery('Quest not found or already completed.').catch(() => {});
            return true;
        }
    }

    async recordCompletionActions(quest, holonId) {
        const actions = [];

        // Record quest initiated event
        actions.push({
            user: quest.initiator,
            action: "initiated",
            quest: quest.title,
            value: 0,
            holonId,
            questId: quest.id
        });

        // Record quest completed events for each participant
        for (const user of quest.participants) {
            actions.push({
                user,
                action: "completed",
                quest: quest.title,
                value: 0,
                holonId,
                questId: quest.id
            });
        }

        // Record appreciation events with full duality (sender + receiver)
        // REA pattern: each appreciation creates dual events for both parties
        for (const sender of quest.appreciation) {
            for (const recipient of quest.participants) {
                // Skip self-appreciation
                if (sender.id === recipient.id) continue;

                // Create appreciation sent event with receiver context
                // The Users.saveUserAction will create both sent and received events
                actions.push({
                    user: sender,
                    action: "sent",
                    quest: quest.title,
                    value: 1,
                    holonId,
                    questId: quest.id,
                    receiver: recipient
                });
            }
        }

        // Process actions in parallel batches (grouped by user to prevent race conditions)
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
            } else if (data === 'calendar_back_to_quest' && this.scheduler) {
                return await this.scheduler.handleBackToQuest(ctx);
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

    async updateQuestMessage(ctx, quest, holonId, messageId, language, markupConfig) {
        const showImages = this.shouldShowQuestsAsImages();

        log.info(`updateQuestMessage - showImages: ${showImages}, holonId: ${holonId}, messageId: ${messageId}, hasPicture: ${!!quest.picture}`);

        try {
            if (showImages) {
                // Image mode: regenerate quest image (picture will be embedded)
                log.info('Updating reply markup for image mode');
                await ctx.telegram.editMessageReplyMarkup(holonId, messageId, null, markupConfig.reply_markup)
                    .catch((err) => {
                        if (err.response?.description?.includes('message is not modified')) {
                            log.debug('Message markup unchanged, skipping update');
                        } else {
                            log.error('Error editing reply markup', err);
                        }
                    });

                if (this.ui?.getQuestImage) {
                    this.queueImageUpdate(ctx, quest, holonId, messageId, markupConfig);
                }
            } else if (quest.picture) {
                // Text mode with picture: update caption
                log.info('Updating message caption for picture quest in text mode');
                const caption = await this.createMessage(quest, language);
                await ctx.telegram.editMessageCaption(holonId, messageId, null, this.truncateCaption(caption), markupConfig)
                    .catch((err) => {
                        if (err.response?.description?.includes('message is not modified')) {
                            log.debug('Message caption unchanged, skipping update');
                        } else {
                            log.error('Error editing message caption', err);
                        }
                    });
            } else {
                // Text mode without picture
                log.info('Updating message text for text mode');
                const message = await this.createMessage(quest, language);
                await ctx.telegram.editMessageText(holonId, messageId, null, message, markupConfig)
                    .catch((err) => {
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

    /**
     * Update a hologram message with "Linked from" text preserved.
     */
    async updateHologramMessage(ctx, quest, holonId, messageId, language, markupConfig, originalHolonName) {
        const showImages = this.shouldShowQuestsAsImages();

        try {
            if (showImages) {
                // Image mode: just update markup, image will be regenerated
                await ctx.telegram.editMessageReplyMarkup(holonId, messageId, null, markupConfig.reply_markup)
                    .catch((err) => {
                        if (!err.response?.description?.includes('message is not modified')) {
                            log.error('Error editing hologram reply markup', err);
                        }
                    });

                if (this.ui?.getQuestImage) {
                    this.queueImageUpdate(ctx, quest, holonId, messageId, markupConfig);
                }
            } else {
                // Text mode: include "Linked from" in the message
                const baseMessage = await this.createMessage(quest, language);
                const hologramMessage = baseMessage + `| 🔗 Linked from ${originalHolonName}\n`;

                if (quest.picture) {
                    await ctx.telegram.editMessageCaption(holonId, messageId, null, this.truncateCaption(hologramMessage), markupConfig)
                        .catch((err) => {
                            if (!err.response?.description?.includes('message is not modified')) {
                                log.error('Error editing hologram caption', err);
                            }
                        });
                } else {
                    await ctx.telegram.editMessageText(holonId, messageId, null, hologramMessage, markupConfig)
                        .catch((err) => {
                            if (!err.response?.description?.includes('message is not modified')) {
                                log.error('Error editing hologram text', err);
                            }
                        });
                }
            }
        } catch (err) {
            log.error('Error in updateHologramMessage', err);
        }
    }

    queueImageUpdate(ctx, quest, holonId, messageId, markupConfig) {
        const key = `${Quests.getQuestHolon(quest)}_${quest.id}`;
        this.imageUpdateQueue.set(key, { ctx, quest, holonId, messageId, markupConfig });
        
        if (this.imageUpdateTimer) clearTimeout(this.imageUpdateTimer);
        this.imageUpdateTimer = setTimeout(() => this.processBatchedImageUpdates(), 500);
    }

    async processBatchedImageUpdates() {
        if (!this.imageUpdateQueue.size) return;
        
        const promises = [];
        for (const [, data] of this.imageUpdateQueue) {
            promises.push(this.regenerateQuestImageBackground(
                data.ctx, data.quest, data.holonId, data.messageId, data.markupConfig
            ));
        }
        
        this.imageUpdateQueue.clear();
        await Promise.allSettled(promises);
    }

    async regenerateQuestImageBackground(ctx, quest, holonId, messageId, markupConfig) {
        try {
            const isHologram = holonId !== Quests.getQuestHolon(quest)?.toString();
            const imagePath = await this.getCachedQuestImage(quest, holonId, isHologram);

            if (imagePath) {
                await ctx.telegram.editMessageMedia(holonId, messageId, null, {
                    type: 'photo',
                    media: { source: imagePath },
                    caption: createPaddedCaption('')
                }, markupConfig);
            }
        } catch {}
    }

    // Remaining method implementations (add as needed)
    async delete(ctx) {
        const [, messageId] = ctx.message.text.split(' ');
        const holonId = ctx.message.chat.id;
        const holonDB = await this.getHolonDB(holonId);
        holonDB.delete(holonId, 'quests', messageId);
        ctx.reply('Quest deleted');
    }

    async listtype(ctx) {
        let type = ctx.message.text.split(' ')[0].replace('/', '');
        if (type && type[type.length - 1] === 's') type = type.slice(0, -1);

        const holonId = ctx.message.chat.id;
        const language = await this.getLanguage(holonId);
        const holonDB = await this.getHolonDB(holonId);
        const quests = await holonDB.getAll(holonId, 'quests');
        
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
        const holonId = getholonId(ctx);
        const language = await this.getLanguage(holonId);
        const holonDB = await this.getHolonDB(holonId);

        try {
            const quests = await holonDB.getAll(holonId, 'quests');
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
        const holonId = getholonId(ctx);
        const language = await this.getLanguage(holonId);
        const holonDB = await this.getHolonDB(holonId);
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
                const users = await this.getUsers(holonId);
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
                holonId: holonId
            };

            // Save appreciation record
            await holonDB.put(holonId, 'appreciations', appreciation);

            // Update user stats
            try {
                const targetUserInfo = await this.users.getUserInfo(targetUser, holonId);
                targetUserInfo.appreciationReceived = (targetUserInfo.appreciationReceived || 0) + amount;
                await holonDB.put(holonId, 'users', targetUserInfo);

                const senderInfo = await this.users.getUserInfo(sender, holonId);
                senderInfo.appreciationGiven = (senderInfo.appreciationGiven || 0) + amount;
                await holonDB.put(holonId, 'users', senderInfo);
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
        const { holonId, questId: messageId } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);
        const holonDB = await this.getHolonDB(holonId);
        const quest = await holonDB.get(holonId, 'quests', messageId);

        if (!await this.questExists(quest, ctx, messageId)) return;

        const hasPermission = quest.initiator?.id === ctx.from.id ||
                             await this.checkUserAdmin(ctx.from.id, holonId);

        if (!hasPermission) {
            return ctx.answerCbQuery(i18next.t('only_initiator_can_publish', {
                lng: language,
                defaultValue: 'Only the quest initiator or admins can publish this quest.'
            })).catch(() => {});
        }

        try {
            // Toggle publish status
            quest.published = !quest.published;

            // Unified save and update (handles federation internally)
            await this.updateMessage(ctx, quest, language);

            const statusMessage = quest.published
                ? i18next.t('quest_published', { lng: language, defaultValue: 'Quest published to public feed!' })
                : i18next.t('quest_unpublished', { lng: language, defaultValue: 'Quest removed from public feed.' });

            ctx.answerCbQuery(statusMessage).catch(() => {});

        } catch (error) {
            console.error('Error publishing quest:', error);
            ctx.answerCbQuery(i18next.t('publish_error', {
                lng: language,
                defaultValue: 'Error publishing quest.'
            })).catch(() => {});
        }
    }
    async broadcast(ctx) {
        const { holonId, questId: messageId } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);
        const quest = await this.db.get(holonId, 'quests', messageId);

        if (!await this.questExists(quest, ctx, messageId)) return;

        const hasPermission = quest.initiator?.id === ctx.from.id ||
                             await this.checkUserAdmin(ctx.from.id, holonId);

        if (!hasPermission) {
            return ctx.answerCbQuery(i18next.t('only_initiator_can_broadcast', {
                lng: language,
                defaultValue: 'Only the quest initiator or admins can broadcast this quest.'
            })).catch(() => {});
        }

        try {
            // Toggle broadcast status
            quest.broadcasted = !quest.broadcasted;

            // Unified save and update
            await this.updateMessage(ctx, quest, language);

            if (quest.broadcasted) {
                // Send quest to all users who have interacted with this holon
                const users = await this.getUsers(holonId);
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
        const holonId = ctx.callbackQuery.message.chat.id;
        const { questId: messageId } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);

        try {
            let quest = await this.db.get(holonId, 'quests', messageId);
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
                    id: messageId,
                    type: 'quest',
                    items: [],
                    creator: quest.initiator.id,
                    created: new Date(),
                    questId: messageId,
                    title: quest.title
                };

                // Save the checklist
                await this.db.put(holonId, 'checklists', checklist);

                // Update quest with checklist reference
                quest.checklistId = checklist.id;
                await this.db.put(holonId, 'quests', quest);
            }

            // Get the checklist
            const checklist = await this.db.get(holonId, 'checklists', quest.checklistId);
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
            await ctx.telegram.sendMessage(holonId, message, {
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
        const holonId = ctx.callbackQuery.message.chat.id;
        const { questId: messageId } = Quests.parseQuestIds(ctx);

        try {
            const quest = await this.db.get(holonId, 'quests', messageId);
            if (!await this.questExists(quest, ctx, messageId)) { return; }

            await ctx.answerCbQuery().catch(() => {});

            // Use InputScene for description collection
            return ctx.scene.enter('input_scene', {
                promptText: '📝 Reply with a description for this task.',
                allowEmpty: false,
                onComplete: async (ctx, description) => {
                    const holonId = ctx.chat.id;
                    const questId = messageId;

                    const quest = await this.db.get(holonId, 'quests', questId);
                    if (!await this.questExists(quest, ctx, questId)) {
                        return;
                    }

                    quest.description = description;
                    await this.db.put(holonId, 'quests', quest);
                    await this.updateMessage(ctx, quest);
                }
            });
        } catch (error) {
            console.error('Error handling description:', error);
            await ctx.answerCbQuery('Error accessing description');
        }
    }
    async handleDependenciesButton(ctx) {
        // Callback: dependencies_quest_<holonId>_<questId>
        const { holonId, questId } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);

        try {
            const quest = await this.db.get(holonId, 'quests', questId);
            if (!await this.questExists(quest, ctx, questId)) { return; }

            // Get all ongoing quests in this chat
            const allQuests = await this.db.getAll(holonId, 'quests');
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
                const dependencies = await this.batchLoadDependencies(holonId, quest.dependencies);
                for (let i = 0; i < quest.dependencies.length; i++) {
                    const depId = quest.dependencies[i];
                    const depQuest = dependencies[i];
                    if (depQuest) {
                        message += `- ${depQuest.title}\n`;
                        buttons.push([
                            Markup.button.callback(`🗑️ Remove: ${depQuest.title}`, `remove_dependency_${holonId}_${questId}_${depId}`)
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
                        Markup.button.callback(`➕ ${q.title}`, `set_dependency_${holonId}_${questId}_${q.id}`)
                    ]);
                });
            }

            // Add a back button
            buttons.push([
                Markup.button.callback('↩️ ' + i18next.t('back', { lng: language, defaultValue: 'Back' }), `back_from_dependencies_${holonId}_${questId}`)
            ]);

            // Show the message with dependency options - edit in place
            // Use the chat where button was clicked, not the quest's source holon
            const clickedChatId = ctx.callbackQuery.message.chat.id;
            const messageId = ctx.callbackQuery.message.message_id;

            // Check if this is a photo message or text message
            if (ctx.callbackQuery.message.photo) {
                // For photo messages, edit the caption and keyboard
                await ctx.telegram.editMessageCaption(clickedChatId, messageId, null, message, Markup.inlineKeyboard(buttons));
            } else {
                // For text messages, edit the text and keyboard
                await ctx.telegram.editMessageText(clickedChatId, messageId, null, message, Markup.inlineKeyboard(buttons));
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
        const holonId = ctx.callbackQuery.data.split('_')[2]; // Original quest's chat
        const questId = ctx.callbackQuery.data.split('_')[3];
        const dependencyId = ctx.callbackQuery.data.split('_')[4];
        const language = await this.getLanguage(holonId);

        try {
            // Get the quest and dependency
            const quest = await this.db.get(holonId, 'quests', questId);
            const depQuest = await this.db.get(holonId, 'quests', dependencyId);

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
            await this.db.put(holonId, 'quests', quest);

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
        const holonId = ctx.callbackQuery.data.split('_')[2]; // Original quest's chat
        const questId = ctx.callbackQuery.data.split('_')[3];
        const dependencyId = ctx.callbackQuery.data.split('_')[4];
        const language = await this.getLanguage(holonId);

        try {
            const quest = await this.db.get(holonId, 'quests', questId);
            if (!quest || !quest.dependencies) {
                await ctx.answerCbQuery('Quest or dependencies not found');
                return;
            }

            // Remove the dependency
            quest.dependencies = quest.dependencies.filter(id => id !== dependencyId);

            // Save the updated quest
            await this.db.put(holonId, 'quests', quest);

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
        // Callback: back_from_dependencies_<holonId>_<questId>
        // Dispatched from generic /back_(.+)/ handler — pass explicit prefix.
        const { holonId, questId } = Quests.parseQuestIds(ctx, 'back_from_dependencies_');
        const language = await this.getLanguage(holonId);

        try {
            await ctx.answerCbQuery().catch(() => {});
            const quest = await this.db.get(holonId, 'quests', questId);
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
        // Callback: recurring_quest_<holonId>_<questId>
        const { holonId, questId } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);

        try {
            const quest = await this.db.get(holonId, 'quests', questId);
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
                    `set_recurring_${holonId}_${questId}_${option.value || 'never'}`
                )];
            });

            // Add stop recurring button if currently recurring
            if (quest.frequency) {
                buttons.push([
                    Markup.button.callback(
                        '🛑 ' + i18next.t('stop_recurring', { lng: language, defaultValue: 'Stop Recurring' }),
                        `stop_recurring_${holonId}_${questId}`
                    )
                ]);
            }

            // Add back button
            buttons.push([
                Markup.button.callback(
                    '↩️ ' + i18next.t('back', { lng: language, defaultValue: 'Back' }),
                    `back_from_recurring_${holonId}_${questId}`
                )
            ]);

            const message = `🔄 *${i18next.t('recurring_settings', { lng: language, defaultValue: 'Recurring Settings' })}*\n\n` +
                          `${i18next.t('current_frequency', { lng: language, defaultValue: 'Current frequency' })}: ${quest.frequency ? i18next.t(quest.frequency, { lng: language, defaultValue: quest.frequency }) : i18next.t('never', { lng: language, defaultValue: 'Never' })}\n\n` +
                          i18next.t('select_frequency', { lng: language, defaultValue: 'Select how often this quest should repeat:' });

            // Use the chat where button was clicked, not the quest's source holon
            const clickedChatId = ctx.callbackQuery.message.chat.id;
            const messageId = ctx.callbackQuery.message.message_id;

            // Check if this is a photo message or text message
            if (ctx.callbackQuery.message.photo) {
                await ctx.telegram.editMessageCaption(clickedChatId, messageId, null, message, Markup.inlineKeyboard(buttons));
            } else {
                await ctx.telegram.editMessageText(clickedChatId, messageId, null, message, Markup.inlineKeyboard(buttons));
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
        // Callback: stop_recurring_<holonId>_<questId>
        const { holonId, questId } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);

        try {
            const quest = await this.db.get(holonId, 'quests', questId);
            if (!await this.questExists(quest, ctx, questId)) return;

            // Remove recurring settings
            quest.frequency = null;
            quest.recurringTaskId = null;

            // Cancel any scheduled recurring tasks if scheduler is available
            if (quest.recurringTaskId && this.scheduler) {
                await this.scheduler.stopTask(quest.recurringTaskId);
            }

            await this.db.put(holonId, 'quests', quest);

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
        // Callback: participants_quest_<holonId>_<questId>
        const { holonId, questId } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);

        try {
            const quest = await this.db.get(holonId, 'quests', questId);
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            await this.showParticipantSelection(ctx, holonId, questId, quest, language);

        } catch (error) {
            console.error('Error showing participant selection:', error);
            await ctx.answerCbQuery('Error showing participant selection');
        }
    }

    async showParticipantSelection(ctx, holonId, questId, quest, language) {
        try {
            await ctx.answerCbQuery().catch(() => {});

            const users = await this.getUsers(holonId);
            // Use the chat where button was clicked, not the quest's source holon
            const clickedChatId = ctx.callbackQuery.message.chat.id;
            const messageId = ctx.callbackQuery.message.message_id;

            // Ensure participants array exists
            if (!quest.participants) {
                quest.participants = [];
            }

            // Create buttons for each user
            const userButtons = [];

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
                    callback_data: `back_from_participants_${holonId}_${questId}`
                }
            ]);

            const keyboard = Markup.inlineKeyboard(userButtons);
            const message = 'Select participants for quest:';

            // Check if this is a photo message or text message
            if (ctx.callbackQuery.message.photo) {
                // For photo messages, edit the caption and keyboard
                await ctx.telegram.editMessageCaption(clickedChatId, messageId, null, message, keyboard);
            } else {
                // For text messages, edit the text and keyboard
                await ctx.telegram.editMessageText(clickedChatId, messageId, null, message, keyboard);
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
            const holonId = ctx.callbackQuery.message.chat.id;

            let quest = await this.db.get(holonId, 'quests', questId);
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
                const users = await this.getUsers(holonId);
                const user = users.find(u => u.id === userId);
                if (user) {
                    quest.participants.push(user);
                    // Remove holonId ("This Holon") if it exists
                    quest.participants = quest.participants.filter(p => p.id !== parseInt(holonId));
                }
            }

            await this.db.put(holonId, 'quests', quest);

            // Refresh the participant selection view only
            await this.refreshParticipantView(ctx, holonId, questId);

        } catch (error) {
            console.error('Error toggling participant:', error);
            await ctx.answerCbQuery('Error updating participant');
        }
    }
    async handleSelectAllParticipants(ctx) {
        try {
            await ctx.answerCbQuery().catch(() => {});

            const questId = ctx.callbackQuery.data.split(':')[1];
            const holonId = ctx.callbackQuery.message.chat.id;

            let quest = await this.db.get(holonId, 'quests', questId);
            if (!quest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            const users = await this.getUsers(holonId);

            // Add all users to participants (excluding holon ID to avoid duplication)
            quest.participants = users.slice();

            await this.db.put(holonId, 'quests', quest);

            // Refresh the participant selection view
            await this.refreshParticipantView(ctx, holonId, questId);

        } catch (error) {
            console.error('Error selecting all participants:', error);
            await ctx.answerCbQuery('Error selecting all participants');
        }
    }
    async backFromParticipants(ctx) {
        // Callback: back_from_participants_<holonId>_<questId>
        // Dispatched from generic /back_(.+)/ handler — pass explicit prefix.
        const { holonId, questId } = Quests.parseQuestIds(ctx, 'back_from_participants_');
        const language = await this.getLanguage(holonId);

        try {
            await ctx.answerCbQuery().catch(() => {});
            const quest = await this.db.get(holonId, 'quests', questId);
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
        const [holonId, questId] = ctx.match[1].split('_');
        const language = await this.getLanguage(holonId);

        try {
            const quest = await this.db.get(holonId, 'quests', questId);
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
        const holonId = ctx.callbackQuery.message.chat.id;
        const messageId = ctx.callbackQuery.message.message_id;

        try {
            // The checklistId for db.get is the quest's message_id which was used as checklist.id
            const checklist = await this.db.get(holonId, 'checklists', checklistId);
            if (!checklist) {
                await ctx.answerCbQuery('Checklist not found');
                return;
            }

            // Toggle the item's checked status
            checklist.items[itemIndex].checked = !checklist.items[itemIndex].checked;
            await this.db.put(holonId, 'checklists', checklist);

            // Update the main quest display
            const mainQuest = await this.db.get(holonId, 'quests', checklist.questId);
            if (mainQuest) {
                await this.updateMessage(ctx, mainQuest, await this.getLanguage(holonId));
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
            await ctx.telegram.editMessageReplyMarkup(holonId, messageId, null, { inline_keyboard: keyboard });
            await ctx.answerCbQuery().catch(() => {});

        } catch (error) {
            console.error('Error handling check item:', error);
            await ctx.answerCbQuery('Error updating checklist item');
        }
    }
    async handleAddItem(ctx) {
        const checklistId = ctx.match[1]; // This is the original quest.id
        const holonId = ctx.callbackQuery.message.chat.id;

        try {
            // Get the checklist to ensure it exists
            const checklist = await this.db.get(holonId, 'checklists', checklistId);
            if (!checklist) {
                await ctx.answerCbQuery('Checklist not found');
                return;
            }

            await ctx.answerCbQuery().catch(() => {});

            // Use InputScene for checklist item input
            return ctx.scene.enter('input_scene', {
                promptText: '📝 Reply with the text for the new checklist item:',
                allowEmpty: false,
                onComplete: async (ctx, itemText) => {
                    const holonId = ctx.chat.id;

                    // Add the new item to the checklist
                    checklist.items.push({
                        text: itemText,
                        checked: false
                    });

                    await this.db.put(holonId, 'checklists', checklist);

                    // Update the main quest
                    const mainQuest = await this.db.get(holonId, 'quests', checklist.questId);
                    if (mainQuest) {
                        await this.updateMessage(ctx, mainQuest, await this.getLanguage(holonId));
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
                    const originalMessageId = ctx.callbackQuery?.message?.message_id;
                    if (originalMessageId) {
                        await this.bot.telegram.editMessageReplyMarkup(holonId, originalMessageId, null, { inline_keyboard: keyboard });
                    }
                }
            });

        } catch (error) {
            console.error('Error handling add item:', error);
            await ctx.answerCbQuery('Error adding checklist item');
        }
    }
    async viewOriginalQuest(ctx) {
        const originalQuestIdParts = ctx.match[1];
        const currentholonId = ctx.callbackQuery.message.chat.id;
        const language = await this.getLanguage(currentholonId);
        const interactingUserId = ctx.callbackQuery.from.id;

        try {
            // Callback format: view_original_quest_<holonId>_<questId>
            // Holon IDs are Telegram chat IDs (no underscores), but quest IDs from
            // harvest contain underscores (e.g. "1714510123456_abc123def"). Split
            // on the FIRST underscore so the whole rest is the quest id.
            const firstSep = originalQuestIdParts.indexOf('_');
            let originalQuestholonId, actualOriginalQuestId;

            if (firstSep > 0 && firstSep < originalQuestIdParts.length - 1) {
                originalQuestholonId = originalQuestIdParts.slice(0, firstSep);
                actualOriginalQuestId = originalQuestIdParts.slice(firstSep + 1);

                if (!originalQuestholonId || originalQuestholonId === 'undefined' || originalQuestholonId === 'null') {
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
                questToView = await this.db.get(originalQuestholonId, 'quests', actualOriginalQuestId);
            } catch (dbError) {
                // Try to find a local hologram copy
                try {
                    const userHologramData = await this.db.get(
                        interactingUserId, 
                        'quests', 
                        actualOriginalQuestId
                    );
                    
                    if (userHologramData && userHologramData.soul) {
                        questToView = {
                            id: actualOriginalQuestId,
                            holon: originalQuestholonId,
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
            questToView.chat = originalQuestholonId;
            questToView.id = actualOriginalQuestId;

            // Create message for the quest view
            const baseMessageText = await this.createMessage(questToView, language);
            const originalHolonName = await getHolonName(this.db, originalQuestholonId, ctx);
            const messageText = baseMessageText +
                `| 🔗 Linked from ${originalHolonName}\n`;
            const markup = this.markup(questToView, language);
            const showQuestsAsImages = this.shouldShowQuestsAsImages();

            // Send the quest view
            let newHologramMsg;
            if (showQuestsAsImages && this.ui && this.ui.getQuestImage) {
                // Image mode: generate quest image (with embedded picture if any)
                let questImagePath = null;
                try {
                    questImagePath = await this.ui.getQuestImage(questToView, originalQuestholonId, true);
                } catch (error) {
                    // Silently handle image generation errors
                }

                if (questImagePath) {
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
            } else if (questToView.picture && (questToView.picture.startsWith('http') || questToView.picture.startsWith('AgAC'))) {
                // Text mode with picture: show original photo with caption (only if valid URL or file_id)
                newHologramMsg = await ctx.replyWithPhoto(questToView.picture, {
                    caption: this.truncateCaption(messageText),
                    ...markup
                });
            } else {
                // Text mode without picture
                newHologramMsg = await ctx.reply(messageText, markup);
            }
            
            // Track the hologram message
            try {
                if (!questToView.activeHolograms || !Array.isArray(questToView.activeHolograms)) {
                    questToView.activeHolograms = [];
                }

                const existingLink = questToView.activeHolograms.find(
                    h => h.holonId === newHologramMsg.chat.id && 
                         h.messageId === newHologramMsg.message_id
                );

                if (!existingLink) {
                    questToView.activeHolograms.push({
                        platform: 'telegram',
                        holonId: newHologramMsg.chat.id,
                        messageId: newHologramMsg.message_id
                    });
                }

                // Save the updated quest with the new hologram link
                await this.db.put(originalQuestholonId, 'quests', questToView).catch(() => {});
            } catch (error) {
                // Silently handle tracking errors
            }

            await ctx.answerCbQuery().catch(() => {});

        } catch (error) {
            console.error('Error viewing original quest:', error);
            await ctx.answerCbQuery('Error displaying quest details.');
        }
    }
    // Ensure the quest has a "main" Telegram message in its home holon, creating
    // one if necessary. Quests created in harvest live in holosphere with
    // string ids and have no Telegram representation until the bot renders one;
    // we reuse the activeHolograms tracking (the same mechanism used for
    // hologram copies in other chats) so every code path that reaches for a
    // Telegram message_id finds it via Quests.resolveTelegramMessageId.
    //
    // Returns the resolved Telegram message_id, or null if creation failed
    // (e.g. the bot isn't a member of the home holon chat).
    async ensureMainTelegramMessage(quest, questHolon, language, markupConfig) {
        if (!quest || !questHolon) return null;

        const existing = Quests.resolveTelegramMessageId(quest, questHolon);
        if (existing != null) return existing;

        try {
            const message = await this.createMessage(quest, language);
            const markup = markupConfig || this.markup(quest, language);

            let sent;
            if (quest.picture && (quest.picture.startsWith('http') || quest.picture.startsWith('AgAC'))) {
                try {
                    sent = await this.bot.telegram.sendPhoto(questHolon, quest.picture, {
                        caption: this.truncateCaption(message),
                        ...markup,
                    });
                } catch {
                    sent = await this.bot.telegram.sendMessage(questHolon, message, markup);
                }
            } else {
                sent = await this.bot.telegram.sendMessage(questHolon, message, markup);
            }

            if (!Array.isArray(quest.activeHolograms)) quest.activeHolograms = [];
            quest.activeHolograms.push({
                platform: 'telegram',
                holonId: questHolon,
                messageId: sent.message_id,
            });

            // Persist immediately — callers (refreshQuestMessage, etc.) may
            // not save the quest themselves, and we don't want to lose track
            // of the message we just sent.
            try {
                const holonDB = await this.getHolonDB(questHolon);
                await holonDB.put(questHolon, 'quests', quest);
            } catch (persistErr) {
                log.warn(`ensureMainTelegramMessage: created message ${sent.message_id} but failed to persist activeHolograms: ${persistErr?.message || persistErr}`);
            }

            // Match the bot's normal /task creation flow.
            this.bot.telegram.pinChatMessage(questHolon, sent.message_id, { disable_notification: true }).catch(() => {});

            return sent.message_id;
        } catch (err) {
            log.warn(`ensureMainTelegramMessage: failed for quest ${quest.id} in holon ${questHolon}: ${err?.message || err}`);
            return null;
        }
    }

    async ensureTelegramHologramMessage(ctx, quest, userId, language) {
        const questHolon = Quests.getQuestHolon(quest);
        if (!quest?.id || !questHolon || !userId) return;

        try {
            // Check if user already has a hologram message for this quest
            const existingHologram = quest.activeHolograms?.find(h =>
                h.platform === 'telegram' && h.holonId === userId
            );

            // Get original holon name for "Linked from" text
            const originalHolonName = await getHolonName(this.db, questHolon, ctx);

            if (existingHologram) {
                // Update existing hologram with "Linked from" preserved
                try {
                    await this.updateHologramMessage(ctx, quest, userId, existingHologram.messageId, language, this.markup(quest, language), originalHolonName);
                    return existingHologram;
                } catch (error) {
                    // If update fails, remove the invalid hologram link and create a new one
                    quest.activeHolograms = quest.activeHolograms.filter(h => h !== existingHologram);
                }
            }

            // Create new hologram message
            const showImages = this.shouldShowQuestsAsImages();
            const baseMessageText = await this.createMessage(quest, language);
            const messageText = baseMessageText +
                `| 🔗 Linked from ${originalHolonName}\n`;
            const markup = this.markup(quest, language);

            let hologramMessage;

            if (showImages) {
                // Image mode: generate quest image (with embedded picture if any)
                const questImagePath = await this.getCachedQuestImage(quest, questHolon, true);
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
            } else if (quest.picture) {
                // Text mode with picture: show original photo with caption
                try {
                    hologramMessage = await ctx.telegram.sendPhoto(userId, quest.picture, {
                        caption: this.truncateCaption(messageText),
                        ...markup
                    });
                } catch (imageError) {
                    // Fallback to text if image sending fails
                    hologramMessage = await ctx.telegram.sendMessage(userId, messageText, markup);
                }
            } else {
                // Text mode without picture
                hologramMessage = await ctx.telegram.sendMessage(userId, messageText, markup);
            }

            // Track the new hologram
            if (!quest.activeHolograms) quest.activeHolograms = [];

            const hologramLink = {
                platform: 'telegram',
                holonId: userId,
                messageId: hologramMessage.message_id
            };

            quest.activeHolograms.push(hologramLink);

            // Don't save here - caller (updateMessage) handles the unified save
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
        try {
            const questHolon = Quests.getQuestHolon(quest);
            if (!questHolon) {
                console.log(`[handleFederatedMessages] Quest ${quest.id} has no valid holon, skipping`);
                return;
            }
            console.log(`[handleFederatedMessages] Starting for quest ${quest.id} in holon ${questHolon}`);

            const holonId = questHolon;
            const holonIdStr = String(holonId);

            // Re-read quest to get updated _meta.activeHolograms from auto-propagation
            const updatedQuest = await this.db.get(holonIdStr, 'quests', quest.id);
            if (!updatedQuest) {
                console.log(`[handleFederatedMessages] Quest ${quest.id} not found after propagation`);
                return;
            }

            // Get the activeHolograms populated by auto-propagation
            const activeHolograms = updatedQuest._meta?.activeHolograms || [];

            if (activeHolograms.length === 0) {
                return;
            }

            // Send Telegram messages to numeric hologram targets
            for (const hologramEntry of activeHolograms) {
                const targetHolon = hologramEntry.targetHolon;

                // Only send Telegram messages to numeric chat IDs
                const holonIdNum = Number(targetHolon);
                if (isNaN(holonIdNum) || !Number.isFinite(holonIdNum)) {
                    // Non-numeric IDs (like hex) don't need Telegram messages
                    continue;
                }

                // Skip if it's the same chat as the original
                if (targetHolon.toString() === holonIdStr) {
                    continue;
                }

                // Check if we already have a Telegram message for this chat
                const existingTelegramMsg = updatedQuest.activeHolograms?.find(
                    h => h.holonId?.toString() === targetHolon.toString() && h.platform === 'telegram'
                );
                if (existingTelegramMsg) {
                    console.log(`[handleFederatedMessages] Quest ${quest.id} already has Telegram message in ${targetHolon}, skipping`);
                    continue;
                }

                try {
                    // Create a federated quest message for Telegram
                    const baseMessageText = await this.createMessage(updatedQuest, language);
                    const originalHolonName = await getHolonName(this.db, questHolon, ctx);
                    const federatedMessageText = `🌐 **${i18next.t('federated_quest', { lng: language, defaultValue: 'Federated Quest' })}**\n` +
                        `📡 ${i18next.t('from_holon', { lng: language, defaultValue: 'From holon' })}: ${originalHolonName}\n\n` +
                        baseMessageText;

                    const federatedMarkup = Markup.inlineKeyboard([
                        [Markup.button.callback(
                            i18next.t('view_original', { lng: language, defaultValue: 'View Original' }),
                            `view_original_quest_${questHolon}_${quest.id}`
                        )]
                    ]);

                    let federatedMessage;

                    if (this.shouldShowQuestsAsImages()) {
                        // Image mode: generate quest image (with embedded picture if any)
                        const questImagePath = await this.getCachedQuestImage(updatedQuest, questHolon, true);
                        if (questImagePath) {
                            try {
                                federatedMessage = await ctx.telegram.sendPhoto(targetHolon,
                                    { source: questImagePath },
                                    {
                                        caption: createPaddedCaption(''),
                                        parse_mode: 'Markdown',
                                        ...federatedMarkup
                                    }
                                );
                            } catch (imageError) {
                                federatedMessage = await ctx.telegram.sendMessage(targetHolon, federatedMessageText, federatedMarkup);
                            }
                        } else {
                            federatedMessage = await ctx.telegram.sendMessage(targetHolon, federatedMessageText, federatedMarkup);
                        }
                    } else if (updatedQuest.picture) {
                        // Text mode with picture: show original photo with caption
                        try {
                            federatedMessage = await ctx.telegram.sendPhoto(targetHolon, updatedQuest.picture, {
                                caption: this.truncateCaption(federatedMessageText),
                                ...federatedMarkup
                            });
                        } catch (imageError) {
                            federatedMessage = await ctx.telegram.sendMessage(targetHolon, federatedMessageText, federatedMarkup);
                        }
                    } else {
                        // Text mode without picture
                        federatedMessage = await ctx.telegram.sendMessage(targetHolon, federatedMessageText, federatedMarkup);
                    }

                    // Track Telegram message in quest.activeHolograms (bot-level tracking)
                    if (!updatedQuest.activeHolograms) updatedQuest.activeHolograms = [];
                    updatedQuest.activeHolograms.push({
                        platform: 'telegram',
                        holonId: targetHolon,
                        messageId: federatedMessage.message_id,
                        type: 'federated'
                    });

                    console.log(`[handleFederatedMessages] Sent Telegram message to federated chat ${targetHolon}`);

                } catch (holonError) {
                    // Fail gently for invalid/inaccessible chats - just skip this target
                    if (holonError.response?.error_code === 400 && holonError.response?.description?.includes('chat not found')) {
                        console.log(`[handleFederatedMessages] Chat ${targetHolon} not found or not accessible, skipping`);
                        // TODO: Make activeHolograms context-aware. When holograms are saved in a Telegram holon,
                        // they should have type: 'telegram'. When saved in a Discord holon, type: 'discord'.
                        // This would allow filtering by platform before attempting to send messages.
                        continue;
                    }
                    console.error(`[handleFederatedMessages] Error sending Telegram message to ${targetHolon}:`, holonError);
                }
            }

            // Save updated quest with Telegram message tracking
            if (updatedQuest.activeHolograms?.length > 0) {
                await this.db.put(holonIdStr, 'quests', updatedQuest, { autoPropagate: false });
            }

            console.log(`[handleFederatedMessages] Completed. Processed ${activeHolograms.length} active holograms`);

        } catch (error) {
            console.error('[handleFederatedMessages] Error handling federated messages:', error);
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

    async refreshParticipantView(ctx, holonId, questId) {
        try {
            const language = await this.getLanguage(holonId);

            // Get fresh quest data to ensure we have the latest state
            const updatedQuest = await this.db.get(holonId, 'quests', questId);
            if (!updatedQuest) {
                await ctx.answerCbQuery('Quest not found');
                return;
            }

            await this.showParticipantSelection(ctx, holonId, questId, updatedQuest, language);
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
        // Callback: set_recurring_<holonId>_<questId>_<frequency>
        // <frequency> is a known short word (daily/weekly/...) with no `_`.
        const { holonId, questId, tail: frequency } = Quests.parseQuestIdsWithTail(ctx);
        const language = await this.getLanguage(holonId);

        try {
            const quest = await this.db.get(holonId, 'quests', questId);
            if (!await this.questExists(quest, ctx, questId)) return;

            // Set the new frequency
            quest.frequency = frequency === 'never' ? null : frequency;

            // If setting up recurring, create a recurring task ID
            if (quest.frequency && this.scheduler) {
                // Cancel existing recurring task if any
                if (quest.recurringTaskId) {
                    await this.scheduler.stopTask(quest.recurringTaskId);
                }

                // Build a task object in the shape Scheduler.createRecurringTask expects.
                // Quests use `holon`/`id`; tasks use `holonId`/`questId`. Default `when` to
                // now so the cron actually fires; user can adjust via the schedule picker.
                const recurringTask = {
                    id: `${quest.id}_recurring`,
                    questId: quest.id,
                    holonId: quest.holon || holonId,
                    title: quest.title,
                    frequency: quest.frequency,
                    when: quest.when || new Date().toISOString(),
                    initiator: quest.initiator,
                    description: quest.description,
                    checklistId: quest.checklistId,
                    dependencies: quest.dependencies,
                    timezone: quest.timezone
                };

                quest.recurringTaskId = await this.scheduler.createRecurringTask(recurringTask);
            } else if (!quest.frequency && quest.recurringTaskId && this.scheduler) {
                // Cancel recurring task if frequency is set to never
                await this.scheduler.stopTask(quest.recurringTaskId);
                quest.recurringTaskId = null;
            }

            await this.db.put(holonId, 'quests', quest);

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
        // Callback: back_from_recurring_<holonId>_<questId>
        const { holonId, questId } = Quests.parseQuestIds(ctx);
        const language = await this.getLanguage(holonId);

        try {
            await ctx.answerCbQuery().catch(() => {});
            const quest = await this.db.get(holonId, 'quests', questId);
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

    async updateHolograms(ctx, quest, language, markupConfig, hologramsToUpdate, updatedMessages = new Set()) {
        if (!hologramsToUpdate?.length) return;

        const questHolon = Quests.getQuestHolon(quest);
        const originalHolonName = await getHolonName(this.db, questHolon, ctx);

        const updatePromises = hologramsToUpdate.map(async (hologram) => {
            try {
                if (hologram.platform === 'telegram') {
                    // Skip already updated messages
                    const messageKey = `${hologram.holonId}_${hologram.messageId}`;
                    if (updatedMessages.has(messageKey)) {
                        return;
                    }
                    updatedMessages.add(messageKey);
                    // Use hologram-specific update that includes "Linked from" text
                    await this.updateHologramMessage(ctx, quest, hologram.holonId, hologram.messageId, language, markupConfig, originalHolonName);
                }
            } catch (error) {
                console.error(`Error updating hologram ${hologram.holonId}/${hologram.messageId}:`, error);
                // Remove invalid hologram links
                if (quest.activeHolograms) {
                    quest.activeHolograms = quest.activeHolograms.filter(h =>
                        !(h.holonId === hologram.holonId && h.messageId === hologram.messageId)
                    );
                }
            }
        });

        await Promise.allSettled(updatePromises);

        // Save updated quest if hologram links were cleaned up
        if (quest.activeHolograms && quest.activeHolograms.length !== hologramsToUpdate.length) {
            try {
                await this.db.put(Quests.getQuestHolon(quest), 'quests', quest);
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
            const language = await this.getLanguage(Quests.getQuestHolon(quest));
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
    async getLanguage(holonId) {
        const key = `lang_${holonId}`;
        const cached = this.languageCache.get(key);
        if (cached && cached.expires > Date.now()) {
            return cached.language;
        }

        const language = await this.settings.getLanguage(holonId);
        this.languageCache.set(key, {
            language,
            expires: Date.now() + this.cacheExpiry
        });
        return language;
    }

    async getUsers(holonId, forceRefresh = false) {
        const key = `users_${holonId}`;
        if (!forceRefresh && this.userCache.has(key)) {
            const cached = this.userCache.get(key);
            if (cached.expires > Date.now()) {
                return cached.users;
            }
        }

        const users = await this.db.getAll(holonId, 'users');
        this.userCache.set(key, {
            users,
            expires: Date.now() + this.cacheExpiry
        });
        return users;
    }

    async getCachedQuestImage(quest, holonId, isHologram = false) {
        // Always regenerate — cache causes stale images on toggle actions
        // The Puppeteer page reuse already provides speed gains

        if (!this.ui?.getQuestImage) {
            return null;
        }

        try {
            const imagePath = await this.ui.getQuestImage(quest, holonId, isHologram);
            return imagePath;
        } catch (error) {
            console.error('Error generating quest image:', error);
            return null;
        }
    }

    startCacheCleanup() {
        // Clean up expired cache entries every 10 minutes
        // Store interval ID so it can be cleared on shutdown
        if (this.cacheCleanupInterval) {
            clearInterval(this.cacheCleanupInterval);
        }
        this.cacheCleanupInterval = setInterval(() => {
            this.cleanupExpiredCache();
        }, 10 * 60 * 1000);
    }

    stopCacheCleanup() {
        if (this.cacheCleanupInterval) {
            clearInterval(this.cacheCleanupInterval);
            this.cacheCleanupInterval = null;
        }
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
    invalidateUserCache(holonId) {
        const key = `users_${holonId}`;
        this.userCache.delete(key);
    }

    // Invalidate language cache when language setting changes
    invalidateLanguageCache(holonId) {
        const key = `lang_${holonId}`;
        this.languageCache.delete(key);
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
            if (parts.length >= 3 && parts[0] === questId && parts[1] === questChat.toString()) {
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
        const questHolon = Quests.getQuestHolon(quest);
        await this.db.put(questHolon, 'quests', quest);

        // Invalidate image cache for this quest
        if (quest.id && questHolon) {
            this.invalidateQuestImageCache(quest.id, questHolon);
        }
    }

    // Queue operation to prevent race conditions on rapid button clicks
    async queueQuestOperation(holonId, questID, operation) {
        const questKey = `${holonId}_${questID}`;

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
    async batchLoadDependencies(holonId, dependencyIds) {
        if (!dependencyIds?.length) return [];

        const promises = dependencyIds.map(id =>
            this.db.get(holonId, 'quests', id).catch(() => null)
        );

        return Promise.all(promises);
    }

    async batchSaveUserActions(actions) {
        if (!actions?.length) return;

        // Check if users instance has batch method
        if (this.users?.batchSaveUserActions) {
            return this.users.batchSaveUserActions(actions);
        }

        // Group actions by user to prevent race conditions
        // Multiple actions for the same user must be processed sequentially
        const actionsByUser = new Map();
        for (const action of actions) {
            const userId = action.user?.id;
            if (!userId) continue;
            if (!actionsByUser.has(userId)) {
                actionsByUser.set(userId, []);
            }
            actionsByUser.get(userId).push(action);
        }

        // Process users in parallel batches, but actions per user sequentially
        const userIds = Array.from(actionsByUser.keys());
        const BATCH_SIZE = 10;
        for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
            const batchUserIds = userIds.slice(i, i + BATCH_SIZE);
            const promises = batchUserIds.map(async (userId) => {
                const userActions = actionsByUser.get(userId);
                // Process this user's actions sequentially to avoid race conditions
                for (const action of userActions) {
                    try {
                        // Pass extra context for REA events (questId, receiver)
                        await this.users.saveUserAction(
                            action.user,
                            action.action,
                            action.quest,
                            action.value,
                            action.holonId,
                            { questId: action.questId, receiver: action.receiver }
                        );
                    } catch (error) {
                        console.error('Error saving user action:', error);
                    }
                }
            });
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
