/**
 * @holons/core/library — booking model shared by every surface (web, bot,
 * kiosk, MCP).
 *
 * Bookings live on library items as `bookings: Booking[]`. A booking is either
 * a run of whole days (inclusive `YYYY-MM-DD` bounds — a drill for the week) or
 * a stretch of clock time (`YYYY-MM-DDTHH:mm` bounds, end exclusive — a car for
 * an hour). Times are wall-clock, with no zone: a holon shares its things in
 * one place, and "14:00" means 14:00 there on every surface. Items that only carry the legacy single-borrow
 * fields (`borrowed`/`borrower`/`returnBy`, written by older clients) get one
 * synthesized booking so old data keeps rendering; mutating an item through
 * `withBookings` migrates it to the array form while recomputing those legacy
 * fields from whichever booking covers today, so old readers stay consistent.
 *
 * Extracted from apps/web `$lib/util/libraryBookings.ts` — the web util is now
 * a facade over this module.
 */

import { userName } from '../identity/index.js';
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
  /** `YYYY-MM-DD` (whole day) or `YYYY-MM-DDTHH:mm` (timed). Read via {@link bookingSpan}. */
  start: string;
  /** `YYYY-MM-DD` (inclusive day) or `YYYY-MM-DDTHH:mm` (exclusive instant). */
  end: string;
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

const TIMED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** True when a stored bound carries a clock time (`YYYY-MM-DDTHH:mm`). */
export function hasTime(s: string | null | undefined): boolean {
  return typeof s === 'string' && TIMED.test(s);
}

/** The `HH:mm` of a timed bound, or `''` for a whole-day one. */
export function timeOf(s: string | null | undefined): string {
  return hasTime(s) ? (s as string).slice(11) : '';
}

