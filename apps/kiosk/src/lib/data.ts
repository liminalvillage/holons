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

/**
 * In federated mode the lens subscriptions tag each partner-holon record with a
 * `_holon` source id (see `subscribeManyLens`). Resolve it to a friendly label
 * — the partner's name when known, else its id — or `undefined` for own items.
 */
type Names = Record<string, string>;
function sourceLabel(rec: unknown, names?: Names): string | undefined {
  const h = (rec as { _holon?: string })._holon;
  if (!h) return undefined;
  return names?.[h] ?? h;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  /** End time (from the quest's `ends`/`until`), when set; timed events only. */
  end?: Date;
  category?: string;
  location?: string;
  allDay: boolean;
  /** Participants, for the avatar stack. */
  people: TaskPerson[];
  /** Number of appreciators. */
  appreciation: number;
  /** Federation partner this came from, when aggregating; own items omit it. */
  source?: string;
}

export interface TaskPerson {
  id: string | number;
  name: string;
}

export interface BacklogTask {
  id: string;
  title: string;
  category?: string;
  due?: Date | null;
  participants: number;
  /** The participants themselves, for the avatar stack. */
  people: TaskPerson[];
  /** Number of appreciators. */
  appreciation: number;
  /** Ids of the appreciators, so a card can show whether *you* appreciate it. */
  appreciatedBy: (string | number)[];
  source?: string;
  /** Manual sort position set by drag-to-reorder; absent ⇒ unordered. */
  orderIndex?: number;
}

/** Friendly display name for a participant/appreciator record. */
function personName(p: any): string {
  const full = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
  return full || (p?.username ? `@${p.username}` : `#${p?.id ?? "?"}`);
}

/** Map a quest's participant/appreciation array to avatar-stack people. */
export function toPeople(arr: unknown): TaskPerson[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((p: any) => ({ id: p?.id ?? p?.username, name: personName(p) }))
    .filter((p: TaskPerson) => p.id != null);
}

function countOf(arr: unknown): number {
  return Array.isArray(arr) ? arr.length : 0;
}

/** Appreciator ids, for matching against the logged-in user. */
function idsOf(arr: unknown): (string | number)[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((p: any) => p?.id ?? p?.username)
    .filter((id): id is string | number => id != null);
}

/** Dated, still-open quests → calendar events, soonest first. */
export function toEvents(quests: Quest[], names?: Names): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const seen = new Set<string>();
  for (const q of quests) {
    if (isDone(q)) continue;
    const date = parseWhen(q.when);
    if (!date) continue;
    const id = String(q.id ?? q.title);
    // Federation shares quests, so the same id can arrive from several holons —
    // keep the first (the kiosk's own copy) so view keys stay unique.
    if (seen.has(id)) continue;
    seen.add(id);
    const iso = String(q.when);
    // Treat a bare date (no time component) as all-day.
    const allDay = !/T\d\d:/.test(iso);
    // Canonical end field is `ends`; `until` is the legacy (bot) name.
    const end = allDay
      ? undefined
      : (parseWhen(q.ends ?? q.until) ?? undefined);
    out.push({
      id,
      title: q.title || "Untitled",
      date,
      end,
      category: q.category,
      location: q.location,
      allDay,
      people: toPeople(q.participants),
      appreciation: countOf(q.appreciation),
      source: sourceLabel(q, names),
    });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Open quests → the backlog wall. Excludes pure calendar events. */
export function toBacklog(quests: Quest[], names?: Names): BacklogTask[] {
  const out: BacklogTask[] = [];
  const seen = new Set<string>();
  for (const q of quests) {
    if (isDone(q)) continue;
    if (String(q.type ?? "").toLowerCase() === "event") continue;
    const id = String(q.id ?? q.title);
    if (seen.has(id)) continue; // dedupe federated copies of the same quest
    seen.add(id);
    out.push({
      id,
      title: q.title || "Untitled",
      category: q.category,
      due: parseWhen(q.when),
      participants: countOf(q.participants),
      people: toPeople(q.participants),
      appreciation: countOf(q.appreciation),
      appreciatedBy: idsOf(q.appreciation),
      source: sourceLabel(q, names),
      // Tolerate a string round-trip from the store (e.g. "3") so manual order
      // survives a reload.
      orderIndex:
        q.orderIndex != null && Number.isFinite(Number(q.orderIndex))
          ? Number(q.orderIndex)
          : undefined,
    });
  }
  // Manually-ordered tasks first (by orderIndex), then the rest alphabetically.
  return out.sort((a, b) => {
    const ai = a.orderIndex;
    const bi = b.orderIndex;
    if (ai != null && bi != null) {
      if (ai !== bi) return ai - bi;
    } else if (ai != null) {
      return -1;
    } else if (bi != null) {
      return 1;
    }
    return a.title.localeCompare(b.title);
  });
}

export interface LibraryThing {
  id: string;
  title: string;
  type: string;
  available: boolean;
  borrower?: string | null;
  source?: string;
}

/** Library lens → display things, available first then alphabetical. */
export function toThings(items: LibraryItem[], names?: Names): LibraryThing[] {
  const seen = new Set<string>();
  return items
    .map((it) => ({
      id: String(it.id ?? ""),
      title: String(it.id ?? "Untitled"),
      type: String(it.type ?? "other"),
      available: !it.borrowed,
      borrower: it.borrower ?? null,
      source: sourceLabel(it, names),
    }))
    .filter((t) => {
      // Drop blanks and federated duplicates so view keys stay unique.
      if (!t.id || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    })
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
}
