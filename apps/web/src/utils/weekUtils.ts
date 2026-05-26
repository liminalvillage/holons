/**
 * Week utility functions for role scheduling
 */

/**
 * Get ISO week key from a date (e.g., "2026-W03")
 */
export function getWeekKey(date: Date): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  // Set to nearest Thursday (to get correct ISO week number)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
}

/**
 * Get start (Monday) and end (Sunday) dates for a week key
 */
export function getWeekDates(weekKey: string): { start: Date; end: Date } {
  const [year, week] = weekKey.split("-W").map(Number);
  // January 4th is always in week 1
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // Convert Sunday from 0 to 7
  // Calculate Monday of week 1
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - dayOfWeek + 1);
  // Calculate Monday of requested week
  const start = new Date(week1Monday);
  start.setDate(week1Monday.getDate() + (week - 1) * 7);
  // Calculate Sunday
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

/**
 * Get array of 7 dates for a week (Monday to Sunday)
 */
export function getWeekDays(weekKey: string): Date[] {
  const { start } = getWeekDates(weekKey);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push(day);
  }
  return days;
}

/**
 * Get current day index (0=Monday, 6=Sunday)
 */
export function getCurrentDayIndex(): number {
  const today = new Date();
  const day = today.getDay();
  // Convert from Sunday=0 to Monday=0
  return day === 0 ? 6 : day - 1;
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

/**
 * Get previous week key
 */
export function getPreviousWeekKey(weekKey: string): string {
  const { start } = getWeekDates(weekKey);
  const previousMonday = new Date(start);
  previousMonday.setDate(start.getDate() - 7);
  return getWeekKey(previousMonday);
}

/**
 * Get next week key
 */
export function getNextWeekKey(weekKey: string): string {
  const { start } = getWeekDates(weekKey);
  const nextMonday = new Date(start);
  nextMonday.setDate(start.getDate() + 7);
  return getWeekKey(nextMonday);
}

/**
 * Format date for display (e.g., "Mon 15")
 */
export function formatDayShort(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[date.getDay()]} ${date.getDate()}`;
}

/**
 * Format week range for display (e.g., "Jan 13 - Jan 19, 2026")
 */
export function formatWeekRange(weekKey: string): string {
  const { start, end } = getWeekDates(weekKey);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const startMonth = months[start.getMonth()];
  const endMonth = months[end.getMonth()];

  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()} - ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
}

/**
 * Get ISO date string (YYYY-MM-DD) from Date
 */
export function toISODateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Day names for headers (Monday first)
 */
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_NAMES_FULL = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
