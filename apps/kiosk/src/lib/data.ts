// SPDX-License-Identifier: AGPL-3.0-or-later
//
// View-model normalisation. The kiosk reads two lenses:
//   - `quests`  → calendar events (dated) + the task backlog (open, undated)
//   - `library` → the library of things
// Core owns the meaning of these records; here we only shape them for display.

import {
  isQuestSettled,
  questSchedule,
  unmetDependencies,
} from "@holons/core/tasks";
import type { Quest } from "@holons/core/tasks";
import { dayKey, getDisplayBookings } from "@holons/core/library";
import type { LibraryItem } from "@holons/core/library";
import type { Role } from "@holons/core/roles";
import {
  getChecklistDisplayTitle,
  getChecklistIcon,
  isSpecialChecklist,
  migrateLegacyChecklistType,
} from "@holons/core/checklists";
import type { Checklist } from "@holons/core/checklists";
import { parseInstant } from "@holons/core/datetime";
import { recordKey, sourceHolonId, sourceRef } from "@holons/core/holosphere";
import type { Translator } from "./i18n";

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
 * Build a stable category → post-it colour map for a set of cards. The distinct
 * categories present are sorted (for determinism) and handed successive palette
 * entries, so every category on the wall gets a *different* colour until the
 * six-colour palette is exhausted (then it wraps). This beats hashing each
 * category independently — independent hashes can collide, landing two large
 * categories on the same hue and making the whole wall look monochrome. Blank
 * categories aren't assigned here; callers fall back to {@link noteColor}.
 */
export function categoryColorMap(
  categories: Iterable<string | undefined>,
): Map<string, string> {
  const distinct = [
    ...new Set([...categories].filter((c): c is string => !!c && c.length > 0)),
  ].sort();
  const map = new Map<string, string>();
  distinct.forEach((c, i) => map.set(c, NOTE_COLORS[i % NOTE_COLORS.length]));
  return map;
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

/**
 * Per-note entrance delay (s), keyed by id — so each card rises in at its OWN
 * time rather than the whole wall appearing at once. Hash-derived, so it's
 * stable per card and independent of list position. Spread across ~0…0.7s.
 */
export function noteRiseDelay(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash << 5) - hash + seed.charCodeAt(i);
  return (Math.abs(hash) % 70) / 100; // 0.00 … 0.69s
}

/**
 * Starting rotation (deg) for a note's entrance — it spins from this angle and
 * settles into its resting tilt as it lands. Hash-derived per card so each
 * rotates in its own direction/amount. Magnitude 6°…10°, sign from a hash bit.
 */
export function noteRiseRot(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash << 5) - hash + seed.charCodeAt(i);
  const mag = 6 + (Math.abs(hash) % 5); // 6 … 10
  return (hash & 2 ? 1 : -1) * mag;
}

// Settled = completed/cancelled/deleted — core owns the rule (it also drives
// which dependencies still block, so the two must never drift apart).
const isDone = isQuestSettled;

/**
 * Parse a quest's `when`/`ends` into a local Date for display. The store is
 * always UTC, so a timezone-qualified ISO instant is shown in the viewer's
 * local time; bare wall-clock strings are legacy data read as local. The
 * canonical parser lives in `@holons/core/datetime` — this re-export keeps the
 * kiosk's existing call sites stable.
 */
export const parseWhen = parseInstant;

type Names = Record<string, string>;

// Provenance of federated/hologram records (which holon a foreign record
// actually lives in, and where a write on it must land). The rule moved to
// `@holons/core/holosphere` so every surface shares it; these re-exports keep
// the kiosk's existing call sites stable.
export { sourceHolonId, sourceRef, recordKey };

/**
 * Resolve a foreign item's source holon to a friendly label — the partner's
 * name when known (from the federation snapshot, or stamped on the provenance
 * envelope), else its id — or `undefined` for the kiosk's own items.
 * Exported for surfaces that work on RAW records (e.g. the detail modal).
 */
