// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reactive state for the kiosk: live lens data, a ticking clock, and the
// auto-rotation controller that flips between views unless someone is touching
// the screen.

import { writable, derived, get, type Readable } from "svelte/store";
import type { Quest } from "@holons/core/tasks";
import type { LibraryItem } from "@holons/core/library";
import type { Role } from "@holons/core/roles";
import type { Checklist } from "@holons/core/checklists";
import {
  toEvents,
  toBacklog,
  toBookingEvents,
  toThings,
  toRoles,
  toChecklists,
  toSuggestions,
  filterBySearch,
  categoryColorMap,
} from "./data";
import type { SearchSuggestions, TaskSort } from "./data";
import {
  FLIP_INTERVAL_MS,
  RESUME_AFTER_IDLE_MS,
  IDLE_HIDE_MS,
  isPhoneDisplay,
  setPinnedTab,
  resolvePinnedTab,
  type Scope,
  type TaskViewMode,
  type LibraryViewMode,
  type RolesViewMode,
  type CalendarMode,
  type TabPref,
} from "./config";
import { scopeLocal } from "./scope";
import { t, type MessageKey } from "./i18n";

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
 * Whose items the views show — the "Show" pill, shared by every view:
 * `personal` (only the logged-in user's), `all` (this holon), or `networked`
 * (this holon plus its federation partners). Persisted per device; hydrated
 * in `+layout.svelte`.
 */
export const scope = writable<Scope>("all");

/**
 * Whether federation partners are folded into the live subscriptions —
 * exactly "scope is networked". Derived so `+layout.svelte`'s subscription
 * re-pointing keeps working untouched; the derived stores below additionally
 * drop already-received partner records the moment the scope narrows (the
 * subscription's own purge is async).
 */
export const federated = derived(scope, ($s) => $s === "networked");

/**
 * Caretaker preference for the Library tab (persisted in config). `auto` — the
 * default — shows the tab exactly when the lens has content; an explicit
 * on/off wins. Anything but "off" keeps the library subscription alive in
 * `+layout.svelte` (auto needs the data to decide); `libraryEnabled` below
 * derives the tab's actual visibility.
 */
export const libraryPref = writable<TabPref>("auto");

/**
 * Caretaker preference for the optional Roles tab — same tri-state semantics
 * as `libraryPref`.
 */
export const rolesPref = writable<TabPref>("auto");

/**
 * Caretaker preference for the optional Lists (checklists) tab — same
 * tri-state semantics as `libraryPref`.
 */
export const checklistsPref = writable<TabPref>("auto");

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
 * How the Tasks backlog is ranked (the Sort pill): loved / new / manual.
 * Persisted per device via config; initialized in `+layout.svelte`.
 */
export const taskSort = writable<TaskSort>("loved");

/** Library layout: card grid / compact list / the user's borrowed things. */
export const libraryViewMode = writable<LibraryViewMode>("cards");

/** Roles layout: today cards / week grid / the user's own roles. */
export const rolesViewMode = writable<RolesViewMode>("cards");

/** Calendar window: day / week / month. Persisted per device via config. */
export const calendarMode = writable<CalendarMode>("day");

/**
 * Window of the Library's booking calendar — its own, not the Calendar tab's:
 * the question there is "which stretches is this gone for?", which the month
 * grid answers, so it opens on the month and remembers separately.
 */
export const libraryCalendarMode = writable<CalendarMode>("month");

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

/** Whether the user menu (account / dashboard / settings) is open. */
export const userMenuOpen = writable<boolean>(false);

export const rawQuests = writable<Quest[]>([]);
export const rawLibrary = writable<LibraryItem[]>([]);
export const rawRoles = writable<Role[]>([]);
export const rawChecklists = writable<Checklist[]>([]);

/**
 * Wall-clock time of the last live emission per lens, stamped by the layout's
 * subscription callbacks. This is the heartbeat the write-echo watchdog reads:
 * a successful LOCAL write must echo through its lens subscription within a
 * couple of seconds (same Gun graph, same process), so a write with no
 * emission after it proves the subscription has gone deaf — the one failure
 * that otherwise looks exactly like "the app stopped updating" and silently
 * eats every remote update too. Plain object, not a store: the watchdog polls
 * it point-in-time; nothing renders from it.
 */
export const lensEmitAt: Record<
  "quests" | "library" | "roles" | "checklists",
  number
> = {
  quests: 0,
  library: 0,
  roles: 0,
  checklists: 0,
};

// Scope narrows the raw records first (dropping partner copies outside the
// networked scope, keeping holograms), then search filters the view models.
// The translator is a derived input everywhere a view model bakes display
// text ("Untitled" fallbacks), so a language switch recomputes the boards.
export const events = derived(
  [rawQuests, partnerNames, searchQuery, scope, t],
  ([$q, $n, $query, $s, $t]) =>
    filterBySearch(toEvents(scopeLocal($q, $s), $n, $t), $query),
);
export const backlog = derived(
  [rawQuests, partnerNames, searchQuery, scope, taskSort, t],
  ([$q, $n, $query, $s, $sort, $t]) =>
    filterBySearch(toBacklog(scopeLocal($q, $s), $n, $sort, $t), $query),
);
// One palette slot per distinct category, derived from *all* quests (not a
// search- or scope-filtered subset) so a category keeps the same colour across
// the calendar and the task wall, and doesn't shift as the filters narrow.
export const categoryColors = derived(rawQuests, ($q) =>
  categoryColorMap($q.map((x) => x.category)),
);
export const things = derived(
  [rawLibrary, partnerNames, searchQuery, scope, t],
  ([$l, $n, $query, $s, $t]) =>
    filterBySearch(toThings(scopeLocal($l, $s), $n, $t), $query),
);
// The library's bookings as calendar spans — what the Library's calendar
// layout renders (through the same CalendarView the Calendar tab uses). No
// translator input: a booking's title is the item's own name, so there is no
// display text to re-resolve on a language switch.
export const bookingEvents = derived(
  [rawLibrary, partnerNames, searchQuery, scope],
  ([$l, $n, $query, $s]) =>
    filterBySearch(toBookingEvents(scopeLocal($l, $s), $n), $query),
);
export const roleCards = derived(
  [rawRoles, partnerNames, searchQuery, scope, t],
  ([$r, $n, $query, $s, $t]) =>
    filterBySearch(toRoles(scopeLocal($r, $s), $n, $t), $query),
);
export const checklistCards = derived(
  [rawChecklists, partnerNames, searchQuery, scope],
  ([$c, $n, $query, $s]) =>
    filterBySearch(toChecklists(scopeLocal($c, $s), $n), $query),
);
// Tap-to-filter chips for the search dropdown, derived from the *unqueried*
// view models so the list stays stable while a query narrows the boards —
// but scope-filtered, so local scopes don't suggest partner people/categories.
export const searchSuggestions: Readable<SearchSuggestions> = derived(
  [rawQuests, rawLibrary, rawRoles, partnerNames, scope, t],
  ([$q, $l, $r, $n, $s, $t]) =>
    toSuggestions(
      toEvents(scopeLocal($q, $s), $n, $t),
      toBacklog(scopeLocal($q, $s), $n, undefined, $t),
      toRoles(scopeLocal($r, $s), $n, $t),
      toThings(scopeLocal($l, $s), $n, $t),
    ),
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

// Labels are catalog keys resolved with `$t` where they render, so a language
// switch re-labels the tabs live (a module const must never freeze a
// translated string).
export const TABS = [
  { id: "tasks", labelKey: "tabs.tasks", glyph: "✎" },
  { id: "calendar", labelKey: "tabs.calendar", glyph: "▦" },
  { id: "library", labelKey: "tabs.library", glyph: "❖" },
  { id: "checklists", labelKey: "tabs.checklists", glyph: "☑" },
  { id: "roles", labelKey: "tabs.roles", glyph: "✪" },
  { id: "status", labelKey: "tabs.status", glyph: "♛" },
] as const satisfies readonly {
  id: string;
  labelKey: MessageKey;
  glyph: string;
}[];

export type TabId = (typeof TABS)[number]["id"];

/**
 * Whether the Library / Roles tab is actually shown: an explicit caretaker
 * choice wins; `auto` (the default) follows the content, so a hub that stocks
 * a library or defines roles gets those tabs without any setup, and an empty
 * lens doesn't waste a rotation slot. An explicitly-enabled tab shows even
 * while empty (its view has an empty state), so the board never silently drops
 * a tab the caretaker turned on.
 */
export const libraryEnabled = derived(
  [libraryPref, rawLibrary],
  ([$pref, $items]) =>
    $pref === "on" || ($pref === "auto" && $items.length > 0),
);
export const rolesEnabled = derived(
  [rolesPref, rawRoles],
  ([$pref, $items]) =>
    $pref === "on" || ($pref === "auto" && $items.length > 0),
);
export const checklistsEnabled = derived(
  [checklistsPref, rawChecklists],
  ([$pref, $items]) =>
    $pref === "on" || ($pref === "auto" && $items.length > 0),
);

/**
 * Tabs actually shown: Library, Lists, and Roles per their (possibly
 * content-driven) visibility above, Status only when the caretaker enabled it.
 */
export const visibleTabs = derived(
  [libraryEnabled, checklistsEnabled, rolesEnabled, statusEnabled],
  ([$library, $checklists, $roles, $status]) =>
    TABS.filter(
      (t) =>
        (t.id !== "library" || $library) &&
        (t.id !== "checklists" || $checklists) &&
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
// The kiosk advances one tab every FLIP_INTERVAL_MS — but only once the screen
// is truly unattended: RESUME_AFTER_IDLE_MS of stillness while the page is
// visible. Boot counts as activity (someone just opened it), and a hidden
// browser tab never accrues idle time — the countdown restarts from zero when
// the page is revealed. `flipAt` drives the thin progress bar so the screen
// telegraphs the next move.

export const rotating = writable<boolean>(false);
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

/**
 * When true, the global pills bar hides regardless of idle — a view holds
 * this while an in-view panel replaces its board (e.g. an open checklist),
 * where the filter pills would be meaningless chrome.
 */
export const pillsSuppressed = writable<boolean>(false);

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

function pauseRotation() {
  rotating.set(false);
  flipAt.set(null);
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = null;
}

/** Restart the unattended countdown: rotation resumes after a full
 *  RESUME_AFTER_IDLE_MS of visible stillness from now. */
function armResume() {
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    rotating.set(true);
    // A pinned kiosk snaps back to its view once everyone has walked away.
    const pin = get(pinnedTab);
    if (pin) activeTab.set(pin);
    scheduleFlip();
  }, RESUME_AFTER_IDLE_MS);
}

/** Begin the rotation loop. Returns a teardown function. */
export function startRotation(): () => void {
  autoRotates.set(!isPhoneDisplay());
  // Boot counts as activity — someone just opened or woke the page — so start
  // attended and let the countdown promote the screen to unattended.
  pauseRotation();
  if (typeof document === "undefined" || !document.hidden) armResume();
  tickTimer = setInterval(() => {
    // Never flip while a detail is zoomed forward or a view holds rotation open
    // (an open overlay) — that would yank the card out from under whoever's
    // reading or editing it. A hidden page never flips either.
    if (typeof document !== "undefined" && document.hidden) return;
    if (!get(rotating) || get(selection) != null || get(rotationHold)) return;
    const at = get(flipAt);
    if (at != null && Date.now() >= at) advance();
  }, 250);
  // Time on another browser tab must not count toward the unattended
  // countdown: freeze while hidden, restart the full countdown on reveal.
  const onVisibility = () => {
    if (document.hidden) pauseRotation();
    else armResume();
  };
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", onVisibility);
  return () => {
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", onVisibility);
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
  pauseRotation();
  idle.set(false);
  armResume();
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
  if (next) activeTab.set(next);
  // Either way the long-press itself was an interaction: stay paused and let
  // noteInteraction's countdown bring rotation back once everyone walks away.
  pauseRotation();
  armResume();
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

// With `auto` tab preferences the Library/Roles tabs come and go as their
// content streams in, so the active tab can be invalidated under the screen.
// Keep it coherent: a pinned tab that (re)appears reclaims an unattended
// screen (a pinned kiosk must not be stranded on the boot fallback once its
// view's data arrives), and an active tab that vanished falls back to the pin
// or the first visible tab. Module-lifetime subscription — these are app
// singletons, so it is never torn down. (Declared last: the callback runs
// synchronously on subscribe and reads stores defined above.)
visibleTabs.subscribe((tabs) => {
  const has = (id: TabId | null) => tabs.some((t) => t.id === id);
  const pin = get(pinnedTab);
  const cur = get(activeTab);
  if (pin && has(pin) && cur !== pin && get(rotating)) {
    activeTab.set(pin);
  } else if (!has(cur)) {
    activeTab.set(pin && has(pin) ? pin : (tabs[0]?.id ?? "tasks"));
  }
});
