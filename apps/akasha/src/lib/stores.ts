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
/** The holon this kiosk displays — set once on boot, read by writers. */
export const holonId = writable<string | null>(null);

export const rawQuests = writable<Quest[]>([]);
export const rawLibrary = writable<LibraryItem[]>([]);

export const events = derived(rawQuests, ($q) => toEvents($q));
export const backlog = derived(rawQuests, ($q) => toBacklog($q));
export const things = derived(rawLibrary, ($l) => toThings($l));

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
  { id: "calendar", label: "Calendar", glyph: "▦" },
  { id: "tasks", label: "Tasks", glyph: "✎" },
  { id: "library", label: "Library", glyph: "❖" },
] as const;

export const activeTab = writable<number>(0);

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
  activeTab.update((i) => (i + 1) % TABS.length);
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

/** Manually select a tab (also counts as an interaction). */
export function selectTab(i: number) {
  activeTab.set(i);
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