export function sourceLabel(rec: unknown, names?: Names): string | undefined {
  const id = sourceHolonId(rec);
  if (!id) return undefined;
  const r = rec as {
    _hologram?: { sourceHolonName?: string };
    _federation?: { originName?: string };
  };
  return (
    names?.[id] ??
    r._hologram?.sourceHolonName ??
    r._federation?.originName ??
    id
  );
}

/**
 * A stable glow-edge colour for a foreign item (one mirrored from another holon
 * via federation or a hologram), hashed from its origin holon id so every item
 * from the same holon shares one hue. `undefined` for the kiosk's own items —
 * they get no glow. Returned ready to drop into a `--glow` custom property.
 */
export function sourceGlow(rec: unknown): string | undefined {
  const id = sourceHolonId(rec);
  if (!id) return undefined;
  let hash = 0;
  for (let i = 0; i < id.length; i++)
    hash = (hash << 5) - hash + id.charCodeAt(i);
  // Fixed saturation/lightness so every partner hue reads as a vivid edge
  // against the warm post-it palette.
  return `hsl(${Math.abs(hash) % 360} 75% 52%)`;
}

/**
 * True for a hologram — a card mirrored here BY REFERENCE from its source
 * holon (the `_hologram` envelope), as opposed to a federation-aggregated
 * copy. Holograms render as literal projections of the original post-it
 * (see `.holo` in app.css).
 */
/**
 * Per-card animation seed in [0, 1), hashed from the card's id — the flicker
 * and sweep clocks of every hologram derive from it (see `.holo` in app.css),
 * so no two projections glitch in unison, including elements that carry no
 * `--tilt` of their own (list rows, the detail modal).
 */
export function holoSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash << 5) - hash + seed.charCodeAt(i);
  return (Math.abs(hash) % 997) / 997;
}

export function isHologram(rec: unknown): boolean {
  // Same condition core's provenance rule uses (`sourceHolonId`), so the
  // projection look and the source glow always agree on what's a hologram.
  const r = rec as { _hologram?: { isHologram?: boolean } } | null | undefined;
  return !!r?._hologram?.isHologram;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  /**
   * End of the span (from the quest's `ends`/`until`), when set. For an
   * all-day range this is the LAST day at midnight — inclusive, not a
   * boundary. See `questSchedule` in @holons/core/tasks.
   */
  end?: Date;
  /** Calendar days covered, inclusive: 1 for an ordinary same-day card. */
  days: number;
  /** `days > 1` — a range that reads as an event and shows on each day. */
  multiDay: boolean;
  category?: string;
  location?: string;
  allDay: boolean;
  /** Participants, for the avatar stack. */
  people: TaskPerson[];
  /** Number of appreciators. */
  appreciation: number;
  /** Federation partner this came from, when aggregating; own items omit it. */
  source?: string;
  /** Glow-edge colour for a federated/hologram item, keyed by its source holon. */
  sourceColor?: string;
  /** True for a hologram — a by-reference mirror of the source holon's card. */
  hologram?: boolean;
  /**
   * Set only on a library booking span (see {@link toBookingEvents}): the
   * library item the span belongs to, so a tap opens the item's card rather
   * than looking for a quest that doesn't exist.
   */
  libraryItemId?: string;
}

export interface TaskPerson {
  id: string | number;
  name: string;
}

export interface BacklogTask {
  id: string;
  title: string;
  category?: string;
  /** Full description, shown on the swipe deck's big card (the wall omits it). */
  description?: string;
  /** Optional image (URL or Telegram file_id) shown on the card. */
  picture?: string | null;
  due?: Date | null;
  participants: number;
  /** The participants themselves, for the avatar stack. */
  people: TaskPerson[];
  /** Number of appreciators. */
  appreciation: number;
  /** Ids of the appreciators, so a card can show whether *you* appreciate it. */
  appreciatedBy: (string | number)[];
  source?: string;
  /** Glow-edge colour for a federated/hologram item, keyed by its source holon. */
  sourceColor?: string;
  /** True for a hologram — a by-reference mirror of the source holon's card. */
  hologram?: boolean;
  /** Who proposed the quest (the "idea" behind it), for the lightbulb chip. */
  initiator?: TaskPerson | null;
  /** Manual sort position set by drag-to-reorder; absent ⇒ unordered. */
  orderIndex?: number;
  /** Creation instant (epoch ms; 0 unknown), for the newest-first default. */
  created: number;
  /**
   * How many of this task's dependencies are still open. 0 ⇒ a current leaf
   * of the graph (self-standing, or every predecessor completed): actionable
   * now. Blocked tasks sort after the leaves and stay out of the swipe deck.
   */
  unmetDeps: number;
  /**
   * The quest's stored `dependencies` list, verbatim (its predecessors' ids).
   * The graph view draws these as edges; ones that lead nowhere — a settled
   * quest, an id not on the board — are simply not rendered (`layoutDag`
   * drops dangling endpoints). `unmetDeps` counts the still-open subset.
   */
  dependencies: string[];
}