/** Local wall-clock `YYYY-MM-DDTHH:mm` key — the form a timed bound is stored in. */
export function minuteKey(date: Date): string {
  return `${ymd(date)}T${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

/**
 * `now` as a Date whose local fields read the wall clock of `timeZone` (an IANA
 * name), for a host that does not sit where the holon does — a bot server in
 * UTC answering for a holon in Rome. Pass the result wherever these functions
 * take `on`/`now`. An empty or unknown zone leaves the host's own clock.
 */
export function wallClock(now: Date = new Date(), timeZone?: string | null): Date {
  if (!timeZone) return now;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(now);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return new Date(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  } catch {
    return now;
  }
}

/** A booking bound from a day and an optional `HH:mm`: timed when a time is given. */
export function bookingBound(day: string, time?: string | null): string {
  return time ? `${dayKey(day)}T${time.slice(0, 5)}` : dayKey(day);
}

/** True when the booking is for a stretch of clock time rather than whole days. */
export function isTimedBooking(b: Pick<Booking, 'start' | 'end'>): boolean {
  return hasTime(b.start) || hasTime(b.end);
}

/**
 * The half-open `[from, to)` stretch a booking occupies, as minute keys that
 * compare as plain strings. A whole day runs `T00:00` → `T24:00`, which sorts
 * after every minute of that day and before the first of the next — so day and
 * timed bookings share one overlap rule, with no date arithmetic.
 */
export function bookingSpan(b: Pick<Booking, 'start' | 'end'>): { from: string; to: string } {
  return {
    from: hasTime(b.start) ? b.start : `${dayKey(b.start)}T00:00`,
    to: hasTime(b.end) ? b.end : `${dayKey(b.end)}T24:00`
  };
}

export function isBookingActive(b: Booking, on: Date = new Date()): boolean {
  const now = minuteKey(on);
  const { from, to } = bookingSpan(b);
  return from <= now && now < to;
}

/** True when the booking's stretch is over. */
export function isBookingPast(b: Booking, on: Date = new Date()): boolean {
  return bookingSpan(b).to <= minuteKey(on);
}

/**
 * Canonical list of bookings for an item, synthesizing one from the legacy
 * single-borrow fields when `bookings` is empty. A legacy borrow that carries
 * no dates at all is still a borrow: it reads as out today, so it can be seen
 * and returned. Sorted by start date.
 */
export function getDisplayBookings(item: BookableItem): Booking[] {
  const list: Booking[] = Array.isArray(item.bookings) ? [...item.bookings] : [];
  if (list.length === 0 && item.borrowed) {
    const start = dayKey(String(item.borrowedAt || item.returnBy || ymd(new Date())));
    list.push({
      id: 'legacy',
      start,
      end: item.returnBy ? dayKey(String(item.returnBy)) : start,
      borrowerId: item.borrowerId != null ? String(item.borrowerId) : '',
      borrower: item.borrower || item.borrowerInitials || 'Unknown',
      borrowerInitials: item.borrowerInitials,
      created: String(item.borrowedAt || '')
    });
  }
  list.sort((a, b) => a.start.localeCompare(b.start));
  return list;
}

/**
 * First booking whose stretch intersects [start, end], or `null`. Bounds are
 * days or timed (see {@link bookingSpan}); back-to-back timed bookings do not
 * collide. `ignoreBookingId` excludes a booking being rescheduled from its own
 * check.
 */
export function findOverlappingBooking(
  item: BookableItem,
  start: string,
  end: string,
  ignoreBookingId?: string
): Booking | null {
  const { from, to } = bookingSpan({ start, end });
  return (
    getDisplayBookings(item).find((b) => {
      if (b.id === ignoreBookingId) return false;
      const span = bookingSpan(b);
      return span.from < to && from < span.to;
    }) ?? null
  );
}

/** Where an item is right now: on the shelf, out, or out past its time. */
export type BookingState = 'available' | 'out' | 'overdue';

export interface BookingStatus {
  state: BookingState;
  /** The booking holding the item: the one covering now, else the lapsed one never returned. */
  booking: Booking | null;
  /** The next booking still to start, if any. */
  next: Booking | null;
}

/**
 * The item's borrow state at `on`, read from `bookings[]` — the one rule every
 * surface shares. The stored `borrowed`/`returnBy` mirror is only as fresh as
 * the last write, so it cannot answer this: a booking starts and ends without
 * anyone writing the item.
 *
 * Returning removes the booking, so one whose time is up and is still there
 * was never brought back: the item is `overdue` with its last holder until
 * they return it or the next booking begins. Overdue never blocks a booking.
 */
export function bookingStatus(item: BookableItem, on: Date = new Date()): BookingStatus {
  const bookings = getDisplayBookings(item);
  const now = minuteKey(on);
  const next = bookings.find((b) => bookingSpan(b).from > now) ?? null;
  const active = bookings.find((b) => isBookingActive(b, on)) ?? null;
  if (active) return { state: 'out', booking: active, next };
  const lapsed = latestPast(bookings, on);
  return lapsed
    ? { state: 'overdue', booking: lapsed, next }
    : { state: 'available', booking: null, next };
}

/** The most recently ended booking, or `null`. */
function latestPast(bookings: Booking[], on: Date): Booking | null {
  let last: Booking | null = null;
  for (const b of bookings) {
    if (!isBookingPast(b, on)) continue;
    if (!last || bookingSpan(b).to > bookingSpan(last).to) last = b;
  }
  return last;
}

/**
 * The booking `actor` would be returning at `on`: the one of theirs covering
 * now, else their most recently ended one (a late return), else `null`.
 */
export function returnableBooking(
  item: BookableItem,
  actor: BorrowActor,
  on: Date = new Date()
): Booking | null {
  const mine = getDisplayBookings(item).filter((b) => actorMatchesBooking(b, actor));
  return mine.find((b) => isBookingActive(b, on)) ?? latestPast(mine, on);
}

/**
 * Rebuild an item around a new bookings list, recomputing the legacy
 * single-borrow mirror fields from whichever booking (if any) covers today,
 * so readers of `borrowed`/`returnBy` that predate bookings stay consistent.
 */
export function withBookings<T extends BookableItem>(
  item: T,
  bookings: Booking[],
  on: Date = new Date()
): T {
  const active = bookings.find((b) => isBookingActive(b, on)) ?? null;
  return {
    ...item,
    bookings,
    borrowed: active !== null,
    borrower: active?.borrower ?? null,
    borrowerId: active?.borrowerId ?? null,
    borrowerInitials: active?.borrowerInitials ?? null,
    borrowedAt: active ? new Date(bookingSpan(active).from).toISOString() : null,
    returnBy: active?.end ?? null
  };
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

/**
 * Build a booking for `actor` over [start, end]: inclusive days, or a timed
 * stretch when the bounds carry a time. Bounds are stored as given — callers
 * normalize them first (see {@link toBound}).
 */
export function makeBooking(
  actor: BorrowActor,
  start: string,
  end: string,
  via?: BookingOrigin | null
): Booking {
  return {
    id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    start: toBound(start),
    end: toBound(end),
    borrowerId: String(actor.id),
    // The name shown on the booking: what the surface resolved (`display_name`),
    // else the one rule every surface shares. Ownership is matched by id.
    borrower: actor.display_name || userName(actor),
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

/**
 * Coerce a range input to a stored bound: a `YYYY-MM-DDTHH:mm` string stays
 * timed; a Date or any other date-ish string is its whole day. (A Date means a
 * day because that is what every date picker hands over — pass
 * `minuteKey(date)` to book from a clock time.)
 */
export function toBound(d: Date | string): string {
  return typeof d === 'string' && hasTime(d) ? d : toDayKey(d);
}

/** Coerce a Date or date-ish string to a YYYY-MM-DD day key. */
export function toDayKey(d: Date | string): string {
  return d instanceof Date ? ymd(d) : dayKey(String(d));
}
