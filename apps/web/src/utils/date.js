import { parseInstant } from "@holons/core/datetime";

// The store is always UTC; `parseInstant` renders a stored instant in the
// viewer's local time (and reads legacy bare wall-clock strings consistently).

// Format time for display
/**
 * @param {string | number | Date} dateTime
 */
export function formatTime(dateTime) {
  const date = parseInstant(dateTime);
  if (!date) return "";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
/**
 * @param {string | number | Date} dateTime
 */
export function formatDate(dateTime) {
  const date = parseInstant(dateTime);
  if (!date) return "";
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) {
    return "today";
  } else if (date.toDateString() === tomorrow.toDateString()) {
    return "tomorrow";
  } else {
    const diff = Math.ceil(
      (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    return `in ${diff} days`;
  }
}
