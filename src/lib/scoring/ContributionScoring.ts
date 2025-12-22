/**
 * Shared contribution scoring service
 *
 * This module provides consistent scoring logic for contributions across the app.
 * Uses the same calculation as Holonsbot REAAggregator.calculateUserScore()
 *
 * Score Formula:
 *   score = aggregates.initiated * equation.initiated
 *         + aggregates.completed * equation.completed
 *         + aggregates.sent * equation.sent
 *         + aggregates.received * equation.received
 *         + aggregates.hours * equation.hours
 *         + aggregates.collaboration * equation.collaboration
 *         + aggregates.wants * equation.wants
 *         + aggregates.offers * equation.offers
 */

export interface ScoreEquation {
  initiated: number;
  completed: number;
  sent: number;
  received: number;
  hours: number;
  collaboration: number;
  wants: number;
  offers: number;
}

/**
 * User aggregates - counts of events/actions
 * Matches Holonsbot REAAggregator.getUserAggregates() output
 */
export interface UserAggregates {
  initiated: number;    // Count of quests initiated
  completed: number;    // Count of quests completed
  sent: number;         // Count of appreciations sent
  received: number;     // Count of appreciations received
  hours: number;        // Sum of hours logged
  collaboration: number; // Count of time logging events
  wants: number;        // Count of wants declared
  offers: number;       // Count of offers declared
}

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
  type: 'initiated' | 'completed' | 'sent' | 'received' | 'hours' | 'collaboration' | 'wants' | 'offers';
  points: number;
  description: string;
}

/**
 * Default equation weights - same as Holonsbot
 */
export const DEFAULT_EQUATION: ScoreEquation = {
  initiated: 1,
  completed: 2,  // Completing is worth 2x more than initiating
  sent: 1,
  received: 1,
  hours: 1,
  collaboration: 1,
  wants: 1,
  offers: 1
};

/**
 * Convert user data to aggregates format
 * Handles both array-based (Dashboard) and count-based (REA) formats
 */
export function toAggregates(userData: any): UserAggregates {
  return {
    // Arrays: count length, Numbers: use directly
    initiated: Array.isArray(userData.initiated) ? userData.initiated.length : (userData.initiated || 0),
    completed: Array.isArray(userData.completed) ? userData.completed.length : (userData.completed || 0),
    sent: typeof userData.sent === 'number' ? userData.sent : 0,
    received: typeof userData.received === 'number' ? userData.received : 0,
    hours: typeof userData.hours === 'number' ? userData.hours : 0,
    collaboration: typeof userData.collaboration === 'number' ? userData.collaboration : 0,
    wants: Array.isArray(userData.wants) ? userData.wants.length : (userData.wants || 0),
    offers: Array.isArray(userData.offers) ? userData.offers.length : (userData.offers || 0)
  };
}

/**
 * Calculate user score from aggregates
 * Matches Holonsbot REAAggregator.calculateUserScore()
 */
export function calculateUserScore(
  aggregates: UserAggregates,
  equation: ScoreEquation = DEFAULT_EQUATION
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
 * Calculate score directly from user data (convenience wrapper)
 */
export function calculateScoreFromUserData(
  userData: any,
  equation: ScoreEquation = DEFAULT_EQUATION
): number {
  const aggregates = toAggregates(userData);
  return calculateUserScore(aggregates, equation);
}

/**
 * Get a detailed breakdown of scores by category
 */
export function getScoreBreakdown(
  aggregates: UserAggregates,
  equation: ScoreEquation = DEFAULT_EQUATION
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
    total: 0
  };

  breakdown.total = breakdown.initiated + breakdown.completed + breakdown.sent +
    breakdown.received + breakdown.hours + breakdown.collaboration +
    breakdown.wants + breakdown.offers;

  return breakdown;
}

/**
 * Calculate the score delta for a specific action
 * Used when completing tasks/events to show the user what they earned
 */
export function getActionScore(
  actionType: 'initiated' | 'completed' | 'joined' | 'hours' | 'sent' | 'received',
  amount: number = 1,
  equation: ScoreEquation = DEFAULT_EQUATION
): ActionScore {
  switch (actionType) {
    case 'initiated':
      return {
        type: 'initiated',
        points: amount * equation.initiated,
        description: `+${amount * equation.initiated} for initiating`
      };
    case 'completed':
      return {
        type: 'completed',
        points: amount * equation.completed,
        description: `+${amount * equation.completed} for completing`
      };
    case 'joined':
      // Joining adds to collaboration count
      return {
        type: 'collaboration',
        points: amount * equation.collaboration,
        description: `+${amount * equation.collaboration} for joining`
      };
    case 'hours':
      return {
        type: 'hours',
        points: amount * equation.hours,
        description: `+${(amount * equation.hours).toFixed(2)} for ${amount.toFixed(2)} hours`
      };
    case 'sent':
      return {
        type: 'sent',
        points: amount * equation.sent,
        description: `+${amount * equation.sent} for sending appreciation`
      };
    case 'received':
      return {
        type: 'received',
        points: amount * equation.received,
        description: `+${amount * equation.received} for receiving appreciation`
      };
    default:
      return {
        type: 'collaboration',
        points: 0,
        description: 'Unknown action'
      };
  }
}

/**
 * Calculate total contribution scores for task completion
 * Returns the score earned by the initiator and participants
 * Uses the same logic as Holonsbot
 */
