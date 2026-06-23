<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import {
    events,
    backlog,
    now,
    openQuest,
    rawQuests,
    holonId,
    selection,
    editOnOpen,
  } from "$lib/stores";
  import { isLoggedIn, loginOpen, telegramUser } from "$lib/auth";
  import { getWriter } from "$lib/holosphere";
  import { createTask } from "@holons/core/tasks";
  import { noteColor, noteTilt, type CalendarEvent } from "$lib/data";
  import Avatars from "$lib/components/Avatars.svelte";

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

  // Which day — and, over the hour timeline, which 15-minute slot — is under
  // the pointer right now.
  function computeDrop(x: number, y: number) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const dayEl = el?.closest<HTMLElement>("[data-day]") ?? null;
    dropDay = dayEl?.dataset.day ?? null;
    if (dayEl && dayEl.dataset.hours != null) {
      const rect = dayEl.getBoundingClientRect();
      const min = Math.round(((y - rect.top) / HOUR_PX) * 4) * 15;
      dropMin = Math.min(24 * 60 - 15, Math.max(0, min));
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
    const dragged = drag != null;
    drag = null;
    dropDay = null;
    dropMin = null;
    pendingId = null;
    if (dragged && id && day) {
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
    const oldStart = new Date(q.when as string);
    let when: string;
    let newStart: Date;
    if (min != null) {
      // Dropped on the hour timeline → that day at that time.
      when = `${day}T${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
      newStart = new Date(when);
    } else if (q.when && /T\d\d:/.test(String(q.when))) {
      // Dropped on a day cell, but it already had a time → keep the time.
      when = `${day}T${pad2(oldStart.getHours())}:${pad2(oldStart.getMinutes())}`;
      newStart = new Date(when);
    } else {
      when = day; // all-day
      newStart = new Date(`${day}T00:00`);
    }

    const updated = { ...q, when };
    // Moving the whole card shifts the start — carry the end along by the same
    // delta so the event keeps its length.
    const oldEnds = new Date((q.ends ?? q.until ?? "") as string);
    if (!Number.isNaN(oldStart.getTime()) && !Number.isNaN(oldEnds.getTime())) {
      const delta = newStart.getTime() - oldStart.getTime();
      updated.ends = new Date(oldEnds.getTime() + delta).toISOString();
    }
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
        const m = Math.round(((y - rect.top) / HOUR_PX) * 4) * 15;
        min = Math.min(24 * 60 - 15, Math.max(0, m));
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
        ? `${day}T${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`
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
    const start = new Date(q.when as string);
    if (Number.isNaN(start.getTime())) return;
    const ends = new Date(start.getTime() + durMin * 60000).toISOString();
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

  $: dayEvents = eventsOn(anchorDay, $events);

  // ── Day timeline (hour grid + "now" line + drag-to-arrange) ───────────────-
  // Hour height tracks the (fluid) root font so the timeline scales with the
  // rest of the kiosk — bigger rows on a large display, tighter on a phone.
  const HOURS = Array.from({ length: 24 }, (_, h) => h);
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

  // Scroll the timeline so the "now" line sits 1.5h from the top (today), or the
  // morning otherwise. Runs after layout (tick + rAF) so it lands reliably every
  // time the calendar is opened, not just the live clock ticking.
  async function focusDay() {
    await tick();
    requestAnimationFrame(() => {
      if (!scrollEl) return;
      const mins = sameDay(anchorDay, get(now)) ? minutesOf(get(now)) : 8 * 60;
      scrollEl.scrollTop = Math.max(0, (mins / 60) * HOUR_PX - HOUR_PX * 1.5);
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
    return () => window.removeEventListener("resize", measureRem);
  });

  $: allDayEvents = dayEvents.filter((e) => e.allDay);
  $: timedEvents = dayEvents.filter((e) => !e.allDay);
  $: dayLayout = eventLayout(timedEvents);
  $: isTodayAnchor = sameDay(anchorDay, $now);
  $: nowTop = (minutesOf($now) / 60) * HOUR_PX;

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
</script>

<div
  class="cal"
  class:has-tray={unscheduled.length}
  style="--tray-h: {trayHeight}px;"
>
  <header class="head">
    <div class="nav">
      <button class="arrow" on:click={() => step(-1)} aria-label="Previous"
        >‹</button
      >
      <h2 class="period">{periodLabel}</h2>
      <button class="arrow" on:click={() => step(1)} aria-label="Next">›</button
      >
    </div>
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
  </header>

  <div class="scrollarea scroll" bind:this={scrollEl}>
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
                    style={tiltStyle(ev.id, noteColor(ev.category))}
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
                      style={tiltStyle(ev.id, noteColor(ev.category))}
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
      <!-- day timeline -->
      {@const iso = isoDay(anchorDay)}
      {#if allDayEvents.length}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="allday"
          class:drop={dropDay === iso && dropMin === null}
          data-day={iso}
          on:pointerdown={beginCreatePress}
        >
          <span class="allday-label">all day</span>
          <div class="allday-items">
            {#each allDayEvents as ev (ev.id)}
              <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
              <span
                class="allday-chip draggable"
                style="background: {noteColor(ev.category)};"
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
      {/if}

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="hours"
        data-day={iso}
        data-hours="1"
        style="height: {24 * HOUR_PX}px;"
        on:pointerdown={beginCreatePress}
      >
        {#each HOURS as h}
          <div class="hour" style="top: {h * HOUR_PX}px;">
            <span class="hour-label">{fmtHour(h)}</span>
          </div>
        {/each}

        {#if dropDay === iso && dropMin !== null}
          <div
            class="slot-hint"
            style="top: {(dropMin / 60) * HOUR_PX}px;"
          ></div>
        {/if}

        {#each timedEvents as ev (ev.id)}
          {@const durMin =
            resize?.id === ev.id ? resize.curMin : eventDurationMin(ev)}
          {@const lay = dayLayout.get(ev.id) ?? { col: 0, cols: 1 }}
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
          <article
            class="day-event draggable"
            class:resizing={resize?.id === ev.id}
            style="top: {(minutesOf(ev.date) / 60) *
              HOUR_PX}px; height: {(durMin / 60) *
              HOUR_PX}px; left: calc(3.2rem + (100% - 3.5rem) * {lay.col} / {lay.cols}); width: calc((100% - 3.5rem) / {lay.cols} - 0.2rem); background: {noteColor(
              ev.category,
            )};"
            role="button"
            tabindex="0"
            on:pointerdown={(e) => beginDrag(e, ev.id, ev.title)}
            on:click={() => open(ev.id)}
            on:keydown={(e) => onKey(e, ev.id)}
          >
            <span class="when"
              >{timeLabel(ev)}{#if resize?.id === ev.id}<span class="dur">
                  · {Math.floor(durMin / 60)}h{durMin % 60
                    ? ` ${durMin % 60}m`
                    : ""}</span
                >{/if}</span
            >
            <span class="ttl">{ev.title}</span>
            {#if ev.location}<span class="where">{ev.location}</span>{/if}
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
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="resize-handle"
              on:pointerdown={(e) => beginResize(e, ev)}
              aria-hidden="true"
            ></span>
          </article>
        {/each}

        {#if isTodayAnchor}
          <div class="now-line" style="top: {nowTop}px;">
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
    {/if}
  </div>

  {#if unscheduled.length}
    <div class="tray" bind:clientHeight={trayHeight}>
      <span class="tray-label">Unscheduled — drag onto a day</span>
      <div class="tray-items scroll">
        {#each unscheduled as task (task.id)}
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
          <span
            class="tray-chip draggable"
            style="background: {noteColor(task.category)};"
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
  {/if}

  <button
    class="fab"
    on:click={openCreate}
    aria-label="New task"
    title="New task">＋</button
  >
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
      display: flex;
      flex-direction: column;
      border-top: none;
      border-left: 1px solid var(--line);
    }
    /* Chips stack vertically and scroll down the sidebar. */
    .cal.has-tray .tray-items {
      flex-direction: column;
      flex-wrap: nowrap;
      overflow-x: hidden;
      overflow-y: auto;
      min-height: 0;
    }
    .cal.has-tray .tray-chip {
      max-width: none;
      white-space: normal;
      /* Vertical scroll now; a horizontal drag lifts a chip onto the calendar. */
      touch-action: pan-y;
    }
    /* Keep the FAB clear of the right sidebar. */
    .cal.has-tray .fab {
      right: calc(var(--tray-w) + 1.3rem);
    }
  }

  /* "New task" floating button — pinned to the corner, lifted above the
     unscheduled drawer when it's present (see the inline `bottom`). */
  .fab {
    position: absolute;
    right: 1.3rem;
    bottom: 1.3rem;
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
    z-index: 7;
    transition:
      transform 0.12s ease,
      background 0.15s ease,
      bottom 0.18s ease;
  }
  .fab:active {
    transform: scale(0.92);
    background: var(--teal-deep);
  }
  /* Portrait: the drawer sits at the bottom, so lift the FAB above it. */
  @media (max-aspect-ratio: 1/1) {
    .cal.has-tray .fab {
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
    gap: 0.5rem;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 0.4rem;
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

  .head {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.7rem;
    padding: 1.1rem 1.4rem 0.7rem;
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

  .hours {
    position: relative;
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
    color: var(--teal-deep);
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
</style>
