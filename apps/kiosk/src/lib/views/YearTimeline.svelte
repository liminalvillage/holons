<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The year at a glance — the kiosk port of the dashboard's lunar timeline
  // (apps/web Timeline.svelte). One horizontal line is the whole year: month
  // ticks, the four solar turning points, every new/full moon, and the
  // holon's dated cards. Single-day cards stack upward from the baseline like
  // mountains (one square per card, in its category colour); multi-day spans
  // run as lane bars along the bottom, so a booking or a festival reads as a
  // stretch. Tapping a square/bar opens the card; tapping anywhere else jumps
  // the calendar to that day.
  import { phase } from "lune";
  import { t, locale, type MessageKey } from "$lib/i18n";
  import type { CalendarEvent } from "$lib/data";

  export let events: CalendarEvent[] = [];
  /** The displayed year (navigation lives in CalendarView's header). */
  export let year: number;
  /** Live clock, for the "today" marker. */
  export let now: Date;
  /** Shared category→colour map (same palette as the other calendar windows). */
  export let noteColorFor: (category: string | undefined) => string;
  export let onOpen: (ev: CalendarEvent) => void;
  export let onSelectDay: ((date: Date) => void) | null = null;

  // Layout constants (rem, so the timeline scales with the kiosk's fluid
  // root font) — keep in sync with the stacking styles below.
  const MIN_HEIGHT_REM = 11;
  const ROW_REM = 0.85; // vertical step per stacked square
  const STACK_BASE_REM = 1.1; // gap between the baseline and the first square
  const LANE_REM = 0.6; // vertical step per span lane

  // Fraction of a year elapsed at `date`, clamped to the displayed year so
  // spans crossing a year boundary pin to the timeline edges.
  function positionInYear(date: Date): number {
    const start = new Date(year, 0, 1).getTime();
    const end = new Date(year + 1, 0, 1).getTime();
    const pos = ((date.getTime() - start) / (end - start)) * 100;
    return Math.min(100, Math.max(0, pos));
  }

  // ── Cards, grouped per day ────────────────────────────────────────────────
  // Single-day cards become the stacked squares; multi-day spans go to the
  // lane bars instead (a bar already says "these days", a dot per day would
  // triple-count it).
  type DayGroup = { date: Date; items: CalendarEvent[] };
  $: dayGroups = (() => {
    const start = new Date(year, 0, 1).getTime();
    const end = new Date(year + 1, 0, 1).getTime();
    const groups = new Map<string, DayGroup>();
    for (const ev of events) {
      if (ev.multiDay) continue;
      const time = ev.date.getTime();
      if (isNaN(time) || time < start || time >= end) continue;
      const key = ev.date.toDateString();
      let group = groups.get(key);
      if (!group) {
        const anchor = new Date(ev.date);
        anchor.setHours(0, 0, 0, 0);
        group = { date: anchor, items: [] };
        groups.set(key, group);
      }
      group.items.push(ev);
    }
    for (const group of groups.values())
      group.items.sort((a, b) => a.date.getTime() - b.date.getTime());
    return Array.from(groups.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
  })();

  // Multi-day spans visible this year, with a greedy lane assignment so
  // overlapping stretches stack instead of drawing on top of each other.
  $: yearSpans = (() => {
    const start = new Date(year, 0, 1).getTime();
    const end = new Date(year + 1, 0, 1).getTime();
    const sorted = events
      .filter((ev) => {
        if (!ev.multiDay) return false;
        const from = ev.date.getTime();
        const to = (ev.end ?? ev.date).getTime();
        return !isNaN(from) && from < end && to >= start;
      })
      .sort(
        (a, b) =>
          a.date.getTime() - b.date.getTime() ||
          (a.end ?? a.date).getTime() - (b.end ?? b.date).getTime() ||
          a.id.localeCompare(b.id),
      );
    const laneEnds: number[] = [];
    return sorted.map((ev) => {
      const from = ev.date.getTime();
      let lane = laneEnds.findIndex((laneEnd) => laneEnd < from);
      // `end` is the last day at midnight (inclusive) — the bar runs to the
      // start of the following day.
      const endExclusive = new Date(ev.end ?? ev.date);
      endExclusive.setDate(endExclusive.getDate() + 1);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(endExclusive.getTime());
      } else {
        laneEnds[lane] = endExclusive.getTime();
      }
      return {
        ev,
        lane,
        startPos: positionInYear(ev.date),
        endPos: positionInYear(endExclusive),
      };
    });
  })();
  $: laneCount = yearSpans.reduce((m, s) => Math.max(m, s.lane + 1), 0);

  // Auto-scale the timeline height so dense days don't overflow: the square
  // stack lives in the band above the baseline (~35% of the container), and
  // the container grows one lane-step per span lane.
  $: maxStack = dayGroups.reduce((m, d) => Math.max(m, d.items.length), 0);
  $: heightRem =
    Math.max(
      MIN_HEIGHT_REM,
      (STACK_BASE_REM + maxStack * ROW_REM + 1.2) / 0.35,
    ) +
    laneCount * LANE_REM;

  // ── Sky: solar turning points + every new/full moon ───────────────────────
  type SolarKey =
    | "cal.springEquinox"
    | "cal.summerSolstice"
    | "cal.autumnEquinox"
    | "cal.winterSolstice";
  function solarPoints(y: number): Array<{ key: SolarKey; date: Date }> {
    return [
      { key: "cal.springEquinox", date: new Date(y, 2, 20) },
      { key: "cal.summerSolstice", date: new Date(y, 5, 21) },
      { key: "cal.autumnEquinox", date: new Date(y, 8, 22) },
      { key: "cal.winterSolstice", date: new Date(y, 11, 21) },
    ];
  }
  $: solarEvents = solarPoints(year);

  // Scan the year in 6-hour steps for the moments the phase crosses new
  // (≈0) or full (≈0.5); the 10-day de-dupe window keeps one marker per
  // lunation. Same recipe as the dashboard's timeline.
  function getMoonPhases(y: number): Array<{ date: Date; isNew: boolean }> {
    const phases: Array<{ date: Date; isNew: boolean }> = [];
    const end = new Date(y + 1, 0, 1);
    let cursor = new Date(y, 0, 1);
    while (cursor < end) {
      const p = phase(cursor).phase;
      if (p < 0.025 || (p > 0.475 && p < 0.525)) {
        const isDuplicate = phases.some(
          (m) =>
            Math.abs(m.date.getTime() - cursor.getTime()) <
            10 * 24 * 60 * 60 * 1000,
        );
        if (!isDuplicate)
          phases.push({ date: new Date(cursor), isNew: p < 0.025 });
      }
      cursor = new Date(cursor.getTime() + 6 * 60 * 60 * 1000);
    }
    return phases;
  }
  $: moonPhases = getMoonPhases(year);

  $: months = Array.from({ length: 12 }, (_, i) =>
    new Date(year, i, 1).toLocaleDateString($locale, { month: "short" }),
  );

  $: todayPos = now.getFullYear() === year ? positionInYear(now) : null;

  // ── Tap-to-jump: anywhere on the empty timeline picks that day ────────────
  let container: HTMLElement;
  function handleBackgroundClick(e: MouseEvent) {
    if (!onSelectDay || !container) return;
    const rect = container.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const start = new Date(year, 0, 1).getTime();
    const end = new Date(year + 1, 0, 1).getTime();
    onSelectDay(new Date(start + (end - start) * frac));
  }
  function onBackgroundKey(e: KeyboardEvent) {
    if ((e.key === "Enter" || e.key === " ") && onSelectDay) {
      e.preventDefault();
      onSelectDay(now.getFullYear() === year ? now : new Date(year, 0, 1));
    }
  }
  function openEv(e: Event, ev: CalendarEvent) {
    e.stopPropagation(); // don't also jump the day underneath
    onOpen(ev);
  }

  function dotTitle(ev: CalendarEvent): string {
    const when = ev.allDay
      ? ev.date.toLocaleDateString($locale, { day: "numeric", month: "short" })
      : ev.date.toLocaleString($locale, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
    return `${ev.title} · ${when}`;
  }
  function spanTitle(ev: CalendarEvent): string {
    const fmt = (d: Date) =>
      d.toLocaleDateString($locale, { day: "numeric", month: "short" });
    return `${ev.title} · ${fmt(ev.date)} – ${fmt(ev.end ?? ev.date)}`;
  }

  // ── Hover readout: the date under the cursor + its sky statistics ─────────
  // Moving over empty timeline shows a hairline plus a card with the date,
  // the moon that night (phase name, illumination, lunation age) and the
  // countdown to the next solar turning point. Cards and sky markers carry
  // their own tooltips, so the readout yields while one of those is hovered.
  const MOON_ICONS = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
  const MOON_NAMES: MessageKey[] = [
    "cal.newMoon",
    "cal.moonWaxingCrescent",
    "cal.moonFirstQuarter",
    "cal.moonWaxingGibbous",
    "cal.fullMoon",
    "cal.moonWaningGibbous",
    "cal.moonLastQuarter",
    "cal.moonWaningCrescent",
  ];

  let hover: { pct: number; date: Date } | null = null;

  function moonStats(date: Date) {
    const p = phase(date);
    // Band the continuous phase into the 8 named faces (centred bands, so
    // 0±1/16 is "new moon" rather than a sliver of crescent).
    const idx = Math.floor(((p.phase + 1 / 16) % 1) * 8);
    return {
      icon: MOON_ICONS[idx],
      nameKey: MOON_NAMES[idx],
      pct: Math.round(p.illuminated * 100),
      age: Math.max(1, Math.round(p.age)),
    };
  }

  /** The next solar turning point on or after `date` (crossing new year). */
  function nextSolar(date: Date): { key: SolarKey; days: number } {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const all = [
      ...solarPoints(day.getFullYear()),
      ...solarPoints(day.getFullYear() + 1),
    ];
    const next = all.find((s) => s.date.getTime() >= day.getTime()) ?? all[0];
    return {
      key: next.key,
      days: Math.round((next.date.getTime() - day.getTime()) / 86400000),
    };
  }

  function onPointerMove(e: PointerEvent) {
    if (!container) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest(".yt-dot, .yt-span, .yt-sky")) {
      hover = null; // that element's own tooltip is speaking
      return;
    }
    const rect = container.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const start = new Date(year, 0, 1).getTime();
    const end = new Date(year + 1, 0, 1).getTime();
    hover = { pct: frac * 100, date: new Date(start + (end - start) * frac) };
  }
  function onPointerLeave() {
    hover = null;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="yt"
  style="height: {heightRem}rem;"
  bind:this={container}
  on:click={handleBackgroundClick}
  on:keydown={onBackgroundKey}
  on:pointermove={onPointerMove}
  on:pointerleave={onPointerLeave}
  role="button"
  tabindex="0"
>
  <!-- Baseline -->
  <div class="yt-base" aria-hidden="true"></div>

  <!-- Month grid -->
  {#each months as name, i}
    <div class="yt-month" style="left: {(i / 12) * 100}%" aria-hidden="true">
      <div class="yt-month-line"></div>
      <span class="yt-month-name">{name}</span>
    </div>
  {/each}

  <!-- Solar turning points -->
  {#each solarEvents as s (s.key)}
    <div class="yt-sky" style="left: {positionInYear(s.date)}%">
      {#if s.key === "cal.summerSolstice"}
        <!-- Longest day: full bright sun -->
        <span class="yt-sun"></span>
      {:else if s.key === "cal.winterSolstice"}
        <!-- Longest night: muted/dark -->
        <span class="yt-sun dark"></span>
      {:else}
        <!-- Equinox: half day, half night. Spring = dark→light. -->
        <span class="yt-sun half" class:flip={s.key === "cal.autumnEquinox"}
        ></span>
      {/if}
      <span class="yt-tip"
        >{$t(s.key)} · {s.date.toLocaleDateString($locale, {
          day: "numeric",
          month: "short",
        })}</span
      >
    </div>
  {/each}

  <!-- New + full moons -->
  {#each moonPhases as m (m.date.toISOString())}
    <div class="yt-sky" style="left: {positionInYear(m.date)}%">
      <span class="yt-moon" class:new={m.isNew}></span>
      <span class="yt-tip"
        >{m.isNew ? `🌑 ${$t("cal.newMoon")}` : `🌕 ${$t("cal.fullMoon")}`} · {m.date.toLocaleDateString(
          $locale,
          {
            day: "numeric",
            month: "short",
          },
        )}</span
      >
    </div>
  {/each}

  <!-- Single-day cards: squares stacked upward from the baseline -->
  {#each dayGroups as day (day.date.toISOString())}
    <div class="yt-day" style="left: {positionInYear(day.date)}%">
      <div
        class="yt-stem"
        style="height: {STACK_BASE_REM + day.items.length * ROW_REM}rem;"
        aria-hidden="true"
      ></div>
      {#each day.items as ev, i (ev.id)}
        <button
          type="button"
          class="yt-dot"
          class:is-foreign={!!ev.sourceColor}
          style="top: calc(50% - {STACK_BASE_REM +
            (i + 1) * ROW_REM}rem); background: {noteColorFor(
            ev.category,
          )}; --glow: {ev.sourceColor ?? 'transparent'};"
          aria-label={dotTitle(ev)}
          on:click={(e) => openEv(e, ev)}
        >
          <span class="yt-tip">{dotTitle(ev)}</span>
        </button>
      {/each}
    </div>
  {/each}

  <!-- Multi-day spans: lane bars along the bottom edge -->
  {#each yearSpans as s (s.ev.id)}
    <button
      type="button"
      class="yt-span"
      class:is-foreign={!!s.ev.sourceColor}
      style="left: {s.startPos}%; width: {Math.max(
        s.endPos - s.startPos,
        0.25,
      )}%; bottom: {0.35 + s.lane * LANE_REM}rem; background: {noteColorFor(
        s.ev.category,
      )}; --glow: {s.ev.sourceColor ?? 'transparent'};"
      aria-label={spanTitle(s.ev)}
      on:click={(e) => openEv(e, s.ev)}
    >
      <span class="yt-tip">{spanTitle(s.ev)}</span>
    </button>
  {/each}

  <!-- Today -->
  {#if todayPos !== null}
    <div class="yt-today" style="left: {todayPos}%" aria-hidden="true">
      <span class="yt-today-dot"></span>
    </div>
  {/if}

  <!-- Hover readout: hairline + sky statistics for the date under the cursor -->
  {#if hover}
    {@const moon = moonStats(hover.date)}
    {@const sun = nextSolar(hover.date)}
    <div class="yt-cursor" style="left: {hover.pct}%" aria-hidden="true"></div>
    <div
      class="yt-readout"
      class:flip={hover.pct > 70}
      style="left: {hover.pct}%"
      aria-hidden="true"
    >
      <div class="ro-date">
        {hover.date.toLocaleDateString($locale, {
          weekday: "short",
          day: "numeric",
          month: "long",
        })}
      </div>
      <div class="ro-line">
        {moon.icon}
        {$t(moon.nameKey)} · {$t("cal.moonLit", { pct: moon.pct })} · {$t(
          "cal.moonAge",
          { n: moon.age },
        )}
      </div>
      <div class="ro-line">
        ☀️ {sun.days === 0
          ? $t("cal.solarToday", { name: $t(sun.key) })
          : $t("cal.inDays", { name: $t(sun.key), n: sun.days })}
      </div>
    </div>
  {/if}
</div>

<style>
  .yt {
    position: relative;
    margin: 0.6rem 0.2rem 0.4rem;
    border-radius: 14px;
    background: var(--paper);
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
    overflow: hidden;
  }

  .yt-base {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: var(--line);
  }

  .yt-month {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
  }
  .yt-month-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--line);
    opacity: 0.55;
  }
  .yt-month-name {
    position: absolute;
    top: 0.35rem;
    left: 0.3rem;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  /* Sky markers sit on the baseline itself. */
  .yt-sky {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    display: grid;
    place-items: center;
    pointer-events: auto;
  }
  .yt-sun {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    background: #f2c14e;
    box-shadow: 0 0 7px rgba(242, 193, 78, 0.65);
  }
  .yt-sun.dark {
    background: #7b8794;
    box-shadow: none;
  }
  /* Equinox: half day, half night (spring dark→light; autumn flipped). */
  .yt-sun.half {
    background: linear-gradient(90deg, #7b8794 50%, #f2c14e 50%);
    box-shadow: none;
  }
  .yt-sun.half.flip {
    background: linear-gradient(90deg, #f2c14e 50%, #7b8794 50%);
  }
  /* Fixed fills, not theme tokens: a full moon is light and a new moon dark
     in EITHER palette — the muted ring keeps both visible on the paper. */
  .yt-moon {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    border: 1px solid var(--muted);
    background: #f4f0e4;
  }
  .yt-moon.new {
    background: #1f2a29;
  }

  /* Per-day card stack: a dashed stem rising from the baseline, one square
     per card climbing it. */
  .yt-day {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
  }
  .yt-stem {
    position: absolute;
    bottom: 50%;
    left: 0;
    width: 0;
    border-left: 1px dashed color-mix(in srgb, var(--muted) 45%, transparent);
  }
  .yt-dot {
    position: absolute;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 2px;
    transform: translateX(-50%);
    pointer-events: auto;
    cursor: pointer;
    box-shadow: var(--shadow-soft);
    transition: transform 0.12s ease;
  }
  .yt-dot:active {
    transform: translateX(-50%) scale(1.4);
  }

  .yt-span {
    position: absolute;
    height: 0.38rem;
    min-width: 4px;
    border-radius: 999px;
    pointer-events: auto;
    cursor: pointer;
    box-shadow: var(--shadow-soft);
  }
  .yt-span:active {
    filter: brightness(0.95);
  }

  /* Federated / hologram cards keep their source-holon glow edge, same as
     every other calendar surface. */
  .yt-dot.is-foreign,
  .yt-span.is-foreign {
    box-shadow:
      0 0 0 1.5px var(--glow),
      0 0 9px 1px color-mix(in srgb, var(--glow) 55%, transparent);
  }

  .yt-today {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--teal);
    box-shadow: 0 0 8px color-mix(in srgb, var(--teal) 55%, transparent);
    pointer-events: none;
  }
  .yt-today-dot {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    background: var(--teal);
    box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--teal) 24%, transparent);
  }

  /* ── Hover ─────────────────────────────────────────────────────────────── */
  /* Content tooltip: shown while its dot / span / sky marker is hovered. */
  .yt-tip {
    position: absolute;
    bottom: calc(100% + 0.45rem);
    left: 50%;
    transform: translateX(-50%);
    padding: 0.3rem 0.55rem;
    border-radius: 8px;
    background: var(--card);
    color: var(--ink);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-soft);
    font-size: 0.72rem;
    font-weight: 700;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
    z-index: 30;
  }
  .yt-dot:hover .yt-tip,
  .yt-span:hover .yt-tip,
  .yt-sky:hover .yt-tip {
    opacity: 1;
  }
  /* The tip's z-index only counts INSIDE its marker (the transform makes each
     marker a stacking context) — so raise the hovered marker itself, or the
     label paints behind the squares stacked above it. */
  .yt-dot:hover,
  .yt-span:hover,
  .yt-sky:hover {
    z-index: 35;
  }

  /* Cursor hairline + the date/sky readout card that follows it. */
  .yt-cursor {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: color-mix(in srgb, var(--ink) 35%, transparent);
    pointer-events: none;
    z-index: 2;
  }
  .yt-readout {
    position: absolute;
    top: 0.5rem;
    transform: translateX(0.7rem);
    padding: 0.45rem 0.65rem;
    border-radius: 10px;
    background: var(--card);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-soft);
    pointer-events: none;
    white-space: nowrap;
    z-index: 40;
  }
  /* Near the right edge the card sits on the hairline's other side. */
  .yt-readout.flip {
    transform: translateX(calc(-100% - 0.7rem));
  }
  .ro-date {
    font-size: 0.78rem;
    font-weight: 800;
    color: var(--ink);
    margin-bottom: 0.15rem;
  }
  .ro-line {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--muted);
    line-height: 1.5;
  }
</style>
