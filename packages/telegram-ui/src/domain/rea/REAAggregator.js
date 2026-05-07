/**
 * @fileoverview REA Aggregator — thin facade re-exporting @holons/core/scoring.
 * @module src/domain/rea/REAAggregator
 *
 * The canonical implementation lives in `packages/core/src/scoring/aggregator.ts`.
 * This facade is preserved so existing JS callers (Users.js, Library.js,
 * Expenses.js, domain/rea/index.js) keep importing from the original path
 * without modification.
 */

import { REAAggregator } from '@holons/core/scoring';

export { REAAggregator };
export default REAAggregator;
