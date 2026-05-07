/**
 * Pure scoring functions: compute user scores, breakdowns, and per-action
 * deltas from aggregates and a value equation.
 *
 * Score formula:
 *   score = aggregates.initiated * equation.initiated
 *         + aggregates.completed * equation.completed
 *         + aggregates.sent * equation.sent
 *         + aggregates.received * equation.received
 *         + aggregates.hours * equation.hours
 *         + aggregates.collaboration * equation.collaboration
 *         + aggregates.wants * equation.wants
 *         + aggregates.offers * equation.offers
 */

import { DEFAULT_EQUATION, type ScoreEquation } from './equation.js';
import { toAggregates, type UserAggregates } from './aggregator.js';

export interface ScoreBreakdown {
  initiated: number;
  completed: number;
  sent: number;
  received: number;
  hours: number;
  collaboration: number;
  wants: number;
  offers: number;
  total: number;
}

export interface ActionScore {
  type:
    | 'initiated'
    | 'completed'
    | 'sent'
    | 'received'
    | 'hours'
    | 'collaboration'
    | 'wants'
    | 'offers';
  points: number;
  description: string;
}

/**
 * Calculate a user's total score from aggregates using the supplied equation.
 */
export function calculateUserScore(
  aggregates: UserAggregates,
  equation: ScoreEquation = DEFAULT_EQUATION,
): number {
  let score = 0;

  if (equation.initiated) score += aggregates.initiated * equation.initiated;
  if (equation.completed) score += aggregates.completed * equation.completed;
  if (equation.sent) score += aggregates.sent * equation.sent;
  if (equation.received) score += aggregates.received * equation.received;
  if (equation.hours) score += aggregates.hours * equation.hours;
  if (equation.collaboration) score += aggregates.collaboration * equation.collaboration;
  if (equation.wants) score += aggregates.wants * equation.wants;
  if (equation.offers) score += aggregates.offers * equation.offers;

  return score;
}

/**
 * Calculate a score directly from raw user data (convenience wrapper).
 */
export function calculateScoreFromUserData(
  userData: any,
  equation: ScoreEquation = DEFAULT_EQUATION,
): number {
  return calculateUserScore(toAggregates(userData), equation);
}

/**
 * Get a detailed breakdown of scores by category.
 */
export function getScoreBreakdown(
  aggregates: UserAggregates,
  equation: ScoreEquation = DEFAULT_EQUATION,
): ScoreBreakdown {
  const breakdown = {
    initiated: aggregates.initiated * equation.initiated,
    completed: aggregates.completed * equation.completed,
    sent: aggregates.sent * equation.sent,
    received: aggregates.received * equation.received,
    hours: aggregates.hours * equation.hours,
    collaboration: aggregates.collaboration * equation.collaboration,
    wants: aggregates.wants * equation.wants,
    offers: aggregates.offers * equation.offers,
    total: 0,
  };

  breakdown.total =
    breakdown.initiated +
    breakdown.completed +
    breakdown.sent +
    breakdown.received +
    breakdown.hours +
    breakdown.collaboration +
    breakdown.wants +
    breakdown.offers;

  return breakdown;
}

/**
 * Calculate the score delta for a specific action.
 * Used when completing tasks/events to show the user what they earned.
 */
export function getActionScore(
  actionType: 'initiated' | 'completed' | 'joined' | 'hours' | 'sent' | 'received',
  amount: number = 1,
  equation: ScoreEquation = DEFAULT_EQUATION,
): ActionScore {
  switch (actionType) {
    case 'initiated':
      return {
        type: 'initiated',
        points: amount * equation.initiated,
        description: `+${amount * equation.initiated} for initiating`,
      };
    case 'completed':
      return {
        type: 'completed',
        points: amount * equation.completed,
        description: `+${amount * equation.completed} for completing`,
      };
    case 'joined':
      // Joining contributes to the collaboration count.
      return {
        type: 'collaboration',
        points: amount * equation.collaboration,
        description: `+${amount * equation.collaboration} for joining`,
      };
    case 'hours':
      return {
        type: 'hours',
        points: amount * equation.hours,
        description: `+${(amount * equation.hours).toFixed(2)} for ${amount.toFixed(2)} hours`,
      };
    case 'sent':
      return {
        type: 'sent',
        points: amount * equation.sent,
        description: `+${amount * equation.sent} for sending appreciation`,
      };
    case 'received':
      return {
        type: 'received',
        points: amount * equation.received,
        description: `+${amount * equation.received} for receiving appreciation`,
      };
    default:
      return {
        type: 'collaboration',
        points: 0,
        description: 'Unknown action',
      };
  }
}

/**
 * Calculate total contribution scores for task completion.
 * Returns the score earned by the initiator and each participant.
 */
export function calculateTaskCompletionScores(
  initiatorId: string | null,
  participantIds: string[],
  timeTracking: Record<string, number> = {},
  equation: ScoreEquation = DEFAULT_EQUATION,
): Map<string, { total: number; breakdown: ActionScore[] }> {
  const scores = new Map<string, { total: number; breakdown: ActionScore[] }>();

  // Initiator gets initiated points (1 event = equation.initiated points).
  if (initiatorId) {
    const initiatedScore = getActionScore('initiated', 1, equation);
    scores.set(initiatorId, {
      total: initiatedScore.points,
      breakdown: [initiatedScore],
    });
  }

  // Each participant gets:
  //  - completion points (1 completion = equation.completed points)
  //  - hours points if they tracked time (hours * equation.hours)
  //  - collaboration points (1 per time-logging event, only if hours > 0)
  for (const participantId of participantIds) {
    const existing = scores.get(participantId) || { total: 0, breakdown: [] };

    const completedScore = getActionScore('completed', 1, equation);
    existing.total += completedScore.points;
    existing.breakdown.push(completedScore);

    const hours = timeTracking[participantId] || 0;
    if (hours > 0) {
      const hoursScore = getActionScore('hours', hours, equation);
      existing.total += hoursScore.points;
      existing.breakdown.push(hoursScore);

      // Collaboration count: 1 per time:logged event
      // (matches Holonsbot REA behavior).
      const collabScore: ActionScore = {
        type: 'collaboration',
        points: equation.collaboration,
        description: `+${equation.collaboration} for collaboration`,
      };
      existing.total += collabScore.points;
      existing.breakdown.push(collabScore);
    }

    scores.set(participantId, existing);
  }

  return scores;
}

/**
 * Calculate percentage share of total score (used for flow distribution).
 */
export function calculatePercentageShare(
  userScore: number,
  totalScore: number,
): number {
  if (totalScore <= 0) return 0;
  return (userScore / totalScore) * 100;
}

/**
 * Calculate all user scores and percentages for a holon.
 */
export function calculateAllUserScores(
  users: any[],
  equation: ScoreEquation = DEFAULT_EQUATION,
): Array<{
  userId: string;
  username: string;
  score: number;
  percentage: number;
  aggregates: UserAggregates;
}> {
  const usersWithScores = users.map((user) => {
    const aggregates = toAggregates(user);
    return {
      userId: String(user.id),
      username: user.username || String(user.id),
      score: calculateUserScore(aggregates, equation),
      percentage: 0,
      aggregates,
    };
  });

  const totalScore = usersWithScores.reduce((sum, u) => sum + u.score, 0);

  return usersWithScores.map((u) => ({
    ...u,
    percentage: calculatePercentageShare(u.score, totalScore),
  }));
}
