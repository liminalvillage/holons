<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import { autoScrollToEnd } from "$lib/autoscroll";
  import {
    events,
    backlog,
    now,
    openQuest,
    rawQuests,
    holonId,
    selection,
    editOnOpen,
    categoryColors,
  } from "$lib/stores";
  import { isLoggedIn, loginOpen, telegramUser } from "$lib/auth";
  import { getWriter } from "$lib/holosphere";
  import { createTask, type Quest } from "@holons/core/tasks";
  import { toStoredInstant } from "@holons/core/datetime";
  import {
    noteColor,
    noteTilt,
    parseWhen,
    type CalendarEvent,
  } from "$lib/data";
  import Avatars from "$lib/components/Avatars.svelte";
  import VoiceButtons from "$lib/components/VoiceButtons.svelte";

  // Open tasks with no date yet — the source for "drag onto a day to schedule".
  $: unscheduled = $backlog.filter((t) => !t.due);

  function open(id: string) {
    if (justDragged) return;
    openQuest(id, "event");
  }
  function openTask(id: string) {
    if (justDragged) return;
    openQuest(id, "task");
  }
  function onKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(id);
    }
  }

  // ── Drag & drop: schedule / reschedule by dropping a card on a day ─────────-
  // Pointer-based so it works with touch and mouse alike. A small movement
  // threshold keeps a plain tap opening the detail card; a real drag writes the
  // new date back through the identity-aware writer (login required).
  let drag: { id: string; title: string; x: number; y: number } | null = null;
  let dropDay: string | null = null;
  let dropMin: number | null = null; // minutes-from-midnight when over the timeline
  let dropOnTray = false; // pointer is over the unscheduled drawer → clear the date
  let justDragged = false;
  let startX = 0;
  let startY = 0;
  let pendingId: string | null = null;
  let pendingTitle = "";

  function pad2(n: number): string {
    return String(n).padStart(2, "0");
  }
  function isoDay(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  // Build a local Date from a "YYYY-MM-DD" day + hours/minutes (used when a drag
  // or create picks a wall-clock slot). The store is always UTC, so callers pass
  // the result through `toStoredInstant` to serialize it as a UTC instant.
  function localDateTime(day: string, h: number, m: number): Date {
    const [y, mo, d] = day.split("-").map(Number);
    return new Date(y, (mo ?? 1) - 1, d ?? 1, h, m);
  }

  // Which day — and, over the hour timeline, which 15-minute slot — is under
  // the pointer right now.
  function computeDrop(x: number, y: number) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    // Over the drawer (or its drag-time drop hint) → unschedule, not reschedule.
    dropOnTray = el?.closest(".tray, .unschedule-zone") != null;
    const dayEl = dropOnTray
      ? null
      : (el?.closest<HTMLElement>("[data-day]") ?? null);
    dropDay = dayEl?.dataset.day ?? null;
    if (dayEl && dayEl.dataset.hours != null) {
      const rect = dayEl.getBoundingClientRect();
      const min = Math.round(minForY(y - rect.top) / 15) * 15;
      dropMin = Math.min(windowEndMin - 15, Math.max(DAY_MIN_START, min));
    } else {
      dropMin = null;
    }
  }

  function beginDrag(e: PointerEvent, id: string, title: string) {
    if (e.button != null && e.button !== 0) return;
    pendingId = id;
    pendingTitle = title;
    startX = e.clientX;
    startY = e.clientY;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  function unbind() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
  }

  function onPointerCancel() {
    unbind();
    drag = null;
    dropDay = null;
    dropMin = null;
    dropOnTray = false;
    pendingId = null;
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) {
      const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (moved < 8 || pendingId == null) return;
      drag = { id: pendingId, title: pendingTitle, x: e.clientX, y: e.clientY };
    }
    e.preventDefault();
    drag = { ...drag, x: e.clientX, y: e.clientY };
    computeDrop(e.clientX, e.clientY);
  }

  function onPointerUp() {
    unbind();
    const id = drag?.id ?? null;
    const day = dropDay;
    const min = dropMin;
    const toTray = dropOnTray;
    const dragged = drag != null;
    drag = null;
    dropDay = null;
    dropMin = null;
    dropOnTray = false;
    pendingId = null;
    if (dragged && id && toTray) {
      justDragged = true; // swallow the click that follows this pointerup
      setTimeout(() => (justDragged = false), 0);
      void applyUnschedule(id);
    } else if (dragged && id && day) {
      justDragged = true; // swallow the click that follows this pointerup
      setTimeout(() => (justDragged = false), 0);
      void applyDrop(id, day, min);
    }
  }

  async function applyDrop(id: string, day: string, min: number | null) {
    const hid = get(holonId);
    if (!hid) return;
    const q = get(rawQuests).find((x) => String(x.id ?? x.title) === id);
    if (!q) return;
    if (!get(isLoggedIn)) {
      loginOpen.set(true);
      return;
    }
    const oldStart = parseWhen(q.when) ?? new Date(NaN);
    let when: string;
    let newStart: Date;
    if (min != null) {
      // Dropped on the hour timeline → that day at that wall-clock time.
      newStart = localDateTime(day, Math.floor(min / 60), min % 60);
      when = toStoredInstant(newStart);
    } else if (q.when && /T\d\d:/.test(String(q.when))) {
      // Dropped on a day cell, but it already had a time → keep the time.
      newStart = localDateTime(day, oldStart.getHours(), oldStart.getMinutes());
      when = toStoredInstant(newStart);
    } else {
      when = day; // all-day (bare date)
      newStart = localDateTime(day, 0, 0);
    }

    const updated = { ...q, when };
    // Moving the whole card shifts the start — carry the end along by the same
    // delta so the event keeps its length.
    const oldEnds = parseWhen(q.ends ?? q.until) ?? new Date(NaN);
    if (!Number.isNaN(oldStart.getTime()) && !Number.isNaN(oldEnds.getTime())) {
      const delta = newStart.getTime() - oldStart.getTime();
      updated.ends = toStoredInstant(new Date(oldEnds.getTime() + delta));
    }
    const writer = await getWriter(hid);
    await writer.put("quests", updated);
  }

  // Dropping a card back into the drawer clears its date, returning it to the
  // unscheduled pool. Empty-string is the codebase's "no date" sentinel (see
  // createTask), so we blank `when`/`ends`/`until` rather than deleting them.
  // A pure calendar event only renders while it's dated — clearing the date
  // would make it vanish from every view — so we also flip its type to a plain
  // task, which keeps it visible in the drawer (and on the Tasks wall).
  async function applyUnschedule(id: string) {
    const hid = get(holonId);
    if (!hid) return;
    const q = get(rawQuests).find((x) => String(x.id ?? x.title) === id);
    if (!q) return;
    if (!q.when) return; // already unscheduled — nothing to clear
    if (!get(isLoggedIn)) {
      loginOpen.set(true);
      return;
    }
    const updated: Quest = { ...q, when: "", ends: "", until: "" };
    if (String(q.type ?? "").toLowerCase() === "event") updated.type = "task";
    const writer = await getWriter(hid);
    await writer.put("quests", updated);
  }

  // ── Long-press / + to create ──────────────────────────────────────────────-
  // Holding still on an empty hour, day cell or week row for ~half a second
  // drops a fresh draft task there and opens the detail card in edit mode. A
  // bare day (no time component) becomes an all-day task; the hour timeline
  // also carries the pressed time. New cards are plain tasks (not pure events)
  // so they show on both the Tasks wall and here. The draft is only written on
  // Save, so a cancel leaves no trace. Moving past a small threshold (a
  // scroll/drag) or lifting early aborts, and presses that land on an existing
  // card are ignored.
  const LONG_PRESS_MS = 500;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressX = 0;
  let pressY = 0;

  function newId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clearPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    window.removeEventListener("pointermove", onPressMove);
    window.removeEventListener("pointerup", clearPress);
    window.removeEventListener("pointercancel", clearPress);
  }

  function onPressMove(e: PointerEvent) {
    if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > 10) clearPress();
  }

  function beginCreatePress(e: PointerEvent) {
    if (e.button != null && e.button !== 0) return;
    const el = e.target as HTMLElement;
    // Never start a create-press on an existing card or control — those carry
    // their own drag/tap/resize gestures.
    if (
      el.closest(
        ".day-event, .allday-chip, .chip, .note, .resize-handle, .tray-chip",
      )
    )
      return;
    const dayEl = el.closest<HTMLElement>("[data-day]");
    if (!dayEl) return;
    const day = dayEl.dataset.day;
    if (!day) return;
    const hasHours = dayEl.dataset.hours != null;
    const rect = dayEl.getBoundingClientRect();
    pressX = e.clientX;
    pressY = e.clientY;
    const y = e.clientY;
    pressTimer = setTimeout(() => {
      clearPress();
      let min: number | null = null;
      if (hasHours) {
        const m = Math.round(minForY(y - rect.top) / 15) * 15;
        min = Math.min(windowEndMin - 15, Math.max(DAY_MIN_START, m));
      }
      try {
        navigator.vibrate?.(15);
      } catch {
        /* haptics are best-effort */
      }
      void createAt(day, min);
    }, LONG_PRESS_MS);
    window.addEventListener("pointermove", onPressMove);
    window.addEventListener("pointerup", clearPress);
    window.addEventListener("pointercancel", clearPress);
  }

  // Build a draft task for `day` (and, on the hour timeline, `min` minutes from
  // midnight) and open it in the detail modal's edit mode. Login-gated, like the
  // other writes in this view.
  async function createAt(day: string, min: number | null) {
    const hid = get(holonId);
    if (!hid) return;
    const user = get(telegramUser);
    if (!user) {
      loginOpen.set(true);
      return;
    }
    const draft = createTask({
      holonId: hid,
      initiator: {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      },
      title: "",
    });
    draft.id = newId();
    draft.when =
      min != null
        ? toStoredInstant(localDateTime(day, Math.floor(min / 60), min % 60))
        : day;
    editOnOpen.set(true); // open straight in edit mode
    selection.set({ kind: "task", quest: draft, isNew: true });
  }

  // The + button creates an all-day draft on a day that's currently in view, so
  // the new card lands where the user is looking: the open day, or today when
  // it falls inside the shown week/month, else the first day of that period.
  function defaultCreateDay(): string {
    const today = startOfDay(get(now));
    if (mode === "day") return isoDay(anchorDay);
    if (mode === "week")
      return isoDay(
        weekDays.some((d) => sameDay(d, today)) ? today : weekDays[0],
      );
    return isoDay(
      today.getMonth() === monthAnchor.getMonth() &&
        today.getFullYear() === monthAnchor.getFullYear()
        ? today
        : monthAnchor,
    );
  }

  function openCreate() {
    void createAt(defaultCreateDay(), null);
  }

  // ── Resize: drag a day-event's bottom edge to change its length ───────────--
  let resize: {
    id: string;
    startY: number;
    baseMin: number;
    curMin: number;
  } | null = null;

  /** Event length in minutes — from `ends`, else a default one hour. */
  function eventDurationMin(ev: CalendarEvent): number {
    if (ev.end) {
      const d = (ev.end.getTime() - ev.date.getTime()) / 60000;
      if (d >= 15) return d;
    }
    return 60;
  }

  function beginResize(e: PointerEvent, ev: CalendarEvent) {
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation(); // a resize must not also start a move-drag
    e.preventDefault();
    const base = eventDurationMin(ev);
    resize = { id: ev.id, startY: e.clientY, baseMin: base, curMin: base };
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", onResizeUp);
    window.addEventListener("pointercancel", onResizeUp);
  }

  function onResizeMove(e: PointerEvent) {
    if (!resize) return;
    e.preventDefault();
    const deltaMin = ((e.clientY - resize.startY) / HOUR_PX) * 60;
    let min = Math.round((resize.baseMin + deltaMin) / 15) * 15; // 15-min snap
    min = Math.max(15, Math.min(24 * 60, min));
    resize = { ...resize, curMin: min };
  }

  function onResizeUp() {
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeUp);
    window.removeEventListener("pointercancel", onResizeUp);
    const r = resize;
    resize = null;
    if (r && r.curMin !== r.baseMin) {
      justDragged = true; // swallow the click that follows pointerup
      setTimeout(() => (justDragged = false), 0);
      void applyResize(r.id, r.curMin);
    }
  }

  async function applyResize(id: string, durMin: number) {
    const hid = get(holonId);
    if (!hid) return;
    const q = get(rawQuests).find((x) => String(x.id ?? x.title) === id);
    if (!q) return;
    if (!get(isLoggedIn)) {
      loginOpen.set(true);
      return;
    }
    const start = parseWhen(q.when);
    if (!start || Number.isNaN(start.getTime())) return;
    const ends = toStoredInstant(new Date(start.getTime() + durMin * 60000));
    const writer = await getWriter(hid);
    await writer.put("quests", { ...q, ends });
  }

  type Mode = "day" | "week" | "month";
  const MODES: Mode[] = ["day", "week", "month"];
  let mode: Mode = "day";

  // Navigation offset, in units of the current mode (days / weeks / months).
  // Resets to 0 whenever the mode changes, so each view opens on "now".
  let offset = 0;
  function setMode(m: Mode) {
    mode = m;
    offset = 0;
    if (m === "day") void focusDay();
  }
  function step(dir: 1 | -1) {
    offset += dir;
    if (mode === "day") void focusDay();
  }

  const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

  function sameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }
  function startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function addDays(d: Date, n: number): Date {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function eventsOn(day: Date, all: CalendarEvent[]): CalendarEvent[] {
    return all
      .filter((e) => sameDay(e.date, day))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }
  function tiltStyle(id: string, bg: string): string {
    return `--tilt: ${noteTilt(id)}deg; background: ${bg};`;
  }
  // Shared category→colour map (see stores) so an event's note matches the same
  // category on the task wall; blank categories fall back to the hash.
  const noteColorFor = (category: string | undefined): string =>
    (category ? $categoryColors.get(category) : undefined) ??
    noteColor(category);

  // ── Anchors (driven by the live clock + nav offset) ───────────────────────
  $: anchorDay = addDays(startOfDay($now), mode === "day" ? offset : 0);

  $: weekDays = (() => {
    const start = startOfDay($now);
    start.setDate(start.getDate() - start.getDay() + offset * 7);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  })();

  $: monthAnchor = new Date($now.getFullYear(), $now.getMonth() + offset, 1);
  $: monthGrid = (() => {
    const start = new Date(monthAnchor);
    start.setDate(1 - monthAnchor.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  })();

  // ── Day timeline (hour grid + "now" line + drag-to-arrange) ───────────────-
  // The day timeline covers waking hours only (08:00–23:00) rather than a full
  // 24h, so the grid is compact and the day's events fill it. Times outside the
  // window are clamped onto its edges.
  const DAY_START_HOUR = 8;
  const DAY_END_HOUR = 23;
  const DAY_MIN_START = DAY_START_HOUR * 60;
  // Hour height tracks the (fluid) root font so the timeline scales with the
  // rest of the kiosk — bigger rows on a large display, tighter on a phone.
  let scrollEl: HTMLElement;
  let rootRem = 16;
  // Live height of the unscheduled drawer, so the + button rides above it.
  let trayHeight = 0;
  $: HOUR_PX = Math.round(rootRem * 3.4);

  function measureRem() {
    if (typeof document === "undefined") return;
    rootRem =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }

  function fmtHour(h: number): string {
    return `${pad2(h)}:00`;
  }
  function minutesOf(d: Date): number {
    return d.getHours() * 60 + d.getMinutes();
  }
  // Vertical pixel offset for a time (minutes from midnight) within the window,
  // and its inverse (pixels → minutes). The window starts at DAY_MIN_START.
  // `hpx` defaults to the live HOUR_PX for plain JS callers; markup MUST pass
  // HOUR_PX explicitly so Svelte tracks it as a dependency and re-runs the
  // position when the responsive root font-size (and thus HOUR_PX) changes —
  // otherwise the hour labels freeze at the first-paint scale while events and
  // the now-line re-render at the new one, drifting the layers apart.
  function yForMin(min: number, hpx: number = HOUR_PX): number {
    return ((min - DAY_MIN_START) / 60) * hpx;
  }
  function minForY(y: number): number {
    return DAY_MIN_START + (y / HOUR_PX) * 60;
  }

  // Scroll the timeline so the "now" line sits 1.5h from the top (today), or the
  // morning otherwise. Runs after layout (tick + rAF) so it lands reliably every
  // time the calendar is opened, not just the live clock ticking.
  async function focusDay() {
    await tick();
    requestAnimationFrame(() => {
      if (!scrollEl) return;
      const mins = sameDay(anchorDay, get(now))
        ? minutesOf(get(now))
        : DAY_MIN_START;
      scrollEl.scrollTop = Math.max(0, yForMin(mins) - HOUR_PX * 1.5);
    });
  }

  // ── Side-by-side layout for colliding events ──────────────────────────────-
  // Greedy interval-graph colouring: events that overlap in time are split into
  // columns so they sit next to each other instead of stacking. Each event gets
  // { col, cols } — its column index and how many columns its overlap cluster
  // needs — which the template turns into a left offset + width.
  function eventLayout(
    evs: CalendarEvent[],
  ): Map<string, { col: number; cols: number }> {
    const items = evs
      .map((ev) => {
        const start = minutesOf(ev.date);
        return { id: ev.id, start, end: start + eventDurationMin(ev), col: 0 };
      })
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const out = new Map<string, { col: number; cols: number }>();
    let group: typeof items = [];
    let colEnds: number[] = []; // running end-time of each active column
    let groupCols = 0;
    let clusterEnd = -Infinity;

    const flush = () => {
      for (const it of group) out.set(it.id, { col: it.col, cols: groupCols });
      group = [];
      colEnds = [];
      groupCols = 0;
    };

    for (const it of items) {
      if (group.length && it.start >= clusterEnd) flush();
      let c = colEnds.findIndex((end) => end <= it.start);
      if (c === -1) {
        c = colEnds.length;
        colEnds.push(it.end);
      } else {
        colEnds[c] = it.end;
      }
      it.col = c;
      group.push(it);
      groupCols = Math.max(groupCols, colEnds.length);
      clusterEnd = Math.max(clusterEnd, it.end);
    }
    flush();
    return out;
  }

  onMount(() => {
    measureRem();
    window.addEventListener("resize", measureRem);
    if (mode === "day") void focusDay();
    // Kiosk displays are unattended — glide the timeline once so booked content
    // below the fold is shown without anyone dragging. Capped at the lowest
    // booked event so it never scrolls down into empty evening hours.
    const stopAutoScroll = scrollEl
      ? autoScrollToEnd(scrollEl, {
          maxScrollTop: () =>
            Math.max(0, contentBottomPx - scrollEl.clientHeight + rootRem),
        })
      : () => {};
    return () => {
      window.removeEventListener("resize", measureRem);
      stopAutoScroll();
    };
  });

  // ── Day view: one column, or two when the screen is wide enough ────────────-
  // On a roomy (landscape kiosk) display the day timeline gains a second column
  // showing the *next* day side-by-side, so you can see what's coming. It folds
  // back to a single column on narrow screens. Both columns share the hour grid
  // and the same drag/drop/create machinery (resolved via each column's
  // `data-day`), so the next day is fully interactive too.
  let bodyWidth = 0;
  const TWIN_MIN_REM = 40; // show the second column only past this width
  $: showNextDay = mode === "day" && bodyWidth >= TWIN_MIN_REM * rootRem;
  $: nextDay = addDays(anchorDay, 1);
  // The "now" line only makes sense while the clock is inside the visible window.
  $: nowInWindow =
    minutesOf($now) >= DAY_MIN_START && minutesOf($now) <= windowEndMin;

  interface DayColumn {
    iso: string;
    label: string;
    allDay: CalendarEvent[];
    timed: CalendarEvent[];
    layout: Map<string, { col: number; cols: number }>;
    isToday: boolean;
    /** The primary (left) column keeps the hour-label gutter; the next day drops it. */
    primary: boolean;
  }
  function makeColumn(day: Date, primary: boolean): DayColumn {
    const evs = eventsOn(day, $events);
    const timed = evs.filter((e) => !e.allDay);
    return {
      iso: isoDay(day),
      label: day.toLocaleDateString([], {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
      allDay: evs.filter((e) => e.allDay),
      timed,
      layout: eventLayout(timed),
      isToday: sameDay(day, $now),
      primary,
    };
  }
  $: dayCols = showNextDay
    ? [makeColumn(anchorDay, true), makeColumn(nextDay, false)]
    : [makeColumn(anchorDay, true)];

  // Inline geometry for a timed event's note. The next-day column has no hour
  // gutter, so its events span the full column width.
  function eventBox(
    ev: CalendarEvent,
    durMin: number,
    lay: { col: number; cols: number },
    gutter: boolean,
    hpx: number = HOUR_PX,
  ): string {
    const top = yForMin(minutesOf(ev.date), hpx);
    const height = (durMin / 60) * hpx;
    const pad = gutter ? "3.2rem" : "0.15rem";
    const inner = gutter ? "3.5rem" : "0.3rem";
    return (
      `top: ${top}px; height: ${height}px;` +
      ` left: calc(${pad} + (100% - ${inner}) * ${lay.col} / ${lay.cols});` +
      ` width: calc((100% - ${inner}) / ${lay.cols} - 0.2rem);` +
      ` background: ${noteColorFor(ev.category)};`
    );
  }

  // The grid always covers the full 08:00–23:00 window, so every hour line is
  // present and the user can scroll the whole day by hand. (We don't trim it to
  // content — that left later hours unreachable on short screens.)
  const HOURS = Array.from(
    { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
    (_, i) => DAY_START_HOUR + i,
  );
  $: gridHeight = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX;
  $: windowEndMin = DAY_END_HOUR * 60;

  // Pixel offset of the lowest booked event (and "now" today). Used only to cap
  // the unattended auto-scroll so it reveals booked content but never glides off
  // into empty evening hours.
  $: contentBottomPx = (() => {
    let b = 0;
    for (const col of dayCols) {
      if (col.isToday) b = Math.max(b, yForMin(minutesOf($now)));
      for (const ev of col.timed) {
        b = Math.max(
          b,
          yForMin(minutesOf(ev.date)) + (eventDurationMin(ev) / 60) * HOUR_PX,
        );
      }
    }
    return b;
  })();

  $: periodLabel =
    mode === "day"
      ? anchorDay.toLocaleDateString([], {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      : mode === "week"
        ? `${weekDays[0].toLocaleDateString([], { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString([], { day: "numeric", month: "short" })}`
        : monthAnchor.toLocaleDateString([], {
            month: "long",
            year: "numeric",
          });

  function timeLabel(e: CalendarEvent): string {
    return e.allDay
      ? "all day"
      : e.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ── Thin events: inline title + shrink-to-fit ─────────────────────────────--
  // A short event (e.g. a 15-minute slot) is too thin for the stacked
  // time-over-title layout — the title spills past the box and gets clipped. So
  // below this rendered height we switch to a single inline line (time then
  // title) whose font shrinks until it fits (see `.day-event.compact` and
  // `fitLine`). `min-height: 1.6rem` floors how thin a box actually renders, so
  // the threshold and font sizing reckon with that effective height.
  const MIN_EVENT_REM = 1.6;
  $: COMPACT_PX = rootRem * 2.5;
  function renderHeightPx(heightPx: number): number {
    return Math.max(heightPx, rootRem * MIN_EVENT_REM);
  }
  // Largest line font (px) that fits a compact event's (vertically-centred)
  // height, kept within a legible band so it never balloons or vanishes.
  function compactFont(heightPx: number): number {
    const fit = renderHeightPx(heightPx) / 1.3;
    return Math.max(rootRem * 0.5, Math.min(rootRem * 0.82, fit));
  }

  // Shrink a compact event's inline line until its single (nowrap) row fits the
  // column width, so a long title is never clipped — only made smaller. Starts
  // from the height-derived `--ev-font` base and steps down to a legible floor.
  // Re-runs (rAF-coalesced) whenever its key — title, duration, scale, layout —
  // changes; the key is passed as the action parameter.
  // `_key` is unused inside, but declaring it lets Svelte type `use:fitLine={…}`
  // and re-invoke `update` each time the key changes.
  function fitLine(node: HTMLElement, _key: string) {
    let raf = 0;
    const fit = () => {
      raf = 0;
      node.style.fontSize = ""; // back to the CSS base (--ev-font)
      let px = parseFloat(getComputedStyle(node).fontSize) || 12;
      let guard = 0;
      while (
        node.scrollWidth > node.clientWidth + 0.5 &&
        px > 6 &&
        guard++ < 60
      ) {
        px -= 0.5;
        node.style.fontSize = `${px}px`;
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(fit);
    };
    schedule();
    return {
      update: (_next: string) => schedule(),
      destroy: () => raf && cancelAnimationFrame(raf),
    };
  }
</script>

<div
  class="cal"
  class:has-tray={unscheduled.length}
  style="--tray-h: {trayHeight}px;"
>
  <header class="head">
    <div class="seg" role="tablist" aria-label="Calendar view">
      {#each MODES as m}
        <button
          class="seg-btn"
          class:active={mode === m}
          role="tab"
          aria-selected={mode === m}
          on:click={() => setMode(m)}>{m}</button
        >
      {/each}
    </div>
    <div class="nav">
      <button class="arrow" on:click={() => step(-1)} aria-label="Previous"
        >‹</button
      >
      <h2 class="period">{periodLabel}</h2>
      <button class="arrow" on:click={() => step(1)} aria-label="Next">›</button
      >
    </div>
  </header>

  <div
    class="scrollarea scroll"
    bind:this={scrollEl}
    bind:clientWidth={bodyWidth}
  >
    {#if mode === "month"}
      <div class="weekdays">
        {#each WEEKDAYS as w}<span>{w}</span>{/each}
      </div>
      <div class="grid">
        {#each monthGrid as day}
          {@const evs = eventsOn(day, $events)}
          {@const inMonth = day.getMonth() === monthAnchor.getMonth()}
          {@const isToday = sameDay(day, $now)}
          {@const iso = isoDay(day)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="cell"
            class:dim={!inMonth}
            class:today={isToday}
            class:drop={dropDay === iso}
            data-day={iso}
            on:pointerdown={beginCreatePress}
          >
            <span class="num">{day.getDate()}</span>
            <div class="chips">
              {#each evs.slice(0, 2) as ev (ev.id)}
                <span class="lift chip-wrap">
                  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                  <span
                    class="chip tilt draggable"
                    class:is-foreign={!!ev.sourceColor}
                    style="{tiltStyle(
                      ev.id,
                      noteColorFor(ev.category),
                    )} --glow: {ev.sourceColor ?? 'transparent'};"
                    title={ev.title}
                    role="button"
                    tabindex="0"
                    on:pointerdown={(e) => beginDrag(e, ev.id, ev.title)}
                    on:click={() => open(ev.id)}
                    on:keydown={(e) => onKey(e, ev.id)}>{ev.title}</span
                  >
                </span>
              {/each}
              {#if evs.length > 2}
                <span class="more">+{evs.length - 2}</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else if mode === "week"}
      <div class="week">
        {#each weekDays as day (day.toISOString())}
          {@const evs = eventsOn(day, $events)}
          {@const isToday = sameDay(day, $now)}
          {@const iso = isoDay(day)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="row"
            class:today={isToday}
            class:drop={dropDay === iso}
            data-day={iso}
            on:pointerdown={beginCreatePress}
          >
            <div class="daychip">
              <span class="dow"
                >{day.toLocaleDateString([], { weekday: "short" })}</span
              >
              <span class="dom">{day.getDate()}</span>
            </div>
            {#if evs.length}
              <div class="row-notes">
                {#each evs as ev (ev.id)}
                  <span class="lift">
                    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                    <article
                      class="note sm tilt draggable"
                      class:is-foreign={!!ev.sourceColor}
                      style="{tiltStyle(
                        ev.id,
                        noteColorFor(ev.category),
                      )} --glow: {ev.sourceColor ?? 'transparent'};"
                      role="button"
                      tabindex="0"
                      on:pointerdown={(e) => beginDrag(e, ev.id, ev.title)}
                      on:click={() => open(ev.id)}
                      on:keydown={(e) => onKey(e, ev.id)}
                    >
                      <span class="when">{timeLabel(ev)}</span>
                      <span class="ttl">{ev.title}</span>
                    </article>
                  </span>
                {/each}
              </div>
            {:else}
              <span class="row-empty">—</span>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <!-- day timeline — one column, or two (with the next day) when wide -->
      <div class="day-cols" class:twin={dayCols.length > 1}>
        <!-- Date band: only needed with two columns (the period header already
             names the day in single-column view). Sticks above the timeline so
             each column's day stays visible while the hours scroll. -->
        {#if dayCols.length > 1}
          <div class="col-heads">
            {#each dayCols as col (col.iso)}
              <div class="col-head" class:today={col.isToday}>{col.label}</div>
            {/each}
          </div>
        {/if}

        {#if dayCols.some((c) => c.allDay.length)}
          <div class="allday-row">
            {#each dayCols as col (col.iso)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="allday"
                class:drop={dropDay === col.iso && dropMin === null}
                data-day={col.iso}
                on:pointerdown={beginCreatePress}
              >
                <span class="allday-label">all day</span>
                <div class="allday-items">
                  {#each col.allDay as ev (ev.id)}
                    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                    <span
                      class="allday-chip draggable"
                      class:is-foreign={!!ev.sourceColor}
                      style="background: {noteColorFor(
                        ev.category,
                      )}; --glow: {ev.sourceColor ?? 'transparent'};"
                      role="button"
                      tabindex="0"
                      title={ev.title}
                      on:pointerdown={(e) => beginDrag(e, ev.id, ev.title)}
                      on:click={() => open(ev.id)}
                      on:keydown={(e) => onKey(e, ev.id)}>{ev.title}</span
                    >
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- One shared hour grid behind both day columns, so the lines are drawn
             once: they always line up across days and never glitch on scroll. -->
        <div class="hours-row" style="height: {gridHeight}px;">
          <div class="hour-grid" aria-hidden="true">
            {#each HOURS as h}
              <div class="hour" style="top: {yForMin(h * 60, HOUR_PX)}px;">
                <span class="hour-label">{fmtHour(h)}</span>
              </div>
            {/each}
          </div>

          {#each dayCols as col (col.iso)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="hours-col"
              data-day={col.iso}
              data-hours="1"
              on:pointerdown={beginCreatePress}
            >
              {#if dropDay === col.iso && dropMin !== null}
                <div
                  class="slot-hint"
                  style="top: {yForMin(dropMin, HOUR_PX)}px;"
                ></div>
              {/if}

              {#each col.timed as ev (ev.id)}
                {@const durMin =
                  resize?.id === ev.id ? resize.curMin : eventDurationMin(ev)}
                {@const lay = col.layout.get(ev.id) ?? { col: 0, cols: 1 }}
                {@const heightPx = (durMin / 60) * HOUR_PX}
                {@const compact = heightPx < COMPACT_PX}
                {@const durLabel = `${Math.floor(durMin / 60)}h${
                  durMin % 60 ? ` ${durMin % 60}m` : ""
                }`}
                <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                <article
                  class="day-event draggable"
                  class:resizing={resize?.id === ev.id}
                  class:is-foreign={!!ev.sourceColor}
                  class:compact
                  style="{eventBox(
                    ev,
                    durMin,
                    lay,
                    col.primary,
                    HOUR_PX,
                  )} --glow: {ev.sourceColor ??
                    'transparent'}; --ev-font: {compactFont(heightPx)}px;"
                  role="button"
                  tabindex="0"
                  on:pointerdown={(e) => beginDrag(e, ev.id, ev.title)}
                  on:click={() => open(ev.id)}
                  on:keydown={(e) => onKey(e, ev.id)}
                >
                  {#if compact}
                    <!-- Too thin to stack: time then title on one shrink-to-fit
                         line, so the title sits next to the hour and is never
                         clipped (see fitLine). -->
                    <span
                      class="cline"
                      use:fitLine={`${ev.title}|${durMin}|${HOUR_PX}|${lay.cols}|${bodyWidth}`}
                    >
                      <span class="when"
                        >{timeLabel(ev)}{#if resize?.id === ev.id}<span
                            class="dur">&nbsp;· {durLabel}</span
                          >{/if}</span
                      >
                      <span class="ttl">{ev.title}</span>
                    </span>
                  {:else}
                    <span class="when"
                      >{timeLabel(ev)}{#if resize?.id === ev.id}<span
                          class="dur"
                        >
                          · {durLabel}</span
                        >{/if}</span
                    >
                    <span class="ttl">{ev.title}</span>
                    {#if ev.location}<span class="where">{ev.location}</span
                      >{/if}
                    {#if ev.source}<span class="src">⇄ {ev.source}</span>{/if}
                    {#if ev.people.length || ev.appreciation}
                      <div class="ev-foot">
                        {#if ev.appreciation}<span class="appr"
                            ><span class="h">♥</span> {ev.appreciation}</span
                          >{/if}
                        {#if ev.people.length}
                          <Avatars people={ev.people} size="1.35rem" />
                        {/if}
                      </div>
                    {/if}
                  {/if}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span
                    class="resize-handle"
                    on:pointerdown={(e) => beginResize(e, ev)}
                    aria-hidden="true"
                  ></span>
                </article>
              {/each}

              {#if col.isToday && nowInWindow}
                <div
                  class="now-line"
                  style="top: {yForMin(minutesOf($now), HOUR_PX)}px;"
                >
                  <span class="now-dot"></span>
                  <span class="now-time"
                    >{$now.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}</span
                  >
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  {#if unscheduled.length}
    <div class="tray" class:drop={dropOnTray} bind:clientHeight={trayHeight}>
      <span class="tray-label"
        >{drag
          ? "Drop here to unschedule"
          : "Unscheduled — drag onto a day"}</span
      >
      <div class="tray-items scroll">
        {#each unscheduled as task (task.id)}
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
          <span
            class="tray-chip draggable"
            class:is-foreign={!!task.sourceColor}
            style="background: {noteColorFor(
              task.category,
            )}; --glow: {task.sourceColor ?? 'transparent'};"
            role="button"
            tabindex="0"
            title={task.title}
            on:pointerdown={(e) => beginDrag(e, task.id, task.title)}
            on:click={() => openTask(task.id)}
            on:keydown={(e) => e.key === "Enter" && openTask(task.id)}
            >{task.title}</span
          >
        {/each}
      </div>
    </div>
  {:else if drag}
    <!-- No unscheduled tasks yet, so the drawer is hidden — surface a transient
         drop zone during a drag so a card can still be pulled off the calendar.
         Absolutely positioned, so revealing it doesn't reflow the timeline. -->
    <div class="unschedule-zone" class:drop={dropOnTray} aria-hidden="true">
      Drop here to unschedule
    </div>
  {/if}

  <div class="fabrow">
    <VoiceButtons />
    <button
      class="fab"
      on:click={openCreate}
      aria-label="New task"
      title="New task">＋</button
    >
  </div>
</div>

{#if drag}
  <div
    class="drag-ghost"
    style="left: {drag.x}px; top: {drag.y}px;"
    aria-hidden="true"
  >
    {drag.title}
  </div>
{/if}

<style>
  /* App-shell grid: a fixed header row, a scrolling middle row, and a fixed
     bottom drawer row. The middle row is minmax(0, 1fr) so it (and only it)
     shrinks/scrolls — the header (date + day/week/month) and the drawer can
     never be pushed out of view, even when the drawer appears. */
  .cal {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    /* Width of the unscheduled drawer when it rides on the right (landscape). */
    --tray-w: clamp(13rem, 22vw, 19rem);
    /* minmax(0, 1fr) so the single column can't be widened past the container
       by the drawer's no-wrap chips — they scroll inside the drawer instead. */
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
  }

  /* Landscape (wider than tall): the unscheduled drawer becomes a right-hand
     sidebar spanning the full height beside the header + calendar, instead of a
     bottom bar — better use of the extra width. Portrait keeps the bottom bar
     (the base grid above). */
  @media (min-aspect-ratio: 1/1) {
    .cal.has-tray {
      grid-template-columns: minmax(0, 1fr) var(--tray-w);
      grid-template-rows: auto minmax(0, 1fr);
      grid-template-areas:
        "head tray"
        "main tray";
    }
    .cal.has-tray .head {
      grid-area: head;
    }
    .cal.has-tray .scrollarea {
      grid-area: main;
    }
    .cal.has-tray .tray {
      grid-area: tray;
      min-height: 0;
      /* Clamp the drawer to its grid area so its tall chip list can't inflate
         the spanned rows past the viewport — that left the list unscrollable. */
      overflow: hidden;
      display: flex;
      flex-direction: column;
      border-top: none;
      border-left: 1px solid var(--line);
    }
    /* Chips stack vertically and scroll down the sidebar. `flex: 1` bounds the
       list to the drawer's height so overflowing chips scroll instead of being
       clipped. */
    .cal.has-tray .tray-items {
      flex: 1 1 0;
      flex-direction: column;
      flex-wrap: nowrap;
      overflow-x: hidden;
      overflow-y: auto;
      min-height: 0;
      /* Vertical scroll clips left/right, so inset the chips there too — keeps
         the glow edge off the sidebar boundary. */
      padding: 0.4rem 0.7rem;
      gap: 0.85rem;
    }
    .cal.has-tray .tray-chip {
      max-width: none;
      white-space: normal;
      /* Vertical scroll now; a horizontal drag lifts a chip onto the calendar. */
      touch-action: pan-y;
    }
    /* Keep the FAB row clear of the right sidebar. */
    .cal.has-tray .fabrow {
      right: calc(var(--tray-w) + 1.3rem);
    }
  }

  /* "New task" floating button — pinned to the corner with the voice buttons
     in one row, lifted above the unscheduled drawer when it's present. */
  .fabrow {
    position: absolute;
    right: 1.3rem;
    bottom: 1.3rem;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    z-index: 7;
    transition: bottom 0.18s ease;
  }
  .fab {
    width: 3.4rem;
    height: 3.4rem;
    border-radius: 50%;
    font-size: 2rem;
    line-height: 1;
    color: #fff;
    background: var(--teal);
    box-shadow: 0 10px 24px rgba(14, 107, 102, 0.4);
    display: grid;
    place-items: center;
    transition:
      transform 0.12s ease,
      background 0.15s ease;
  }
  .fab:active {
    transform: scale(0.92);
    background: var(--teal-deep);
  }
  /* Portrait: the drawer sits at the bottom, so lift the FAB row above it. */
  @media (max-aspect-ratio: 1/1) {
    .cal.has-tray .fabrow {
      bottom: calc(var(--tray-h, 0px) + 1rem);
    }
  }
  .scrollarea {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0.2rem 1.4rem 1rem;
  }

  /* ── Drag & drop ───────────────────────────────────────────────────────--- */
  .draggable {
    touch-action: none;
    cursor: grab;
  }
  .drop {
    outline: 2px dashed var(--teal);
    outline-offset: -2px;
    background: #e7f3f1 !important;
  }
  .drag-ghost {
    position: fixed;
    z-index: 60;
    transform: translate(-50%, -50%) rotate(-2deg);
    pointer-events: none;
    max-width: 13rem;
    padding: 0.5rem 0.8rem;
    border-radius: 4px 12px 12px 12px;
    background: var(--note-sun);
    color: var(--ink);
    font-size: 0.9rem;
    font-weight: 700;
    box-shadow: var(--shadow-note);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Transient unschedule target shown mid-drag when the drawer is empty. Pinned
     over the bottom of the calendar so appearing/vanishing never reflows the
     timeline under the dragging finger. */
  .unschedule-zone {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 8;
    padding: 1rem 1.4rem;
    text-align: center;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    background: var(--card);
    border-top: 1px dashed var(--line);
  }

  /* Unscheduled-task drawer (drag source): a fixed bottom bar, never scrolls
     out of view; its chips scroll horizontally inside it. */
  .tray {
    flex: 0 0 auto;
    min-width: 0;
    padding: 0.6rem 1.4rem 0.9rem;
    background: var(--card);
    border-top: 1px solid var(--line);
  }
  .tray-label {
    display: block;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: 0.45rem;
  }
  .tray-items {
    display: flex;
    min-width: 0;
    gap: 0.7rem;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    /* Inset the chips from the scrolling box so a foreign chip's glow edge has
       room to bloom instead of being clipped by the overflow boundary. */
    padding: 0.5rem 0.4rem 0.7rem;
  }
  .tray-chip {
    flex: 0 0 auto;
    max-width: 12rem;
    padding: 0.5rem 0.8rem;
    border-radius: 4px 12px 12px 12px;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink);
    box-shadow: var(--shadow-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Horizontal swipes scroll the drawer; a vertical drag lifts a chip out
       onto the calendar. */
    touch-action: pan-x;
    cursor: grab;
  }
  .tray-chip:active {
    filter: brightness(0.97);
  }

  /* Stacked + centered by default (the day/week/month selector sits above the
     date). Where there's width, they share one line: date on the left, selector
     on the right. */
  .head {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.7rem;
    padding: 0.9rem 1.4rem 0.6rem;
  }
  @media (min-width: 640px) {
    .head {
      flex-direction: row-reverse;
      justify-content: space-between;
      align-items: center;
    }
    .head .nav {
      width: auto;
    }
  }
  .nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    width: 100%;
  }
  .period {
    margin: 0;
    font-size: 1.45rem;
    font-weight: 700;
    color: var(--ink);
    text-align: center;
    letter-spacing: 0.01em;
    min-width: 12rem;
  }
  .arrow {
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    font-size: 1.7rem;
    line-height: 1;
    color: var(--teal-deep);
    background: var(--paper);
    display: grid;
    place-items: center;
    transition:
      background 0.2s ease,
      transform 0.1s ease;
  }
  .arrow:active {
    transform: scale(0.92);
    background: var(--paper-deep);
  }

  /* Segmented Day / Week / Month control */
  .seg {
    display: inline-flex;
    background: var(--paper);
    border-radius: 999px;
    padding: 4px;
    gap: 2px;
  }
  .seg-btn {
    text-transform: capitalize;
    font-size: 0.86rem;
    font-weight: 700;
    color: var(--muted);
    padding: 0.4rem 1.05rem;
    border-radius: 999px;
    min-height: 40px;
    transition:
      background 0.2s ease,
      color 0.2s ease;
  }
  .seg-btn.active {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }

  /* ── Month ─────────────────────────────────────────────────────────────── */
  .weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    margin-bottom: 0.35rem;
  }
  .weekdays span {
    text-align: center;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--muted);
    letter-spacing: 0.08em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 5px;
  }
  .cell {
    min-height: 5.1rem;
    border-radius: 12px;
    background: var(--paper);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 0.35rem 0.3rem;
    gap: 0.25rem;
    overflow: hidden;
  }
  .cell.dim {
    opacity: 0.4;
  }
  .cell .num {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .cell.today {
    background: #e7f3f1;
    outline: 2px solid var(--teal);
  }
  .cell.today .num {
    color: var(--teal-deep);
    font-weight: 800;
  }
  .chips {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: stretch;
  }
  .chip-wrap {
    display: block;
    width: 100%;
  }
  .chip {
    display: block;
    max-width: 100%;
    font-size: 0.62rem;
    font-weight: 700;
    color: rgba(32, 48, 47, 0.78);
    padding: 0.12rem 0.34rem;
    border-radius: 3px 6px 6px 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
  }
  .more {
    font-size: 0.6rem;
    color: var(--muted);
    font-weight: 700;
    text-align: center;
  }

  /* ── Week ──────────────────────────────────────────────────────────────── */
  .week {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.5rem 0.6rem;
    border-radius: 14px;
    background: var(--paper);
    min-height: 4.2rem;
  }
  .row.today {
    background: #e7f3f1;
    outline: 2px solid var(--teal);
  }
  .daychip {
    flex: 0 0 3rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.05;
  }
  .daychip .dow {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--muted);
    letter-spacing: 0.04em;
  }
  .daychip .dom {
    font-size: 1.3rem;
    font-weight: 800;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .row.today .dom,
  .row.today .dow {
    color: var(--teal-deep);
  }
  .row-notes {
    display: flex;
    gap: 0.7rem;
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }
  .row-empty {
    color: var(--line);
    font-size: 1.3rem;
    padding-left: 0.4rem;
  }

  /* ── Day timeline ──────────────────────────────────────────────────────--- */
  /* One column normally; a second (the next day) appears side-by-side when the
     screen is wide (`.twin`). The date band, all-day strip and hours row are each
     a flex row of N day-columns so the days stay column-aligned. */
  .day-cols {
    display: flex;
    flex-direction: column;
  }
  /* Date band: pinned above the scrolling timeline so each column's day stays
     visible. Opaque so the hours scroll cleanly underneath it. */
  .col-heads {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: stretch;
    background: var(--paper);
  }
  .allday-row {
    display: flex;
    align-items: stretch;
  }
  .col-heads > .col-head,
  .allday-row > .allday {
    flex: 1 1 0;
    min-width: 0;
  }
  /* Divider between the two days (date band, all-day, and the timeline columns;
     the column rule only matches when a second column is present). */
  .day-cols.twin .col-heads > * + *,
  .day-cols.twin .allday-row > * + *,
  .hours-col + .hours-col {
    border-left: 1px solid var(--line);
  }
  .col-head {
    padding: 0.35rem 0 0.4rem;
    text-align: center;
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--muted);
  }
  .col-head.today {
    color: var(--teal-deep);
  }

  .allday {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.3rem 0.2rem 0.6rem;
    margin-bottom: 0.4rem;
    border-bottom: 1px solid var(--line);
    border-radius: 8px;
  }
  .allday-label {
    flex: 0 0 auto;
    margin-top: 0.4rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .allday-items {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .allday-chip {
    padding: 0.4rem 0.7rem;
    border-radius: 4px 12px 12px 12px;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink);
    box-shadow: var(--shadow-soft);
    white-space: nowrap;
    touch-action: none;
    cursor: grab;
  }

  .hours-row {
    position: relative;
    display: flex;
    align-items: stretch;
  }
  /* The hour lines + labels live in one full-width layer behind the day columns,
     so they're drawn a single time — guaranteeing the two days line up. */
  .hour-grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .hours-col {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
  }
  .hour {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: 1px solid var(--line);
  }
  .hour-label {
    position: absolute;
    top: -0.62em;
    left: 0;
    width: 2.6rem;
    text-align: right;
    font-size: 0.7rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .day-event {
    position: absolute;
    /* left + width are set inline (per overlap column); see eventLayout(). */
    min-height: 1.6rem;
    padding: 0.3rem 0.6rem 0.55rem;
    border-radius: 4px 12px 12px 12px;
    box-shadow: var(--shadow-soft);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
    animation: kiosk-rise 0.3s ease both;
  }
  .day-event:active {
    filter: brightness(0.97);
  }
  .day-event.resizing {
    outline: 2px solid var(--teal);
    z-index: 6;
    animation: none;
  }
  .day-event .dur {
    color: var(--teal-deep);
  }
  /* Bottom grip: drag to change the event's length. */
  .resize-handle {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 0.7rem;
    cursor: ns-resize;
    touch-action: none;
  }
  .resize-handle::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: 0.16rem;
    transform: translateX(-50%);
    width: 1.7rem;
    height: 3px;
    border-radius: 3px;
    background: rgba(32, 48, 47, 0.3);
  }
  .day-event .when {
    font-size: 0.64rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(32, 48, 47, 0.62);
  }
  .day-event .ttl {
    font-size: 0.95rem;
    font-weight: 700;
    line-height: 1.15;
    color: var(--ink);
  }
  .day-event .where {
    font-size: 0.78rem;
    color: rgba(32, 48, 47, 0.62);
  }
  .day-event .src {
    margin-top: 0.15rem;
    font-size: 0.7rem;
    font-weight: 700;
    /* Tinted with the source holon's own colour (same hue as its glow edge). */
    color: var(--glow, var(--teal-deep));
  }
  .day-event .ev-foot {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }
  .day-event .appr {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    font-size: 0.74rem;
    font-weight: 700;
    color: #9a3b2f;
  }
  .day-event .appr .h {
    font-size: 1.4em;
    line-height: 1;
  }

  /* Compact (thin) event: one centred row — time then title — instead of the
     stacked layout, so a short slot's title sits next to the hour and is never
     clipped. The line's base size is the height-derived `--ev-font`; `fitLine`
     shrinks it further if a long title would overflow the column width. */
  .day-event.compact {
    flex-direction: row;
    align-items: center;
    padding: 0 0.5rem;
  }
  .day-event.compact .cline {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    width: 100%;
    min-width: 0;
    font-size: var(--ev-font, 0.72rem);
    line-height: 1.12;
    white-space: nowrap;
    overflow: hidden;
  }
  .day-event.compact .when {
    flex: 0 0 auto;
    font-size: 0.82em;
    letter-spacing: 0;
  }
  .day-event.compact .ttl {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 1em;
    line-height: 1.12;
  }
  /* A thin box is mostly grip otherwise — slim the handle so the body stays
     tappable to open. */
  .day-event.compact .resize-handle {
    height: 0.45rem;
  }
  .slot-hint {
    position: absolute;
    left: 3rem;
    right: 0.3rem;
    height: 2px;
    background: var(--teal);
    border-radius: 2px;
    z-index: 3;
  }
  /* "Now" indicator — accent-coloured, spanning the full width, with a soft
     glow, a ringed dot, and a pill clock. */
  .now-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: 2px solid var(--teal);
    box-shadow: 0 0 9px color-mix(in srgb, var(--teal) 55%, transparent);
    z-index: 4;
    pointer-events: none;
  }
  .now-dot {
    position: absolute;
    left: 0;
    top: 0;
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    background: var(--teal);
    box-shadow: 0 0 0 0.22rem color-mix(in srgb, var(--teal) 24%, transparent);
    transform: translate(-50%, -50%);
  }
  .now-time {
    position: absolute;
    left: 0.55rem;
    top: -0.82em;
    font-size: 0.64rem;
    font-weight: 800;
    color: #fff;
    background: var(--teal);
    padding: 0.08rem 0.45rem;
    border-radius: 999px;
    box-shadow: var(--shadow-soft);
  }

  /* ── Shared post-it notes ──────────────────────────────────────────────--- */
  .note {
    border-radius: 4px 14px 14px 14px;
    animation: kiosk-rise 0.4s ease both;
    cursor: pointer;
  }
  .chip {
    cursor: pointer;
  }
  .note:active,
  .chip:active {
    filter: brightness(0.97);
  }
  .note .when {
    font-size: 0.7rem;
    font-weight: 700;
    color: rgba(32, 48, 47, 0.62);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .note.sm {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0.7rem 0.6rem;
    max-width: 11rem;
  }
  .note.sm .ttl {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.15;
  }

  /* Federated / hologram events — a coloured edge keyed by their source holon
     (see `sourceGlow` in lib/data.ts, supplied as `--glow`) marks them as
     coming from elsewhere, across every calendar surface they appear on. The
     surfaces that carry a soft lift keep it (re-stated here, since their own
     `box-shadow` rule would otherwise win on specificity). */
  .chip.is-foreign,
  .note.is-foreign {
    box-shadow:
      0 0 0 2px var(--glow),
      0 0 14px 1px color-mix(in srgb, var(--glow) 55%, transparent);
  }
  .day-event.is-foreign,
  .allday-chip.is-foreign,
  .tray-chip.is-foreign {
    box-shadow:
      0 0 0 2px var(--glow),
      0 0 14px 1px color-mix(in srgb, var(--glow) 55%, transparent),
      var(--shadow-soft);
  }
</style>
