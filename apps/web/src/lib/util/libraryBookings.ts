// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Library booking helpers shared by the Library feature and the main
 * Calendar (which overlays booking periods from the holon's `library` lens).
 *
 * Bookings live on library items as `bookings: Booking[]` with inclusive
 * YYYY-MM-DD day ranges; items that only carry the legacy single-borrow
 * fields get one synthesized booking so old data keeps rendering.
 */

export interface Booking {
  id: string;
  start: string; // YYYY-MM-DD (or ISO; always read via dayKey)
  end: string; // YYYY-MM-DD, inclusive
  borrowerId: string;
  borrower: string; // display name
  borrowerInitials?: string | null;
  /** Canonical creation timestamp (ISO). */
  created: string;
}

export interface BookableItem {
  id: string;
  bookings?: Booking[];
  borrowed?: boolean;
  borrower?: string | null;
  borrowerId?: string | null;
  borrowerInitials?: string | null;
  borrowedAt?: string | null;
  returnBy?: string | null;
  _deleted?: boolean;
  [key: string]: any;
}

/** One calendar span per booking, colored by item. */
export interface BookingSpan {
  id: string;
  title: string;
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
  color: string;
  _libraryItemId: string;
}

/** Local-date YYYY-MM-DD key. */
export function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
  const list: Booking[] = Array.isArray(item.bookings)
    ? [...item.bookings]
    : [];
  if (list.length === 0 && item.borrowed && item.borrowedAt) {
    list.push({
      id: "legacy",
      start: dayKey(String(item.borrowedAt)),
      end: item.returnBy
        ? dayKey(String(item.returnBy))
        : dayKey(String(item.borrowedAt)),
      borrowerId: item.borrowerId || "",
      borrower: item.borrower || item.borrowerInitials || "Unknown",
      borrowerInitials: item.borrowerInitials,
      created: String(item.borrowedAt),
    });
  }
  list.sort((a, b) => a.start.localeCompare(b.start));
  return list;
}

/** Stable per-item color so an item is recognizable across list + calendar. */
export function getItemColor(itemId: string): string {
  let hash = 0;
  for (let i = 0; i < itemId.length; i++) {
    hash = itemId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(`${dayKey(dateStr)}T00:00:00`);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

/** Flatten items into calendar spans — one per booking, colored by item. */
export function buildBookingSpans(items: BookableItem[]): BookingSpan[] {
  return items
    .filter((item) => item && item.id && !item._deleted)
    .flatMap((item) =>
      getDisplayBookings(item).map((booking) => ({
        id: `span-${item.id}-${booking.id}`,
        title: `${item.id}${booking.borrower ? ` — ${booking.borrower}` : ""} (${formatDayLabel(booking.start)} → ${formatDayLabel(booking.end)})`,
        start: dayKey(booking.start),
        end: dayKey(booking.end),
        color: getItemColor(item.id),
        _libraryItemId: item.id,
      })),
    );
}
