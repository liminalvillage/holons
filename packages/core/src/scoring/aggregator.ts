/**
 * REA aggregator: derives user aggregates, currency balances, and reports
 * from the REA (Resource-Event-Agent) event stream.
 *
 * UI-agnostic: callers supply the event store (telegram-ui's REAEventStore,
 * or a future web-side store). All values are computed on-demand with no
 * mutable state.
 */

import { calculateUserScore } from './score.js';
import type { ScoreEquation } from './equation.js';

/**
 * User aggregates: counts of events/actions across the REA event stream.
 * Matches the shape produced by REAAggregator.getUserAggregates().
 */
export interface UserAggregates {
  /** Count of quests initiated. */
  initiated: number;
  /** Count of quests completed. */
  completed: number;
  /** Count of appreciations sent. */
  sent: number;
  /** Count of appreciations received. */
  received: number;
  /** Sum of hours logged. */
  hours: number;
  /** Count of time-logging events. */
  collaboration: number;
  /** Count of wants declared. */
  wants: number;
  /** Count of offers declared. */
  offers: number;
}

/** All-zero UserAggregates — useful default while REA queries are in flight. */
export const ZERO_USER_AGGREGATES: UserAggregates = {
  initiated: 0,
  completed: 0,
  sent: 0,
  received: 0,
  hours: 0,
  collaboration: 0,
  wants: 0,
  offers: 0,
};

/**
 * Convert raw user data (from web stores or REA events) into the canonical
 * UserAggregates shape. Handles both array-based (Dashboard) and count-based
 * (REA) inputs.
 */
export function toAggregates(userData: any): UserAggregates {
  return {
    initiated: Array.isArray(userData.initiated)
      ? userData.initiated.length
      : userData.initiated || 0,
    completed: Array.isArray(userData.completed)
      ? userData.completed.length
      : userData.completed || 0,
    sent: typeof userData.sent === 'number' ? userData.sent : 0,
    received: typeof userData.received === 'number' ? userData.received : 0,
    hours: typeof userData.hours === 'number' ? userData.hours : 0,
    collaboration:
      typeof userData.collaboration === 'number' ? userData.collaboration : 0,
    wants: Array.isArray(userData.wants)
      ? userData.wants.length
      : userData.wants || 0,
    offers: Array.isArray(userData.offers)
      ? userData.offers.length
      : userData.offers || 0,
  };
}

/**
 * Minimal interface for the event store the aggregator depends on.
 * Concrete implementations live in each UI (e.g. telegram-ui's REAEventStore).
 */
export interface REAEventStoreLike {
  query(holonId: string, filters?: any): Promise<any[]>;
  sumQuantity?(holonId: string, filters?: any): Promise<number>;
  getInTimeRange?(holonId: string, fromDate: number, toDate: number): Promise<any[]>;
  getItemEvents?(holonId: string, itemId: string): Promise<any[]>;
}

/**
 * REA Aggregator: computes user statistics, currency balances, and
 * leaderboard scores from the REA event stream.
 */
export class REAAggregator {
  eventStore: REAEventStoreLike;

  constructor(eventStore: REAEventStoreLike) {
    this.eventStore = eventStore;
  }

  /**
   * Get a user's aggregate statistics for scoring.
   */
  async getUserAggregates(holonId: string, userId: string): Promise<UserAggregates> {
    const events = await this.eventStore.query(holonId, { agentId: userId });
    const userIdStr = String(userId);

    return {
      initiated: events.filter(
        (e) => e.eventType === 'quest:initiated' && String(e.provider?.id) === userIdStr,
      ).length,

      completed: events.filter(
        (e) => e.eventType === 'quest:completed' && String(e.provider?.id) === userIdStr,
      ).length,

      sent: events.filter(
        (e) => e.eventType === 'appreciation:sent' && String(e.provider?.id) === userIdStr,
      ).length,

      received: events.filter(
        (e) => e.eventType === 'appreciation:received' && String(e.receiver?.id) === userIdStr,
      ).length,

      hours: events
        .filter(
          (e) =>
            e.eventType === 'quest:time_logged' && String(e.provider?.id) === userIdStr,
        )
        .reduce((sum, e) => sum + (e.resource?.quantity || 0), 0),

      collaboration: events.filter(
        (e) => e.eventType === 'quest:time_logged' && String(e.provider?.id) === userIdStr,
      ).length,

      wants: events.filter(
        (e) => e.eventType === 'want:declared' && String(e.provider?.id) === userIdStr,
      ).length,

      offers: events.filter(
        (e) => e.eventType === 'offer:declared' && String(e.provider?.id) === userIdStr,
      ).length,
    };
  }

