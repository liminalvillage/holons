/**
 * @holons/core/scoring — shared contribution-scoring logic.
 *
 * One source of truth for value equations, REA aggregation, and per-user
 * score computation. Used by all UIs (web, telegram, text, ai) so that
 * "compute user score" is consistent everywhere.
 */

export {
  DEFAULT_EQUATION,
  getCachedEquation,
  loadEquation,
  migrateEquation,
  parseCurrencyCodes,
  preloadEquation,
  saveEquation,
  subscribeToEquationChanges,
  type ScoreEquation,
} from './equation.js';

export {
  REAAggregator,
  extractReaUsers,
  toAggregates,
  ZERO_USER_AGGREGATES,
  type REAEventStoreLike,
  type ReaUser,
  type UserAggregates,
} from './aggregator.js';

export {
  calculateAllUserScores,
  calculateScoreFromUserData,
  calculateTaskCompletionScores,
  calculateUserScore,
  computeHolonUserScores,
  getActionScore,
  getScoreBreakdown,
  loadHolonUserData,
  normalizeShares,
  scoreHolonUsers,
  type ActionScore,
  type HolonUserData,
  type ScoreBreakdown,
  type ScoredHolonUser,
  type ScoringAggregator,
} from './score.js';
