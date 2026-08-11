/**
 * @holons/core/library — UI-agnostic CRUD + helpers for community library items.
 *
 * The bot's `Library.js` (Telegraf) and any future web UI both call these
 * helpers so that the storage shape stays consistent across surfaces.
 *
 * The DB parameter is anything matching `LibraryDB` (HoloSphere implements it).
 */

import {
  LIBRARY_TYPES,
  type BorrowActor,
  type CreateLibraryItemOptions,
  type LibraryDB,
  type LibraryItem,
  type LibraryItemType,
  type LibraryStats
} from './types.js';
import {
  actorMatchesBooking,
  computeBorrowerInitials,
  findOverlappingBooking,
  getDisplayBookings,
  isBookingActive,
  makeBooking,
  toDayKey,
  withBookings,
  ymd,
  type Booking
} from './bookings.js';

export { computeBorrowerInitials };

const LENS = 'library';

const TOOL_KEYWORDS = [
  'hammer',
  'drill',
  'saw',
  'screwdriver',
  'wrench',
  'pliers',
  'shovel',
  'rake',
  'axe',
  'knife'
];
const BOOK_KEYWORDS = ['book', 'manual', 'guide', 'novel', 'textbook'];
const EQUIPMENT_KEYWORDS = ['camera', 'projector', 'speaker', 'tent', 'bicycle', 'ladder'];
const ACCOMMODATION_KEYWORDS = ['room', 'cabin', 'apartment', 'dorm', 'bungalow', 'guesthouse'];

/** Detect a likely item category from its name. */
export function detectItemType(itemName: string): LibraryItemType {
  const name = itemName.toLowerCase();
  if (TOOL_KEYWORDS.some((k) => name.includes(k))) return LIBRARY_TYPES.TOOL;
  if (BOOK_KEYWORDS.some((k) => name.includes(k))) return LIBRARY_TYPES.BOOK;
  if (EQUIPMENT_KEYWORDS.some((k) => name.includes(k))) return LIBRARY_TYPES.EQUIPMENT;
  if (ACCOMMODATION_KEYWORDS.some((k) => name.includes(k))) return LIBRARY_TYPES.ACCOMMODATION;
  return LIBRARY_TYPES.OTHER;
}

/** Build a fully-populated `LibraryItem` ready to persist. */
export function createLibraryItem(
  id: string,
  type?: LibraryItemType | null,
  options: CreateLibraryItemOptions = {}
): LibraryItem {
  return {
    id,
    type: type || LIBRARY_TYPES.OTHER,
    borrowed: false,
    createdBy: options.createdBy,
    createdByUsername: options.createdByUsername,
    borrower: null,
    category: options.category || 'Uncategorized',
    description: options.description || '',
    value: options.value || 0,
    created: new Date().toISOString()
  };
}

/** Pick a display icon for an item (or string fallback). */
export function getItemIcon(item: { type?: string } | string): string {
  if (typeof item === 'string') return '📦';
  switch (item.type) {
    case LIBRARY_TYPES.TOOL:
      return '🔧';
    case LIBRARY_TYPES.BOOK:
      return '📚';
    case LIBRARY_TYPES.EQUIPMENT:
      return '⚙️';
    case LIBRARY_TYPES.ACCOMMODATION:
      return '🛏️';
    case LIBRARY_TYPES.OTHER:
    default:
      return '📦';
  }
}

/** Human-friendly type name, e.g. for stats listings. */
export function getTypeDisplayName(type?: string): string {
  switch (type) {
    case LIBRARY_TYPES.TOOL:
      return 'tool';
    case LIBRARY_TYPES.BOOK:
      return 'book';
    case LIBRARY_TYPES.EQUIPMENT:
      return 'equipment';
    case LIBRARY_TYPES.ACCOMMODATION:
      return 'accommodation';
    case LIBRARY_TYPES.OTHER:
      return 'item';
    default:
      // A custom (user-created) category displays as itself.
      return type && type.trim() ? type.trim() : 'item';
  }
}