/**
 * Friendly display name for a person record. Tolerates both the Telegram
 * snake_case participants (`first_name`) and the quest initiator's camelCase
 * (`firstName`), so either shape resolves to a real name.
 */
function personName(p: any): string {
  const full = [p?.first_name ?? p?.firstName, p?.last_name ?? p?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return full || (p?.username ? `@${p.username}` : `#${p?.id ?? "?"}`);
}

/** The quest's initiator as an avatar-stack person, or null when unset. */
function toInitiator(q: Quest): TaskPerson | null {
  const i = q.initiator;
  if (!i || i.id == null) return null;
  return { id: i.id, name: personName(i) };
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

/**
 * Human label for a due date relative to `now`: "today" / "tomorrow" /
 * "yesterday", day counts inside a week, else a short date. Compares calendar
 * days, not 24h spans, so 23:59 → 00:01 still reads "tomorrow". Callers pass
 * the reactive `$t`/`$locale` so the label re-renders on a language switch.
 */
export function dueLabelFor(
  due: Date | null | undefined,
  now: Date,
  t: Translator,
  locale: string,
): string | null {
  if (!due) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(due);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return t("dates.today");
  if (days === 1) return t("dates.tomorrow");
  if (days === -1) return t("dates.yesterday");
  if (days < 0) return t("dates.daysAgo", { n: -days });
  if (days < 7) return t("dates.inDays", { n: days });
  return due.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** Dated, still-open quests → calendar events, soonest first. */
export function toEvents(
  quests: Quest[],
  names?: Names,
  t?: Translator,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const seen = new Set<string>();
  for (const q of quests) {
    if (isDone(q)) continue;
    // Core owns what a schedule means: all-day vs timed, and the inclusive
    // span of days a multi-day card covers.
    const { start: date, end, allDay, days, multiDay } = questSchedule(q);
    if (!date) continue;
    const id = String(q.id ?? q.title);
    // Federation shares quests, so the same id can arrive from several holons —
    // keep the first (the kiosk's own copy) so view keys stay unique.
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: q.title || (t ? t("common.untitled") : "Untitled"),
      date,
      end: end ?? undefined,
      days,
      multiDay,
      category: q.category,
      location: q.location,
      allDay,
      people: toPeople(q.participants),
      appreciation: countOf(q.appreciation),
      source: sourceLabel(q, names),
      sourceColor: sourceGlow(q),
      hologram: isHologram(q),
    });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * How the backlog ranks within each blocked/unblocked group (the Sort pill):
 * most-appreciated first (`loved`, the default — recency breaks ties),
 * newest first (`new`), or the hand-dragged `orderIndex` (`manual`).
 */
export type TaskSort = "loved" | "new" | "manual";

/** Open quests → the backlog wall. Excludes pure calendar events. */
export function toBacklog(
  quests: Quest[],
  names?: Names,
  sort: TaskSort = "loved",
  t?: Translator,
): BacklogTask[] {
  const out: BacklogTask[] = [];
  const seen = new Set<string>();
  // Computed over the FULL quest list (including settled quests) so a
  // dependency on a completed quest no longer blocks its successor.
  const unmet = unmetDependencies(quests);
  for (const q of quests) {
    if (isDone(q)) continue;
    // A hard `put(null)` delete (vs the `_deleted` tombstone) leaves a husk node
    // that Gun re-emits with every field nulled; the live subscription forwards
    // it (it only swallows a clean null). Skip these — otherwise the board shows
    // a phantom "Untitled" card that flips with the real one and re-triggers the
    // FLIP reshuffle endlessly.
    if (q.id == null && !q.title) continue;
    if (String(q.type ?? "").toLowerCase() === "event") continue;
    const id = String(q.id ?? q.title);
    if (seen.has(id)) continue; // dedupe federated copies of the same quest
    seen.add(id);
    out.push({
      id,
      title: q.title || (t ? t("common.untitled") : "Untitled"),
      category: q.category,
      description: q.description || undefined,
      picture: q.picture ?? null,
      due: parseWhen(q.when),
      participants: countOf(q.participants),
      people: toPeople(q.participants),
      appreciation: countOf(q.appreciation),
      appreciatedBy: idsOf(q.appreciation),
      source: sourceLabel(q, names),
      sourceColor: sourceGlow(q),
      hologram: isHologram(q),
      initiator: toInitiator(q),
      // Tolerate a string round-trip from the store (e.g. "3") so manual order
      // survives a reload.
      orderIndex:
        q.orderIndex != null && Number.isFinite(Number(q.orderIndex))
          ? Number(q.orderIndex)
          : undefined,
      created: (() => {
        const t = Date.parse(String(q.created ?? ""));
        return Number.isFinite(t) ? t : 0;
      })(),
      unmetDeps: unmet.get(id)?.length ?? 0,
      dependencies: ((q.dependencies as string[] | undefined) ?? []).map(
        String,
      ),
    });
  }
  // Current leaves first — a task blocked by open dependencies can't be acted
  // on yet, so it never outranks actionable work regardless of the chosen
  // sort. Within each group the Sort pill's ranking applies, with the title
  // as a stable final tiebreak.
  return out.sort((a, b) => {
    const ablocked = a.unmetDeps > 0;
    const bblocked = b.unmetDeps > 0;
    if (ablocked !== bblocked) return ablocked ? 1 : -1;
    if (sort === "manual") {
      const ai = a.orderIndex;
      const bi = b.orderIndex;
      if (ai != null && bi != null) {
        if (ai !== bi) return ai - bi;
      } else if (ai != null) {
        return -1;
      } else if (bi != null) {
        return 1;
      }
    } else {
      if (sort === "loved" && a.appreciation !== b.appreciation)
        return b.appreciation - a.appreciation;
      if (a.created !== b.created) return b.created - a.created;
    }
    return a.title.localeCompare(b.title);
  });
}

export interface LibraryThing {
  id: string;
  title: string;
  type: string;
  /**
   * Optional photo of the thing, same encoding as a quest's (URL, data-URI or
   * Telegram file_id — see `$lib/image`). Not part of core's `LibraryItem`
   * interface: no writer sets one today, but bot-created and federated items
   * can carry it, so it's read through the record's open index signature.
   */
  picture?: string | null;
  available: boolean;
  borrower?: string | null;
  /** Who has it out (Telegram id), for the "my things" filter. */
  borrowerId?: number | string | null;
  /** When the current borrow is due back, when known. */
  returnBy?: Date | null;
  source?: string;
  /** Glow-edge colour for a federated/hologram item, keyed by its source holon. */
  sourceColor?: string;
  /** True for a hologram — a by-reference mirror of the source holon's card. */
  hologram?: boolean;
}

export interface RoleCard {
  id: string;
  title: string;
  description?: string;
  /** Members holding the role, for the avatar stack. */
  people: TaskPerson[];
  /** Number of members. */
  count: number;
  source?: string;
  /** Glow-edge colour for a federated/hologram item, keyed by its source holon. */
  sourceColor?: string;
  /** True for a hologram — a by-reference mirror of the source holon's card. */
  hologram?: boolean;
}

/** Roles lens → display cards, alphabetical by title. */
export function toRoles(
  roles: Role[],
  names?: Names,
  t?: Translator,
): RoleCard[] {
  const seen = new Set<string>();
  return roles
    .map((r) => ({
      id: String(r.id ?? r.title ?? ""),
      title: r.title || (t ? t("roles.untitledRole") : "Untitled role"),
      description: r.description || undefined,
      people: toPeople(r.participants),
      count: countOf(r.participants),
      source: sourceLabel(r, names),
      sourceColor: sourceGlow(r),
      hologram: isHologram(r),
    }))
    .filter((r) => {
      // Drop blanks and federated duplicates so view keys stay unique.
      if (!r.id || seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export interface ChecklistCard {
  /**
   * The record's own id — its name in the store, and what a write targets.
   * NOT unique across holons: every holon has an `agenda` and a `shopping`.
   * Use {@link ChecklistCard.key} to identify a card in the view.
   */
  id: string;
  /**
   * View identity: unique even when partners contribute a list of the same
   * name (`recordKey` — `origin::id` for a foreign list, the bare id for our
   * own). Svelte keys, open-panel state and lookups all run off this.
   */
  key: string;
  title: string;
  /** Core's emoji for the list kind (📅 agenda, 🛒 shopping, 📋 …). */
  icon: string;
  /** Items done / total, for the progress chip. */
  done: number;
  total: number;
  /** Agenda/shopping — undeletable, pinned ahead of the ad-hoc lists. */
  special: boolean;
  /** Who created the list (raw id), for the personal scope. */
  creator?: string | number | null;
  source?: string;
  /** Glow-edge colour for a federated/hologram item, keyed by its source holon. */
  sourceColor?: string;
  /** True for a hologram — a by-reference mirror of the source holon's card. */
  hologram?: boolean;
}

/**
 * Checklists lens → display cards: the special agenda/shopping lists first,
 * then alphabetical. Legacy records are run through core's type migration so
 * the icon/special rules see a typed list.
 */
export function toChecklists(
  lists: Checklist[],
  names?: Names,
): ChecklistCard[] {
  const seen = new Set<string>();
  return lists
    .filter((c) => c && c.id != null && String(c.id).length > 0)
    .map((c) => {
      const typed = migrateLegacyChecklistType({ ...c });
      const items = Array.isArray(typed.items) ? typed.items : [];
      return {
        id: String(typed.id),
        key: recordKey(c, String(typed.id)),
        title: getChecklistDisplayTitle(typed),
        icon: getChecklistIcon(typed),
        done: items.filter((i) => i?.checked).length,
        total: items.length,
        special: isSpecialChecklist(typed),
        creator: typed.creator ?? null,
        source: sourceLabel(c, names),
        sourceColor: sourceGlow(c),
        hologram: isHologram(c),
      };
    })
    .filter((c) => {
      // Dedupe on the ORIGIN-qualified key, not the bare id: a partner's
      // `shopping` is a different list from ours and both belong on the board.
      if (seen.has(c.key)) return false;
      seen.add(c.key);
      return true;
    })
    .sort((a, b) => {
      if (a.special !== b.special) return a.special ? -1 : 1;
      if (a.title !== b.title) return a.title.localeCompare(b.title);
      // Same-named lists from different holons: our own first (its key is the
      // bare id), then partners by origin.
      const aOwn = a.key === a.id;
      const bOwn = b.key === b.id;
      if (aOwn !== bOwn) return aOwn ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
}

/** Library lens → display things, available first then alphabetical. */
export function toThings(
  items: LibraryItem[],
  names?: Names,
  t?: Translator,
): LibraryThing[] {
  const seen = new Set<string>();
  return items
    .map((it) => ({
      id: String(it.id ?? ""),
      title: String(it.id ?? (t ? t("common.untitled") : "Untitled")),
      type: String(it.type ?? "other"),
      picture: (it.picture as string | undefined) ?? null,
      available: !it.borrowed,
      borrower: it.borrower ?? null,
      borrowerId: it.borrowerId ?? null,
      returnBy: parseWhen(it.returnBy),
      source: sourceLabel(it, names),
      sourceColor: sourceGlow(it),
      hologram: isHologram(it),
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

/** Local midnight of a `YYYY-MM-DD` day, or `null` when it doesn't parse. */
function dayStart(day: string): Date | null {
  const d = new Date(`${dayKey(day)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Library bookings → all-day calendar spans, one per booking: the data behind
 * the Library's calendar layout, which answers "when is this gone?" at a
 * glance. The web dashboard overlays the very same spans on its main calendar
 * (`$lib/util/libraryBookings.buildBookingSpans`); the kiosk feeds them to its
 * own CalendarView instead, so both surfaces read one booking model.
 *
 * Core owns what a booking IS — `getDisplayBookings` also synthesizes one for
 * items that still carry only the legacy single-borrow fields, so old data
 * shows up too. The shaping here is purely for display:
 *
 * - `category` is the item's name, so the note-colour hash gives every item a
 *   stable colour of its own (the same trick web's `getItemColor` plays).
 * - the borrower rides in `people`, so the avatar stack and the Mine scope
 *   ("the bookings that are mine") work without a special case.
 */
export function toBookingEvents(
  items: LibraryItem[],
  names?: Names,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const itemId = String(item.id ?? "");
    // Federation shares the library, so the same item can arrive from several
    // holons — keep the first (our own copy) so view keys stay unique.
    if (!itemId || item._deleted || seen.has(itemId)) continue;
    seen.add(itemId);
    const source = sourceLabel(item, names);
    const sourceColor = sourceGlow(item);
    const hologram = isHologram(item);
    for (const b of getDisplayBookings(item)) {
      const date = dayStart(b.start);
      const end = dayStart(b.end);
      if (!date || !end) continue;
      // Inclusive day count; rounded because a DST boundary inside the range
      // makes the millisecond span 23h or 25h, not a whole number of days.
      const days = Math.max(
        1,
        Math.round((end.getTime() - date.getTime()) / 86_400_000) + 1,
      );
      const who = b.borrower || (b.borrowerId ? String(b.borrowerId) : "");
      out.push({
        id: `booking-${itemId}-${b.id}`,
        libraryItemId: itemId,
        title: itemId,
        date,
        end,
        days,
        multiDay: days > 1,
        category: itemId,
        allDay: true,
        people: who ? [{ id: b.borrowerId || who, name: who }] : [],
        appreciation: 0,
        source,
        sourceColor,
        hologram,
      });
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Tap-to-filter suggestions for the search dropdown: every distinct category
 * and every person currently visible on the board. People are gathered from
 * event/task participants, task initiators, role holders, and library
 * borrowers, deduped case-insensitively (first spelling wins) so "Anna" from a
 * task and "anna" from a role collapse into one chip.
 */
export interface SearchSuggestions {
  categories: string[];
  people: string[];
}

export function toSuggestions(
  events: CalendarEvent[],
  backlog: BacklogTask[],
  roles: RoleCard[],
  things: LibraryThing[],
): SearchSuggestions {
  const categories = [
    ...new Set(
      [...events, ...backlog]
        .map((c) => c.category)
        .filter((c): c is string => !!c && c.length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const people = new Map<string, string>();
  const addPerson = (name: string | null | undefined) => {
    const n = name?.trim();
    if (n && !people.has(n.toLowerCase())) people.set(n.toLowerCase(), n);
  };
  for (const e of events) e.people.forEach((p) => addPerson(p.name));
  for (const t of backlog) {
    t.people.forEach((p) => addPerson(p.name));
    addPerson(t.initiator?.name);
  }
  for (const r of roles) r.people.forEach((p) => addPerson(p.name));
  for (const t of things) addPerson(t.borrower);

  return {
    categories,
    people: [...people.values()].sort((a, b) => a.localeCompare(b)),
  };
}

/** Text fields the kiosk search bar matches against, across every view model. */
interface Searchable {
  title?: string;
  category?: string;
  location?: string;
  description?: string;
  type?: string;
  source?: string;
  borrower?: string | null;
  people?: TaskPerson[];
}

/**
 * Filter view-model items by the search bar's query: case-insensitive, and an
 * item must match *every* whitespace-separated term (AND). An empty query
 * passes the list straight through (same reference — no needless re-render).
 */
export function filterBySearch<T extends Searchable>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const terms = q.split(/\s+/);
  return items.filter((it) => {
    const hay = [
      it.title,
      it.category,
      it.location,
      it.description,
      it.type,
      it.source,
      it.borrower ?? undefined,
      ...(it.people?.map((p) => p.name) ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
