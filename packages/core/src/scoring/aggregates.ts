/**
 * Canonical per-user REA aggregate shape plus its zero value and normalizer.
 *
 * Split out of aggregator.ts so score.ts can depend on it without importing
 * the aggregator (which itself imports score.ts) — that was an import cycle.
 */

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
  /**
   * Count of distinct quests this user has any event in. Quest is identified
   * by `context.questId`; events with no quest context don't contribute.
   */
  participation: number;
  /**
   * Count of distinct other agents the user has appeared alongside in any
   * quest's event stream (i.e. the size of their collaboration network).
   * Holon-typed and 'external' agents are excluded — only real users count.
   */
  coParticipants: number;
  /**
   * Total event count where the user is provider or receiver, regardless
   * of event type. Approximates raw activity volume.
   */
  activity: number;
  /**
   * Mean group size across quests the user participated in. Group size for
   * a quest = number of distinct real-agent participants in its event
   * stream. Solo quests contribute 1; pairs contribute 2; etc.
   */
  groupSize: number;
  /**
   * Population variance of group size across the user's quests. Higher =
   * the user works in differently-sized teams; zero = always the same
   * size (e.g. always solo, or always pairs).
   */
  variance: number;
}

/** All-zero UserAggregates — useful default while REA queries are in flight. */
export const ZERO_USER_AGGREGATES: UserAggregates = {
  initiated: 0,
  completed: 0,
  sent: 0,
  received: 0,
  hours: 0,
  collaboration: 0,
  participation: 0,
  coParticipants: 0,
  activity: 0,
  groupSize: 0,
  variance: 0,
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
    // Collaboration aggregates: legacy flat user records don't carry these,
    // so default to 0. The REAAggregator path produces them from events.
    participation:
      typeof userData.participation === 'number' ? userData.participation : 0,
    coParticipants:
      typeof userData.coParticipants === 'number' ? userData.coParticipants : 0,
    activity:
      typeof userData.activity === 'number' ? userData.activity : 0,
    groupSize:
      typeof userData.groupSize === 'number' ? userData.groupSize : 0,
    variance:
      typeof userData.variance === 'number' ? userData.variance : 0,
  };
}