  /**
   * Get currency balance for a user.
   * Positive = owed to user; negative = user owes.
   */
  async getCurrencyBalance(
    holonId: string,
    userId: string,
    currency: string,
  ): Promise<number> {
    const events = await this.eventStore.query(holonId, { resourceType: 'money' });
    const currencyLower = currency.toLowerCase();
    const userIdStr = String(userId);

    const currencyEvents = events.filter(
      (e) => e.resource?.unit?.toLowerCase() === currencyLower,
    );

    let balance = 0;

    currencyEvents.forEach((e) => {
      const providerId = String(e.provider?.id);
      const receiverId = String(e.receiver?.id);

      if (e.eventType === 'expense:share') {
        if (providerId === userIdStr) balance += e.resource.quantity;
        if (receiverId === userIdStr) balance -= e.resource.quantity;
      } else if (e.eventType === 'expense:paid') {
        // Payer expenditure is tracked separately; no inter-user balance change.
      } else if (e.eventType === 'transfer:direct') {
        if (providerId === userIdStr) balance -= e.resource.quantity;
        if (receiverId === userIdStr) balance += e.resource.quantity;
      }
    });

    return balance;
  }

  /**
   * Get credit balance for the library system.
   */
  async getCreditBalance(
    holonId: string,
    userId: string,
    startingCredits: number = 10,
  ): Promise<number> {
    const events = await this.eventStore.query(holonId, { resourceType: 'credit' });
    const userIdStr = String(userId);

    let balance = startingCredits;

    events.forEach((e) => {
      const providerId = String(e.provider?.id);
      const receiverId = String(e.receiver?.id);

      if (receiverId === userIdStr) balance += e.resource?.quantity || 0;
      if (providerId === userIdStr) balance -= e.resource?.quantity || 0;
    });

    return balance;
  }

  /**
   * Build credit matrix for expense settlement.
   * Returns N×N matrix where matrix[i][j] = amount user i is owed by user j.
   */
  async buildCreditMatrix(
    holonId: string,
    currency: string,
    users: Array<{ id: string | number }>,
  ): Promise<number[][]> {
    const n = users.length;
    const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    const currencyLower = currency.toLowerCase();

    const events = await this.eventStore.query(holonId, {
      resourceType: 'money',
      eventType: 'expense:share',
    });

    const currencyEvents = events.filter(
      (e) => e.resource?.unit?.toLowerCase() === currencyLower,
    );

    currencyEvents.forEach((e) => {
      const providerIdx = users.findIndex((u) => String(u.id) === String(e.provider?.id));
      const receiverIdx = users.findIndex((u) => String(u.id) === String(e.receiver?.id));

      if (providerIdx !== -1 && receiverIdx !== -1 && providerIdx !== receiverIdx) {
        matrix[providerIdx][receiverIdx] += e.resource.quantity;
      }
    });

    return matrix;
  }

  /**
   * Get net balances for all users in a currency, sorted descending.
   */
  async getNetBalances(
    holonId: string,
    currency: string,
    users: Array<{ id: string | number }>,
  ): Promise<Array<{ user: any; balance: number }>> {
    const balances = await Promise.all(
      users.map(async (user) => ({
        user,
        balance: await this.getCurrencyBalance(holonId, String(user.id), currency),
      })),
    );

    return balances.sort((a, b) => b.balance - a.balance);
  }

