/**
 * @fileoverview Telegram UI for user management.
 *
 * Domain logic is delegated to `@holons/core/users`. This module is
 * responsible only for Telegram command wiring, message rendering, and
 * adapting Telegraf context objects to/from the core service surface.
 *
 * @module src/Users
 */

import { Telegraf } from 'telegraf';
import * as utils from './utilities.js';
import { REAEventStore } from '@holons/core/rea';
import { REAAggregator } from '@holons/core/scoring';
import type { ScoreEquation } from '@holons/core/scoring';

// `@holons/core/users` ships function exports (getUserProfile, joinHolon, ...);
// the bot keeps a class-shaped service-locator pattern below for backwards
// compat with existing handlers, structurally typed against UsersServiceLike.

// ----------------------------------------------------------------------------
// Local types modelling the Telegraf surface we need. Kept narrow on purpose
// so we do not depend on @telegraf/types here (avoids TS2742 portability
// issues elsewhere in this package).
// ----------------------------------------------------------------------------

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_bot?: boolean;
}

interface TelegramMessage {
  from: TelegramUser;
  chat: { id: number | string };
  text: string;
}

interface TelegrafCtx {
  message: TelegramMessage;
  reply: (text: string) => Promise<unknown>;
}

/**
 * Minimal database surface used by the user service. Mirrors the holosphere
 * `DB` shape consumed elsewhere in this package.
 */
interface DB {
  get: (
    holonId: string,
    bucket: string,
    id: string | number,
  ) => Promise<unknown>;
  put: (holonId: string, bucket: string, value: unknown) => Promise<unknown>;
  getAll: (holonId: string, bucket: string) => Promise<any[]>;
  delete: (
    holonId: string,
    bucket: string,
    id: string | number,
  ) => Promise<unknown>;
}

interface UserProfile {
  id: number;
  version: string;
  username: string | number;
  first_name?: string;
  last_name?: string;
  values: string[];
  needs: string[];
  participated: Record<string, unknown>;
}

interface UserInfoWithAggregates extends UserProfile {
  initiated: string[];
  completed: string[];
  sent: number;
  received: number;
  hours: number;
  collaboration: unknown;
  wants: string[];
  offers: string[];
  actions: unknown[];
}

/** holosphere returns '' for missing keys; treat that and nullish as "no profile". */
function isUserProfile(v: unknown): v is UserProfile {
  return v !== null && typeof v === 'object' && 'id' in (v as object);
}

/**
 * Interface mirroring `@holons/core/users` UsersService. This is the surface
 * the Telegram UI delegates to; the implementation is currently inline in
 * `LocalUsersService` below until Unit 8 lands the canonical core module.
 */
interface UsersServiceLike {
  getEventStore(): REAEventStore;
  getAggregator(): REAAggregator;
  getUsers(holonId: string): Promise<any[]>;
  getUserProfile(
    user: TelegramUser,
    holonId: string,
  ): Promise<UserProfile | null>;
  ensureUserProfile(user: TelegramUser, holonId: string): Promise<void>;
  getUserInfo(
    user: TelegramUser,
    holonId: string | number,
  ): Promise<UserInfoWithAggregates | null>;
  addValueToProfile(
    user: TelegramUser,
    holonId: string,
    values: string[],
  ): Promise<UserProfile>;
  addNeedToProfile(
    user: TelegramUser,
    holonId: string,
    needs: string[],
  ): Promise<UserProfile>;
  removeUser(holonId: string, userId: string | number): Promise<void>;
  listUsersActions(holonId: string): Promise<string>;
  getUserActivityHistory(
    holonId: string,
    userId: string | number,
    limit?: number | null,
  ): Promise<unknown[]>;
  getUserScore(
    holonId: string,
    userId: string | number,
    equation: ScoreEquation,
  ): Promise<number>;
  getAllUserScores(
    holonId: string,
    equation: ScoreEquation,
  ): Promise<unknown[]>;
}

// ----------------------------------------------------------------------------
// Local implementation of the core users service. Intended to be replaced
// by `@holons/core/users` once Unit 8 lands. Keeping it here (rather than in
// Users.ts top-level) preserves the boundary the migration is establishing.
// ----------------------------------------------------------------------------

class LocalUsersService implements UsersServiceLike {
  private db: DB;
  private eventStore: REAEventStore;
  private aggregator: REAAggregator;

