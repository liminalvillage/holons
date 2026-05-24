// @ts-nocheck
//
// Telegram bot UI for events. Migrated from Events.js as part of Phase B
// `tg-ui/quests-events`. Domain logic (Quest type + persistence helper) is
// imported from `@holons/core/tasks`; events share the `quests` family of
// types since they're a quest subtype in the bot data model. Telegraf
// scenes, keyboards and command handlers stay in this file — they're the
// bot UI layer, not domain logic.
//
// `@ts-nocheck` matches the wholesale-migration approach used for
// Quests.ts; piecewise typing is a follow-up.

/**
 * @fileoverview Event Management System for HolonsBot.
 * @module src/Events
 */
import { Markup } from 'telegraf';
import i18next from 'i18next';
import { getholonId, getMessageId, capitalize, getDisplayName, createPaddedCaption } from './utilities.js';
import { log } from '../utils/logger.js';
import {
    saveTasksToHolon,
    planTaskCompletion,
    executeCompletionPlan,
    type Quest as CoreQuest,
} from '@holons/core/tasks';
import { DEFAULT_EQUATION } from '@holons/core/scoring';

const DASHBOARD_ADDRESS = process.env.DASHBOARD_ADDRESS || 'https://dashboard.holons.io';

/**
 * Event Management System for HolonsBot.
 *
 * @class Events
 * @description Handles all event-related functionality including creation, display,
 * completion, participation, scheduling, and hologram management.
 * Supports both one-time and recurring events with REA economic tracking.
 *
 * @property {Telegraf} bot - The Telegraf bot instance
 * @property {DB} db - Database instance
 * @property {Users} users - Users module instance
 * @property {Settings} settings - Settings module instance
 * @property {UI|null} ui - UI module (set after construction)
 * @property {Scheduler|null} scheduler - Scheduler module (set after construction)
 */
export default class Events {
    /**
     * Gets the holon ID from an event object with backward compatibility.
     * @static
     * @param {Object} event - The event object
     * @returns {string|number|null} The holon ID
     */
    static getEventHolon(event) {
        return event?.holon ?? event?.chat ?? null;
    }

    // Resolve the Telegram message_id that represents this event in the given
    // holon. Mirrors Quests.resolveTelegramMessageId — see that doc for context.
    static resolveTelegramMessageId(event, holonId) {
        if (!event || holonId == null) return null;
        const target = String(holonId);
        const sources = [
            ...(event.activeHolograms || []),
            ...(event._meta?.activeHolograms || []),
        ];
        const entry = sources.find(h =>
            String(h.holonId) === target &&
            (!h.platform || h.platform === 'telegram')
        );
        if (entry?.messageId != null) {
            const n = Number(entry.messageId);
            return Number.isFinite(n) ? n : null;
        }
        if (target === String(Events.getEventHolon(event))) {
            const id = String(event.id ?? '');
            if (/^-?\d+$/.test(id)) return Number(id);
        }
        return null;
    }

    // Bootstrap a Telegram message for an event if one doesn't exist yet.
    // Same pattern as Quests.ensureMainTelegramMessage.
    async ensureMainTelegramMessage(event, eventHolon, language, markupConfig) {
        if (!event || !eventHolon) return null;

        const existing = Events.resolveTelegramMessageId(event, eventHolon);
        if (existing != null) return existing;

        try {
            const message = await this.ui?.createEventMessage(event, language) || await this.createMessage(event, language);
            const markup = markupConfig || this.markup(event, language);

            let sent;
            if (event.picture && (event.picture.startsWith('http') || event.picture.startsWith('AgAC'))) {
                try {
                    sent = await this.bot.telegram.sendPhoto(eventHolon, event.picture, {
                        caption: this.truncateCaption(message),
                        ...markup,
                    });
                } catch {
                    sent = await this.bot.telegram.sendMessage(eventHolon, message, markup);
                }
            } else {
                sent = await this.bot.telegram.sendMessage(eventHolon, message, markup);
            }

            if (!Array.isArray(event.activeHolograms)) event.activeHolograms = [];
            event.activeHolograms.push({
                platform: 'telegram',
                holonId: eventHolon,
                messageId: sent.message_id,
            });

            try {
                await this.db.put(String(eventHolon), 'events', event);
            } catch (persistErr) {
                log.warn(`Events.ensureMainTelegramMessage: created ${sent.message_id} but failed to persist: ${persistErr?.message || persistErr}`);
            }

            this.bot.telegram.pinChatMessage(eventHolon, sent.message_id, { disable_notification: true }).catch(() => {});

            return sent.message_id;
        } catch (err) {
            log.warn(`Events.ensureMainTelegramMessage: failed for event ${event.id} in holon ${eventHolon}: ${err?.message || err}`);
            return null;
        }
    }

