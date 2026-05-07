/**
 * @fileoverview User management for HolonsBot holons.
 *
 * Telegraf command bindings + REA orchestration. All profile / values / needs
 * / membership data operations are delegated to `@holons/core/users` so the
 * web UI and bot share the same persistence semantics.
 *
 * @module src/Users
 */
import { t } from "i18next";
import * as utils from './utilities.js';
import { Markup } from 'telegraf';
import { REAEventStore, REAEventFactory, REAAggregator } from './domain/rea/index.js';
import {
  getUserProfile as coreGetUserProfile,
  ensureUserProfile as coreEnsureUserProfile,
  getUsers as coreGetUsers,
  addUserValues,
  addUserNeeds,
  joinHolon as coreJoinHolon,
  leaveHolon as coreLeaveHolon,
} from '@holons/core/users';

/**
 * User management class for handling holon members and their contributions.
 *
 * @class Users
 * @description Manages user data, values, needs, and resource event tracking within holons.
 * Integrates with REA (Resource-Event-Agent) pattern for economic event tracking.
 *
 * @property {Telegraf} bot - The Telegraf bot instance
 * @property {DB} db - Database instance
 * @property {REAEventStore} eventStore - REA event store for economic events
 * @property {Object} eventFactory - REA event factory
 * @property {REAAggregator} aggregator - REA aggregator for computing balances
 *
 * @example
 * const users = new Users(bot, db);
 * const userInfo = await users.getUserInfo(telegramUser, chatId);
 */
class Users {
  /**
   * Creates a new Users instance and registers user commands.
   * @constructor
   * @param {Telegraf} bot - The Telegraf bot instance
   * @param {DB} db - The database instance
   */
  constructor(bot, db) {
    this.bot = bot;
    this.db = db;

    this.eventStore = new REAEventStore(db);
    this.eventFactory = REAEventFactory;
    this.aggregator = new REAAggregator(this.eventStore);

    this.bot.command(['value', 'ivalue'], (ctx) => this.addValue(ctx));
    this.bot.command(['need', 'ineed', 'weneed'], (ctx) => this.addNeed(ctx));
    this.bot.command("join", (ctx) => this.join(ctx));
    this.bot.command("leave", (ctx) => this.leave(ctx));
  }

  /**
   * Get the REA event store instance
   * @returns {REAEventStore}
   */
  getEventStore() {
    return this.eventStore;
  }

  /**
   * Get the REA aggregator instance
   * @returns {REAAggregator}
   */
  getAggregator() {
    return this.aggregator;
  }

  async join(ctx) {
    const { hasUsername } = await coreJoinHolon(this.db, ctx.message.from, ctx.message.chat.id);
    if (!hasUsername) {
      ctx.reply('Please set a username in your telegram settings to join the group.');
    } else {
      ctx.reply('🎉 Welcome ' + ctx.message.from.first_name + '! 🎉');
    }
  }

  async leave(ctx) {
    const holonId = ctx.message.chat.id;
    const user = ctx.message.from;
    await coreLeaveHolon(this.db, user.id, holonId);
    ctx.reply('Goodbye ' + user.first_name + '!');
  }


  async addValue(ctx) {
    const values = utils.parseList(ctx.message.text);
    if (!values?.length) {
      ctx.reply('Please specify a value or list of values to add. eg: /value freedom, non-violence');
      return;
    }
    await addUserValues(this.db, ctx.message.from, ctx.message.chat.id, values);
    ctx.reply(`Added ${values.join(', ')} to your values.`);
  }

  async addNeed(ctx) {
    const needs = utils.parseList(ctx.message.text);
    if (!needs?.length) {
      ctx.reply('Please specify a need or comma separated list of needs to add. eg: /need hugs, massages');
      return;
    }
    await addUserNeeds(this.db, ctx.message.from, ctx.message.chat.id, needs);
    ctx.reply(`Added ${needs.join(', ')} to your needs.`);
  }



  async listUsersActions(ctx) {
    const holonId = ctx.message.chat.id;
    const users = await coreGetUsers(this.db, holonId);

    let message = ''
    for (let i = 0; i < users.length; i++) {
      let user = users[i];
      // Get completed count from REA aggregates
      const aggregates = await this.aggregator.getUserAggregates(holonId, user.id);
      if (aggregates.completed > 0) {
        message += user.username + ': ' + aggregates.completed + ' completed\n'
      }
    }
    return message
  }