/** Display title for an item or legacy string entry. */
export function getItemDisplayTitle(item: { id?: string } | string): string {
  if (typeof item === 'string') return item;
  return item.id ?? '';
}

// ============================================================================
// Read operations
// ============================================================================

/** Fetch a single item by id from a holon's library. Returns `null` if absent. */
export async function getItem(
  db: LibraryDB,
  holonId: string | number,
  itemId: string
): Promise<LibraryItem | null> {
  return (await db.get(String(holonId), LENS, itemId)) as LibraryItem | null;
}

/** List all library items for a holon, sorted by id. */
export async function listItems(db: LibraryDB, holonId: string | number): Promise<LibraryItem[]> {
  const list = ((await db.getAll(String(holonId), LENS)) || []) as LibraryItem[];
  list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return list;
}

/** Filter library items by free-text term (matches id and category, case-insensitive). */
export function filterItems(items: LibraryItem[], term: string): LibraryItem[] {
  const needle = (term || '').toLowerCase();
  if (!needle) return items;
  return items.filter(
    (item) =>
      String(item.id || '')
        .toLowerCase()
        .includes(needle) ||
      String(item.category || '')
        .toLowerCase()
        .includes(needle)
  );
}

/** Aggregate library stats (totals, byType, borrowed/available). */
export function getLibraryStats(items: LibraryItem[]): LibraryStats {
  const byType: Record<string, number> = {};
  for (const item of items) {
    const type = item.type || LIBRARY_TYPES.OTHER;
    byType[type] = (byType[type] || 0) + 1;
  }
  return {
    total: items.length,
    borrowed: items.filter((i) => i.borrowed).length,
    available: items.filter((i) => !i.borrowed).length,
    byType
  };
}

// ============================================================================
// Mutating operations — return outcomes so UIs can render appropriate messages
// ============================================================================

export interface AddItemResult {
  ok: boolean;
  item?: LibraryItem;
  reason?: 'already_exists';
}

/** Add a new library item if the id is not already taken. */
export async function addItem(
  db: LibraryDB,
  holonId: string | number,
  itemId: string,
  options: CreateLibraryItemOptions = {}
): Promise<AddItemResult> {
  const holon = String(holonId);
  if (await db.get(holon, LENS, itemId)) {
    return { ok: false, reason: 'already_exists' };
  }
  // Honor a caller-supplied type (e.g. a UI type picker); otherwise guess it
  // from the name.
  const type = options.type ?? detectItemType(itemId);
  const item = createLibraryItem(itemId, type, options);
  await db.put(holon, LENS, item);
  return { ok: true, item };
}

/** Delete a library item unconditionally. */
export async function removeItem(
  db: LibraryDB,
  holonId: string | number,
  itemId: string
): Promise<void> {
  await db.delete(String(holonId), LENS, itemId);
}

export interface SetValueResult {
  ok: boolean;
  item?: LibraryItem;
  reason?: 'not_found' | 'forbidden';
}

/** Update an item's credit value. Only the original owner may change it. */
export async function setItemValue(
  db: LibraryDB,
  holonId: string | number,
  itemId: string,
  value: number,
  requestingUserId: number | string
): Promise<SetValueResult> {
  const holon = String(holonId);
  const item = (await db.get(holon, LENS, itemId)) as LibraryItem | null;
  if (!item) return { ok: false, reason: 'not_found' };
  if (item.createdBy !== requestingUserId) return { ok: false, reason: 'forbidden' };
  item.value = Number.isFinite(value) ? value : 0;
  await db.put(holon, LENS, item);
  return { ok: true, item };
}

export interface BookItemResult {
  ok: boolean;
  item?: LibraryItem;
  /** The booking that was created or rescheduled. */
  booking?: Booking;
  /** True when the borrower is the item's owner (no credit charge applies). */
  isOwner?: boolean;
  /** The existing booking the requested range collides with. */
  conflict?: Booking;
  reason?: 'not_found' | 'overlaps' | 'invalid_range';
}

