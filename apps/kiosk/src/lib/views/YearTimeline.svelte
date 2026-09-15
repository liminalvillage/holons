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
  //
  // The line zooms and pans: pinch or Ctrl/⌘-scroll to zoom around the
  // fingers/cursor, drag (or scroll sideways) to pan, or use the toolbar.
  // Zooming only spreads positions out — markers keep their size — so once a
  // card has room before its neighbour its title appears next to it, and a
  // span wide enough carries its title inside the bar.
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
  /**
   * "YYYY-MM-DD" a card being dragged (from CalendarView's drawer) would land
   * on, to highlight it. CalendarView reads the day off the pointer via the
   * container's `data-view-from`/`data-view-to` (the ms the viewport spans).
   */
  export let dropDay: string | null = null;
  /**
   * A press on a card is the card's, not the timeline's: the board takes the
   * pointer for its drag (move to another day, or into the drawer) instead
   * of a pan starting under it. Null leaves cards tap-only.
   */
  export let onDragStart:
    | ((e: PointerEvent, ev: CalendarEvent) => void)
    | null = null;

  // Layout constants (rem, so the timeline scales with the kiosk's fluid
  // root font) — keep in sync with the stacking styles below.
  const MIN_HEIGHT_REM = 11;
  const ROW_REM = 0.85; // vertical step per stacked square
  const STACK_BASE_REM = 1.1; // gap between the baseline and the first square
  const LANE_REM = 0.6; // vertical step per span lane
  const LABELED_LANE_REM = 1.05; // …once span bars are wide enough for titles

  const DAY_MS = 86400000;
  const MAX_ZOOM = 60; // ≈ six days across the width
  const DRAG_SLOP_PX = 6; // movement before a press becomes a pan
  const LABEL_MIN_PX = 44; // narrowest room worth a (truncated) title
  const LABEL_MAX_PX = 240;
  const SPAN_LABEL_MIN_PX = 40;

  $: yearStart = new Date(year, 0, 1).getTime();
  $: yearEnd = new Date(year + 1, 0, 1).getTime();

  // Fraction of a year elapsed at `date`, clamped to the displayed year so
  // spans crossing a year boundary pin to the timeline edges. (The helpers
  // below are reactive declarations, not functions: `$:` blocks only see the
  // variables they name, so a plain function reading the viewport would leave
  // them stale while panning.)
  $: positionInYear = (date: Date): number => {
    const pos = ((date.getTime() - yearStart) / (yearEnd - yearStart)) * 100;
    return Math.min(100, Math.max(0, pos));
  };

  // ── Viewport: zoom + pan ──────────────────────────────────────────────────
  // `zoom` is how many widths the year spans; `viewStart` is the year
  // position (0–100) at the left edge. Everything is placed through `toX`.
  let zoom = 1;
  let viewStart = 0;
  let width = 0; // container px (bind:clientWidth)

  $: viewSpan = 100 / zoom;
  $: pxPerPct = (width * zoom) / 100;
  $: pxPerDay = (pxPerPct * 100 * DAY_MS) / (yearEnd - yearStart);
  $: zoomed = zoom > 1.001;
  // Handlers read the viewport through these instead of the `$:` values
  // above, which only refresh on the next flush — back-to-back wheel or
  // pointer events in one tick would otherwise compound a stale span.
  const spanNow = () => 100 / zoom;
  const pxPerPctNow = () => (width * zoom) / 100;

  $: toX = (pos: number): number => (pos - viewStart) * zoom;
  /** Is the year range [from, to] (with a margin) inside the viewport? */
  $: inView = (from: number, to: number = from): boolean => {
    const margin = viewSpan * 0.05;
    return to >= viewStart - margin && from <= viewStart + viewSpan + margin;
  };
  function clampView(start: number, z: number = zoom): number {
    return Math.min(100 - 100 / z, Math.max(0, start));
  }
  /** Zoom to `next`, keeping the year position under `frac` (0–1) still. */
  function zoomAt(frac: number, next: number) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const anchor = viewStart + frac * spanNow();
    zoom = z;
    viewStart = clampView(anchor - (frac * 100) / z, z);
  }
  function resetView() {
    zoom = 1;
    viewStart = 0;
  }
  // A new year starts from the whole-year overview.
  $: (year, resetView());

  function fracAt(clientX: number): number {
    const rect = container.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }
  function dateAtFrac(frac: number): Date {
    const pos = viewStart + frac * spanNow();
    return new Date(yearStart + ((yearEnd - yearStart) * pos) / 100);
  }

  // ── Cards, grouped per day ────────────────────────────────────────────────
  // Single-day cards become the stacked squares; multi-day spans go to the
  // lane bars instead (a bar already says "these days", a dot per day would
  // triple-count it). A day's stack stands at its midday, so zoomed in it
  // sits in the middle of that day's column.
  type DayGroup = { date: Date; pos: number; items: CalendarEvent[] };
  $: dayGroups = (() => {
    const groups = new Map<string, DayGroup>();
    for (const ev of events) {
      if (ev.multiDay) continue;
      const time = ev.date.getTime();
      if (isNaN(time) || time < yearStart || time >= yearEnd) continue;
      const key = ev.date.toDateString();
      let group = groups.get(key);
      if (!group) {
        const anchor = new Date(ev.date);
        anchor.setHours(0, 0, 0, 0);
        const midday = new Date(anchor);
        midday.setHours(12);
        group = { date: anchor, pos: positionInYear(midday), items: [] };
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

  // Title room per stacked square: the px distance to the next day whose
  // stack reaches the same row (lower neighbours don't collide). One sweep
  // from the right, remembering the nearest occupant of each row.
  $: labelRoom = (() => {
    const next: number[] = [];
    const room: number[][] = new Array(dayGroups.length);
    for (let g = dayGroups.length - 1; g >= 0; g--) {
      const day = dayGroups[g];
      room[g] = day.items.map((_, i) => {
        const gap = ((next[i] ?? 100) - day.pos) * pxPerPct;
        next[i] = day.pos;
        return gap;
      });
    }
    return room;
  })();
  function labelWidth(room: number): number | null {
    // Room minus this square's half, the label's lead gap, and the
    // neighbour's half-square.
    const w = Math.min(LABEL_MAX_PX, room - 20);
    return w >= LABEL_MIN_PX ? w : null;
  }

  // Multi-day spans visible this year, with a greedy lane assignment so
  // overlapping stretches stack instead of drawing on top of each other.
  $: yearSpans = (() => {
    const sorted = events
      .filter((ev) => {
        if (!ev.multiDay) return false;
        const from = ev.date.getTime();
        const to = (ev.end ?? ev.date).getTime();
        return !isNaN(from) && from < yearEnd && to >= yearStart;
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

  // Spans on screen, clipped to the viewport so a bar that runs off the left
  // edge still starts its title at the visible edge.
  $: shownSpans = yearSpans
    .filter((s) => inView(s.startPos, s.endPos))
    .map((s) => {
      const left = Math.max(toX(s.startPos), -1);
      const right = Math.min(toX(s.endPos), 101);
      const widthPct = Math.max(right - left, 0.25);
      return {
        ...s,
        left,
        widthPct,
        labeled: (widthPct / 100) * width >= SPAN_LABEL_MIN_PX,
      };
    });
  $: laneRem = shownSpans.some((s) => s.labeled) ? LABELED_LANE_REM : LANE_REM;

  // Auto-scale the timeline height so dense days don't overflow: the square
  // stack lives in the band above the baseline (~35% of the container), and
  // the container grows one lane-step per span lane.
  $: maxStack = dayGroups.reduce((m, d) => Math.max(m, d.items.length), 0);
  $: heightRem =
    Math.max(
      MIN_HEIGHT_REM,
      (STACK_BASE_REM + maxStack * ROW_REM + 1.2) / 0.35,
    ) +
    laneCount * laneRem;

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

  // Month bands on screen. The name pins to the left edge while its month
  // is partly scrolled off, and spells out in full once there's room.
  $: longMonths = pxPerDay * 30 >= 130;
  $: shownMonths = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(year, i, 1);
    const from = positionInYear(date);
    const to = positionInYear(new Date(year, i + 1, 1));
    return { i, date, from, to };
  })
    .filter((m) => inView(m.from, m.to))
    .map((m) => ({
      ...m,
      x: toX(m.from),
      name: m.date.toLocaleDateString($locale, {
        month: longMonths ? "long" : "short",
      }),
    }));

  // Day ticks once days are wide enough: every day's number when there's
  // room for it, else a tick per Monday.
  $: dayStep = pxPerDay >= 20 ? 1 : pxPerDay >= 5 ? 7 : 0;
  $: dayTicks = (() => {
    if (!dayStep) return [];
    const ticks: Array<{ key: number; x: number; label: string }> = [];
    const firstVisible = Math.max(
      0,
      Math.floor(((viewStart / 100) * (yearEnd - yearStart)) / DAY_MS) - 1,
    );
    const cursor = new Date(year, 0, 1 + firstVisible);
    while (cursor.getTime() < yearEnd) {
      const pos = positionInYear(cursor);
      if (pos > viewStart + viewSpan) break;
      const isMonday = cursor.getDay() === 1;
      if (cursor.getDate() !== 1 && (dayStep === 1 || isMonday))
        ticks.push({
          key: cursor.getTime(),
          x: toX(pos),
          label: String(cursor.getDate()),
        });
      cursor.setDate(cursor.getDate() + 1);
    }
    return ticks;
  })();

  $: todayPos = now.getFullYear() === year ? positionInYear(now) : null;

  $: fmtPos = (pos: number): string =>
    new Date(
      yearStart + ((yearEnd - yearStart) * Math.min(pos, 99.99)) / 100,
    ).toLocaleDateString($locale, { day: "numeric", month: "short" });
  $: rangeLabel = zoomed
    ? `${fmtPos(viewStart)} – ${fmtPos(viewStart + viewSpan)}`
    : String(year);

  // ── Gestures: drag to pan, pinch to zoom, tap to open/jump ────────────────
  let container: HTMLElement;
  const pointers = new Map<number, { x: number; y: number }>();
  type Pan = {
    kind: "pan";
    id: number;
    x: number;
    y: number;
    start: number;
    active: boolean;
  };
  type Pinch = { kind: "pinch"; dist: number; zoom: number; anchor: number };
  let gesture: Pan | Pinch | null = null;
  let dragged = false; // swallow the click that ends a pan/pinch

  function pinchMetrics() {
    const [a, b] = Array.from(pointers.values());
    return {
      dist: Math.max(24, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: (a.x + b.x) / 2,
    };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragged = false;
      gesture = {
        kind: "pan",
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        start: viewStart,
        active: false,
      };
    } else if (pointers.size === 2) {
      const { dist, mid } = pinchMetrics();
      gesture = {
        kind: "pinch",
        dist,
        zoom,
        anchor: viewStart + fracAt(mid) * spanNow(),
      };
      dragged = true;
      hover = null;
      for (const id of pointers.keys()) capture(id);
    }
  }

  function capture(id: number) {
    try {
      container.setPointerCapture(id);
    } catch {
      /* pointer already gone */
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!container) return;
    if (pointers.has(e.pointerId))
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (gesture?.kind === "pinch" && pointers.size >= 2) {
      const { dist, mid } = pinchMetrics();
      const z = Math.min(
        MAX_ZOOM,
        Math.max(1, gesture.zoom * (dist / gesture.dist)),
      );
      zoom = z;
      viewStart = clampView(gesture.anchor - (fracAt(mid) * 100) / z, z);
      return;
    }
    if (gesture?.kind === "pan" && gesture.id === e.pointerId) {
      const dx = e.clientX - gesture.x;
      if (
        !gesture.active &&
        Math.abs(dx) > DRAG_SLOP_PX &&
        Math.abs(dx) > Math.abs(e.clientY - gesture.y)
      ) {
        gesture.active = true;
        dragged = true;
        capture(e.pointerId);
      }
      if (gesture.active) {
        hover = null;
        if (width > 0)
          viewStart = clampView(gesture.start - dx / pxPerPctNow());
        return;
      }
    }

    // Hover readout: the date under the cursor + its sky statistics.
    const target = e.target as HTMLElement | null;
    if (target?.closest(".yt-dot, .yt-span, .yt-sky")) {
      hover = null; // that element's own tooltip is speaking
      return;
    }
    const frac = fracAt(e.clientX);
    hover = { pct: frac * 100, date: dateAtFrac(frac) };
  }

  function onPointerEnd(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (gesture?.kind === "pinch" && pointers.size === 1) {
      // Lifting one finger of a pinch carries on as a pan with the other.
      const [[id, p]] = Array.from(pointers.entries());
      gesture = {
        kind: "pan",
        id,
        x: p.x,
        y: p.y,
        start: viewStart,
        active: true,
      };
    } else if (pointers.size === 0) {
      gesture = null;
    }
    if (e.type === "pointercancel") hover = null;
  }

  function swallowDragClick(e: MouseEvent) {
    if (!dragged) return;
    dragged = false;
    // Immediate: after pointer capture the click lands on the container
    // itself, where its own bubble listener would still run.
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  // Ctrl/⌘-scroll (and a trackpad pinch, which arrives as ctrl+wheel) zooms
  // around the cursor; a sideways scroll pans. Plain vertical scrolling is
  // left to the page. Non-passive, so it's attached by hand.
  function wheel(node: HTMLElement) {
    const handler = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? width : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(fracAt(e.clientX), zoom * Math.exp(-e.deltaY * unit * 0.01));
        return;
      }
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      if (
        zoom > 1.001 &&
        dx &&
        (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))
      ) {
        e.preventDefault();
        if (width > 0)
          viewStart = clampView(viewStart + (dx * unit) / pxPerPctNow());
      }
    };
    node.addEventListener("wheel", handler, { passive: false });
    return { destroy: () => node.removeEventListener("wheel", handler) };
  }

  // ── Tap-to-jump: anywhere on the empty timeline picks that day ────────────
  function handleBackgroundClick(e: MouseEvent) {
    if (!onSelectDay || !container) return;
    onSelectDay(dateAtFrac(fracAt(e.clientX)));
  }
  function onBackgroundKey(e: KeyboardEvent) {
    if ((e.key === "Enter" || e.key === " ") && onSelectDay) {
      e.preventDefault();
      onSelectDay(now.getFullYear() === year ? now : new Date(year, 0, 1));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomAt(0.5, zoom * 1.6);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomAt(0.5, zoom / 1.6);
    } else if (e.key === "0") {
      e.preventDefault();
      resetView();
    } else if (
      (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
      zoom > 1.001
    ) {
      e.preventDefault();
      const step = spanNow() * 0.2 * (e.key === "ArrowLeft" ? -1 : 1);
      viewStart = clampView(viewStart + step);
    }
  }
  function openEv(e: Event, ev: CalendarEvent) {
    e.stopPropagation(); // don't also jump the day underneath
    onOpen(ev);
  }
  function liftEv(e: PointerEvent, ev: CalendarEvent) {
    if (!onDragStart) return;
    e.stopPropagation(); // the timeline must not start panning under it
    onDragStart(e, ev);
  }

  // ── Toolbar: zoom buttons + the overview strip ────────────────────────────
  // The strip is the whole year in miniature with the viewport as a window;
  // pressing or dragging on it centres the view there.
  let overview: HTMLElement;
  let scrubbing = false;
  function scrubTo(clientX: number) {
    const rect = overview.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    viewStart = clampView(frac * 100 - spanNow() / 2);
  }
  function onScrubDown(e: PointerEvent) {
    scrubbing = true;
    overview.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  }
  function onScrubMove(e: PointerEvent) {
    if (scrubbing) scrubTo(e.clientX);
  }
  function onScrubEnd() {
    scrubbing = false;
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
      days: Math.round((next.date.getTime() - day.getTime()) / DAY_MS),
    };
  }

  function onPointerLeave() {
    hover = null;
  }

  // ── Drop target: the day a dragged card would land on ─────────────────────
  $: viewFromMs = yearStart + ((yearEnd - yearStart) * viewStart) / 100;
  $: viewToMs =
    yearStart + ((yearEnd - yearStart) * (viewStart + viewSpan)) / 100;
  $: dropBand = (() => {
    if (!dropDay) return null;
    const [y, m, d] = dropDay.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const from = positionInYear(start);
    const to = positionInYear(new Date(y, m - 1, d + 1));
    if (!inView(from, to)) return null;
    const left = toX(from);
    return {
      left,
      width: Math.max(toX(to) - left, 0),
      label: start.toLocaleDateString($locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    };
  })();
</script>

<div class="yt-bar">
  {#if zoomed}
    <span class="yt-range">{rangeLabel}</span>
  {:else}
    <!-- The header already names the year; say how to get closer instead. -->
    <span class="yt-range hint">{$t("cal.zoomHint")}</span>
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="yt-overview"
    class:off={!zoomed}
    bind:this={overview}
    on:pointerdown={onScrubDown}
    on:pointermove={onScrubMove}
    on:pointerup={onScrubEnd}
    on:pointercancel={onScrubEnd}
    aria-hidden="true"
  >
    {#each Array(12) as _, i}
      <span class="yt-ov-month" style="left: {(i / 12) * 100}%"></span>
    {/each}
    {#if todayPos !== null}
      <span class="yt-ov-today" style="left: {todayPos}%"></span>
    {/if}
    <span class="yt-ov-window" style="left: {viewStart}%; width: {viewSpan}%"
    ></span>
  </div>
  <div class="yt-zoom">
    <button
      type="button"
      class="yt-zbtn"
      on:click={() => zoomAt(0.5, zoom / 1.6)}
      disabled={!zoomed}
      aria-label={$t("cal.zoomOut")}
      title={$t("cal.zoomOut")}>−</button
    >
    <button
      type="button"
      class="yt-zbtn wide"
      on:click={resetView}
      disabled={!zoomed}
      title={$t("cal.zoomReset")}>{$t("cal.zoomReset")}</button
    >
    <button
      type="button"
      class="yt-zbtn"
      on:click={() => zoomAt(0.5, zoom * 1.6)}
      disabled={zoom >= MAX_ZOOM}
      aria-label={$t("cal.zoomIn")}
      title={$t("cal.zoomIn")}>+</button
    >
  </div>
</div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="yt"
  class:zoomed
  class:panning={gesture?.kind === "pinch" ||
    (gesture?.kind === "pan" && gesture.active)}
  style="height: {heightRem}rem;"
  data-view-from={viewFromMs}
  data-view-to={viewToMs}
  bind:this={container}
  bind:clientWidth={width}
  use:wheel
  on:click|capture={swallowDragClick}
  on:click={handleBackgroundClick}
  on:keydown={onBackgroundKey}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerEnd}
  on:pointercancel={onPointerEnd}
  on:pointerleave={onPointerLeave}
  role="button"
  tabindex="0"
>
  <!-- Baseline -->
  <div class="yt-base" aria-hidden="true"></div>

  <!-- Month grid -->
  {#each shownMonths as m (m.i)}
    <div class="yt-month" style="left: {m.x}%" aria-hidden="true">
      <div class="yt-month-line"></div>
    </div>
    <span
      class="yt-month-name"
      style="left: {Math.max(m.x, 0)}%; max-width: {Math.max(
        0,
        toX(m.to) - Math.max(m.x, 0),
      )}%"
      aria-hidden="true">{m.name}</span
    >
  {/each}

  <!-- Day ticks (zoomed in) -->
  {#each dayTicks as d (d.key)}
    <div
      class="yt-daytick"
      class:week={dayStep === 7}
      style="left: {d.x}%"
      aria-hidden="true"
    >
      <span>{d.label}</span>
    </div>
  {/each}

  <!-- Solar turning points -->
  {#each solarEvents as s (s.key)}
    {#if inView(positionInYear(s.date))}
      <div class="yt-sky" style="left: {toX(positionInYear(s.date))}%">
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
    {/if}
  {/each}

  <!-- New + full moons -->
  {#each moonPhases as m (m.date.toISOString())}
    {#if inView(positionInYear(m.date))}
      <div class="yt-sky" style="left: {toX(positionInYear(m.date))}%">
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
    {/if}
  {/each}

  <!-- Single-day cards: squares stacked upward from the baseline, titled
       once there's room before the next stack on the same row -->
  {#each dayGroups as day, g (day.date.toISOString())}
    {#if inView(day.pos)}
      <div class="yt-day" style="left: {toX(day.pos)}%">
        <div
          class="yt-stem"
          style="height: {STACK_BASE_REM + day.items.length * ROW_REM}rem;"
          aria-hidden="true"
        ></div>
        {#each day.items as ev, i (ev.id)}
          {@const lw = labelWidth(labelRoom[g]?.[i] ?? 0)}
          <button
            type="button"
            class="yt-dot"
            class:is-foreign={!!ev.sourceColor}
            style="top: calc(50% - {STACK_BASE_REM +
              (i + 1) * ROW_REM}rem); background: {noteColorFor(
              ev.category,
            )}; --glow: {ev.sourceColor ?? 'transparent'};"
            aria-label={dotTitle(ev)}
            on:pointerdown={(e) => liftEv(e, ev)}
            on:click={(e) => openEv(e, ev)}
          >
            {#if lw !== null}
              <span
                class="yt-label"
                style="max-width: {lw}px"
                aria-hidden="true">{ev.title}</span
              >
            {/if}
            <span class="yt-tip">{dotTitle(ev)}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/each}

  <!-- Multi-day spans: lane bars along the bottom edge -->
  {#each shownSpans as s (s.ev.id)}
    <button
      type="button"
      class="yt-span"
      class:labeled={s.labeled}
      class:is-foreign={!!s.ev.sourceColor}
      style="left: {s.left}%; width: {s.widthPct}%; bottom: {0.35 +
        s.lane * laneRem}rem; background: {noteColorFor(
        s.ev.category,
      )}; --glow: {s.ev.sourceColor ?? 'transparent'};"
      aria-label={spanTitle(s.ev)}
      on:pointerdown={(e) => liftEv(e, s.ev)}
      on:click={(e) => openEv(e, s.ev)}
    >
      {#if s.labeled}
        <span class="yt-span-label" aria-hidden="true">{s.ev.title}</span>
      {/if}
      <span class="yt-tip">{spanTitle(s.ev)}</span>
    </button>
  {/each}

  <!-- Today -->
  {#if todayPos !== null && inView(todayPos)}
    <div class="yt-today" style="left: {toX(todayPos)}%" aria-hidden="true">
      <span class="yt-today-dot"></span>
    </div>
  {/if}

  <!-- Drop target while a card is dragged over the timeline -->
  {#if dropBand}
    <div
      class="yt-drop"
      class:flip={dropBand.left > 70}
      style="left: {dropBand.left}%; width: {dropBand.width}%"
      aria-hidden="true"
    >
      <span class="yt-drop-label">{dropBand.label}</span>
    </div>
  {/if}

  <!-- Hover readout: hairline + sky statistics for the date under the cursor -->
  {#if hover && !dropDay}
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
  /* ── Toolbar ───────────────────────────────────────────────────────────── */
  .yt-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.7rem;
    margin: 0.6rem 0.2rem 0;
  }
  .yt-range {
    min-width: 7.5rem;
    font-size: 0.78rem;
    font-weight: 800;
    color: var(--ink);
    white-space: nowrap;
  }
  .yt-overview {
    position: relative;
    flex: 1 1 8rem;
    height: 44px; /* touch target; the drawn strip is the inner band */
    cursor: pointer;
    touch-action: none;
  }
  .yt-overview::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 0.7rem;
    transform: translateY(-50%);
    border-radius: 999px;
    background: var(--paper);
    border: 1px solid var(--line);
  }
  .yt-overview.off {
    visibility: hidden;
  }
  .yt-range.hint {
    font-weight: 600;
    color: var(--muted);
    white-space: normal;
  }
  /* Narrow: range + buttons share the first row, the strip gets its own. */
  @media (max-width: 640px) {
    .yt-overview {
      order: 3;
      flex-basis: 100%;
    }
    .yt-overview.off {
      display: none;
    }
    .yt-range {
      min-width: 0;
      flex: 1 1 0;
    }
  }
  .yt-ov-month {
    position: absolute;
    top: calc(50% - 0.35rem);
    height: 0.7rem;
    width: 1px;
    background: var(--line);
  }
  .yt-ov-today {
    position: absolute;
    top: calc(50% - 0.45rem);
    height: 0.9rem;
    width: 2px;
    background: var(--teal);
  }
  .yt-ov-window {
    position: absolute;
    top: calc(50% - 0.5rem);
    height: 1rem;
    min-width: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--teal) 22%, transparent);
    border: 1.5px solid var(--teal);
    box-sizing: border-box;
  }
  .yt-zoom {
    display: flex;
    gap: 0.3rem;
    margin-left: auto;
  }
  .yt-zbtn {
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
  .yt-zbtn.wide {
    font-size: 0.75rem;
  }
  .yt-zbtn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .yt-zbtn:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }

  .yt {
    position: relative;
    margin: 0.4rem 0.2rem 0.4rem;
    border-radius: 14px;
    background: var(--paper);
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
    overflow: hidden;
    /* Vertical swipes still scroll the page; sideways drags and pinches are
       the timeline's (see onPointerDown). */
    touch-action: pan-y;
  }
  .yt.zoomed {
    cursor: grab;
  }
  .yt.panning {
    cursor: grabbing;
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
    padding-left: 0.3rem;
    box-sizing: border-box;
    overflow: hidden;
    white-space: nowrap;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    pointer-events: none;
  }

  /* Day ticks: a short mark under the month names, number beside it. */
  .yt-daytick {
    position: absolute;
    top: 1.25rem;
    height: 0.9rem;
    width: 1px;
    background: color-mix(in srgb, var(--line) 80%, transparent);
    pointer-events: none;
  }
  .yt-daytick span {
    position: absolute;
    top: 0;
    left: 0.2rem;
    font-size: 0.55rem;
    font-weight: 600;
    line-height: 0.9rem;
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
    /* A finger moving sideways from a card lifts it (the board's drag);
       moving up or down still scrolls the page (see beginDrag there). */
    touch-action: pan-y;
    box-shadow: var(--shadow-soft);
    transition: transform 0.12s ease;
  }
  .yt-dot:active {
    transform: translateX(-50%) scale(1.4);
  }
  /* The card's title beside its square (part of the button, so it taps). */
  .yt-label {
    position: absolute;
    left: calc(100% + 0.2rem);
    top: 50%;
    transform: translateY(-50%);
    padding: 0 0.2rem;
    border-radius: 3px;
    background: color-mix(in srgb, var(--paper) 82%, transparent);
    font-size: 0.62rem;
    font-weight: 700;
    line-height: 0.8rem;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }

  .yt-span {
    position: absolute;
    height: 0.38rem;
    min-width: 4px;
    border-radius: 999px;
    pointer-events: auto;
    cursor: pointer;
    touch-action: pan-y;
    box-shadow: var(--shadow-soft);
  }
  .yt-span.labeled {
    height: 0.85rem;
    border-radius: 5px;
    display: flex;
    align-items: center;
  }
  .yt-span-label {
    padding: 0 0.35rem;
    font-size: 0.6rem;
    font-weight: 700;
    line-height: 0.85rem;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
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
  /* No tooltips mid-pan: the pointer sweeping across markers would flash them. */
  .yt.panning .yt-tip {
    opacity: 0;
  }
  /* The tip's z-index only counts INSIDE its marker (the transform makes each
     marker a stacking context) — so raise the hovered marker itself, or the
     label paints behind the squares stacked above it. */
  .yt-dot:hover,
  .yt-span:hover,
  .yt-sky:hover {
    z-index: 35;
  }

  /* The day a dragged card would land on: a teal column (at least a hairline
     wide at year scale) with the date pinned to its top. */
  .yt-drop {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 3px;
    background: color-mix(in srgb, var(--teal) 22%, transparent);
    border-inline: 1.5px solid var(--teal);
    box-sizing: border-box;
    pointer-events: none;
    z-index: 45;
  }
  .yt-drop-label {
    position: absolute;
    top: 0.4rem;
    left: calc(100% + 0.35rem);
    padding: 0.25rem 0.55rem;
    border-radius: 8px;
    background: var(--teal);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 800;
    white-space: nowrap;
  }
  .yt-drop.flip .yt-drop-label {
    left: auto;
    right: calc(100% + 0.35rem);
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
