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
  bookItem,
  borrowItem,
  type BookingContext,
  cancelBooking,
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
  updateBookingDates,
  type AddItemResult,
  type BookItemResult,
  type BorrowItemResult,
  type CancelBookingResult,
  type ReturnItemResult,
  type SetValueResult,
  type UpdateBookingResult
} from './operations.js';

export {
  actorDisplayName,
  actorMatchesBooking,
  dayKey,
  findOverlappingBooking,
  bookingOriginFor,
  bookingOriginLabel,
  getDisplayBookings,
  isBookingActive,
  isFederatedBooking,
  makeBooking,
  toDayKey,
  withBookings,
  ymd,
  type BookableItem,
  type Booking,
  type BookingOrigin
} from './bookings.js';

export {
  recordBorrowAccounting,
  recordReturnAccounting,
  type AccountingDeps,
  type REAEventFactoryLike,
  type REAEventStoreLike
} from './deposits.js';
