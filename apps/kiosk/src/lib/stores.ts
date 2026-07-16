// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reactive state for the kiosk: live lens data, a ticking clock, and the
// auto-rotation controller that flips between views unless someone is touching
// the screen.

import { writable, derived, get, type Readable } from "svelte/store";
import type { Quest } from "@holons/core/tasks";
import type { LibraryItem } from "@holons/core/library";
import type { Role } from "@holons/core/roles";
import {
  toEvents,
  toBacklog,
  toThings,
  toRoles,
  filterBySearch,
  categoryColorMap,
} from "./data";
import {
  FLIP_INTERVAL_MS,
  RESUME_AFTER_IDLE_MS,
  IDLE_HIDE_MS,
  isPhoneDisplay,
  setPinnedTab,
  resolvePinnedTab,
  type TaskViewMode,
} from "./config";

// ── Connection / source data ───────────────────────────────────────────────

export const holonName = writable<string>("");
export const connected = writable<boolean>(false);
/** The holon this kiosk displays — chosen on boot or from Settings. */
export const holonId = writable<string | null>(null);

/** Caretaker-set display name shown in the header; overrides the holon name. */
export const brandName = writable<string>("");
/** Caretaker-set header logo (data URL or image URL); empty → bundled logo. */
export const brandLogo = writable<string>("");
/** Accent colour (hex); applied as the `--teal` family across the UI. */
export const accent = writable<string>("#0e6b66");

/**
 * When on, the kiosk aggregates this holon together with its federation
 * partners so every tab shows the combined picture. Re-points the live
 * subscriptions in `+layout.svelte`.
 */
export const federated = writable<boolean>(false);

/**
 * Whether the Library tab is shown (a caretaker toggle, persisted in config; on
 * by default). Toggling it (de)activates the library subscription in
 * `+layout.svelte` and adds/removes the tab in `visibleTabs`.
 */
export const libraryEnabled = writable<boolean>(true);

/**
 * Whether the optional Roles tab is shown (a caretaker opt-in, persisted in
 * config). Toggling it (de)activates the roles subscription in `+layout.svelte`
 * and adds/removes the tab in `visibleTabs`.
 */
export const rolesEnabled = writable<boolean>(false);

/**
 * Whether the optional Status tab (a ranked contribution leaderboard) is shown
 * (a caretaker opt-in, persisted in config). Toggling it adds/removes the tab in
 * `visibleTabs`; the StatusView owns its own data subscriptions, so no aggregator
 * is wired in `+layout.svelte`.
 */
export const statusEnabled = writable<boolean>(false);

/** Federation partner id → display name, for the per-item source chips. */
export const partnerNames = writable<Record<string, string>>({});

/**
 * Free-text search from the header bar. Filters the visible content of every
 * view (tasks, calendar, library, roles) through the derived stores below, so
 * one query narrows whatever tab is on screen. Empty ⇒ no filtering.
 */
export const searchQuery = writable<string>("");

/** Whether the Settings panel is open. */
export const settingsOpen = writable<boolean>(false);

/**
 * How the Tasks view lays out the backlog (wall / list / swipe deck). Persisted
 * per device via config; initialized in `+layout.svelte`.
 */
export const taskViewMode = writable<TaskViewMode>("cards");

/**
 * Task ids the swipe deck has dealt with this session — skipped, joined, or
 * liked — so the deck strictly advances. A module store (not component state)
 * because tab auto-rotation remounts the Tasks view every flip; deliberately
 * never persisted, so skipped cards return next session.
 */
export const swipeDismissed = writable<Set<string>>(new Set());

// ── Transient notice (toast) ───────────────────────────────────────────────
//
// One-line feedback for taps that can't proceed (e.g. completing a task you
// haven't joined). Auto-dismisses; each new notice replaces the previous one.

export const notice = writable<string | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

/** Show a transient notice for `ms` (default ~3.5s). */
export function showNotice(text: string, ms = 3500): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  notice.set(text);
  noticeTimer = setTimeout(() => {
    notice.set(null);
    noticeTimer = null;
  }, ms);
}

/** Whether the user menu (account / federated / dashboard / settings) is open. */
export const userMenuOpen = writable<boolean>(false);

export const rawQuests = writable<Quest[]>([]);
export const rawLibrary = writable<LibraryItem[]>([]);
export const rawRoles = writable<Role[]>([]);

