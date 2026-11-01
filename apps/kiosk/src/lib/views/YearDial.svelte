<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The year window as one dial — the radial shape of YearTimeline. The
  // outer ring is the year (January at 12 o'clock, clockwise): month bands,
  // the four solar turning points and every new/full moon on its rim, the
  // holon's single-day cards stacked inward from it, multi-day spans as arcs
  // inside. The inner ring is the moon we're in, new moon at 12 o'clock, its
  // days ticked, its cards the same way. A teal hand on each ring is now.
  //
  // Tapping a card opens it; tapping elsewhere on a ring jumps the calendar
  // to that day. Hovering a day lists everything on it (the stacks only
  // show the first few). The dial zooms and pans like the line (pinch,
  // Ctrl/⌘-scroll, drag, or the toolbar); zoomed in, cards keep a readable
  // size and more of each day's stack fits. A dragged card lands on the
  // day under the pointer: the board reads it off `data-radial` + the ring
  // spans (see CalendarView's `yearDayAt`).
  import { onDestroy } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import YearShapeSwitch from "$lib/components/YearShapeSwitch.svelte";
  import { createSvgZoom } from "$lib/svgzoom";
  import { ICONS } from "$lib/icons";
  import { t, locale } from "$lib/i18n";
  import type { CalendarEvent } from "$lib/data";
  import {
    getMoonPhases,
    lunationMoonPhases,
    moonStats,
    nextSolar,
    solarEventsIn,
    type SolarKey,
  } from "$lib/yearscale";

  export let events: CalendarEvent[] = [];
  export let year: number;
  /** The moon close-up inside the year: its span `[from, to)` and its name. */
  export let inner: {
    range: { from: number; to: number };
    title: string;
  } | null = null;
  export let now: Date;
  export let noteColorFor: (category: string | undefined) => string;
  export let onOpen: (ev: CalendarEvent) => void;
  export let onSelectDay: ((date: Date) => void) | null = null;
  export let dropDay: string | null = null;
  export let onDragStart:
    | ((e: PointerEvent, ev: CalendarEvent) => void)
    | null = null;
  /** Lead the toolbar with the year window's Lines/Dial switch. */
  export let showShape = false;
  /**
   * The height the board has for this window (its scroll area), px. The
   * drawing fills it — toolbar included — rather than a capped square; 0
   * falls back to a square as wide as the board.
   */
  export let height = 0;

  // Geometry, in viewBox units (the dial is a 1000×1000 square).
  const C = 500;
  /** Distance from the centre that splits the two rings (for taps/drops). */
  const SPLIT = 290;
  const YEAR = {
    sky: 462, // moons + suns on the rim
    bandOut: 440,
    bandIn: 404,
    stack: 388, // first card, stacking inward
    span: 306, // first span lane, stepping inward
    maxStack: 5,
  };
  const MOON = {
    sky: 262,
    bandOut: 246,
    bandIn: 222,
    stack: 206,
    span: 132,
    maxStack: 4,
  };
  const CHIP = 15; // card square, unzoomed
  const STEP = 18; // radial step per stacked card, unzoomed
  const LANE = 11; // radial step per span lane
  const MAX_LANES = 5;
  const HOVER_ITEMS = 8; // rows the hover card lists before "+n more"

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const zoom = createSvgZoom(1000, 6);
  const { view, busy } = zoom;
  $: zoomed = $view.zoom > 1.001;
  // The viewport is the board's area, whatever its shape.
  let barH = 0;
  let wrapW = 0;
  let wrapH = 0;
  $: if (wrapW && wrapH) zoom.setAspect(wrapW / wrapH);
  // Zooming magnifies the drawing; cards shrink in drawing units by √zoom so
  // on screen they grow a little (easier to hit) while each day's stack
  // gains room for more of them.
  $: k = 1 / Math.sqrt($view.zoom);
  $: chip = CHIP * k;
  $: step = STEP * k;
  $: yearMax = Math.max(
    YEAR.maxStack,
    Math.floor((YEAR.stack - YEAR.span - 8) / step) + 1,
  );
  $: moonMax = Math.max(
    MOON.maxStack,
    Math.floor((MOON.stack - MOON.span - 8) / step) + 1,
  );

  $: yearFrom = new Date(year, 0, 1).getTime();
  $: yearTo = new Date(year + 1, 0, 1).getTime();
  $: moonFrom = inner?.range.from ?? 0;
  $: moonTo = inner?.range.to ?? 0;

  const frac = (ms: number, from: number, to: number) =>
    Math.min(1, Math.max(0, (ms - from) / (to - from)));
  /** Point at fraction `f` of a lap, radius `r` (12 o'clock, clockwise). */
  function pt(f: number, r: number): [number, number] {
    const a = f * 2 * Math.PI;
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  }
  function arc(f0: number, f1: number, r: number): string {
    const sweep = Math.max(f1 - f0, 0.0005);
    if (sweep >= 0.9999) {
      // A whole lap: two halves (one arc can't start and end on one point).
      const [x0, y0] = pt(0, r);
      const [x1, y1] = pt(0.5, r);
      return `M${x0} ${y0}A${r} ${r} 0 1 1 ${x1} ${y1}A${r} ${r} 0 1 1 ${x0} ${y0}`;
    }
    const [x0, y0] = pt(f0, r);
    const [x1, y1] = pt(f0 + sweep, r);
    return `M${x0} ${y0}A${r} ${r} 0 ${sweep > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
  }
  /** A ring sector from `f0` to `f1` between radii `rIn` and `rOut`. */
  function sector(f0: number, f1: number, rIn: number, rOut: number): string {
    const large = f1 - f0 > 0.5 ? 1 : 0;
    const [a, b] = pt(f0, rOut);
    const [c, d] = pt(f1, rOut);
    const [e, g] = pt(f1, rIn);
    const [h, i] = pt(f0, rIn);
    return `M${a} ${b}A${rOut} ${rOut} 0 ${large} 1 ${c} ${d}L${e} ${g}A${rIn} ${rIn} 0 ${large} 0 ${h} ${i}Z`;
  }
  /** Text rotation that keeps a tangent label upright on either half. */
  function upright(f: number): number {
    const deg = f * 360;
    return deg > 90 && deg < 270 ? deg + 180 : deg;
  }

  // ── Cards per ring ────────────────────────────────────────────────────────
  type Day = { key: string; f: number; items: CalendarEvent[] };
  function dayStacks(from: number, to: number, evs: CalendarEvent[]): Day[] {
    const map = new Map<string, Day>();
    for (const ev of evs) {
      if (ev.multiDay) continue;
      const time = ev.date.getTime();
      if (isNaN(time) || time < from || time >= to) continue;
      const key = ev.date.toDateString();
      let day = map.get(key);
      if (!day) {
        const midday = new Date(ev.date);
        midday.setHours(12, 0, 0, 0);
        day = { key, f: frac(midday.getTime(), from, to), items: [] };
        map.set(key, day);
      }
      day.items.push(ev);
    }
    for (const d of map.values())
      d.items.sort((a, b) => a.date.getTime() - b.date.getTime());
    return [...map.values()];
  }
  type Span = { ev: CalendarEvent; lane: number; f0: number; f1: number };
  function spanArcs(from: number, to: number, evs: CalendarEvent[]): Span[] {
    const sorted = evs
      .filter((ev) => {
        if (!ev.multiDay) return false;
        const a = ev.date.getTime();
        return !isNaN(a) && a < to && (ev.end ?? ev.date).getTime() >= from;
      })
      .sort(
        (a, b) =>
          a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id),
      );
    const laneEnds: number[] = [];
    const out: Span[] = [];
    for (const ev of sorted) {
      const start = ev.date.getTime();
      const endEx = new Date(ev.end ?? ev.date);
      endEx.setDate(endEx.getDate() + 1);
      let lane = laneEnds.findIndex((e) => e <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(endEx.getTime());
      } else laneEnds[lane] = endEx.getTime();
      if (lane >= MAX_LANES) continue;
      out.push({
        ev,
        lane,
        f0: frac(start, from, to),
        f1: frac(endEx.getTime(), from, to),
      });
    }
    return out;
  }

  $: yearDays = dayStacks(yearFrom, yearTo, events);
  $: yearSpans = spanArcs(yearFrom, yearTo, events);
  $: moonDays = inner ? dayStacks(moonFrom, moonTo, events) : [];
  $: moonSpans = inner ? spanArcs(moonFrom, moonTo, events) : [];

  // ── Rim: months, lunation days, sky ───────────────────────────────────────
  $: months = Array.from({ length: 12 }, (_, m) => {
    const a = new Date(year, m, 1).getTime();
    const b = new Date(year, m + 1, 1).getTime();
    return {
      m,
      f0: frac(a, yearFrom, yearTo),
      f1: frac(b, yearFrom, yearTo),
      name: new Date(year, m, 15).toLocaleDateString($locale, {
        month: "short",
      }),
    };
  });
  $: moonDayTicks = (() => {
    if (!inner) return [];
    const ticks: Array<{ key: number; f: number; label: string; mid: number }> =
      [];
    const first = new Date(moonFrom);
    const cursor = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate() + 1,
    );
    while (cursor.getTime() < moonTo) {
      const next = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() + 1,
      );
      ticks.push({
        key: cursor.getTime(),
        f: frac(cursor.getTime(), moonFrom, moonTo),
        mid: frac(
          (cursor.getTime() + Math.min(next.getTime(), moonTo)) / 2,
          moonFrom,
          moonTo,
        ),
        label: String(cursor.getDate()),
      });
      cursor.setTime(next.getTime());
    }
    return ticks;
  })();

  $: yearMoons = getMoonPhases(yearFrom, yearTo);
  $: lunaMoons = inner ? lunationMoonPhases(moonFrom, moonTo) : [];
  $: solar = solarEventsIn(yearFrom, yearTo);
  const SUN_FILL: Record<SolarKey, string> = {
    "cal.summerSolstice": "sun",
    "cal.winterSolstice": "dark",
    "cal.springEquinox": "half",
    "cal.autumnEquinox": "half flip",
  };

  $: nowMs = now.getTime();
  $: yearNow =
    nowMs >= yearFrom && nowMs < yearTo ? frac(nowMs, yearFrom, yearTo) : null;
  $: moonNow =
    inner && nowMs >= moonFrom && nowMs < moonTo
      ? frac(nowMs, moonFrom, moonTo)
      : null;
  $: tonight = moonStats(now);
  $: tonightPaths = ICONS[tonight.icon].paths;
  $: titleParts = (inner?.title ?? "").split(" · ");

  // ── Drop target: the day a dragged card would land on, on each ring ───────
  function dayFrac(
    iso: string,
    from: number,
    to: number,
  ): [number, number] | null {
    const [y, m, d] = iso.split("-").map(Number);
    const a = new Date(y, m - 1, d).getTime();
    const b = new Date(y, m - 1, d + 1).getTime();
    if (b <= from || a >= to) return null;
    return [frac(a, from, to), frac(b, from, to)];
  }
  $: dropYear = dropDay ? dayFrac(dropDay, yearFrom, yearTo) : null;
  $: dropMoon = dropDay && inner ? dayFrac(dropDay, moonFrom, moonTo) : null;

  // ── Hit-testing: which ring, which day is under a screen point ───────────
  type Hit = { ring: "year" | "moon"; day: Date };
  function hitAt(clientX: number, clientY: number): Hit | null {
    const p = zoom.toSvg(clientX, clientY);
    if (!p) return null;
    const dx = p.x - C;
    const dy = p.y - C;
    const dist = Math.hypot(dx, dy);
    const f = (((Math.atan2(dx, -dy) / (2 * Math.PI)) % 1) + 1) % 1;
    let ring: Hit["ring"] | null = null;
    if (dist >= SPLIT && dist <= YEAR.sky + 24) ring = "year";
    else if (inner && dist >= MOON.span - MAX_LANES * LANE - 6 && dist < SPLIT)
      ring = "moon";
    if (!ring) return null;
    const [from, to] =
      ring === "moon" ? [moonFrom, moonTo] : [yearFrom, yearTo];
    const day = new Date(Math.min(to - 1, from + (to - from) * f));
    day.setHours(0, 0, 0, 0);
    return { ring, day };
  }

  // ── Taps ──────────────────────────────────────────────────────────────────
  function background(e: MouseEvent) {
    if (!onSelectDay) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit) onSelectDay(hit.day);
  }
  function openEv(e: Event, ev: CalendarEvent) {
    e.stopPropagation();
    onOpen(ev);
  }
  function keyEv(e: KeyboardEvent, ev: CalendarEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(ev);
    }
  }
  function liftEv(e: PointerEvent, ev: CalendarEvent) {
    if (!onDragStart) return;
    if (e.pointerType === "mouse") e.stopPropagation();
    onDragStart(e, ev);
  }
  function onKey(e: KeyboardEvent) {
    if ((e.key === "Enter" || e.key === " ") && onSelectDay) {
      e.preventDefault();
      onSelectDay(yearNow !== null ? now : new Date(yearFrom));
    }
  }

  // ── Hover: the day under the cursor, with everything on it ────────────────
  let wrap: HTMLElement;
  let hover: {
    ring: Hit["ring"];
    day: Date;
    items: CalendarEvent[];
    x: number;
    y: number;
    flipX: boolean;
    flipY: boolean;
    focus: string | null;
  } | null = null;

  function itemsOn(day: Date): CalendarEvent[] {
    const a = day.getTime();
    const b = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate() + 1,
    ).getTime();
    return events
      .filter((ev) => {
        const s = ev.date.getTime();
        if (isNaN(s)) return false;
        if (!ev.multiDay) return s >= a && s < b;
        const end = new Date(ev.end ?? ev.date);
        end.setDate(end.getDate() + 1);
        return s < b && end.getTime() > a;
      })
      .sort(
        (x, y) =>
          Number(y.multiDay) - Number(x.multiDay) ||
          Number(!y.allDay) - Number(!x.allDay) ||
          x.date.getTime() - y.date.getTime(),
      );
  }
  function onHover(e: PointerEvent) {
    if (e.pointerType !== "mouse" || $busy || dropDay) {
      hover = null;
      return;
    }
    const hit = hitAt(e.clientX, e.clientY);
    if (!hit || !wrap) {
      hover = null;
      return;
    }
    const box = wrap.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const focus =
      (e.target as Element | null)
        ?.closest<SVGElement>("[data-ev]")
        ?.getAttribute("data-ev") ?? null;
    const same =
      hover &&
      hover.ring === hit.ring &&
      hover.day.getTime() === hit.day.getTime();
    hover = {
      ring: hit.ring,
      day: hit.day,
      items: same && hover ? hover.items : itemsOn(hit.day),
      x,
      y,
      flipX: x > box.width * 0.6,
      flipY: y > box.height * 0.55,
      focus,
    };
  }
  $: if ($busy) hover = null;
  $: hoverBand = (() => {
    if (!hover) return null;
    const moon = hover.ring === "moon";
    const [from, to] = moon ? [moonFrom, moonTo] : [yearFrom, yearTo];
    const a = hover.day.getTime();
    const b = new Date(
      hover.day.getFullYear(),
      hover.day.getMonth(),
      hover.day.getDate() + 1,
    ).getTime();
    const g = moon ? MOON : YEAR;
    return sector(
      frac(Math.max(a, from), from, to),
      frac(Math.min(b, to), from, to),
      g.span - MAX_LANES * LANE,
      g.bandOut,
    );
  })();
  function timeOf(ev: CalendarEvent): string {
    if (ev.multiDay) {
      const fmt = (d: Date) =>
        d.toLocaleDateString($locale, { day: "numeric", month: "short" });
      return `${fmt(ev.date)} – ${fmt(ev.end ?? ev.date)}`;
    }
    if (ev.allDay) return $t("cal.allDay");
    return ev.date.toLocaleTimeString($locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  onDestroy(() => (hover = null));

  function cardLabel(ev: CalendarEvent): string {
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
  function spanLabel(ev: CalendarEvent): string {
    const fmt = (d: Date) =>
      d.toLocaleDateString($locale, { day: "numeric", month: "short" });
    return `${ev.title} · ${fmt(ev.date)} – ${fmt(ev.end ?? ev.date)}`;
  }
  const fmtDay = (d: Date) =>
    d.toLocaleDateString($locale, { day: "numeric", month: "short" });
</script>

<div class="yd-bar" bind:offsetHeight={barH}>
  {#if showShape}
    <YearShapeSwitch />
  {/if}
  <span class="yd-hint" class:on={zoomed}
    >{zoomed
      ? `${Math.round($view.zoom * 10) / 10}×`
      : $t("cal.zoomHint")}</span
  >
  <div class="yd-zoom">
    <button
      type="button"
      class="yd-zbtn"
      on:click={() => zoom.zoomBy(1 / 1.6)}
      disabled={!zoomed}
      aria-label={$t("cal.zoomOut")}
      title={$t("cal.zoomOut")}>−</button
    >
    <button
      type="button"
      class="yd-zbtn wide"
      on:click={zoom.reset}
      disabled={!zoomed}
      title={$t("cal.zoomReset")}>{$t("cal.zoomReset")}</button
    >
    <button
      type="button"
      class="yd-zbtn"
      on:click={() => zoom.zoomBy(1.6)}
      disabled={$view.zoom >= 5.99}
      aria-label={$t("cal.zoomIn")}
      title={$t("cal.zoomIn")}>+</button
    >
  </div>
</div>

<div
  class="yd"
  bind:this={wrap}
  bind:clientWidth={wrapW}
  bind:clientHeight={wrapH}
  style={height > 0
    ? `height: ${Math.max(320, height - barH - 12)}px`
    : "aspect-ratio: 1"}
>
  <svg
    class="dial"
    class:zoomed
    viewBox={$view.box}
    use:zoom.attach
    role="button"
    tabindex="0"
    aria-label={$t("cal.dialAria")}
    data-radial="1"
    data-view-from={yearFrom}
    data-view-to={yearTo}
    data-inner-from={inner ? moonFrom : undefined}
    data-inner-to={inner ? moonTo : undefined}
    data-split={SPLIT}
    on:click={background}
    on:keydown={onKey}
    on:pointermove={onHover}
    on:pointerleave={() => (hover = null)}
  >
    <!-- Year: month bands -->
    {#each months as m (m.m)}
      {@const mid = (m.f0 + m.f1) / 2}
      {@const [lx, ly] = pt(mid, (YEAR.bandIn + YEAR.bandOut) / 2)}
      <path
        class="band"
        class:alt={m.m % 2 === 1}
        d={sector(m.f0, m.f1, YEAR.bandIn, YEAR.bandOut)}
      />
      <text
        class="month"
        dominant-baseline="central"
        x={lx}
        y={ly}
        transform="rotate({upright(mid)} {lx} {ly})">{m.name}</text
      >
    {/each}

    <!-- Year: sky on the rim -->
    {#each solar as s (s.key)}
      {@const f = frac(s.date.getTime(), yearFrom, yearTo)}
      {@const [x, y] = pt(f, YEAR.sky)}
      <g class="sky">
        <circle class="sun {SUN_FILL[s.key]}" cx={x} cy={y} r="11" />
        {#if SUN_FILL[s.key].startsWith("half")}
          <path
            class="sun-lit"
            d="M{x} {y - 11}a11 11 0 0 {SUN_FILL[s.key] === 'half'
              ? 1
              : 0} 0 22z"
            transform="rotate({f * 360} {x} {y})"
          />
        {/if}
        <title>{$t(s.key)} · {fmtDay(s.date)}</title>
      </g>
    {/each}
    {#each yearMoons as m (m.date.getTime())}
      {@const [x, y] = pt(frac(m.date.getTime(), yearFrom, yearTo), YEAR.sky)}
      <circle class="moon" class:new={m.isNew} cx={x} cy={y} r="6"
        ><title
          >{$t(m.isNew ? "cal.newMoon" : "cal.fullMoon")} · {fmtDay(
            m.date,
          )}</title
        ></circle
      >
    {/each}

    <!-- Year: drop target -->
    {#if dropYear}
      <path
        class="drop"
        d={sector(
          dropYear[0],
          dropYear[1],
          YEAR.span - MAX_LANES * LANE,
          YEAR.bandOut,
        )}
      />
    {/if}

    {#if hoverBand && hover?.ring === "year"}
      <path class="hover-band" d={hoverBand} />
    {/if}

    <!-- Year: spans, then the day stacks -->
    {#each yearSpans as s (s.ev.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <path
        class="span"
        data-ev={s.ev.id}
        d={arc(s.f0, s.f1, YEAR.span - s.lane * LANE)}
        style="stroke: {noteColorFor(s.ev.category)}; --glow: {s.ev
          .sourceColor ?? 'transparent'}"
        role="button"
        tabindex="0"
        aria-label={spanLabel(s.ev)}
        on:pointerdown={(e) => liftEv(e, s.ev)}
        on:click={(e) => openEv(e, s.ev)}
        on:keydown={(e) => keyEv(e, s.ev)}
      />
    {/each}
    {#each yearDays as d (d.key)}
      {#each d.items.slice(0, yearMax) as ev, i (ev.id)}
        {@const [x, y] = pt(d.f, YEAR.stack - i * step)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <rect
          class="chip"
          class:foreign={!!ev.sourceColor}
          x={x - chip / 2}
          y={y - chip / 2}
          width={chip}
          height={chip}
          data-ev={ev.id}
          rx="3"
          transform="rotate({d.f * 360} {x} {y})"
          style="fill: {noteColorFor(ev.category)}; --glow: {ev.sourceColor ??
            'transparent'}"
          role="button"
          tabindex="0"
          aria-label={cardLabel(ev)}
          on:pointerdown={(e) => liftEv(e, ev)}
          on:click={(e) => openEv(e, ev)}
          on:keydown={(e) => keyEv(e, ev)}
        />
      {/each}
      {#if d.items.length > yearMax}
        {@const [x, y] = pt(d.f, YEAR.stack - yearMax * step)}
        <text
          class="more"
          dominant-baseline="central"
          {x}
          {y}
          style="font-size: {12 * k}px">+{d.items.length - yearMax}</text
        >
      {/if}
    {/each}

    {#if yearNow !== null}
      {@const [x0, y0] = pt(yearNow, SPLIT + 6)}
      {@const [x1, y1] = pt(yearNow, YEAR.sky + 14)}
      <line class="now" x1={x0} y1={y0} x2={x1} y2={y1} />
      <circle class="now-dot" cx={x1} cy={y1} r="7" />
    {/if}

    {#if inner}
      <!-- Moon: the ring of days -->
      <circle
        class="ring"
        cx={C}
        cy={C}
        r={(MOON.bandIn + MOON.bandOut) / 2}
        style="stroke-width: {MOON.bandOut - MOON.bandIn}"
      />
      {#each moonDayTicks as d (d.key)}
        {@const [a, b] = pt(d.f, MOON.bandIn)}
        {@const [c, e] = pt(d.f, MOON.bandOut)}
        {@const [lx, ly] = pt(d.mid, (MOON.bandIn + MOON.bandOut) / 2)}
        <line class="tick" x1={a} y1={b} x2={c} y2={e} />
        <text
          class="dayno"
          dominant-baseline="central"
          x={lx}
          y={ly}
          transform="rotate({upright(d.mid)} {lx} {ly})">{d.label}</text
        >
      {/each}
      {#each lunaMoons as m (m.date.getTime())}
        {@const [x, y] = pt(frac(m.date.getTime(), moonFrom, moonTo), MOON.sky)}
        <circle class="moon" class:new={m.isNew} cx={x} cy={y} r="8"
          ><title
            >{$t(m.isNew ? "cal.newMoon" : "cal.fullMoon")} · {fmtDay(
              m.date,
            )}</title
          ></circle
        >
      {/each}

      {#if dropMoon}
        <path
          class="drop"
          d={sector(
            dropMoon[0],
            dropMoon[1],
            MOON.span - MAX_LANES * LANE,
            MOON.bandOut,
          )}
        />
      {/if}

      {#if hoverBand && hover?.ring === "moon"}
        <path class="hover-band" d={hoverBand} />
      {/if}

      {#each moonSpans as s (s.ev.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <path
          class="span"
          data-ev={s.ev.id}
          d={arc(s.f0, s.f1, MOON.span - s.lane * LANE)}
          style="stroke: {noteColorFor(s.ev.category)}; --glow: {s.ev
            .sourceColor ?? 'transparent'}"
          role="button"
          tabindex="0"
          aria-label={spanLabel(s.ev)}
          on:pointerdown={(e) => liftEv(e, s.ev)}
          on:click={(e) => openEv(e, s.ev)}
          on:keydown={(e) => keyEv(e, s.ev)}
        />
      {/each}
      {#each moonDays as d (d.key)}
        {#each d.items.slice(0, moonMax) as ev, i (ev.id)}
          {@const [x, y] = pt(d.f, MOON.stack - i * step)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <rect
            class="chip"
            class:foreign={!!ev.sourceColor}
            x={x - chip / 2}
            y={y - chip / 2}
            width={chip}
            height={chip}
            data-ev={ev.id}
            rx="3"
            transform="rotate({d.f * 360} {x} {y})"
            style="fill: {noteColorFor(ev.category)}; --glow: {ev.sourceColor ??
              'transparent'}"
            role="button"
            tabindex="0"
            aria-label={cardLabel(ev)}
            on:pointerdown={(e) => liftEv(e, ev)}
            on:click={(e) => openEv(e, ev)}
            on:keydown={(e) => keyEv(e, ev)}
          />
        {/each}
        {#if d.items.length > moonMax}
          {@const [x, y] = pt(d.f, MOON.stack - moonMax * step)}
          <text
            class="more"
            dominant-baseline="central"
            {x}
            {y}
            style="font-size: {12 * k}px">+{d.items.length - moonMax}</text
          >
        {/if}
      {/each}

      {#if moonNow !== null}
        {@const [x0, y0] = pt(moonNow, MOON.span - MAX_LANES * LANE + 20)}
        {@const [x1, y1] = pt(moonNow, MOON.sky + 14)}
        <line class="now" x1={x0} y1={y0} x2={x1} y2={y1} />
        <circle class="now-dot" cx={x1} cy={y1} r="6" />
      {/if}
    {/if}

    <!-- Centre: tonight's moon and the lunation's name -->
    <g
      class="tonight"
      transform="translate({C - 30} {C - 72}) scale(2.5)"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" class="tonight-disc" />
      {#each tonightPaths as p}
        <path d={p.d} class:fill={p.fill} />
      {/each}
    </g>
    <text class="centre-title" x={C} y={C + 18}>{titleParts[0] ?? year}</text>
    {#if titleParts[1]}
      <text class="centre-sub" x={C} y={C + 48}>{titleParts[1]}</text>
    {/if}
    <text class="centre-sub" x={C} y={C + 76}
      >{$t(tonight.nameKey)} · {$t("cal.moonLit", { pct: tonight.pct })}</text
    >
  </svg>

  {#if hover}
    {@const moon = moonStats(hover.day)}
    {@const sun = nextSolar(hover.day)}
    <div
      class="yd-readout"
      class:flip-x={hover.flipX}
      class:flip-y={hover.flipY}
      style="left: {hover.x}px; top: {hover.y}px"
      aria-hidden="true"
    >
      <div class="ro-date">
        {hover.day.toLocaleDateString($locale, {
          weekday: "short",
          day: "numeric",
          month: "long",
        })}
      </div>
      <div class="ro-line">
        <Icon name={moon.icon} />
        {$t(moon.nameKey)} · {$t("cal.moonLit", { pct: moon.pct })}
      </div>
      <div class="ro-line">
        <Icon name="sun" />
        {sun.days === 0
          ? $t("cal.solarToday", { name: $t(sun.key) })
          : $t("cal.inDays", { name: $t(sun.key), n: sun.days })}
      </div>
      {#if hover.items.length}
        <ul class="ro-items">
          {#each hover.items.slice(0, HOVER_ITEMS) as ev (ev.id)}
            <li class:focus={ev.id === hover.focus}>
              <span
                class="ro-dot"
                class:span={ev.multiDay}
                style="background: {noteColorFor(ev.category)}"
              ></span>
              <span class="ro-title">{ev.title}</span>
              <span class="ro-time">{timeOf(ev)}</span>
            </li>
          {/each}
        </ul>
        {#if hover.items.length > HOVER_ITEMS}
          <div class="ro-more">
            {$t("cal.moreItems", { n: hover.items.length - HOVER_ITEMS })}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  /* ── Toolbar ───────────────────────────────────────────────────────────── */
  .yd-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.7rem;
    margin: 0.6rem 0.2rem 0;
  }
  .yd-hint {
    font-size: 0.78rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .yd-hint.on {
    color: var(--ink);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .yd-zoom {
    display: flex;
    gap: 0.3rem;
    margin-left: auto;
  }
  .yd-zbtn {
    min-width: 44px;
    min-height: 44px;
    padding: 0 0.6rem;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font-size: 1.1rem;
    font-weight: 800;
    cursor: pointer;
    touch-action: manipulation;
  }
  .yd-zbtn.wide {
    font-size: 0.75rem;
  }
  .yd-zbtn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .yd-zbtn:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }

  .yd {
    position: relative;
    flex-shrink: 0;
    margin-top: 0.4rem;
  }
  .dial {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    font-family: inherit;
  }
  /* Zoomed in, a finger drag pans the dial, not the page. */
  .dial.zoomed {
    touch-action: none;
    cursor: grab;
  }
  .dial:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: -2px;
    border-radius: 1rem;
  }
  .band {
    fill: color-mix(in srgb, var(--line) 55%, transparent);
    stroke: var(--paper);
    stroke-width: 2;
  }
  .band.alt {
    fill: color-mix(in srgb, var(--line) 85%, transparent);
  }
  .month {
    fill: var(--ink);
    font-size: 17px;
    font-weight: 600;
    text-anchor: middle;
    pointer-events: none;
  }
  .ring {
    fill: none;
    stroke: color-mix(in srgb, var(--line) 70%, transparent);
  }
  .tick {
    stroke: var(--paper);
    stroke-width: 2;
  }
  .dayno {
    fill: var(--muted);
    font-size: 12px;
    text-anchor: middle;
    pointer-events: none;
  }
  /* Fixed fills, not theme tokens (as on the line): the sun is warm and a
     full moon light, a new moon dark, in EITHER palette. */
  .sun {
    fill: #f2c14e;
    filter: drop-shadow(0 0 5px rgba(242, 193, 78, 0.65));
  }
  .sun.dark {
    fill: #7b8794;
    filter: none;
  }
  .sun.half {
    fill: #7b8794;
    filter: none;
  }
  .sun-lit {
    fill: #f2c14e;
  }
  .moon {
    fill: #f4f0e4;
    stroke: var(--muted);
    stroke-width: 1.5;
  }
  .moon.new {
    fill: #1f2a29;
  }
  .chip {
    cursor: pointer;
    touch-action: pan-y;
    stroke: var(--paper);
    stroke-width: 1.5;
  }
  .chip.foreign {
    filter: drop-shadow(0 0 3px var(--glow));
  }
  .chip:focus-visible,
  .span:focus-visible {
    outline: none;
    stroke: var(--teal);
    stroke-width: 3;
  }
  .span {
    fill: none;
    stroke-width: 8;
    stroke-linecap: round;
    cursor: pointer;
    touch-action: pan-y;
    filter: drop-shadow(0 0 2px var(--glow));
  }
  .more {
    fill: var(--muted);
    font-size: 12px;
    font-weight: 600;
    text-anchor: middle;
    pointer-events: none;
  }
  .now {
    stroke: var(--teal);
    stroke-width: 3;
    stroke-linecap: round;
    pointer-events: none;
  }
  .now-dot {
    fill: var(--teal);
    stroke: color-mix(in srgb, var(--teal) 30%, transparent);
    stroke-width: 6;
    pointer-events: none;
  }
  .hover-band {
    fill: color-mix(in srgb, var(--ink) 7%, transparent);
    pointer-events: none;
  }
  .drop {
    fill: color-mix(in srgb, var(--teal) 24%, transparent);
    stroke: var(--teal);
    stroke-width: 2;
    pointer-events: none;
  }
  .tonight {
    pointer-events: none;
  }
  .tonight-disc {
    fill: #1f2a29;
  }
  .tonight path {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1;
  }
  .tonight path.fill {
    fill: #f4f0e4;
    stroke: none;
  }
  .centre-title {
    fill: var(--ink);
    font-size: 30px;
    font-weight: 700;
    text-anchor: middle;
    pointer-events: none;
  }
  .centre-sub {
    fill: var(--muted);
    font-size: 19px;
    text-anchor: middle;
    pointer-events: none;
  }

  /* ── Hover card ────────────────────────────────────────────────────────── */
  .yd-readout {
    position: absolute;
    z-index: 4;
    width: max-content;
    max-width: min(20rem, 80vw);
    transform: translate(14px, 14px);
    padding: 0.55rem 0.7rem;
    border-radius: 12px;
    background: var(--card);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-soft);
    color: var(--ink);
    font-size: 0.78rem;
    pointer-events: none;
  }
  .yd-readout.flip-x {
    transform: translate(calc(-100% - 14px), 14px);
  }
  .yd-readout.flip-y {
    transform: translate(14px, calc(-100% - 14px));
  }
  .yd-readout.flip-x.flip-y {
    transform: translate(calc(-100% - 14px), calc(-100% - 14px));
  }
  .ro-date {
    font-weight: 800;
    margin-bottom: 0.2rem;
  }
  .ro-line {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--muted);
  }
  .ro-items {
    list-style: none;
    margin: 0.45rem 0 0;
    padding: 0.4rem 0 0;
    border-top: 1px solid var(--line);
    display: grid;
    gap: 0.25rem;
  }
  .ro-items li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.45rem;
  }
  .ro-items li.focus .ro-title {
    font-weight: 800;
  }
  .ro-dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 2px;
  }
  .ro-dot.span {
    width: 1rem;
    height: 0.35rem;
    border-radius: 999px;
  }
  .ro-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ro-time {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ro-more {
    margin-top: 0.25rem;
    color: var(--muted);
  }
</style>