/**
 * Book an item for `borrower` over an inclusive [start, end] day range —
 * starting today when `start` is omitted. This is THE borrow primitive: it
 * appends to `bookings[]` (migrating a legacy single-borrow into the array on
 * the way) after checking the range against every existing booking, then
 * recomputes the legacy mirror fields via `withBookings`.
 *
 * Caller is responsible for any concurrency guarding (the bot uses an
 * in-memory lock around its calendar picker) and any expense/REA bookkeeping
 * (see `recordBorrowAccounting`).
 */
export async function bookItem(
  db: LibraryDB,
  holonId: string | number,
  itemId: string,
  borrower: BorrowActor,
  range: { start?: Date | string; end: Date | string }
): Promise<BookItemResult> {
  const holon = String(holonId);
  const item = (await db.get(holon, LENS, itemId)) as LibraryItem | null;
  if (!item) return { ok: false, reason: 'not_found' };

  const start = range.start ? toDayKey(range.start) : ymd(new Date());
  const end = toDayKey(range.end);
  if (end < start) return { ok: false, item, reason: 'invalid_range' };

  const conflict = findOverlappingBooking(item, start, end);
  if (conflict) return { ok: false, item, conflict, reason: 'overlaps' };

  const booking = makeBooking(borrower, start, end);
  const updated = withBookings(item, [...getDisplayBookings(item), booking]);
  await db.put(holon, LENS, updated);

  return { ok: true, item: updated, booking, isOwner: updated.createdBy === borrower.id };
}

export interface BorrowItemResult {
  ok: boolean;
  item?: LibraryItem;
  /** True when the borrower is the item's owner (no credit charge applies). */
  isOwner?: boolean;
  /** The booking created for this borrow (on success). */
  booking?: Booking;
  /** The existing booking that blocked the borrow (on `already_borrowed`/`overlaps`). */
  conflict?: Booking;
  /** `already_borrowed`: conflict covers today. `overlaps`: a future reservation. */
  reason?: 'not_found' | 'already_borrowed' | 'overlaps';
}

/**
 * Borrow an item starting today until `returnDate` — a `bookItem` wrapper
 * kept for callers that only collect a return date (bot calendar, kiosk
 * quick-borrow). Collisions with a booking active today report the familiar
 * `already_borrowed`; collisions with a future reservation report `overlaps`.
 */
export async function borrowItem(
  db: LibraryDB,
  holonId: string | number,
  itemId: string,
  borrower: BorrowActor,
  returnDate: Date | string
): Promise<BorrowItemResult> {
  const res = await bookItem(db, holonId, itemId, borrower, { end: returnDate });
  if (res.ok) {
    return { ok: true, item: res.item, isOwner: res.isOwner, booking: res.booking };
  }
  if (res.reason === 'not_found') return { ok: false, reason: 'not_found' };
  if (res.reason === 'overlaps' && res.conflict) {
    return {
      ok: false,
      item: res.item,
      conflict: res.conflict,
      reason: isBookingActive(res.conflict) ? 'already_borrowed' : 'overlaps'
    };
  }
  // invalid_range can only mean returnDate is before today.
  return { ok: false, item: res.item, reason: 'already_borrowed' };
}

export interface ReturnItemResult {
  ok: boolean;
  item?: LibraryItem;
  isOwner?: boolean;
  reason?: 'not_found' | 'not_borrowed' | 'forbidden';
}

/**
 * End the booking that covers today. Only its borrower (matched by id,
 * falling back to '@'-tolerant name comparison) may return. Future
 * reservations on the same item survive the return. The current item
 * snapshot is always returned (on success and on `not_borrowed`/`forbidden`)
 * so callers can render meaningful error messages without re-fetching.
 */