export const events = derived(
  [rawQuests, partnerNames, searchQuery],
  ([$q, $n, $query]) => filterBySearch(toEvents($q, $n), $query),
);
export const backlog = derived(
  [rawQuests, partnerNames, searchQuery],
  ([$q, $n, $query]) => filterBySearch(toBacklog($q, $n), $query),
);
// One palette slot per distinct category, derived from *all* quests (not a
// search-filtered subset) so a category keeps the same colour across the
// calendar and the task wall, and doesn't shift as the search narrows.
export const categoryColors = derived(rawQuests, ($q) =>
  categoryColorMap($q.map((x) => x.category)),
);
export const things = derived(
  [rawLibrary, partnerNames, searchQuery],
  ([$l, $n, $query]) => filterBySearch(toThings($l, $n), $query),
);
export const roleCards = derived(
  [rawRoles, partnerNames, searchQuery],
  ([$r, $n, $query]) => filterBySearch(toRoles($r, $n), $query),
);

/**
 * Whether the board may render. False while a holon's initial data burst is
 * still streaming in from Gun; the layout flips it true once that settles, so
 * the active view mounts a single time on the full set and its entrance
 * animation plays cleanly — exactly like a tab switch (which remounts on
 * already-loaded data) — instead of animating cards one-by-one as they arrive.
 */
export const boardReady = writable<boolean>(false);

// ── Detail / zoom selection ────────────────────────────────────────────────
//
// Clicking any post-it or card "brings it forward" into the DetailModal. The
// selection carries the full source record (not the view-model) so the modal
// can show every field and write edits straight back.

export type Selection =
  // `isNew` marks a draft built locally (e.g. long-press on the calendar) that
  // hasn't been written to Holosphere yet — the detail modal opens straight in
  // edit mode and Cancel discards it instead of leaving a phantom card.
  | { kind: "event"; quest: Quest; isNew?: boolean }
  | { kind: "task"; quest: Quest; isNew?: boolean }
  | { kind: "thing"; item: LibraryItem }
  | null;

export const selection = writable<Selection>(null);

/**
 * A task completion awaiting participant confirmation. Set by the board ✓ or the
 * detail modal; the shared CompleteConfirm popup lets the user confirm who took
 * part (for honest REA accounting) and then calls `onConfirm` with the adjusted
 * task to actually record + animate the completion.
 */
export type CompletionRequest = {
  task: Quest;
  onConfirm: (adjustedTask: Quest) => void;
} | null;
export const completionRequest = writable<CompletionRequest>(null);

/** When true, the next quest opened in the DetailModal starts in edit mode. */
export const editOnOpen = writable<boolean>(false);

/** Open a quest (calendar event or backlog task) by id, looked up live. */
export function openQuest(id: string, kind: "event" | "task"): void {
  const q = get(rawQuests).find((x) => String(x.id ?? x.title) === id);
  if (q) selection.set({ kind, quest: q });
}

/** Open a library thing by id, looked up live. */
export function openThing(id: string): void {
  const item = get(rawLibrary).find((x) => String(x.id ?? "") === id);
  if (item) selection.set({ kind: "thing", item });
}

export function closeDetail(): void {
  selection.set(null);
}

// ── Tabs ─────────────────────────────────────────────────────────────────--

