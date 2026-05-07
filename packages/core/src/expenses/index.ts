// Public surface for `@holons/core/expenses`.
//
// Authoritative source: packages/telegram-ui/src/Expenses.js (storage shape +
// balance accounting). Designed to be UI-agnostic so the web, telegram, text
// and AI UIs can share computation.
export * from './types.js';
export {
  calculateBalance,
  calculateCreditMatrix,
  coerceSplitWith,
  computeBalances,
  computeCreditMatrix,
  computeUserCurrencyBalance,
  normalizeCurrency,
} from './balance.js';
export {
  addParticipant,
  createExpense,
  removeParticipant,
  splitAmongAll,
  toggleParticipant,
} from './operations.js';
export type { CreateExpenseInput } from './operations.js';
