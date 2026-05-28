<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { events, now, openQuest } from "$lib/stores";
  import { noteColor, noteTilt, type CalendarEvent } from "$lib/data";

  function open(id: string) {
    openQuest(id, "event");
  }
  function onKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(id);
    }
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
  }
  function step(dir: 1 | -1) {
    offset += dir;
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

<div class="cal scroll">
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

  {#if mode === "month"}
    <div class="weekdays">
      {#each WEEKDAYS as w}<span>{w}</span>{/each}
    </div>
    <div class="grid">
      {#each monthGrid as day}
        {@const evs = eventsOn(day, $events)}
        {@const inMonth = day.getMonth() === monthAnchor.getMonth()}
        {@const isToday = sameDay(day, $now)}
        <div class="cell" class:dim={!inMonth} class:today={isToday}>
          <span class="num">{day.getDate()}</span>
          <div class="chips">
            {#each evs.slice(0, 2) as ev (ev.id)}
              <span class="lift chip-wrap">
                <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                <span
                  class="chip tilt"
                  style={tiltStyle(ev.id, noteColor(ev.category))}
                  title={ev.title}
                  role="button"
                  tabindex="0"
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
        <div class="row" class:today={isToday}>
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
                    class="note sm tilt"
                    style={tiltStyle(ev.id, noteColor(ev.category))}
                    role="button"
                    tabindex="0"
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
    <!-- day -->
    {#if dayEvents.length}
      <div class="day">
        {#each dayEvents as ev (ev.id)}
          <span class="lift">
            <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
            <article
              class="note lg tilt"
              style={tiltStyle(ev.id, noteColor(ev.category))}
              role="button"
              tabindex="0"
              on:click={() => open(ev.id)}
              on:keydown={(e) => onKey(e, ev.id)}
            >
              <span class="when">{timeLabel(ev)}</span>
              <h3>{ev.title}</h3>
              {#if ev.location}<span class="where">{ev.location}</span>{/if}
            </article>
          </span>
        {/each}
      </div>
    {:else}
      <p class="empty">Nothing on for this day. ✶</p>
    {/if}
  {/if}
</div>

<style>
  .cal {
    flex: 1;
    min-height: 0;
    padding: 1.2rem 1.4rem 1.6rem;
    overflow-x: hidden;
  }

  .head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.7rem;
    margin-bottom: 1rem;
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
    width: 48px;
    height: 48px;
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

  /* ── Day ───────────────────────────────────────────────────────────────── */
  .day {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    padding-top: 0.3rem;
  }
  .day .lift {
    display: block;
  }

  /* ── Shared post-it notes ──────────────────────────────────────────────--- */
  .note {
    border-radius: 4px 14px 14px 14px;
    animation: akasha-rise 0.4s ease both;
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
  .note.lg {
    padding: 1rem 1.15rem 1.15rem;
  }
  .note.lg h3 {
    margin: 0.25rem 0 0;
    font-size: 1.25rem;
    line-height: 1.2;
    color: var(--ink);
  }
  .note.lg .where {
    display: block;
    margin-top: 0.5rem;
    font-size: 0.9rem;
    color: rgba(32, 48, 47, 0.62);
  }

  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
    font-size: 1.1rem;
  }
</style>
