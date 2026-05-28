/**
 * Pure scoring functions: compute user scores, breakdowns, and per-action
 * deltas from aggregates and a value equation.
 *
 * Score formula:
 *   score = aggregates.initiated     * equation.initiated
 *         + aggregates.completed     * equation.completed
 *         + aggregates.sent          * equation.sent
 *         + aggregates.received      * equation.received
 *         + aggregates.collaboration * equation.collaboration
 *         + Σ currencyBalances[c]    * equation.currencies[c]
 *
 * Hours: when `equation.currencies.hour` is set, the hour contribution comes
 * from `currencyBalances.hour` (or, if missing, falls back to
 * `aggregates.hours`). When `currencies.hour` is unset but the legacy
 * `equation.hours` is, scoring falls back to `aggregates.hours *
 * equation.hours`. Both paths produce the same result for migrated holons.
 */

import { DEFAULT_EQUATION, type ScoreEquation } from './equation.js';
import { toAggregates, ZERO_USER_AGGREGATES, type UserAggregates } from './aggregator.js';

export interface ScoreBreakdown {
  initiated: number;
  completed: number;
  sent: number;
  received: number;
  /** @deprecated Use `currencies.hour` (or read `breakdown.currencies['hour']`). */
  hours: number;
  collaboration: number;
  /** Collaboration-signal contributions: aggregate × weight. */
  participation: number;
  coParticipants: number;
  activity: number;
  groupSize: number;
  variance: number;
  /** Per-currency contribution: balance × weight. */
  currencies: Record<string, number>;
  total: number;
}

export interface ActionScore {
  type:
    | 'initiated'
    | 'completed'
    | 'sent'
    | 'received'
    | 'hours'
    | 'collaboration';
  points: number;
  description: string;
}

/**
 * Resolve the effective per-currency balances for scoring, applying the
 * `aggregates.hours → currencyBalances.hour` fallback when the caller hasn't
 * supplied an explicit hour balance. Used by every scoring helper so the
 * fallback rule lives in one place.
 */
function resolveCurrencyBalances(
  aggregates: UserAggregates,
  equation: ScoreEquation,
  currencyBalances: Record<string, number>,
): Record<string, number> {
  const balances = { ...currencyBalances };
  if (
    balances.hour === undefined &&
    aggregates.hours &&
    (equation.currencies?.hour ?? 0) > 0
  ) {
    balances.hour = aggregates.hours;
  }
  return balances;
}

/**
 * Calculate a user's total score from aggregates using the supplied equation.
 *
 * `currencyBalances` (optional) maps currency code → balance for the user.
 * If `currencies.hour` is set but `currencyBalances.hour` isn't, the score
 * falls back to `aggregates.hours` so legacy callers that don't thread
 * balances yet keep working.
 */
export function calculateUserScore(
  aggregates: UserAggregates,
  equation: ScoreEquation = DEFAULT_EQUATION,
  currencyBalances: Record<string, number> = {},
): number {
  let score = 0;

  if (equation.initiated) score += aggregates.initiated * equation.initiated;
  if (equation.completed) score += aggregates.completed * equation.completed;
  if (equation.sent) score += aggregates.sent * equation.sent;
  if (equation.received) score += aggregates.received * equation.received;
  if (equation.collaboration) score += aggregates.collaboration * equation.collaboration;
  if (equation.participation)   score += (aggregates.participation   ?? 0) * equation.participation;
  if (equation.coParticipants)  score += (aggregates.coParticipants  ?? 0) * equation.coParticipants;
  if (equation.activity)        score += (aggregates.activity        ?? 0) * equation.activity;
  if (equation.groupSize)       score += (aggregates.groupSize       ?? 0) * equation.groupSize;
  if (equation.variance)        score += (aggregates.variance        ?? 0) * equation.variance;

  const hourCurrencyWeight = equation.currencies?.hour ?? 0;
  // Legacy path: if no currencies.hour weight is set, score hours via
  // equation.hours so unmigrated holons keep working.
  if (!hourCurrencyWeight && equation.hours) {
    score += aggregates.hours * equation.hours;
  }

  const balances = resolveCurrencyBalances(aggregates, equation, currencyBalances);
  for (const [currency, weight] of Object.entries(equation.currencies ?? {})) {
    if (!weight) continue;
    score += (balances[currency] ?? 0) * weight;
  }

  return score;
}

/**
 * Calculate a score directly from raw user data (convenience wrapper).
 */
export function calculateScoreFromUserData(
  userData: any,
  equation: ScoreEquation = DEFAULT_EQUATION,
  currencyBalances: Record<string, number> = {},
): number {
  return calculateUserScore(toAggregates(userData), equation, currencyBalances);
}

/**
 * Get a detailed breakdown of scores by category.
 *
 * The `hours` field is kept for backwards-compat: it equals
 * `currencies.hour` when the equation has migrated, otherwise
 * `aggregates.hours * equation.hours`.
 */
