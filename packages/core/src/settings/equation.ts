// Equation persistence (loadEquation / subscribeToEquationChanges).
//
// Per Phase B unit boundaries, the value-equation loader and subscriber
// are owned by `core/scoring` (Unit 1) — they sit beside `ScoreEquation`
// and `DEFAULT_EQUATION` in `apps/web/src/lib/scoring/ContributionScoring.ts`
// and depend on the score type definitions.
//
// Once Unit 1 lands, it should populate this file (or have us re-export
// from `@holons/core/scoring` here) so that any consumer that prefers to
// reach for equation persistence from the settings barrel can do so.
//
// Until then this module intentionally exports nothing so callers fall
// back to the existing web-side functions.

export {};