  /**
   * Calculate a user's score by applying the value equation to their aggregates.
   * Includes optional currency weights from the equation.
   */
  async calculateUserScore(
    holonId: string,
    userId: string,
    equation: ScoreEquation,
  ): Promise<number> {
    const aggregates = await this.getUserAggregates(holonId, userId);
    let score = calculateUserScore(aggregates, equation);

    if (equation.currencies) {
      for (const [currency, weight] of Object.entries(equation.currencies)) {
        if (weight > 0) {
          const balance = await this.getCurrencyBalance(holonId, userId, currency);
          score += balance * weight;
        }
      }
    }

    return score;
  }

  /**
   * Get all user scores for a holon, sorted descending by score.
   */
  async getAllUserScores(
    holonId: string,
    users: Array<{ id: string | number }>,
    equation: ScoreEquation,
  ): Promise<Array<{ user: any; score: number; aggregates: UserAggregates }>> {
    const scores = await Promise.all(
      users.map(async (user) => {
        const aggregates = await this.getUserAggregates(holonId, String(user.id));
        const score = await this.calculateUserScore(holonId, String(user.id), equation);
        return { user, score, aggregates };
      }),
    );

    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Get total hours logged for a holon.
   */
  async getTotalHours(holonId: string): Promise<number> {
    if (!this.eventStore.sumQuantity) {
      throw new Error('eventStore does not support sumQuantity');
    }
    return this.eventStore.sumQuantity(holonId, { eventType: 'quest:time_logged' });
  }

  /**
   * Get total expenses for a holon in a currency.
   */
  async getTotalExpenses(holonId: string, currency: string): Promise<number> {
    const events = await this.eventStore.query(holonId, { eventType: 'expense:paid' });
    const currencyLower = currency.toLowerCase();
    return events
      .filter((e) => e.resource?.unit?.toLowerCase() === currencyLower)
      .reduce((sum, e) => sum + (e.resource?.quantity || 0), 0);
  }

  /**
   * Get activity summary for a time period.
   */
  async getActivitySummary(
    holonId: string,
    fromDate: number,
    toDate: number,
  ): Promise<{
    totalEvents: number;
    questsInitiated: number;
    questsCompleted: number;
    hoursLogged: number;
    appreciationsSent: number;
    expensesPaid: number;
    itemsBorrowed: number;
    itemsReturned: number;
  }> {
    if (!this.eventStore.getInTimeRange) {
      throw new Error('eventStore does not support getInTimeRange');
    }
    const events = await this.eventStore.getInTimeRange(holonId, fromDate, toDate);

    return {
      totalEvents: events.length,
      questsInitiated: events.filter((e) => e.eventType === 'quest:initiated').length,
      questsCompleted: events.filter((e) => e.eventType === 'quest:completed').length,
      hoursLogged: events
        .filter((e) => e.eventType === 'quest:time_logged')
        .reduce((sum, e) => sum + (e.resource?.quantity || 0), 0),
      appreciationsSent: events.filter((e) => e.eventType === 'appreciation:sent').length,
      expensesPaid: events
        .filter((e) => e.eventType === 'expense:paid')
        .reduce((sum, e) => sum + (e.resource?.quantity || 0), 0),
      itemsBorrowed: events.filter((e) => e.eventType === 'item:borrowed').length,
      itemsReturned: events.filter((e) => e.eventType === 'item:returned').length,
    };
  }

  /**
   * Get a user's activity history, sorted newest first.
   */
  async getUserActivityHistory(
    holonId: string,
    userId: string,
    limit: number | null = null,
  ): Promise<any[]> {
    const events = await this.eventStore.query(holonId, { agentId: userId });
    const sorted = events.sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Get a library item's lending history.
   */
  async getItemLendingHistory(holonId: string, itemId: string): Promise<any[]> {
    if (!this.eventStore.getItemEvents) {
      throw new Error('eventStore does not support getItemEvents');
    }
    const events = await this.eventStore.getItemEvents(holonId, itemId);
    return events
      .filter((e) => e.eventType === 'item:borrowed' || e.eventType === 'item:returned')
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get pending deposits (items not yet returned).
   */
  async getPendingDeposits(holonId: string): Promise<any[]> {
    return this.eventStore.query(holonId, {
      eventType: 'item:deposit_held',
      status: 'pending',
    });
  }
}

export default REAAggregator;