export const TABS = [
  { id: "tasks", label: "Tasks", glyph: "✎" },
  { id: "calendar", label: "Calendar", glyph: "▦" },
  { id: "library", label: "Library", glyph: "❖" },
  { id: "roles", label: "Roles", glyph: "✪" },
  { id: "status", label: "Status", glyph: "♛" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/**
 * Tabs actually shown: the Library tab follows its caretaker toggle (on by
 * default), and the optional Roles and Status tabs appear only when the
 * caretaker has enabled them. Each is purely toggle-driven — an enabled tab
 * shows even while empty (its view shows an empty state), so the board never
 * silently drops a tab the caretaker turned on.
 */
export const visibleTabs = derived(
  [libraryEnabled, rolesEnabled, statusEnabled],
  ([$library, $roles, $status]) =>
    TABS.filter(
      (t) =>
        (t.id !== "library" || $library) &&
        (t.id !== "roles" || $roles) &&
        (t.id !== "status" || $status),
    ),
);

// A persisted pin from a previous session, validated against the known tabs.
const savedPin = resolvePinnedTab();
const initialPin: TabId | null = TABS.some((t) => t.id === savedPin)
  ? (savedPin as TabId)
  : null;

/** The active view — the kiosk opens on its pinned tab, else Tasks. */
export const activeTab = writable<TabId>(initialPin ?? "tasks");

/**
 * The tab the kiosk is pinned to, or null to auto-rotate. While pinned the
 * screen rests on this view: rotation is suspended and, once everyone walks
 * away, the board snaps back to it. Long-press a tab to (un)pin; persisted via
 * config so it survives a power-cycle.
 */
export const pinnedTab = writable<TabId | null>(initialPin);

// ── Clock ──────────────────────────────────────────────────────────────────

export const now = writable<Date>(new Date());
let clockTimer: ReturnType<typeof setInterval> | null = null;

export function startClock(): () => void {
  if (clockTimer) return () => {};
  clockTimer = setInterval(() => now.set(new Date()), 1000);
  return () => {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
  };
}

// ── Auto-rotation ────────────────────────────────────────────────────────--
//
// The kiosk advances one tab every FLIP_INTERVAL_MS. Any interaction pauses
// rotation and resumes it after RESUME_AFTER_IDLE_MS of stillness. `flipAt`
// drives the thin progress bar so the screen telegraphs the next move.

export const rotating = writable<boolean>(true);
/** Wall-clock time (ms) of the next scheduled flip, or null while paused. */
export const flipAt = writable<number | null>(null);

/**
 * Whether this display auto-rotates at all. Phones never do — a handheld
 * screen flipping views under your thumb is disorienting; tablets and wall
 * displays keep the kiosk behaviour. Decided once on boot (startRotation);
 * the header hides the flip-progress rail when it's off.
 */
export const autoRotates = writable<boolean>(true);

/**
 * Whether no one has touched the screen recently — drives hiding the header
 * chrome for an immersive board. Starts true (an unattended kiosk shows the
 * board, not the chrome); any interaction clears it via `noteInteraction`.
 */
export const idle = writable<boolean>(true);

/**
 * When true, auto-rotation is suspended regardless of the idle/resume timers —
 * a view holds this while an overlay it owns is open (e.g. the Status score
 * breakdown) so the screen can't flip out from under someone reading it.
 */
export const rotationHold = writable<boolean>(false);

let tickTimer: ReturnType<typeof setInterval> | null = null;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlip() {
  // A pinned kiosk or a phone never advances, so don't arm the progress bar.
  if (get(pinnedTab) || !get(autoRotates)) {
    flipAt.set(null);
    return;
  }
  flipAt.set(Date.now() + FLIP_INTERVAL_MS);
}

function advance() {
  if (get(pinnedTab) || !get(autoRotates)) return; // parked / handheld — never rotate
  const tabs = get(visibleTabs);
  if (!tabs.length) return;
  const i = tabs.findIndex((t) => t.id === get(activeTab));
  activeTab.set(tabs[(i + 1) % tabs.length].id);
  scheduleFlip();
}

/** Begin the rotation loop. Returns a teardown function. */
export function startRotation(): () => void {
  autoRotates.set(!isPhoneDisplay());
  rotating.set(true);
  scheduleFlip();
  tickTimer = setInterval(() => {
    // Never flip while a detail is zoomed forward or a view holds rotation open
    // (an open overlay) — that would yank the card out from under whoever's
    // reading or editing it.
    if (!get(rotating) || get(selection) != null || get(rotationHold)) return;
    const at = get(flipAt);
    if (at != null && Date.now() >= at) advance();
  }, 250);
  return () => {
    if (tickTimer) clearInterval(tickTimer);
    if (resumeTimer) clearTimeout(resumeTimer);
    if (idleTimer) clearTimeout(idleTimer);
    tickTimer = null;
    resumeTimer = null;
    idleTimer = null;
  };
}

/**
 * Call on any user interaction: reveal the chrome, pause rotation, and arm both
 * the chrome-hide and rotation-resume timers so the screen returns to its
 * immersive, self-advancing state once everyone walks away.
 */
export function noteInteraction() {
  rotating.set(false);
  flipAt.set(null);
  idle.set(false);
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    rotating.set(true);
    // A pinned kiosk snaps back to its view once everyone has walked away.
    const pin = get(pinnedTab);
    if (pin) activeTab.set(pin);
    scheduleFlip();
  }, RESUME_AFTER_IDLE_MS);
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => idle.set(true), IDLE_HIDE_MS);
}

/** Manually select a tab by id (also counts as an interaction). */
export function selectTab(id: TabId) {
  activeTab.set(id);
  noteInteraction();
}

/**
 * Long-press handler: pin the kiosk to a tab (parking it there, no rotation) or
 * unpin if it's already the pinned one. Persisted so the park survives a reload.
 */
export function togglePin(id: TabId) {
  const next = get(pinnedTab) === id ? null : id;
  pinnedTab.set(next);
  setPinnedTab(next);
  if (next) {
    activeTab.set(next);
    rotating.set(false);
  } else {
    rotating.set(true);
  }
  // Re-arm (or, while pinned, clear) the flip timer to match the new state.
  scheduleFlip();
}

/** 0…1 progress toward the next flip, for the header indicator. */
export const flipProgress: Readable<number> = derived(
  [flipAt, now],
  ([$flipAt]) => {
    if ($flipAt == null) return 0;
    const remaining = $flipAt - Date.now();
    return Math.max(0, Math.min(1, 1 - remaining / FLIP_INTERVAL_MS));
  },
);