  constructor(db: DB) {
    this.db = db;
    // Bot's DB.get requires the id arg; core's HoloSphereLike.get treats it as
    // optional. They're runtime-compatible — cast at the boundary.
    this.eventStore = new REAEventStore(db as any);
    this.aggregator = new REAAggregator(this.eventStore);
  }

  getEventStore() {
    return this.eventStore;
  }

  getAggregator() {
    return this.aggregator;
  }

  async getUsers(holonId: string) {
    return this.db.getAll(holonId, 'users');
  }

  async getUserProfile(
    user: TelegramUser,
    holonId: string,
  ): Promise<UserProfile | null> {
    if (user?.is_bot) return null;
    if (!holonId) return null;

    const holonIdStr = String(holonId);
    const stored = await this.db.get(holonIdStr, 'users', user.id);
    if (isUserProfile(stored)) return stored;

    const userinfo: UserProfile = {
      id: user.id,
      version: '0.3', // REA version
      username: user.username ? user.username : user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      values: [],
      needs: [],
      participated: {},
    };
    await this.db.put(holonIdStr, 'users', userinfo);
    return userinfo;
  }

  async ensureUserProfile(user: TelegramUser, holonId: string) {
    if (user?.is_bot) return;
    if (!holonId) return;

    const stored = await this.db.get(holonId, 'users', user.id);
    if (!isUserProfile(stored)) {
      await this.getUserProfile(user, holonId);
    }
  }

  async getUserInfo(
    user: TelegramUser,
    holonId: string | number,
  ): Promise<UserInfoWithAggregates | null> {
    if (user?.is_bot) return null;

    const holonIdStr = String(holonId);
    const profile = await this.getUserProfile(user, holonIdStr);
    if (!profile) return null;

    const aggregates = (await this.aggregator.getUserAggregates(
      holonIdStr,
      String(user.id),
    )) as {
      initiated: number;
      completed: number;
      sent: number;
      received: number;
      hours: number;
      collaboration: unknown;
      wants: number;
      offers: number;
    };

    return {
      ...profile,
      initiated: Array(aggregates.initiated).fill(''),
      completed: Array(aggregates.completed).fill(''),
      sent: aggregates.sent,
      received: aggregates.received,
      hours: aggregates.hours,
      collaboration: aggregates.collaboration,
      wants: Array(aggregates.wants).fill(''),
      offers: Array(aggregates.offers).fill(''),
      actions: [],
    };
  }

  async addValueToProfile(
    user: TelegramUser,
    holonId: string,
    values: string[],
  ) {
    const userinfo = (await this.getUserProfile(user, holonId)) as UserProfile;
    if (!userinfo.values) userinfo.values = [];
    userinfo.values = Array.from(new Set(userinfo.values.concat(values)));
    await this.db.put(holonId, 'users', userinfo);
    return userinfo;
  }

  async addNeedToProfile(
    user: TelegramUser,
    holonId: string,
    needs: string[],
  ) {
    const userinfo = (await this.getUserProfile(user, holonId)) as UserProfile;
    if (!userinfo.needs) userinfo.needs = [];
    userinfo.needs = Array.from(new Set(userinfo.needs.concat(needs)));
    await this.db.put(holonId, 'users', userinfo);
    return userinfo;
  }

  async removeUser(holonId: string, userId: string | number) {
    await this.db.delete(holonId, 'users', userId);
  }

  async listUsersActions(holonId: string) {
    const users = await this.getUsers(holonId);
    let message = '';
    for (const user of users) {
      const aggregates = (await this.aggregator.getUserAggregates(
        holonId,
        String(user.id),
      )) as { completed: number };
      if (aggregates.completed > 0) {
        message += user.username + ': ' + aggregates.completed + ' completed\n';
      }
    }
    return message;
  }

  async getUserActivityHistory(
    holonId: string,
    userId: string | number,
    limit: number | null = null,
  ) {
    return this.aggregator.getUserActivityHistory(
      holonId,
      String(userId),
      limit as any,
    );
  }

  async getUserScore(
    holonId: string,
    userId: string | number,
    equation: ScoreEquation,
  ) {
    return this.aggregator.calculateUserScore(holonId, String(userId), equation);
  }

