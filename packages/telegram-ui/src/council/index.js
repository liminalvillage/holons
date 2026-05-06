/**
 * @fileoverview Bot-side council facade re-exports.
 *
 * Existing entry points:
 *  - `Council.js` (top-level): AI wisdom-generation — unrelated to proposal voting.
 *  - This module: thin facade over `@holons/core/council` for proposal/vote ops.
 *
 * @module src/council
 */

export * from './proposals.js';