    /**
     * Creates a new Events instance and registers all event commands and actions.
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

        // External dependencies (set after construction)
        this.ui = null;
        this.scheduler = null;

        // Operation queue to prevent race conditions on rapid clicks
        this.eventOperationQueues = new Map();

        // Performance caches
        this.languageCache = new Map();
        this.userCache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes

        this.registerCommands();
        this.registerActions();
    }

    /**
     * Wrap handler functions with error protection.
     * Prevents bot from crashing on unhandled errors.
     */
    safeHandler(fn) {
        return async (ctx, next) => {
            try {
                await fn.call(this, ctx, next);
            } catch (error) {
                log.error('Event handler error', {
                    error: error.message,
                    stack: error.stack,
                    handler: fn.name,
                    userId: ctx.from?.id,
                    holonId: ctx.chat?.id,
                    data: ctx.callbackQuery?.data,
                });

                try {
                    if (ctx.answerCbQuery) {
                        await ctx.answerCbQuery('An error occurred. Please try again.').catch(() => {});
                    } else if (ctx.reply) {
                        await ctx.reply('An error occurred. Please try again.').catch(() => {});
                    }
                } catch {}
            }
        };
    }

    registerCommands() {
        // Event creation commands
        this.bot.command(['event', 'evento'], this.safeHandler(ctx => this.createEvent(ctx)));

        // Event listing
        this.bot.command(['events', 'eventi'], this.safeHandler(ctx => this.listEvents(ctx)));
    }

    registerActions() {
        const actions = {
            'participate_event_': this.join,
            'appreciate_event_': this.appreciate,
            'schedule_event_': this.schedule,
            'complete_event_': this.complete,
            'cancel_event_': this.cancel,
            'more_event_actions_': this.showMoreActions,
            'less_event_actions_': this.hideMoreActions,
            'publish_event_': this.publish,
        };

        Object.entries(actions).forEach(([prefix, handler]) => {
            const regex = new RegExp(prefix + '(.+)');
            this.bot.action(regex, this.safeHandler(handler.bind(this)));
        });

        // Recurring event actions
        this.bot.action(/recurring_event_(.+)/, this.safeHandler(ctx => this.handleRecurringButton(ctx)));
        this.bot.action(/set_recurring_event_(.+)/, this.safeHandler(ctx => this.handleSetRecurring(ctx)));
        this.bot.action(/back_from_recurring_event_(.+)/, this.safeHandler(ctx => this.handleBackFromRecurring(ctx)));
    }

    // ==================== Core Event Methods ====================

    /**
     * Create a new event.
     * @param {Object} ctx - Telegraf context
     */
    async createEvent(ctx) {
        const holonId = getholonId(ctx);
        const messageId = getMessageId(ctx);
        const language = await this.getLanguage(holonId);
        const text = ctx.message.text || ctx.message.caption;

        const sender = ctx.message.from;
        const title = text.split(' ').slice(1).join(' ');
        const picture = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : null;

        if (!title) {
            return ctx.reply(i18next.t('usage', { type: 'event', lng: language }));
        }

        // Create event object
        const event = {
            id: '',
            version: '0.1',
            holon: holonId,
            message_thread_id: ctx.message?.is_topic_message ? ctx.message.message_thread_id : null,
            initiator: sender,
            title,
            picture,
            type: 'event',
            status: 'ongoing',
            date: Date.now(),
            participants: [],
            appreciation: [],
            // Event-specific fields
            when: '',
            until: '',
            where: { latitude: '', longitude: '', name: '' },
            // Scheduling
            reminderId: null,
            recurringTaskId: null,
            frequency: null,
            // Holograms
            activeHolograms: [],
            // Optional
            description: '',
            published: false,
        };

        // Send message
        let nctx;
        if (picture) {
            nctx = await ctx.replyWithPhoto(picture, {
                caption: createPaddedCaption("📅 " + event.title),
                parse_mode: 'Markdown',
                ...this.markup(event, language)
            });
        } else {
            const message = await this.ui?.createEventMessage(event, language) || await this.createMessage(event, language);
            nctx = await ctx.reply(message, this.markup(event, language));
        }

        // Set event ID
        event.id = ctx.platform === 'discord' ? nctx.id : nctx.message_id;
        if (!event.holon || event.holon === 0) {
            event.holon = ctx.platform === 'discord' ? nctx.channel.id : nctx.chat.id;
        }

        // Persist via @holons/core/tasks so the bot/web/text UIs share one
        // persistence path. Events live in the `events` lens, not `quests`,
        // so route through a thin lens-rewriting adapter.
        const eventsLensAdapter = {
            put: (h: string, _lens: string, v: unknown) => this.db.put(h, 'events', v),
        };
        await saveTasksToHolon(eventsLensAdapter, holonId.toString(), [event as CoreQuest]);

        // Update buttons and pin message
        const eventHolon = Events.getEventHolon(event);
        try {
            await this.bot.telegram.editMessageReplyMarkup(eventHolon, event.id, null,
                this.markup(event, language).reply_markup);
        } catch {}

        this.bot.telegram.pinChatMessage(eventHolon, event.id, { disable_notification: true }).catch(() => {});
        this.bot.telegram.deleteMessage(holonId, messageId).catch(() => {});

        return event;
    }

