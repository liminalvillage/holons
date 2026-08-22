/**
 * @holons/core/library — booking model shared by every surface (web, bot,
 * kiosk, MCP).
 *
 * Bookings live on library items as `bookings: Booking[]` with inclusive
 * YYYY-MM-DD day ranges. Items that only carry the legacy single-borrow
 * fields (`borrowed`/`borrower`/`returnBy`, written by older clients) get one
 * synthesized booking so old data keeps rendering; mutating an item through
 * `withBookings` migrates it to the array form while recomputing those legacy
 * fields from whichever booking covers today, so old readers stay consistent.
 *
 * Extracted from apps/web `$lib/util/libraryBookings.ts` — the web util is now
 * a facade over this module.
 */

import type { BorrowActor } from './types.js';

/**
 * The holon a booking was made FROM, when that isn't the holon owning the item.
 *
 * Federation lets someone book a partner's item without leaving their own
 * holon: the write is redirected to the owner (see `sourceRef`), so the owner
 * ends up holding a booking by a person who is not one of theirs, with nothing
 * to say where it came from. This records that link at the moment it is known.
 */
export interface BookingOrigin {
  /** Id of the holon the borrower acted from. */
  holon: string;
  /** Its display name, when resolved — for a chip that reads better than an id. */
  name?: string;
}

export interface Booking {
  id: string;
  start: string; // YYYY-MM-DD (or ISO; always read via dayKey), inclusive
  end: string; // YYYY-MM-DD, inclusive
  borrowerId: string;
  borrower: string; // display name, stored without a leading '@'
  borrowerInitials?: string | null;
  /** Canonical creation timestamp (ISO). */
  created: string;
  /**
   * Set only on a FEDERATED booking — the partner holon the borrower booked
   * from. Absent means the borrower acted inside the item's own holon, so
   * every booking made before this existed reads correctly as local.
   */
  viaHolon?: string;
  /** Display name for {@link Booking.viaHolon}, when it was resolvable. */
  viaHolonName?: string;
}

/**
 * Structural shape of anything bookings can be read from/written to. Kept
 * structural (not `LibraryItem`) so calendar overlays can pass loosely-typed
 * records.
 */
export interface BookableItem {
  id: string;
  bookings?: Booking[];
  borrowed?: boolean;
  borrower?: string | null;
  borrowerId?: number | string | null;
  borrowerInitials?: string | null;
  borrowedAt?: Date | string | null;
  returnBy?: Date | string | null;
  _deleted?: boolean;
  [key: string]: unknown;
}

/** Local-date YYYY-MM-DD key. */
export function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/** Normalize a stored date (bare day or full ISO) to its YYYY-MM-DD day. */
export function dayKey(s: string): string {
  return s.length > 10 ? s.slice(0, 10) : s;
}

export function isBookingActive(b: Booking, on: Date = new Date()): boolean {
  const today = ymd(on);
  return today >= dayKey(b.start) && today <= dayKey(b.end);
}

/**
 * Canonical list of bookings for an item, synthesizing one from the legacy
 * single-borrow fields when `bookings` is empty. Sorted by start date.
 */
export function getDisplayBookings(item: BookableItem): Booking[] {
  const list: Booking[] = Array.isArray(item.bookings) ? [...item.bookings] : [];
  if (list.length === 0 && item.borrowed && item.borrowedAt) {
    list.push({
      id: 'legacy',
      start: dayKey(String(item.borrowedAt)),
      end: item.returnBy ? dayKey(String(item.returnBy)) : dayKey(String(item.borrowedAt)),
      borrowerId: item.borrowerId != null ? String(item.borrowerId) : '',
      borrower: item.borrower || item.borrowerInitials || 'Unknown',
      borrowerInitials: item.borrowerInitials,
      created: String(item.borrowedAt)
    });
  }
  list.sort((a, b) => a.start.localeCompare(b.start));
  return list;
}

/**
 * First booking whose inclusive day range intersects [start, end], or `null`.
 * `ignoreBookingId` excludes a booking being rescheduled from its own check.
 */
export function findOverlappingBooking(
  item: BookableItem,
  start: string,
  end: string,
  ignoreBookingId?: string
): Booking | null {
  const from = dayKey(start);
  const to = dayKey(end);
  return (
    getDisplayBookings(item).find(
      (b) => b.id !== ignoreBookingId && dayKey(b.start) <= to && dayKey(b.end) >= from
    ) ?? null
  );
}

