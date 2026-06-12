// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reactive state for the kiosk: live lens data, a ticking clock, and the
// auto-rotation controller that flips between views unless someone is touching
// the screen.

import { writable, derived, get, type Readable } from "svelte/store";
import type { Quest } from "@holons/core/tasks";
import type { LibraryItem } from "@holons/core/library";
import { toEvents, toBacklog, toThings } from "./data";
import { FLIP_INTERVAL_MS, RESUME_AFTER_IDLE_MS } from "./config";

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

/** Federation partner id → display name, for the per-item source chips. */
export const partnerNames = writable<Record<string, string>>({});

/** Whether the Settings panel is open. */
export const settingsOpen = writable<boolean>(false);

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

export const events = derived([rawQuests, partnerNames], ([$q, $n]) =>
  toEvents($q, $n),
);
export const backlog = derived([rawQuests, partnerNames], ([$q, $n]) =>
  toBacklog($q, $n),
);
export const things = derived([rawLibrary, partnerNames], ([$l, $n]) =>
  toThings($l, $n),
);

// ── Detail / zoom selection ────────────────────────────────────────────────
//
// Clicking any post-it or card "brings it forward" into the DetailModal. The
// selection carries the full source record (not the view-model) so the modal
// can show every field and write edits straight back.

export type Selection =
  | { kind: "event"; quest: Quest }
  | { kind: "task"; quest: Quest }
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
] as const;

export type TabId = (typeof TABS)[number]["id"];

/** Tabs actually shown: the Library tab is hidden while it has no items. */
export const visibleTabs = derived(things, ($things) =>
  TABS.filter((t) => t.id !== "library" || $things.length > 0),
);

/** The active view — the kiosk opens on Tasks. */
export const activeTab = writable<TabId>("tasks");

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

let tickTimer: ReturnType<typeof setInterval> | null = null;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlip() {
  flipAt.set(Date.now() + FLIP_INTERVAL_MS);
}

function advance() {
  const tabs = get(visibleTabs);
  if (!tabs.length) return;
  const i = tabs.findIndex((t) => t.id === get(activeTab));
  activeTab.set(tabs[(i + 1) % tabs.length].id);
  scheduleFlip();
}

/** Begin the rotation loop. Returns a teardown function. */
export function startRotation(): () => void {
  rotating.set(true);
  scheduleFlip();
  tickTimer = setInterval(() => {
    // Never flip while a detail is zoomed forward — that would yank the card
    // out from under whoever's reading or editing it.
    if (!get(rotating) || get(selection) != null) return;
    const at = get(flipAt);
    if (at != null && Date.now() >= at) advance();
  }, 250);
  return () => {
    if (tickTimer) clearInterval(tickTimer);
    if (resumeTimer) clearTimeout(resumeTimer);
    tickTimer = null;
    resumeTimer = null;
  };
}

/** Call on any user interaction: pause rotation, arm the resume timer. */
export function noteInteraction() {
  rotating.set(false);
  flipAt.set(null);
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    rotating.set(true);
    scheduleFlip();
  }, RESUME_AFTER_IDLE_MS);
}

/** Manually select a tab by id (also counts as an interaction). */
export function selectTab(id: TabId) {
  activeTab.set(id);
  noteInteraction();
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