export function getScoreBreakdown(
  aggregates: UserAggregates,
  equation: ScoreEquation = DEFAULT_EQUATION,
  currencyBalances: Record<string, number> = {},
): ScoreBreakdown {
  const hourCurrencyWeight = equation.currencies?.hour ?? 0;
  const balances = resolveCurrencyBalances(aggregates, equation, currencyBalances);

  const currencies: Record<string, number> = {};
  for (const [currency, weight] of Object.entries(equation.currencies ?? {})) {
    if (!weight) continue;
    const contribution = (balances[currency] ?? 0) * weight;
    if (contribution !== 0) currencies[currency] = contribution;
  }

  const legacyHours = !hourCurrencyWeight && equation.hours
    ? aggregates.hours * equation.hours
    : 0;
  const hours = legacyHours + (currencies.hour ?? 0);

  const breakdown: ScoreBreakdown = {
    initiated: aggregates.initiated * (equation.initiated ?? 0),
    completed: aggregates.completed * (equation.completed ?? 0),
    sent: aggregates.sent * (equation.sent ?? 0),
    received: aggregates.received * (equation.received ?? 0),
    hours,
    collaboration: aggregates.collaboration * (equation.collaboration ?? 0),
    participation:  (aggregates.participation  ?? 0) * (equation.participation  ?? 0),
    coParticipants: (aggregates.coParticipants ?? 0) * (equation.coParticipants ?? 0),
    activity:       (aggregates.activity       ?? 0) * (equation.activity       ?? 0),
    groupSize:      (aggregates.groupSize      ?? 0) * (equation.groupSize      ?? 0),
    variance:       (aggregates.variance       ?? 0) * (equation.variance       ?? 0),
    currencies,
    total: 0,
  };

  breakdown.total =
    breakdown.initiated +
    breakdown.completed +
    breakdown.sent +
    breakdown.received +
    legacyHours +
    breakdown.collaboration +
    breakdown.participation +
    breakdown.coParticipants +
    breakdown.activity +
    breakdown.groupSize +
    breakdown.variance +
    Object.values(currencies).reduce((s, v) => s + v, 0);

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
    case 'hours': {
      // Prefer currencies.hour (post-migration); fall back to legacy hours.
      const hourWeight = equation.currencies?.hour ?? equation.hours ?? 0;
      return {
        type: 'hours',
        points: amount * hourWeight,
        description: `+${(amount * hourWeight).toFixed(2)} for ${amount.toFixed(2)} hours`,
      };
    }
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
 * Normalize a set of (possibly negative) scores into percentage shares.
 *
 * Single source of truth for "what slice of the pie does each member get" —
 * used by the web leaderboard (Status), the flow/contract distribution
 * (FlowManagement → on-chain splitter), and the MCP scoring tools, so every
 * surface splits the pie identically.
 *
 * Algorithm: shift every score by `min(0, lowest)` so the distribution is
 * non-negative, then divide by the shifted total. The shift only kicks in
 * when something is negative — when every score is ≥ 0 this reduces to plain
 * proportional `score / Σscore`. When the shift leaves a member at 0 weight
 * (some score ≤ 0), lift every weight by a small uniform floor so that
 * member still gets a positive slice. This is the only transform that gives
 * all four properties at once:
 *   1. monotonic — a higher score is always a higher share, so a member in
 *      debt can never outrank one who isn't. (Raw `score/Σscore` breaks when
 *      the value equation weights signed currency balances and Σscore ≈ 0,
 *      making the percentage explode; using `|score|` breaks monotonicity by
 *      inflating large debtors.)
 *   2. strictly positive — every share is > 0, so a pie always renders and
 *      the on-chain splitter allocates a positive slice to every member (a
 *      0 share would exclude them; a negative one is invalid).
 *   3. sums to 100% — including members in debt, who get a small share rather
 *      than a negative or oversized one.
 *   4. proportional when there's no debt — if every score is ≥ 0 the floor
 *      never engages, so the result is exactly `score / Σscore`.
 *
 * The floor is `FLOOR_RATIO` of the mean weight, added uniformly and then
 * renormalized — uniform addition preserves ordering (monotonic) and keeps
 * the sum at 100%. Degenerate inputs: an empty list yields `[]`; a list whose
 * shifted weights are all 0 (every score equal) splits the pie evenly.
 *
 * Returns shares in the same order as the input.
 */
const FLOOR_RATIO = 0.05;

export function normalizeShares(scores: number[]): number[] {
  const n = scores.length;
  if (n === 0) return [];
  const offset = Math.min(0, ...scores);
  const weights = scores.map((v) => v - offset); // ≥ 0; unchanged when all ≥ 0
  const shiftedTotal = weights.reduce((sum, w) => sum + w, 0);

  // Strictly-positive floor: a member sits at exactly 0 weight only when some
  // score ≤ 0. Lift everyone by a small uniform pseudo-weight so that member
  // gets a positive slice. All-positive inputs have no 0 weight → no floor →
  // exactly proportional.
  if (weights.some((w) => w === 0)) {
    const floor = shiftedTotal > 0 ? (shiftedTotal / n) * FLOOR_RATIO : 1;
    for (let i = 0; i < n; i++) weights[i] += floor;
  }

  const total = weights.reduce((sum, w) => sum + w, 0);
  return weights.map((w) => (w / total) * 100);
}