    /**
     * Join an event (toggle participation).
     */
    async join(ctx) {
        return this.handleParticipation(ctx, 'join');
    }

    /**
     * Appreciate an event (toggle appreciation).
     */
    async appreciate(ctx) {
        return this.handleParticipation(ctx, 'appreciate');
    }

    /**
     * Handle participation actions (join/appreciate).
     */
    async handleParticipation(ctx, action) {
        const [, , holonId, eventID] = ctx.callbackQuery.data.split('_');
        const sender = ctx.callbackQuery.from;

        log.info(`handleParticipation called - action: ${action}, holonId: ${holonId}, eventID: ${eventID}, user: ${sender.id}`);

        // Answer callback query IMMEDIATELY
        ctx.answerCbQuery().catch(() => {});

        // Queue operation to prevent race conditions
        await this.queueEventOperation(holonId, eventID, async () => {
            const language = await this.getLanguage(holonId);
            let event;

            try {
                event = await this.db.get(holonId.toString(), 'events', eventID);
            } catch (err) {
                log.error(`Failed to fetch event: ${holonId}/events/${eventID}`, err);
            }

            if (!await this.eventExists(event, ctx, eventID)) return;
            if (await this.handleCompletedEventInteraction(ctx, event, holonId, eventID, language)) return;

            event.participants = event.participants || [];
            event.appreciation = event.appreciation || [];

            if (action === 'join') {
                const idx = event.participants.findIndex(u => u.id === sender.id);
                if (idx > -1) {
                    event.participants.splice(idx, 1);
                } else {
                    event.participants.push(sender);
                }
                event.appreciation = event.appreciation.filter(u => u.id !== sender.id);
            } else {
                const userIdx = event.participants.findIndex(u => u.id === sender.id);
                if (userIdx > -1 && event.status === "completed") return;
                if (userIdx > -1) event.participants.splice(userIdx, 1);

                const appIdx = event.appreciation.findIndex(u => u.id === sender.id);
                if (appIdx > -1) {
                    if (event.status === "completed") return;
                    event.appreciation.splice(appIdx, 1);
                } else {
                    event.appreciation.push(sender);
                }
            }

            // Save event using the same holonId we fetched from
            try {
                await this.db.put(holonId.toString(), 'events', event);
            } catch (err) {
                log.error(`Failed to save event after participation: ${holonId}/events/${eventID}`, err);
            }

            // Update message display
            const interactingUser = (action === 'join') ? sender : null;
            await this.updateMessage(ctx, event, language, { interactingUser, skipSave: true });
        });
    }