  /**
   * Save user action as REA event
   * This is the primary method for recording economic events
   * @param {Object} user - User object with id, username, first_name
   * @param {string} type - Action type (initiated, completed, sent, received, etc.)
   * @param {string} action - Action description (quest title, etc.)
   * @param {number} amount - Amount (for hours, money, etc.)
   * @param {string} holonId - Holon context
   * @param {Object} [extraContext] - Additional context (questId, receiver, etc.)
   */
  async saveUserAction(user, type, action, amount, holonId, extraContext = {}) {
    const events = [];

    switch (type) {
      case 'initiated':
        events.push(this.eventFactory.questInitiated(holonId, user, {
          id: extraContext.questId || action,
          title: action
        }));
        break;

      case 'completed':
        events.push(this.eventFactory.questCompleted(holonId, user, {
          id: extraContext.questId || action,
          title: action
        }));
        break;

      case 'sent':
        // Appreciation sent - requires receiver in extraContext
        if (extraContext.receiver) {
          const appreciationEvents = this.eventFactory.appreciationExchange(
            holonId,
            user,
            extraContext.receiver,
            1,
            action,
            extraContext.questId
          );
          events.push(...appreciationEvents);
        }
        break;

      case 'received':
        // Appreciation received is handled by the 'sent' case above (dual events)
        // This case is for legacy compatibility
        break;

      case 'collaborated':
        // Time/hours logged
        if (amount > 0) {
          events.push(this.eventFactory.timeLogged(
            holonId,
            user,
            amount,
            extraContext.questId,
            action
          ));
        }
        break;

      case 'offers':
        events.push(this.eventFactory.offerDeclared(holonId, user, action));
        break;

      case 'wants':
        events.push(this.eventFactory.wantDeclared(holonId, user, action));
        break;

      case 'appreciated':
        // Legacy appreciation record
        break;

      default:
        console.warn(`Unknown action type: ${type}`);
        break;
    }

    // Store all events
    for (const event of events) {
      await this.eventStore.put(holonId, event);
    }

    // Update user profile to ensure they exist in the system
    await this.ensureUserProfile(user, holonId);

    return events;
  }

  /**
   * Batch save multiple user actions (for quest completion)
   * Groups actions by user to prevent race conditions
   * @param {Array} actions - Array of {user, action, quest, value, holonId} objects
   */
  async batchSaveUserActions(actions) {
    if (!actions?.length) return;

    // Group actions by user to prevent race conditions
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
            await this.saveUserAction(
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

  async getUsers(holonId) {
    return coreGetUsers(this.db, holonId);
  }

  /**
   * Get user profile (without computed aggregates).
   * Thin wrapper over `@holons/core/users`.
   * @param {Object} user - User object
   * @param {string} holonId - Holon context
   * @returns {Promise<Object>} User profile
   */
  async getUserProfile(user, holonId) {
    return coreGetUserProfile(this.db, user, holonId);
  }

  /**
   * Ensure user profile exists.
   * Thin wrapper over `@holons/core/users`.
   * @param {Object} user - User object
   * @param {string} holonId - Holon context
   */
  async ensureUserProfile(user, holonId) {
    return coreEnsureUserProfile(this.db, user, holonId);
  }

  /**
   * Get user info with computed aggregates from REA events
   * This merges profile data with computed action counts
   * @param {Object} user - User object
   * @param {string} holonId - Holon context
   * @returns {Promise<Object>} User info with aggregates
   */
  async getUserInfo(user, holonId) {
    if (user?.is_bot) {
      return null;
    }

    // Ensure holonId is a string (required by holosphere)
    const holonIdStr = String(holonId);

    // Get profile data
    const profile = await this.getUserProfile(user, holonIdStr);

    // Get computed aggregates from REA events
    const aggregates = await this.aggregator.getUserAggregates(holonIdStr, user.id);

    // Merge profile with aggregates for backward compatibility
    return {
      ...profile,
      // Legacy field names mapped from aggregates
      initiated: Array(aggregates.initiated).fill(''),  // Array for .length compatibility
      completed: Array(aggregates.completed).fill(''),
      sent: aggregates.sent,
      received: aggregates.received,
      hours: aggregates.hours,
      collaboration: aggregates.collaboration,
      wants: Array(aggregates.wants).fill(''),
      offers: Array(aggregates.offers).fill(''),
      // Actions array can be fetched from event store if needed
      actions: []
    };
  }

  /**
   * Get detailed user activity history
   * @param {string} holonId - Holon context
   * @param {string} userId - User ID
   * @param {number} [limit] - Optional limit
   * @returns {Promise<Array>} Activity events
   */
  async getUserActivityHistory(holonId, userId, limit = null) {
    return this.aggregator.getUserActivityHistory(holonId, userId, limit);
  }

  /**
   * Get user score based on value equation
   * @param {string} holonId - Holon context
   * @param {string} userId - User ID
   * @param {Object} equation - Value equation weights
   * @returns {Promise<number>}
   */
  async getUserScore(holonId, userId, equation) {
    return this.aggregator.calculateUserScore(holonId, userId, equation);
  }

  /**
   * Get all user scores for a holon
   * @param {string} holonId - Holon context
   * @param {Object} equation - Value equation weights
   * @returns {Promise<Array>} Sorted array of {user, score, aggregates}
   */
  async getAllUserScores(holonId, equation) {
    const users = await this.getUsers(holonId);
    return this.aggregator.getAllUserScores(holonId, users, equation);
  }
}

export default Users;