/**
 * Rebuild an item around a new bookings list, recomputing the legacy
 * single-borrow mirror fields from whichever booking (if any) covers today,
 * so readers of `borrowed`/`returnBy` that predate bookings stay consistent.
 */
export function withBookings<T extends BookableItem>(item: T, bookings: Booking[]): T {
  const active = bookings.find((b) => isBookingActive(b)) ?? null;
  return {
    ...item,
    bookings,
    borrowed: active !== null,
    borrower: active?.borrower ?? null,
    borrowerId: active?.borrowerId ?? null,
    borrowerInitials: active?.borrowerInitials ?? null,
    borrowedAt: active ? new Date(`${dayKey(active.start)}T00:00:00`).toISOString() : null,
    returnBy: active?.end ?? null
  };
}

/**
 * Display name an actor's bookings are stored under: username (no '@'),
 * falling back to first/last name, then the raw id. Surfaces that have a
 * richer name (e.g. a resolved holon name for a Nostr key) pass it via
 * `BorrowActor.display_name`.
 */
export function actorDisplayName(actor: BorrowActor): string {
  if (actor.display_name) return actor.display_name;
  if (actor.username) return actor.username.replace(/^@/, '');
  const name = [actor.first_name, actor.last_name].filter(Boolean).join(' ').trim();
  return name || String(actor.id);
}

/** Case- and '@'-insensitive handle comparison. */
function sameHandle(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase();
}

/**
 * Whether `actor` is the booking's borrower. Matches by id first; falls back
 * to the stored display name vs. the actor's username/display name, tolerant
 * of the '@' prefix older web clients wrote.
 */
export function actorMatchesBooking(booking: Booking, actor: BorrowActor): boolean {
  if (booking.borrowerId && String(booking.borrowerId) === String(actor.id)) return true;
  return (
    sameHandle(booking.borrower, actor.username) ||
    sameHandle(booking.borrower, actor.display_name)
  );
}

/** Compute borrower initials from first/last name with username fallback. */
export function computeBorrowerInitials(actor: BorrowActor): string {
  const firstInitial = actor.first_name ? actor.first_name.charAt(0).toUpperCase() : '';
  const lastInitial = actor.last_name ? actor.last_name.charAt(0).toUpperCase() : '';
  const initials = firstInitial + lastInitial;
  if (initials) return initials;
  if (actor.username) return actor.username.replace(/^@/, '').charAt(0).toUpperCase();
  if (actor.display_name) return actor.display_name.charAt(0).toUpperCase();
  return '?';
}

/** Build a booking for `actor` over the inclusive [start, end] day range. */
export function makeBooking(
  actor: BorrowActor,
  start: string,
  end: string,
  via?: BookingOrigin | null
): Booking {
  return {
    id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    start: dayKey(start),
    end: dayKey(end),
    borrowerId: String(actor.id),
    borrower: actorDisplayName(actor),
    borrowerInitials: computeBorrowerInitials(actor),
    created: new Date().toISOString(),
    // Omitted entirely for a local booking, so the stored shape is unchanged
    // for the overwhelmingly common case.
    ...(via?.holon ? { viaHolon: String(via.holon) } : {}),
    ...(via?.holon && via.name ? { viaHolonName: via.name } : {})
  };
}

/**
 * The origin to stamp on a booking of `ownerHolon`'s item by an actor working
 * in `actingHolon` — or `null` when they are the same holon (a local booking,
 * which carries no origin).
 *
 * Core owns this comparison so no surface has to decide for itself what counts
 * as "federated": every UI just reports the holon it is showing.
 */
export function bookingOriginFor(
  ownerHolon: string | number,
  actingHolon?: string | number | null,
  actingHolonName?: string | null
): BookingOrigin | null {
  if (actingHolon == null || actingHolon === '') return null;
  if (String(actingHolon) === String(ownerHolon)) return null;
  return {
    holon: String(actingHolon),
    ...(actingHolonName ? { name: actingHolonName } : {})
  };
}

/** True when the booking was made from another holon through federation. */
export function isFederatedBooking(b: Booking | null | undefined): boolean {
  return !!b?.viaHolon;
}

/** How to label a booking's origin: the partner's name, else its id, else null. */
export function bookingOriginLabel(b: Booking | null | undefined): string | null {
  if (!b?.viaHolon) return null;
  return b.viaHolonName || b.viaHolon;
}

/** Coerce a Date or date-ish string to a YYYY-MM-DD day key. */
export function toDayKey(d: Date | string): string {
  return d instanceof Date ? ymd(d) : dayKey(String(d));
}