    /**
     * Complete an event.
     */
    async complete(ctx) {
        const [, , holonId, eventID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(holonId);
        const event = await this.db.get(holonId.toString(), 'events', eventID);

        if (!await this.eventExists(event, ctx, eventID)) return;

        const completerId = ctx.from.id;
        const canComplete = event.initiator.id === completerId ||
                           event.participants.some(u => u.id === completerId) ||
                           await this.checkUserAdmin(completerId, holonId);

        if (!canComplete) {
            return ctx.answerCbQuery(i18next.t('onlyinitiatorcomplete', { lng: language }));
        }

        // Answer callback query IMMEDIATELY
        ctx.answerCbQuery(`Completing "${event.title}"...`).catch(() => {});

        event.status = "completed";

        // Cancel reminder if exists
        if (event.reminderId && this.scheduler) {
            await this.scheduler.cancelReminder(event.reminderId);
            delete event.reminderId;
        }

        const hologramsToUpdate = event.activeHolograms ? [...event.activeHolograms] : [];
        event.activeHolograms = [];

        await this.updateMessage(ctx, event, language, { explicitHologramsToUpdate: hologramsToUpdate });

        ctx.telegram.unpinChatMessage(holonId, eventID).catch(() => {});

        // REA side-effects via shared core; events have no timeTracking so
        // plan.expenses is empty — same code path as Quests.
        const equation =
            (await this.settings?.getValueEquation(holonId).catch(() => null)) || DEFAULT_EQUATION;
        const plan = planTaskCompletion(event, equation, { holonId });
        await executeCompletionPlan(this.db, this.users.getEventStore(), holonId, plan);

        ctx.reply(`Event "${event.title}" completed! 🎊`, { reply_to_message_id: eventID }).catch(() => {});
    }

    /**
     * Cancel an event.
     */
    async cancel(ctx) {
        const [, , holonId, eventID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(holonId);

        let event;
        try {
            event = await this.db.get(holonId.toString(), 'events', eventID);
        } catch {}

        const eventHolonId = Events.getEventHolon(event);
        const isHologram = eventHolonId && eventHolonId.toString() !== holonId.toString();

        if (isHologram) {
            const msgId = ctx.callbackQuery?.message.message_id || eventID;
            await ctx.telegram.deleteMessage(holonId, msgId).catch(() => {});
            return ctx.answerCbQuery('Hologram cancelled.').catch(() => {});
        }

        if (!event) {
            const msgId = ctx.callbackQuery?.message.message_id || eventID;
            await ctx.telegram.deleteMessage(holonId, msgId).catch(() => {});
            return ctx.answerCbQuery('Event not found or already cancelled.').catch(() => {});
        }

        const hasPermission = event.initiator?.id === ctx.from.id ||
                             await this.checkUserAdmin(ctx.from.id, holonId);

        if (!hasPermission) {
            return ctx.answerCbQuery(i18next.t('onlyinitatorcancel', { lng: language })).catch(() => {});
        }

        ctx.answerCbQuery('Cancelling event...').catch(() => {});

        // Delete holograms
        if (event.activeHolograms?.length > 0) {
            for (const h of event.activeHolograms) {
                await ctx.telegram.deleteMessage(h.holonId, h.messageId).catch(() => {});
            }
        }

        // Cancel reminder
        if (event.reminderId && this.scheduler) {
            await this.scheduler.cancelReminder(event.reminderId);
        }

        await this.db.delete(holonId.toString(), 'events', eventID);
        await ctx.telegram.unpinChatMessage(holonId, eventID).catch(() => {});
        await ctx.deleteMessage(eventID).catch(() => {});
    }

    /**
     * Show calendar for scheduling.
     */
    async schedule(ctx) {
        const [, , , eventID] = ctx.callbackQuery.data.split('_');
        const holonId = ctx.callbackQuery.message.chat.id;

        try {
            const event = await this.db.get(holonId.toString(), 'events', eventID);
            if (!await this.eventExists(event, ctx, eventID)) return;

            const language = await this.getLanguage(holonId);
            if (await this.handleCompletedEventInteraction(ctx, event, holonId, eventID, language)) return;

            // Cancel existing reminder
            if (event.reminderId && this.scheduler) {
                await this.scheduler.cancelReminder(event.reminderId);
                delete event.reminderId;
                await this.db.put(holonId.toString(), 'events', event);
                await this.updateMessage(ctx, event, language);
            }

            // Show calendar (scheduler needs to support events path)
            await this.scheduler?.showCalendar(ctx, eventID, 'events');
            await ctx.answerCbQuery().catch(() => {});
        } catch (error) {
            log.error('Error showing calendar for event', error);
            await ctx.answerCbQuery('Error showing calendar');
        }
    }

    /**
     * List all events.
     */
    async listEvents(ctx) {
        const holonId = getholonId(ctx);
        const language = await this.getLanguage(holonId);

        try {
            const events = await this.db.getAll(holonId.toString(), 'events');
            const openEvents = events.filter(e => e.status === 'ongoing' || e.status === 'scheduled');

            if (!openEvents.length) {
                return ctx.reply(i18next.t('no_events', {
                    lng: language,
                    defaultValue: 'No upcoming events found.'
                }));
            }

            let message = `*${i18next.t('events', { lng: language, defaultValue: 'Events' })}*:\n\n`;
            openEvents.forEach(e => {
                const dateStr = e.when ? new Date(e.when).toLocaleDateString() : '';
                message += `- ${e.title} ${dateStr ? `(${dateStr})` : ''} - ${e.participants?.length || 0} participants\n`;
            });

            ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error) {
            log.error('Error listing events', error);
            ctx.reply('Error fetching events');
        }
    }

    // ==================== UI Methods ====================

    async showMoreActions(ctx) {
        const [,, holonId, eventID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(holonId);
        const event = await this.db.get(holonId.toString(), 'events', eventID);

        if (!await this.eventExists(event, ctx, eventID)) return;

        // Use the chat where button was clicked, not the event's source holon
        const clickedChatId = ctx.callbackQuery.message.chat.id;
        const expandedButtons = this.getExpandedButtons(event, language);
        await this.updateEventMessage(ctx, event, clickedChatId, ctx.callbackQuery.message.message_id,
                                      language, { reply_markup: { inline_keyboard: expandedButtons } });
        await ctx.answerCbQuery().catch(() => {});
    }

    async hideMoreActions(ctx) {
        const [,, holonId, eventID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(holonId);
        const event = await this.db.get(holonId.toString(), 'events', eventID);

        if (!await this.eventExists(event, ctx, eventID)) return;

        // Use the chat where button was clicked, not the event's source holon
        const clickedChatId = ctx.callbackQuery.message.chat.id;
        await this.updateEventMessage(ctx, event, clickedChatId, ctx.callbackQuery.message.message_id,
                                      language, this.markup(event, language));
        await ctx.answerCbQuery().catch(() => {});
    }

    /**
     * Generate inline keyboard markup for an event.
     */
    markup(event, language) {
        const eventHolon = Events.getEventHolon(event);
        if (!eventHolon) return Markup.inlineKeyboard([]);

        if (!event.id || event.id === '') {
            return Markup.inlineKeyboard([
                [Markup.button.callback(event.title || 'Creating event...', 'placeholder')]
            ]);
        }

        const buttons = [];

        if (event.status === "completed") {
            buttons.push([
                Markup.button.callback(i18next.t('appreciate', { lng: language }),
                                      `appreciate_event_${eventHolon}_${event.id}`)
            ]);
        } else {
            buttons.push(
                [
                    Markup.button.callback(i18next.t('join', { lng: language }),
                                          `participate_event_${eventHolon}_${event.id}`),
                    Markup.button.callback(i18next.t('complete', { lng: language }),
                                          `complete_event_${eventHolon}_${event.id}`)
                ],
                [
                    Markup.button.callback(i18next.t('appreciate', { lng: language }),
                                          `appreciate_event_${eventHolon}_${event.id}`),
                    Markup.button.callback(i18next.t('schedule', { lng: language }),
                                          `schedule_event_${eventHolon}_${event.id}`)
                ],
                [
                    Markup.button.callback('...' + i18next.t('more_actions', { lng: language }),
                                          `more_event_actions_${eventHolon}_${event.id}`)
                ]
            );
        }

        return Markup.inlineKeyboard(buttons);
    }

    /**
     * Generate expanded button layout for events.
     */
    getExpandedButtons(event, language) {
        const eventHolon = Events.getEventHolon(event);
        const buttons = [];

        if (event.status === "completed") {
            return [
                [Markup.button.callback(i18next.t('appreciate', { lng: language }),
                                      `appreciate_event_${eventHolon}_${event.id}`)],
                [Markup.button.callback('...' + i18next.t('less_actions', { lng: language }),
                                      `less_event_actions_${eventHolon}_${event.id}`)]
            ];
        }

        buttons.push(
            [
                Markup.button.callback(i18next.t('join', { lng: language }),
                                      `participate_event_${eventHolon}_${event.id}`),
                Markup.button.callback(i18next.t('complete', { lng: language }),
                                      `complete_event_${eventHolon}_${event.id}`)
            ],
            [
                Markup.button.callback(i18next.t('appreciate', { lng: language }),
                                      `appreciate_event_${eventHolon}_${event.id}`),
                Markup.button.callback(i18next.t('schedule', { lng: language }),
                                      `schedule_event_${eventHolon}_${event.id}`)
            ],
            [
                Markup.button.callback(i18next.t('cancel', { lng: language }),
                                      `cancel_event_${eventHolon}_${event.id}`)
            ],
            [
                Markup.button.callback('...' + this.getRecurringButtonText(event, language),
                                      `recurring_event_${eventHolon}_${event.id}`)
            ],
            [
                Markup.button.callback('...' + i18next.t('publish', { lng: language }),
                                      `publish_event_${eventHolon}_${event.id}`),
                Markup.button.url('...' + 'Dashboard',
                                 `${DASHBOARD_ADDRESS}/${eventHolon}/events?event=${event.id}`)
            ],
            [Markup.button.callback('...' + i18next.t('less_actions', { lng: language }),
                                   `less_event_actions_${eventHolon}_${event.id}`)]
        );

        return buttons;
    }

    /**
     * Create text message for an event (fallback when UI not available).
     */
    async createMessage(event, language) {
        const lines = [
            `| ${i18next.t('Event', { lng: language })}${event.recurringTaskId ? ' ...' : ''}: ${event.title.padEnd(200)}`,
            `| ... ${i18next.t('by', { lng: language })}: ${getDisplayName(event.initiator)}`
        ];

        if (event.description) lines.push(`| ... ${event.description}`);
        if (event.frequency) lines.push(`| ... ${i18next.t('repeat', { lng: language })}: ${i18next.t(event.frequency, { lng: language })}`);

        if (event.participants?.length) {
            const names = event.participants.map(u => getDisplayName(u));
            lines.push(`| ... : ${names.join(', ')}`);
        }

        if (event.appreciation?.length) {
            lines.push(`| ... : ${event.appreciation.map(u => getDisplayName(u)).join(', ')}`);
        }

        for (const [field, emoji] of [['when', '...'], ['until', '...']]) {
            if (event[field]) {
                const date = new Date(event[field]);
                const timezone = await this.settings.getTimezone(Events.getEventHolon(event)) || 'UTC';
                try {
                    const dateStr = date.toLocaleDateString(language, {
                        weekday: 'long', month: 'long', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                        timeZone: timezone, timeZoneName: 'short'
                    });
                    lines.push(`| ${emoji}: ${dateStr}`);
                } catch {
                    lines.push(`| ${emoji}: Invalid Date`);
                }
            }
        }

        if (event.where?.latitude) {
            lines.push(`| ... : ${event.where.latitude}, ${event.where.longitude}`);
        }

        lines.push(`| ... : ${i18next.t(event.status, { lng: language })}`);

        if (event.published) lines.push(`| ... ${i18next.t('published', { lng: language })}`);

        return lines.join('\n') + '\n';
    }

    // ==================== Message Update Methods ====================

    /**
     * Unified save and update function for events.
     */
    async updateMessage(ctx, event, language, options = {}) {
        const eventHolon = Events.getEventHolon(event);
        if (!eventHolon || !event.id) return;

        let useExpandedMarkup = false;
        let explicitHologramsToUpdate = null;
        let interactingUser = null;

        let skipSave = false;
        if (typeof options === 'object') {
            useExpandedMarkup = options.useExpandedMarkup || false;
            explicitHologramsToUpdate = options.explicitHologramsToUpdate || null;
            interactingUser = options.interactingUser || null;
            skipSave = options.skipSave || false;
        }

        language = language || await this.getLanguage(eventHolon);
        const markupConfig = useExpandedMarkup
            ? { reply_markup: { inline_keyboard: this.getExpandedButtons(event, language) } }
            : this.markup(event, language);

        const updatedMessages = new Set();

        const mainMessageKey = `${eventHolon}_${event.id}`;

        // Update the main Telegram message
        try {
            await ctx.telegram.getChat(eventHolon);
            await this.updateEventMessage(ctx, event, eventHolon, event.id, language, markupConfig);
            updatedMessages.add(mainMessageKey);
        } catch {}

        // Save event (unless already saved by caller)
        if (!skipSave) {
            try {
                await this.db.put(eventHolon.toString(), 'events', event);
            } catch (err) {
                log.error(`Failed to save event in updateMessage: ${eventHolon}/${event.id}`, err);
            }
        }

        // Update existing holograms from _meta.activeHolograms
        const metaHolograms = event._meta?.activeHolograms || [];
        if (metaHolograms.length > 0) {
            await this.updateHologramsFromMeta(ctx, event, language, markupConfig, metaHolograms, updatedMessages);
        }
    }

    async updateEventMessage(ctx, event, holonId, messageId, language, markupConfig) {
        try {
            if (event.picture) {
                // Event with picture: update caption
                const message = await this.ui?.createEventMessage(event, language) || await this.createMessage(event, language);
                await ctx.telegram.editMessageCaption(holonId, messageId, null, this.truncateCaption(message), markupConfig)
                    .catch((err) => {
                        if (!err.response?.description?.includes('message is not modified')) {
                            log.error('Error editing event caption', err);
                        }
                    });
            } else {
                // Text-only event
                const message = await this.ui?.createEventMessage(event, language) || await this.createMessage(event, language);
                await ctx.telegram.editMessageText(holonId, messageId, null, message, markupConfig)
                    .catch((err) => {
                        if (!err.response?.description?.includes('message is not modified')) {
                            log.error('Error editing event text', err);
                        }
                    });
            }
        } catch (err) {
            log.error('Error in updateEventMessage', err);
        }
    }

    /**
     * Update holograms using the new _meta.activeHolograms structure from HoloSphere.
     * Structure: { targetHolon, platforms: { telegram: { messageId } } }
     */
    async updateHologramsFromMeta(ctx, event, language, markupConfig, metaHolograms, updatedMessages = new Set()) {
        if (!metaHolograms?.length) return;

        for (const hologram of metaHolograms) {
            try {
                const telegramData = hologram.platforms?.telegram;
                if (!telegramData?.messageId) {
                    // No Telegram message for this hologram yet
                    continue;
                }

                const targetHolon = hologram.targetHolon;
                const messageId = telegramData.messageId;

                // Skip already updated messages
                const messageKey = `${targetHolon}_${messageId}`;
                if (updatedMessages.has(messageKey)) {
                    continue;
                }
                updatedMessages.add(messageKey);

                await this.updateEventMessage(ctx, event, targetHolon, messageId, language, markupConfig);
            } catch (error) {
                log.error(`Error updating hologram ${hologram.targetHolon}:`, error);
            }
        }
    }

    /**
     * @deprecated Use updateHologramsFromMeta instead. Kept for backward compatibility.
     */
    async updateHolograms(ctx, event, language, markupConfig, hologramsToUpdate, updatedMessages) {
        for (const hologram of hologramsToUpdate) {
            const key = `${hologram.holonId}_${hologram.messageId}`;
            if (updatedMessages.has(key)) continue;

            try {
                await this.updateEventMessage(ctx, event, hologram.holonId, hologram.messageId, language, markupConfig);
                updatedMessages.add(key);
            } catch {}
        }
    }

    // ==================== Recurring Events ====================

    async handleRecurringButton(ctx) {
        const [, , holonId, eventID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(holonId);
        const event = await this.db.get(holonId.toString(), 'events', eventID);

        if (!await this.eventExists(event, ctx, eventID)) return;

        const frequencies = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
        const buttons = frequencies.map(freq => [
            Markup.button.callback(
                (event.frequency === freq ? '... ' : '') + i18next.t(freq, { lng: language, defaultValue: freq }),
                `set_recurring_event_${freq}_${holonId}_${eventID}`
            )
        ]);

        buttons.push([
            Markup.button.callback('... ' + i18next.t('back', { lng: language }),
                                  `back_from_recurring_event_${holonId}_${eventID}`)
        ]);

        await ctx.editMessageReplyMarkup({ inline_keyboard: buttons });
        await ctx.answerCbQuery().catch(() => {});
    }

    async handleSetRecurring(ctx) {
        const parts = ctx.callbackQuery.data.split('_');
        const frequency = parts[3];
        const holonId = parts[4];
        const eventID = parts[5];

        const language = await this.getLanguage(holonId);
        const event = await this.db.get(holonId.toString(), 'events', eventID);

        if (!await this.eventExists(event, ctx, eventID)) return;

        // Toggle frequency
        if (event.frequency === frequency) {
            event.frequency = null;
            if (event.recurringTaskId && this.scheduler) {
                await this.scheduler.stopTask(event.recurringTaskId);
                event.recurringTaskId = null;
            }
        } else {
            event.frequency = frequency;

            // Create or update recurring task via scheduler
            if (this.scheduler && event.when) {
                if (event.recurringTaskId) {
                    await this.scheduler.stopTask(event.recurringTaskId);
                }
                const taskId = await this.scheduler.createRecurringTask({
                    id: `${event.id}_recurring`,
                    holonId,
                    questId: event.id,
                    title: event.title,
                    frequency: event.frequency,
                    when: event.when,
                    initiator: event.initiator,
                    description: event.description,
                    timezone: event.timezone,
                    type: 'event'
                });
                if (taskId) {
                    event.recurringTaskId = taskId;
                }
            }
        }

        await this.updateMessage(ctx, event, language);
        await ctx.answerCbQuery(
            event.frequency
                ? `Event set to repeat ${event.frequency}`
                : 'Recurring disabled'
        ).catch(() => {});
    }

    async handleBackFromRecurring(ctx) {
        const [, , , holonId, eventID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(holonId);
        const event = await this.db.get(holonId.toString(), 'events', eventID);

        if (!await this.eventExists(event, ctx, eventID)) return;

        const expandedButtons = this.getExpandedButtons(event, language);
        await ctx.editMessageReplyMarkup({ inline_keyboard: expandedButtons });
        await ctx.answerCbQuery().catch(() => {});
    }

    // ==================== Publish ====================

    async publish(ctx) {
        const [, , holonId, eventID] = ctx.callbackQuery.data.split('_');
        const language = await this.getLanguage(holonId);
        const event = await this.db.get(holonId.toString(), 'events', eventID);

        if (!await this.eventExists(event, ctx, eventID)) return;

        event.published = !event.published;
        await this.updateMessage(ctx, event, language);

        await ctx.answerCbQuery(
            event.published ? 'Event published!' : 'Event unpublished'
        ).catch(() => {});
    }

    // ==================== Helper Methods ====================

    async getLanguage(holonId) {
        const cached = this.languageCache.get(holonId);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.value;
        }

        const language = await this.settings.getLanguage(holonId);
        this.languageCache.set(holonId, { value: language, timestamp: Date.now() });
        return language;
    }

    async eventExists(event, ctx, eventId = 'N/A') {
        if (!event || event === '') {
            const holonId = getholonId(ctx);
            const language = holonId ? await this.getLanguage(holonId) : 'en';

            if (ctx.callbackQuery) {
                await ctx.answerCbQuery(i18next.t('eventnotfound', { lng: language, defaultValue: 'Event not found.' })).catch(() => {});
                await ctx.deleteMessage().catch(() => {});
            }
            return false;
        }
        return true;
    }

    async handleCompletedEventInteraction(ctx, event, holonId, eventID, language) {
        if (event.status !== 'completed') return false;

        try {
            await this.updateMessage(ctx, event, language, false);
            ctx.answerCbQuery(`Event "${event.title}" has already been completed`).catch(() => {});
            return true;
        } catch {
            const msgId = ctx.callbackQuery?.message.message_id || eventID;
            await ctx.telegram.deleteMessage(holonId, msgId).catch(() => {});
            ctx.answerCbQuery('Event not found or already completed.').catch(() => {});
            return true;
        }
    }

    async checkUserAdmin(userId, holonId) {
        try {
            if (holonId > 0) return true;
            const member = await this.bot.telegram.getChatMember(holonId, userId);
            return ['administrator', 'creator'].includes(member.status);
        } catch {
            return false;
        }
    }

    async queueEventOperation(holonId, eventID, operation) {
        const key = `${holonId}_${eventID}`;
        const existingQueue = this.eventOperationQueues.get(key) || Promise.resolve();

        const newQueue = existingQueue.then(async () => {
            try {
                await operation();
            } catch (error) {
                log.error('Event operation failed:', error);
            }
        });

        this.eventOperationQueues.set(key, newQueue);
        await newQueue;
    }

    getRecurringButtonText(event, language) {
        return event.frequency
            ? i18next.t(event.frequency, { lng: language, defaultValue: event.frequency })
            : i18next.t('never', { lng: language, defaultValue: 'Never' });
    }

    truncateCaption(caption) {
        if (!caption || caption.length <= 1024) return caption;
        return caption.slice(0, 1021) + '...';
    }

    /**
     * Invalidate language cache when user changes language.
     */
    invalidateLanguageCache(holonId) {
        if (holonId) {
            this.languageCache.delete(holonId);
        } else {
            this.languageCache.clear();
        }
    }

    // ==================== Setters for External Dependencies ====================

    setScheduler(scheduler) { this.scheduler = scheduler; }
    setUIInstance(ui) { this.ui = ui; }
}