  async getAllUserScores(holonId: string, equation: ScoreEquation) {
    const users = await this.getUsers(holonId);
    return this.aggregator.getAllUserScores(holonId, users, equation);
  }
}

/**
 * Telegram UI for user management.
 *
 * Wires Telegram commands and adapts ctx into core-service calls. All
 * persistence and aggregation lives in the injected `UsersServiceLike`
 * implementation (currently `LocalUsersService`, eventually
 * `@holons/core/users`).
 */
class Users {
  bot: Telegraf;
  db: DB;
  /** Domain service. Type matches the future `@holons/core/users` API. */
  service: UsersServiceLike;

  constructor(bot: Telegraf, db: DB) {
    this.bot = bot;
    this.db = db;
    this.service = new LocalUsersService(db);

    this.bot.command(['value', 'ivalue'], (ctx) =>
      this.addValue(ctx as unknown as TelegrafCtx),
    );
    this.bot.command(['need', 'ineed', 'weneed'], (ctx) =>
      this.addNeed(ctx as unknown as TelegrafCtx),
    );
    this.bot.command('join', (ctx) =>
      this.join(ctx as unknown as TelegrafCtx),
    );
    this.bot.command('leave', (ctx) =>
      this.leave(ctx as unknown as TelegrafCtx),
    );
  }

  // ---- Pass-through delegators (preserve legacy public surface) ------------

  getEventStore() {
    return this.service.getEventStore();
  }

  getAggregator() {
    return this.service.getAggregator();
  }

  async getUsers(holonId: string) {
    return this.service.getUsers(holonId);
  }

  async getUserProfile(user: TelegramUser, holonId: string) {
    return this.service.getUserProfile(user, holonId);
  }

  async ensureUserProfile(user: TelegramUser, holonId: string) {
    return this.service.ensureUserProfile(user, holonId);
  }

  async getUserInfo(user: TelegramUser, holonId: string | number) {
    return this.service.getUserInfo(user, holonId);
  }

  async listUsersActions(holonId: string) {
    return this.service.listUsersActions(holonId);
  }

  async getUserActivityHistory(
    holonId: string,
    userId: string | number,
    limit: number | null = null,
  ) {
    return this.service.getUserActivityHistory(holonId, userId, limit);
  }

  async getUserScore(
    holonId: string,
    userId: string | number,
    equation: ScoreEquation,
  ) {
    return this.service.getUserScore(holonId, userId, equation);
  }

  async getAllUserScores(holonId: string, equation: ScoreEquation) {
    return this.service.getAllUserScores(holonId, equation);
  }

  // ---- Telegraf command handlers (UI-only) ---------------------------------

  async join(ctx: TelegrafCtx) {
    const userinfo = await this.service.getUserInfo(
      ctx.message.from,
      ctx.message.chat.id,
    );
    if (!userinfo || userinfo.username === undefined) {
      await ctx.reply(
        'Please set a username in your telegram settings to join the group.',
      );
    } else {
      await ctx.reply('🎉 Welcome ' + ctx.message.from.first_name + '! 🎉');
    }
  }

  async leave(ctx: TelegrafCtx) {
    const holonId = String(ctx.message.chat.id);
    const user = ctx.message.from;
    await this.service.removeUser(holonId, user.id);
    await ctx.reply('Goodbye ' + user.first_name + '!');
  }

  async addValue(ctx: TelegrafCtx) {
    const holonId = String(ctx.message.chat.id);
    const user = ctx.message.from;
    const values = utils.parseList(ctx.message.text);
    if (!values || values.length === 0) {
      await ctx.reply(
        'Please specify a value or list of values to add. eg: /value freedom, non-violence',
      );
      return;
    }
    await this.service.addValueToProfile(user, holonId, values);
    await ctx.reply(`Added ${values.join(', ')} to your values.`);
  }

  async addNeed(ctx: TelegrafCtx) {
    const holonId = String(ctx.message.chat.id);
    const user = ctx.message.from;
    const needs = utils.parseList(ctx.message.text);
    if (!needs || needs.length === 0) {
      await ctx.reply(
        'Please specify a need or comma separated list of needs to add. eg: /need hugs, massages',
      );
      return;
    }
    await this.service.addNeedToProfile(user, holonId, needs);
    await ctx.reply(`Added ${needs.join(', ')} to your needs.`);
  }
}

export default Users;
export type { UsersServiceLike };