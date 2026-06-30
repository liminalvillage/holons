// SPDX-License-Identifier: AGPL-3.0-or-later
//
// View-model normalisation. The kiosk reads two lenses:
//   - `quests`  → calendar events (dated) + the task backlog (open, undated)
//   - `library` → the library of things
// Core owns the meaning of these records; here we only shape them for display.

import type { Quest } from "@holons/core/tasks";
import type { LibraryItem } from "@holons/core/library";
import type { Role } from "@holons/core/roles";
import { parseInstant } from "@holons/core/datetime";

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

function isDone(q: Quest): boolean {
  const s = String(q.status ?? "").toLowerCase();
  return (
    s === "completed" ||
    s === "cancelled" ||
    q.completed === true ||
    q._deleted === true
  );
}

/**
 * Parse a quest's `when`/`ends` into a local Date for display. The store is
 * always UTC, so a timezone-qualified ISO instant is shown in the viewer's
 * local time; bare wall-clock strings are legacy data read as local. The
 * canonical parser lives in `@holons/core/datetime` — this re-export keeps the
 * kiosk's existing call sites stable.
 */
export const parseWhen = parseInstant;

type Names = Record<string, string>;

/**
 * The originating holon id for a record that didn't come from this kiosk's own
 * holon. Three provenance markers can surface one:
 *   - `_holon`            — tag the kiosk's own aggregator adds to partner-holon
 *                           records when federating (see `createLensAggregator`);
 *   - `_hologram`         — Holosphere's resolved-hologram envelope, for an item
 *                           mirrored from another holon (`sourceHolon`);
 *   - `_federation`       — Holosphere's federation envelope, for an item that
 *                           arrived via a federated partner (`origin`).
 * `undefined` for the kiosk's own items.
 */
export function sourceHolonId(rec: unknown): string | undefined {
  const r = rec as {
    _holon?: string;
    _federation?: { origin?: string };
    _hologram?: { isHologram?: boolean; sourceHolon?: string | null };
  };
  if (r._holon) return r._holon;
  if (r._hologram?.isHologram && r._hologram.sourceHolon)
    return r._hologram.sourceHolon;
  if (r._federation?.origin) return r._federation.origin;
  return undefined;
}

/**
 * Where a foreign item actually lives, for a write that must land in the owner's
 * graph (borrow/return), not a local copy. Returns the source `{ holon, key }`,
 * or `undefined` for the kiosk's own items (write them in place).
 *
 * The holon comes from {@link sourceHolonId}. The key matters for a resolved
 * hologram: its local pointer can sit under a different key than the source's
 * own (`_hologram.sourceKey` is the authoritative one parsed from the soul);
 * federated/`_holon` partners share the id, so we fall back to `localId`. This
 * mirrors HoloSphere's own put-redirection, which rewrites a write landing on a
 * hologram to `soul.holon`/`soul.key` — we just target it directly.
 */
export function sourceRef(
  rec: unknown,
  localId: string,
): { holon: string; key: string } | undefined {
  const holon = sourceHolonId(rec);
  if (!holon) return undefined;
  const sourceKey = (rec as { _hologram?: { sourceKey?: string | null } })
    ._hologram?.sourceKey;
  return { holon, key: sourceKey || localId };
}

/**
 * Resolve a foreign item's source holon to a friendly label — the partner's
 * name when known (from the federation snapshot, or stamped on the provenance
 * envelope), else its id — or `undefined` for the kiosk's own items.
 */
function sourceLabel(rec: unknown, names?: Names): string | undefined {
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
  /** Glow-edge colour for a federated/hologram item, keyed by its source holon. */
  sourceColor?: string;
}

export interface TaskPerson {
  id: string | number;
  name: string;
}

export interface BacklogTask {
  id: string;
  title: string;
  category?: string;
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
  /** Who proposed the quest (the "idea" behind it), for the lightbulb chip. */
  initiator?: TaskPerson | null;
  /** Manual sort position set by drag-to-reorder; absent ⇒ unordered. */
  orderIndex?: number;
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
      sourceColor: sourceGlow(q),
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
      title: q.title || "Untitled",
      category: q.category,
      picture: q.picture ?? null,
      due: parseWhen(q.when),
      participants: countOf(q.participants),
      people: toPeople(q.participants),
      appreciation: countOf(q.appreciation),
      appreciatedBy: idsOf(q.appreciation),
      source: sourceLabel(q, names),
      sourceColor: sourceGlow(q),
      initiator: toInitiator(q),
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
  /** Glow-edge colour for a federated/hologram item, keyed by its source holon. */
  sourceColor?: string;
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
}

/** Roles lens → display cards, alphabetical by title. */
export function toRoles(roles: Role[], names?: Names): RoleCard[] {
  const seen = new Set<string>();
  return roles
    .map((r) => ({
      id: String(r.id ?? r.title ?? ""),
      title: r.title || "Untitled role",
      description: r.description || undefined,
      people: toPeople(r.participants),
      count: countOf(r.participants),
      source: sourceLabel(r, names),
      sourceColor: sourceGlow(r),
    }))
    .filter((r) => {
      // Drop blanks and federated duplicates so view keys stay unique.
      if (!r.id || seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
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
      sourceColor: sourceGlow(it),
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
