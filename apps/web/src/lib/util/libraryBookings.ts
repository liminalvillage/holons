// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Library booking helpers shared by the Library feature and the main
 * Calendar (which overlays booking periods from the holon's `library` lens).
 *
 * The booking model (shapes, day math, legacy synthesis) lives in
 * `@holons/core/library` — this module re-exports it and adds only the
 * presentation helpers (colors, calendar spans) the web UI needs.
 */

import {
  dayKey,
  getDisplayBookings,
  type BookableItem,
} from "@holons/core/library";

export {
  dayKey,
  getDisplayBookings,
  isBookingActive,
  ymd,
  type BookableItem,
  type Booking,
} from "@holons/core/library";

/** One calendar span per booking, colored by item. */
export interface BookingSpan {
  id: string;
  title: string;
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
  color: string;
  _libraryItemId: string;
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