export function calculateTaskCompletionScores(
  initiatorId: string | null,
  participantIds: string[],
  timeTracking: Record<string, number> = {},
  equation: ScoreEquation = DEFAULT_EQUATION
): Map<string, { total: number; breakdown: ActionScore[] }> {
  const scores = new Map<string, { total: number; breakdown: ActionScore[] }>();

  // Initiator gets initiated points (1 event = equation.initiated points)
  if (initiatorId) {
    const initiatedScore = getActionScore('initiated', 1, equation);
    scores.set(initiatorId, {
      total: initiatedScore.points,
      breakdown: [initiatedScore]
    });
  }

  // Each participant gets:
  // - completed points (1 completion = equation.completed points)
  // - hours points if tracked (hours * equation.hours)
  // - collaboration points (1 time log event = equation.collaboration, but only if hours > 0)
  for (const participantId of participantIds) {
    const existing = scores.get(participantId) || { total: 0, breakdown: [] };

    // Add completion score
    const completedScore = getActionScore('completed', 1, equation);
    existing.total += completedScore.points;
    existing.breakdown.push(completedScore);

    // Add hours score if they tracked time
    const hours = timeTracking[participantId] || 0;
    if (hours > 0) {
      // Hours contribution
      const hoursScore = getActionScore('hours', hours, equation);
      existing.total += hoursScore.points;
      existing.breakdown.push(hoursScore);

      // Collaboration count (1 per time logging event)
      // This matches Holonsbot: collaboration = count of quest:time_logged events
      const collabScore: ActionScore = {
        type: 'collaboration',
        points: equation.collaboration,
        description: `+${equation.collaboration} for collaboration`
      };
      existing.total += collabScore.points;
      existing.breakdown.push(collabScore);
    }

    scores.set(participantId, existing);
  }

  return scores;
}

// Per-holon equation cache for instant access
const equationCache = new Map<string, ScoreEquation>();
const equationSubscriptions = new Map<string, () => void>();

/**
 * Get cached equation synchronously (returns default if not cached)
 */
export function getCachedEquation(holonId: string): ScoreEquation {
  return equationCache.get(holonId) || { ...DEFAULT_EQUATION };
}

/**
 * Load equation from holosphere settings with caching
 * Returns cached value immediately, updates cache in background
 */
export async function loadEquation(
  holosphere: any,
  holonId: string
): Promise<ScoreEquation> {
  // Return cached immediately if available
  const cached = equationCache.get(holonId);
  if (cached) {
    // Refresh in background (fire and forget)
    refreshEquationCache(holosphere, holonId).catch(() => {});
    return cached;
  }

  // No cache - fetch and cache
  return refreshEquationCache(holosphere, holonId);
}

/**
 * Refresh equation cache from holosphere
 */
async function refreshEquationCache(
  holosphere: any,
  holonId: string
): Promise<ScoreEquation> {
  try {
    // Use get with specific key instead of getAll for faster lookup
    const settings = await holosphere.get(holonId, 'settings', holonId);
    if (settings?.equation) {
      const equation = { ...DEFAULT_EQUATION, ...settings.equation };
      equationCache.set(holonId, equation);
      return equation;
    }
  } catch (err) {
    // Silently use default
  }
  const defaultEq = { ...DEFAULT_EQUATION };
  equationCache.set(holonId, defaultEq);
  return defaultEq;
}

/**
 * Subscribe to settings changes to keep equation cache fresh
 * Call this once per holon (e.g., in layout or holon context)
 */
export function subscribeToEquationChanges(
  holosphere: any,
  holonId: string
): () => void {
  // Already subscribed?
  if (equationSubscriptions.has(holonId)) {
    return equationSubscriptions.get(holonId)!;
  }

  // Subscribe to settings changes
  const unsub = holosphere.subscribe(holonId, 'settings', (settings: any) => {
    if (settings?.equation) {
      equationCache.set(holonId, { ...DEFAULT_EQUATION, ...settings.equation });
    }
  });

  const unsubscribe = () => {
    if (unsub?.unsubscribe) unsub.unsubscribe();
    else if (typeof unsub === 'function') unsub();
    equationSubscriptions.delete(holonId);
  };

  equationSubscriptions.set(holonId, unsubscribe);
  return unsubscribe;
}

/**
 * Preload equation for a holon (call during app init or navigation)
 */
export async function preloadEquation(
  holosphere: any,
  holonId: string
): Promise<void> {
  await refreshEquationCache(holosphere, holonId);
}

/**
 * Calculate percentage share of total score
 * Used for flow distribution
 */
export function calculatePercentageShare(
  userScore: number,
  totalScore: number
): number {
  if (totalScore <= 0) return 0;
  return (userScore / totalScore) * 100;
}

/**
 * Calculate all user scores and percentages for a holon
 */
export function calculateAllUserScores(
  users: any[],
  equation: ScoreEquation = DEFAULT_EQUATION
): Array<{ userId: string; username: string; score: number; percentage: number; aggregates: UserAggregates }> {
  const usersWithScores = users.map(user => {
    const aggregates = toAggregates(user);
    return {
      userId: String(user.id),
      username: user.username || String(user.id),
      score: calculateUserScore(aggregates, equation),
      percentage: 0,
      aggregates
    };
  });

  const totalScore = usersWithScores.reduce((sum, u) => sum + u.score, 0);

  return usersWithScores.map(u => ({
    ...u,
    percentage: calculatePercentageShare(u.score, totalScore)
  }));
}
