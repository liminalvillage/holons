/**
 * Shared contribution scoring service — thin re-export from @holons/core/scoring.
 *
 * The canonical implementation lives in `packages/core/src/scoring/`.
 * Both the web app and the telegram bot consume the same logic so user
 * scores match across UIs.
 *
 * This file is preserved as a re-export so existing relative imports inside
 * apps/web (e.g. `import ... from "../lib/scoring/ContributionScoring"`)
 * keep resolving without changes.
 */

export * from '@holons/core/scoring';
