/**
 * @holons/core/library
 *
 * Shared community-library domain logic. Authoritative source for borrowing
 * and lending CRUD + deposit accounting, used by the Telegram bot today and
 * by future web/text/AI UIs.
 *
 * Subpath import:
 *   import { addItem, borrowItem, recordBorrowAccounting } from '@holons/core/library';
 */

export {
  LIBRARY_TYPES,
  type BorrowActor,
  type CreateLibraryItemOptions,
  type LibraryDB,
  type LibraryItem,
  type LibraryItemType,
  type LibraryStats
} from './types.js';

export {
  addItem,
  borrowItem,
  computeBorrowerInitials,
  createLibraryItem,
  detectItemType,
  filterItems,
  getItem,
  getItemDisplayTitle,
  getItemIcon,
  getLibraryStats,
  getTypeDisplayName,
  listItems,
  removeItem,
  returnItem,
  setItemValue,
  type AddItemResult,
  type BorrowItemResult,
  type ReturnItemResult,
  type SetValueResult
} from './operations.js';

export {
  recordBorrowAccounting,
  recordReturnAccounting,
  type AccountingDeps,
  type REAEventFactoryLike,
  type REAEventStoreLike
} from './deposits.js';
