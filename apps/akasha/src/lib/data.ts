// SPDX-License-Identifier: AGPL-3.0-or-later
//
// View-model normalisation. The kiosk reads two lenses:
//   - `quests`  → calendar events (dated) + the task backlog (open, undated)
//   - `library` → the library of things
// Core owns the meaning of these records; here we only shape them for display.

import type { Quest } from "@holons/core/tasks";
import type { LibraryItem } from "@holons/core/library";

/** Warm post-it palette, indexed deterministically by category. */
export const NOTE_COLORS = [
  "var(--note-sun)",
  "var(--note-mint)",
  "var(--note-sky)",
  "var(--note-coral)",
  "var(--note-lav)",
  "var(--note-lime)",
] as const;

/** Stable colour for a label so the same category always gets the same note. */
export function noteColor(seed: string | undefined): string {
  const s = seed && seed.length ? seed : "•";
  let hash = 0;
  for (let i = 0; i < s.length; i++)
    hash = (hash << 5) - hash + s.charCodeAt(i);
  return NOTE_COLORS[Math.abs(hash) % NOTE_COLORS.length];
}

/**
 * Very slight, repeatable tilt (deg) for a note, keyed by id — stable, never
 * jittery, and deliberately never 0°: every post-it sits just barely askew.
 * Magnitude 0.5°…1.1°, sign from a hash bit.
 */
export function noteTilt(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash << 5) - hash + seed.charCodeAt(i);
  const mag = 0.5 + (Math.abs(hash) % 7) / 10; // 0.5 … 1.1
  return (hash & 1 ? 1 : -1) * mag;
}

function isDone(q: Quest): boolean {
  const s = String(q.status ?? "").toLowerCase();
  return (
    s === "completed" ||
    s === "cancelled" ||
    q.completed === true ||
    q._deleted === true
  );
}

function parseWhen(when: unknown): Date | null {
  if (!when) return null;
  const d = new Date(when as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  category?: string;
  location?: string;
  allDay: boolean;
}

export interface BacklogTask {
  id: string;
  title: string;
  category?: string;
  due?: Date | null;
  participants: number;
}

/** Dated, still-open quests → calendar events, soonest first. */
export function toEvents(quests: Quest[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const q of quests) {
    if (isDone(q)) continue;
    const date = parseWhen(q.when);
    if (!date) continue;
    const iso = String(q.when);
    // Treat a bare date (no time component) as all-day.
    const allDay = !/T\d\d:/.test(iso);
    out.push({
      id: String(q.id ?? q.title),
      title: q.title || "Untitled",
      date,
      category: q.category,
      location: q.location,
      allDay,
    });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Open quests → the backlog wall. Excludes pure calendar events. */
export function toBacklog(quests: Quest[]): BacklogTask[] {
  const out: BacklogTask[] = [];
  for (const q of quests) {
    if (isDone(q)) continue;
    if (String(q.type ?? "").toLowerCase() === "event") continue;
    out.push({
      id: String(q.id ?? q.title),
      title: q.title || "Untitled",
      category: q.category,
      due: parseWhen(q.when),
      participants: Array.isArray(q.participants) ? q.participants.length : 0,
    });
  }
  // Most recently created first when timestamps exist; else keep insertion.
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export interface LibraryThing {
  id: string;
  title: string;
  type: string;
  available: boolean;
  borrower?: string | null;
}

/** Library lens → display things, available first then alphabetical. */
export function toThings(items: LibraryItem[]): LibraryThing[] {
  return items
    .map((it) => ({
      id: String(it.id ?? ""),
      title: String(it.id ?? "Untitled"),
      type: String(it.type ?? "other"),
      available: !it.borrowed,
      borrower: it.borrower ?? null,
    }))
    .filter((t) => t.id)
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
}