export async function returnItem(
  db: LibraryDB,
  holonId: string | number,
  itemId: string,
  returner: BorrowActor
): Promise<ReturnItemResult> {
  const holon = String(holonId);
  const item = (await db.get(holon, LENS, itemId)) as LibraryItem | null;
  if (!item) return { ok: false, reason: 'not_found' };

  const bookings = getDisplayBookings(item);
  const active = bookings.find((b) => isBookingActive(b)) ?? null;
  if (!active) return { ok: false, reason: 'not_borrowed', item };
  if (!actorMatchesBooking(active, returner)) return { ok: false, reason: 'forbidden', item };

  const isOwner = item.createdBy === returner.id;

  // Snapshot values (value, createdBy) survive untouched, so the caller can
  // hand the returned item straight to accounting helpers.
  const updated = withBookings(
    item,
    bookings.filter((b) => b.id !== active.id)
  );
  updated.returnedAt = new Date().toISOString();
  await db.put(holon, LENS, updated);

  return { ok: true, item: updated, isOwner };
}

export interface CancelBookingResult {
  ok: boolean;
  item?: LibraryItem;
  booking?: Booking;
  reason?: 'not_found' | 'no_such_booking' | 'forbidden';
}

/**
 * Remove a booking (typically a future reservation) by id. Only its borrower
 * may cancel. Cancelling the booking that covers today is equivalent to a
 * return — callers wanting refund bookkeeping use `recordReturnAccounting`
 * either way.
 */
export async function cancelBooking(
  db: LibraryDB,
  holonId: string | number,
  itemId: string,
  bookingId: string,
  actor: BorrowActor
): Promise<CancelBookingResult> {
  const holon = String(holonId);
  const item = (await db.get(holon, LENS, itemId)) as LibraryItem | null;
  if (!item) return { ok: false, reason: 'not_found' };

  const bookings = getDisplayBookings(item);
  const booking = bookings.find((b) => b.id === bookingId) ?? null;
  if (!booking) return { ok: false, item, reason: 'no_such_booking' };
  if (!actorMatchesBooking(booking, actor)) return { ok: false, item, reason: 'forbidden' };

  const updated = withBookings(
    item,
    bookings.filter((b) => b.id !== booking.id)
  );
  await db.put(holon, LENS, updated);

  return { ok: true, item: updated, booking };
}

export interface UpdateBookingResult {
  ok: boolean;
  item?: LibraryItem;
  booking?: Booking;
  conflict?: Booking;
  reason?: 'not_found' | 'no_such_booking' | 'forbidden' | 'overlaps' | 'invalid_range';
}

/**
 * Reschedule an existing booking to a new inclusive [start, end] range. Only
 * its borrower may edit; the new range is checked against every *other*
 * booking on the item.
 */
export async function updateBookingDates(
  db: LibraryDB,
  holonId: string | number,
  itemId: string,
  bookingId: string,
  range: { start: Date | string; end: Date | string },
  actor: BorrowActor
): Promise<UpdateBookingResult> {
  const holon = String(holonId);
  const item = (await db.get(holon, LENS, itemId)) as LibraryItem | null;
  if (!item) return { ok: false, reason: 'not_found' };

  const bookings = getDisplayBookings(item);
  const existing = bookings.find((b) => b.id === bookingId) ?? null;
  if (!existing) return { ok: false, item, reason: 'no_such_booking' };
  if (!actorMatchesBooking(existing, actor)) return { ok: false, item, reason: 'forbidden' };

  const start = toDayKey(range.start);
  const end = toDayKey(range.end);
  if (end < start) return { ok: false, item, reason: 'invalid_range' };

  const conflict = findOverlappingBooking(item, start, end, bookingId);
  if (conflict) return { ok: false, item, conflict, reason: 'overlaps' };

  const booking: Booking = { ...existing, start, end };
  const updated = withBookings(
    item,
    bookings.map((b) => (b.id === bookingId ? booking : b))
  );
  await db.put(holon, LENS, updated);

  return { ok: true, item: updated, booking };
}