/**
 * Calculate all user scores and percentages for a holon.
 *
 * `currencyBalances` (optional) is keyed by userId, then by currency code.
 * Callers that already track balances per user can pass them through; absent
 * entries fall back to the `aggregates.hours` shim for the hour currency.
 */
export function calculateAllUserScores(
  users: any[],
  equation: ScoreEquation = DEFAULT_EQUATION,
  currencyBalances: Record<string, Record<string, number>> = {},
): Array<{
  userId: string;
  username: string;
  score: number;
  percentage: number;
  aggregates: UserAggregates;
}> {
  const usersWithScores = users.map((user) => {
    const aggregates = toAggregates(user);
    const userId = String(user.id);
    return {
      userId,
      username: user.username || userId,
      score: calculateUserScore(aggregates, equation, currencyBalances[userId] ?? {}),
      percentage: 0,
      aggregates,
    };
  });

  const shares = normalizeShares(usersWithScores.map((u) => u.score));

  return usersWithScores.map((u, i) => ({
    ...u,
    percentage: shares[i],
  }));
}

// ===========================================================================
// Holon scores + shares — THE single pipeline every surface uses.
//
// Web (Status leaderboard, Flow distribution) and the Telegram bot all derive
// per-user scores and pie shares from this code, so the numbers are identical
// everywhere. Each surface used to carry its own fetch/score/normalize glue
// and drifted; this consolidates it. Inputs always come from the REA event
// stream (aggregates + currency balances), so there is one source of truth.
// ===========================================================================

/** Minimal REA aggregator surface used to pull a user's scoring inputs.
 *  Structural (not a class import) to avoid a score.ts ↔ aggregator.ts cycle. */
export interface ScoringAggregator {
  getUserAggregates(holonId: string, userId: string): Promise<UserAggregates>;
  getCurrencyBalance(holonId: string, userId: string, currency: string): Promise<number>;
}

/** A user's REA-sourced scoring inputs: aggregates + money balances. */
export interface HolonUserData {
  userId: string;
  aggregates: UserAggregates;
  /** Money-currency balances (code → balance). `hour` is omitted — the scorer
   *  derives it from `aggregates.hours`. */
  balances: Record<string, number>;
}

/** A scored user: inputs + breakdown + score + normalized share (0–100). */
export interface ScoredHolonUser extends HolonUserData {
  breakdown: ScoreBreakdown;
  score: number;
  percentage: number;
}

/**
 * Async: pull each user's scoring inputs from the REA store — aggregates plus
 * the balance of every code in `currencyCodes` (money; `hour` is skipped, the
 * scorer derives it from aggregates.hours).
 *
 * Kept separate from {@link scoreHolonUsers} so UIs with a live equation
 * editor can re-score (pure, sync) without re-fetching on every weight tweak.
 */
export async function loadHolonUserData(
  aggregator: ScoringAggregator,
  holonId: string | number,
  users: Array<{ id: string | number }>,
  currencyCodes: string[] = [],
): Promise<HolonUserData[]> {
  const hid = String(holonId);
  const money = currencyCodes.filter((c) => c && c !== 'hour');
  return Promise.all(
    users.map(async (u) => {
      const userId = String(u.id);
      let aggregates: UserAggregates;
      try {
        aggregates = await aggregator.getUserAggregates(hid, userId);
      } catch {
        aggregates = { ...ZERO_USER_AGGREGATES };
      }
      const balances: Record<string, number> = {};
      await Promise.all(
        money.map(async (c) => {
          try {
            balances[c] = await aggregator.getCurrencyBalance(hid, userId, c);
          } catch {
            balances[c] = 0;
          }
        }),
      );
      return { userId, aggregates, balances };
    }),
  );
}

/**
 * Pure: score every loaded user under `equation` and assign normalized shares
 * (monotonic, strictly positive, summing to 100 — see {@link normalizeShares}).
 * This is the one place "scores + shares for a holon" is computed; results are
 * returned in the same order as `loaded`.
 */
export function scoreHolonUsers(
  loaded: HolonUserData[],
  equation: ScoreEquation = DEFAULT_EQUATION,
): ScoredHolonUser[] {
  const scored = loaded.map((d) => {
    const breakdown = getScoreBreakdown(d.aggregates, equation, d.balances);
    return { ...d, breakdown, score: breakdown.total, percentage: 0 };
  });
  const shares = normalizeShares(scored.map((s) => s.score));
  scored.forEach((s, i) => {
    s.percentage = shares[i];
  });
  return scored;
}

/**
 * Convenience: {@link loadHolonUserData} + {@link scoreHolonUsers} in one call.
 * For surfaces with no live equation editing (the bot). Balances are pulled
 * for every currency the equation weights.
 */
export async function computeHolonUserScores(
  aggregator: ScoringAggregator,
  holonId: string | number,
  users: Array<{ id: string | number }>,
  equation: ScoreEquation = DEFAULT_EQUATION,
): Promise<ScoredHolonUser[]> {
  const codes = Object.keys(equation.currencies ?? {});
  const loaded = await loadHolonUserData(aggregator, holonId, users, codes);
  return scoreHolonUsers(loaded, equation);
}
