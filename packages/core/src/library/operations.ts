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

/** Detect a likely item category from its name. */
export function detectItemType(itemName: string): LibraryItemType {
  const name = itemName.toLowerCase();
  if (TOOL_KEYWORDS.some((k) => name.includes(k))) return LIBRARY_TYPES.TOOL;
  if (BOOK_KEYWORDS.some((k) => name.includes(k))) return LIBRARY_TYPES.BOOK;
  if (EQUIPMENT_KEYWORDS.some((k) => name.includes(k))) return LIBRARY_TYPES.EQUIPMENT;
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
    case LIBRARY_TYPES.OTHER:
    default:
      return 'item';
  }
}

/** Display title for an item or legacy string entry. */
export function getItemDisplayTitle(item: { id?: string } | string): string {
  if (typeof item === 'string') return item;
  return item.id ?? '';
}

/** Compute borrower initials from first/last name with username fallback. */
export function computeBorrowerInitials(actor: BorrowActor): string {
  const firstInitial = actor.first_name ? actor.first_name.charAt(0).toUpperCase() : '';
  const lastInitial = actor.last_name ? actor.last_name.charAt(0).toUpperCase() : '';
  const initials = firstInitial + lastInitial;
  if (initials) return initials;
  if (actor.username) return actor.username.charAt(0).toUpperCase();
  return '?';
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
  const type = detectItemType(itemId);
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

export interface BorrowItemResult {
  ok: boolean;
  item?: LibraryItem;
  /** True when the borrower is the item's owner (no credit charge applies). */
  isOwner?: boolean;
  reason?: 'not_found' | 'already_borrowed';
}

/**
 * Mark an item as borrowed by `borrower`. Caller is responsible for any
 * concurrency guarding (the bot uses an in-memory lock around the calendar
 * picker) and any expense/REA bookkeeping (see `recordBorrowAccounting`).
 */
export async function borrowItem(
  db: LibraryDB,
  holonId: string | number,
  itemId: string,
  borrower: BorrowActor,
  returnDate: Date | string
): Promise<BorrowItemResult> {
  const holon = String(holonId);
  const item = (await db.get(holon, LENS, itemId)) as LibraryItem | null;
  if (!item) return { ok: false, reason: 'not_found' };
  if (item.borrowed) return { ok: false, reason: 'already_borrowed' };

  item.borrowed = true;
  item.borrower = borrower.username ?? null;
  item.borrowerId = borrower.id;
  item.borrowerInitials = computeBorrowerInitials(borrower);
  item.borrowedAt = new Date();
  item.returnBy = returnDate instanceof Date ? returnDate : new Date(returnDate);
  await db.put(holon, LENS, item);

  return { ok: true, item, isOwner: item.createdBy === borrower.id };
}

export interface ReturnItemResult {
  ok: boolean;
  item?: LibraryItem;
  isOwner?: boolean;
  reason?: 'not_found' | 'not_borrowed' | 'forbidden';
}

/**
 * Mark an item as returned by `returner`. Only the current borrower (matched
 * by id, falling back to username) may return. The current item snapshot is
 * always returned (on success and on `not_borrowed`/`forbidden`) so callers
 * can render meaningful error messages without re-fetching.
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
  if (!item.borrowed) return { ok: false, reason: 'not_borrowed', item };

  const isBorrower =
    item.borrowerId === returner.id || (returner.username && item.borrower === returner.username);
  if (!isBorrower) return { ok: false, reason: 'forbidden', item };

  const isOwner = item.createdBy === returner.id;

  // Snapshot pre-clear values (value, createdBy) survive untouched, so the
  // caller can hand the returned item straight to accounting helpers.
  item.borrowed = false;
  item.borrower = null;
  item.borrowerId = null;
  item.returnedAt = new Date();
  await db.put(holon, LENS, item);

  return { ok: true, item, isOwner };
}
