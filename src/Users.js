import { t } from "i18next";
import * as utils from './utilities.js';
import { Markup } from 'telegraf';
import { REAEventStore, REAEventFactory, REAAggregator } from './domain/rea/index.js';

class Users {
  constructor(bot, db) {
    this.bot = bot;
    this.db = db;

    // Initialize REA components
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
    let userinfo = await this.getUserInfo(ctx.message.from, ctx.message.chat.id)
    if (userinfo.username == undefined) {
      ctx.reply('Please set a username in your telegram settings to join the group.');
    }
    else {
      ctx.reply('🎉 Welcome ' + ctx.message.from.first_name + '! 🎉');
    }
  }

  async leave(ctx) {
    const holonId = ctx.message.chat.id;
    const user = ctx.message.from;
    await this.db.del(holonId + '/users', user.id)
    ctx.reply('Goodbye ' + user.first_name + '!');
  }


  async addValue(ctx) {
    const holonId = ctx.message.chat.id;
    const user = ctx.message.from;
    const values = utils.parseList(ctx.message.text);
    if (!values) {
      ctx.reply('Please specify a value or list of values to add. eg: /value freedom, non-violence');
      return;
    }

    let userinfo = await this.getUserProfile(user, holonId)
    if (!userinfo.values) userinfo.values = []
    userinfo.values = Array.from(new Set(userinfo.values.concat(values)))

    await this.db.put(holonId + '/users', userinfo)
    ctx.reply(`Added ${values.join(', ')} to your values.`);
  }

  async addNeed(ctx) {
    const holonId = ctx.message.chat.id;
    const user = ctx.message.from;
    const needs = utils.parseList(ctx.message.text);
    if (!needs) {
      ctx.reply('Please specify a need or comma separated list of needs to add. eg: /need hugs, massages');
      return;
    }

    let userinfo = await this.getUserProfile(user, holonId)
    if (!userinfo.needs) userinfo.needs = []
    userinfo.needs = Array.from(new Set(userinfo.needs.concat(needs)))

    await this.db.put(holonId + '/users', userinfo)
    ctx.reply(`Added ${needs.join(', ')} to your needs.`);
  }



  async listUsersActions(ctx) {
    const holonId = ctx.message.chat.id;
    let users = await this.db.getAll(holonId + '/users')

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
    return this.db.getAll(holonId + '/users')
  }

  /**
   * Get user profile (without computed aggregates)
   * Use this for profile data updates
   * @param {Object} user - User object
   * @param {string} holonId - Holon context
   * @returns {Promise<Object>} User profile
   */
  async getUserProfile(user, holonId) {
    if (user?.is_bot) {
      return null;
    }

    let userinfo = await this.db.get(holonId + '/users', user.id)
    if (!userinfo || userinfo == '') {
      userinfo = {
        id: user.id,
        version: '0.3',  // REA version
        username: user.username ? user.username : user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        // Profile data only - no action counts (computed from events)
        values: [],
        needs: [],
        participated: {}
      }
      await this.db.put(holonId + '/users', userinfo)
    }
    return userinfo
  }

  /**
   * Ensure user profile exists
   * @param {Object} user - User object
   * @param {string} holonId - Holon context
   */
  async ensureUserProfile(user, holonId) {
    if (user?.is_bot) return;

    let userinfo = await this.db.get(holonId + '/users', user.id)
    if (!userinfo || userinfo == '') {
      await this.getUserProfile(user, holonId);
    }
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

    // Get profile data
    const profile = await this.getUserProfile(user, holonId);

    // Get computed aggregates from REA events
    const aggregates = await this.aggregator.getUserAggregates(holonId, user.id);

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
