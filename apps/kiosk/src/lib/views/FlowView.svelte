<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  // The flow: a fractal of dials. The year is a dial of moons, the moon a
  // dial of quadrants and days, the quadrant a dial of days, the day a
  // clock — and at any depth the outer ring is the period we're in with
  // the next one nested inside. Pinch or scroll and the inner ring grows
  // into the outer while the outer slides off past the edge: the four
  // keyframe views are what the zoom interpolates across, nothing switches
  // (see `$lib/flowgeom` for the geometry, `$lib/flowzoom` for the gestures).
  //
  // Read-only. Cards are the dial's small chips at every level: a tap opens
  // one. A tap in the middle dives one level in (on a ring, into that
  // moment); a tap outside the outer ring backs one level out. Zooming in on
  // a ring dives into what sits under the fingers. Every ring re-lays itself
  // out for the camera and the box, so chips and labels keep one size on
  // screen at every depth and nothing overlaps.
  import { t, locale } from "$lib/i18n";
  import { ICONS } from "$lib/icons";
  import type { CalendarEvent } from "$lib/data";
  import {
    Z,
    Z_MIN,
    Z_MAX,
    C,
    LEVELS,
    dragDt,
    flowContext,
    instantAt,
    layoutFlow,
    radialPlan,
    ringAt,
    zOfLevel,
    type FlowCamera,
    type FlowLevel,
    type FlowRing,
    type FlowSky,
  } from "$lib/flowgeom";
  import { createFlowZoom } from "$lib/flowzoom";
  import {
    DAY_MS,
    MOON_NAMES,
    moonStats,
    nextSolar,
    type SolarKey,
  } from "$lib/yearscale";

  export let events: CalendarEvent[] = [];
  export let now: Date;
  export let noteColorFor: (category: string | undefined) => string;
  export let onOpen: (ev: CalendarEvent) => void;
  /** Fills the board like the dial; 0 keeps a square. */
  export let height = 0;
  /** The header's period label follows the readout. */
  export let onReadout: ((text: string) => void) | null = null;

  // ── Camera ────────────────────────────────────────────────────────────────
  // The radial plan follows the box (see `radialPlan`); the gestures read
  // it through `rO` so a ring is where the finger finds it.
  let rO = radialPlan(1).rO;
  const zoom = createFlowZoom({
    initial: { z: Z.YEAR, t0: now.getTime() },
    zMin: Z_MIN,
    zMax: Z_MAX,
    instantAt: (x, y, cam) => instantAt(x, y, cam, flowContext(cam.t0), rO),
    dragDt: (a, b, cam) => dragDt(a, b, cam, flowContext(cam.t0), rO),
  });
  const { camera, busy } = zoom;
  $: cam = $camera;
  $: ctx = flowContext(cam.t0);

  // The clock ticks every second; the scene only cares about the minute.
  let nowMinMs = 0;
  $: {
    const m = Math.floor(now.getTime() / 60_000) * 60_000;
    if (m !== nowMinMs) nowMinMs = m;
  }
  // The square drawing fits the box's smaller side: scale what must keep a
  // size on screen (chips, labels, bands) by the units a pixel covers.
  let wrapW = 0;
  let wrapH = 0;
  $: upx = wrapW > 0 && wrapH > 0 ? 1000 / Math.min(wrapW, wrapH) : 1;
  $: rO = radialPlan(upx).rO;
  $: weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 7 + i).toLocaleDateString($locale, { weekday: "short" }),
  );
  $: scene = layoutFlow({
    events,
    now: new Date(nowMinMs),
    cam,
    ctx,
    unitsPerPx: upx,
    weekdays,
  });
  $: level = scene.level as FlowLevel;

  // ── Readout ───────────────────────────────────────────────────────────────
  const QUADRANT_NAMES = [1, 3, 5, 7].map((i) => MOON_NAMES[i]);
  $: tonight = moonStats(new Date(cam.t0));
  $: tonightPaths = ICONS[tonight.icon].paths;
  $: parts = [
    { id: "year" as FlowLevel, text: String(scene.readout.year) },
    {
      id: "lunation" as FlowLevel,
      text: $t("cal.lunationShort", { n: scene.readout.lunation.index }),
    },
    {
      id: "phase" as FlowLevel,
      text: $t(QUADRANT_NAMES[scene.readout.quadrant]),
    },
    {
      id: "day" as FlowLevel,
      text: scene.readout.date.toLocaleDateString($locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    },
  ];
  $: onReadout?.(parts.map((p) => p.text).join(" · "));

  // The season's wash: which turning point comes next says where we are.
  const SEASON_NOTE: Record<SolarKey, string> = {
    "cal.summerSolstice": "var(--note-mint)", // spring
    "cal.autumnEquinox": "var(--note-sun)", // summer
    "cal.winterSolstice": "var(--note-coral)", // autumn
    "cal.springEquinox": "var(--note-sky)", // winter
  };
  $: seasonNote = SEASON_NOTE[nextSolar(new Date(cam.t0)).key];

  // ── Gestures beyond the camera's own ─────────────────────────────────────
  $: outerRing = scene.rings.find((r) => r.focus >= 0.5) ?? scene.rings[0];
  export function pan(dir: 1 | -1): void {
    // One eighth of the outer ring's period, so the arrows walk in steps that read.
    const len = outerRing
      ? outerRing.period.to - outerRing.period.from
      : DAY_MS;
    zoom.panBy(dir * len * 0.125);
  }
  export function today(): void {
    zoom.flyTo({ z: cam.z, t0: now.getTime() }, 420);
  }
  function zoomStep(dir: 1 | -1) {
    zoom.zoomBy(dir * 0.5);
  }
  /**
   * A tap in the middle dives one level in (a tap on a ring, into that
   * moment); a tap outside the outer ring backs one level out.
   */
  function background(e: MouseEvent) {
    if ($busy || !outerRing) return;
    const p = zoom.toSvg(e.clientX, e.clientY);
    if (!p) return;
    const dist = Math.hypot(p.x - C, p.y - C);
    if (dist > outerRing.rOut + 8 * upx) {
      if (outerRing.level > 0)
        zoom.flyTo({ z: zOfLevel(outerRing.level - 1), t0: cam.t0 }, 560);
      return;
    }
    const hit = ringAt(p.x, p.y, cam, ctx, rO);
    const next = Math.min(LEVELS.length - 1, outerRing.level + 1);
    const t0 = hit && hit.level >= outerRing.level ? hit.t : cam.t0;
    if (next !== outerRing.level || t0 !== cam.t0)
      zoom.flyTo({ z: zOfLevel(next), t0 }, 560);
  }
  function openEv(e: Event, ev: CalendarEvent) {
    e.stopPropagation();
    onOpen(ev);
  }
  function keyEv(e: KeyboardEvent, ev: CalendarEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onOpen(ev);
    }
  }
  function onKey(e: KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    switch (e.key) {
      case "+":
      case "=":
        zoomStep(-1);
        break;
      case "-":
      case "_":
        zoomStep(1);
        break;
      case "ArrowRight":
      case "ArrowDown":
        pan(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        pan(-1);
        break;
      case "Home":
      case "0":
        today();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // ── Drawing helpers ───────────────────────────────────────────────────────
  /** Text rotation that keeps a tangent label upright on either half. */
  function upright(f: number): number {
    const deg = f * 360;
    return deg > 90 && deg < 270 ? deg + 180 : deg;
  }
  function skyTitle(s: FlowSky): string {
    const day = s.date.toLocaleDateString($locale, {
      day: "numeric",
      month: "short",
    });
    if (s.kind === "solar" && s.labelKey) return `${$t(s.labelKey)} · ${day}`;
    if (s.kind === "new") return `${$t("cal.newMoon")} · ${day}`;
    if (s.kind === "full") return `${$t("cal.fullMoon")} · ${day}`;
    return day;
  }
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
  /** A ring's centre text: what the dial is of. */
  function ringTitle(r: FlowRing): string {
    if (r.level === 0) return String(new Date(r.period.from).getFullYear());
    if (r.level === 1)
      return $t("cal.lunationShort", { n: ctx.lunationOf(cam.t0).index });
    if (r.level === 2) return $t(QUADRANT_NAMES[scene.readout.quadrant]);
    return new Date(r.period.from).toLocaleDateString($locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  let barH = 0;
  $: boxH = height > 0 ? Math.max(320, height - barH - 12) : 0;
  $: zoomed = cam.z < Z.YEAR - 0.01;
  // The blend between keyframes, for the push-in feel.
  $: frac = scene.depth - Math.floor(scene.depth);
  $: pushZ = -70 * Math.sin(Math.PI * frac);
</script>

<div class="fv-bar" bind:offsetHeight={barH}>
  <div class="fv-readout" aria-live="polite">
    {#each parts as p, i (p.id)}
      {#if i > 0}<span class="fv-sep">·</span>{/if}
      <span class="fv-part" class:on={p.id === level}>{p.text}</span>
    {/each}
  </div>
  <span class="fv-hint">{$t("cal.flowHint")}</span>
  <div class="fv-zoom">
    <button
      type="button"
      class="fv-zbtn"
      on:click={() => zoomStep(1)}
      disabled={cam.z >= Z_MAX - 0.01}
      aria-label={$t("cal.zoomOut")}
      title={$t("cal.zoomOut")}>−</button
    >
    <button
      type="button"
      class="fv-zbtn wide"
      on:click={today}
      title={$t("cal.flowToday")}>{$t("cal.flowToday")}</button
    >
    <button
      type="button"
      class="fv-zbtn"
      on:click={() => zoomStep(-1)}
      disabled={cam.z <= Z_MIN + 0.01}
      aria-label={$t("cal.zoomIn")}
      title={$t("cal.zoomIn")}>+</button
    >
  </div>
</div>

<div
  class="fv"
  class:zoomed
  bind:clientWidth={wrapW}
  bind:clientHeight={wrapH}
  style="{boxH
    ? `height: ${boxH}px;`
    : 'aspect-ratio: 1;'} --season: {seasonNote}"
>
  <svg
    class="fv-near"
    viewBox="0 0 1000 1000"
    style="transform: translateZ({pushZ}px); --u: {upx}"
    use:zoom.attach
    role="button"
    tabindex="0"
    aria-label={$t("cal.flowAria")}
    on:click={background}
    on:keydown={onKey}
  >
    {#each scene.rings as ring (ring.level)}
      <g
        class="ring"
        class:outer={ring.focus >= 0.5}
        style="opacity: {ring.opacity}"
        data-level={ring.name}
      >
        <!-- The band: sectors of the period, with their names -->
        {#each ring.sectors as sc (sc.key)}
          <path class="band" class:alt={sc.alt} d={sc.d} />
          {#if sc.label}
            <text
              class="band-label"
              dominant-baseline="central"
              x={sc.lx}
              y={sc.ly}
              transform="rotate({upright(sc.f)} {sc.lx} {sc.ly})"
              >{sc.label}</text
            >
          {/if}
        {/each}
        {#each ring.ticks as k (k.key)}
          <line class="tick" x1={k.x1} y1={k.y1} x2={k.x2} y2={k.y2} />
          {#if k.label}
            <text
              class="tick-label"
              dominant-baseline="central"
              x={k.lx}
              y={k.ly}
              transform="rotate({upright(k.f)} {k.lx} {k.ly})">{k.label}</text
            >
          {/if}
        {/each}

        <!-- Sky on the band -->
        {#each ring.sky as s (s.key)}
          {#if s.kind === "new" || s.kind === "full"}
            <circle
              class="moon"
              class:new={s.kind === "new"}
              cx={s.x}
              cy={s.y}
              r={5 * upx}><title>{skyTitle(s)}</title></circle
            >
          {:else if s.kind === "quarter"}
            <circle class="moon quarter" cx={s.x} cy={s.y} r={3.5 * upx}
              ><title>{skyTitle(s)}</title></circle
            >
          {:else}
            <circle class="sun" cx={s.x} cy={s.y} r={6 * upx}
              ><title>{skyTitle(s)}</title></circle
            >
          {/if}
        {/each}

        <!-- Spans inside the band, chips beside it -->
        {#each ring.spans as s (s.key)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <path
            class="span"
            d={s.d}
            style="stroke: {s.ev.color ??
              noteColorFor(s.ev.category)}; --glow: {s.ev.sourceColor ??
              'transparent'}"
            role="button"
            tabindex="0"
            aria-label={spanLabel(s.ev)}
            on:click={(e) => openEv(e, s.ev)}
            on:keydown={(e) => keyEv(e, s.ev)}
          />
        {/each}
        {#each ring.cards as c (c.key)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <rect
            class="chip"
            class:done={!!c.ev.completed}
            class:foreign={!!c.ev.sourceColor}
            class:external={!!c.ev.external}
            x={c.x - c.size / 2}
            y={c.y - c.size / 2}
            width={c.size}
            height={c.size}
            rx={2 * upx}
            transform="rotate({c.rot} {c.x} {c.y})"
            style="fill: {c.ev.color ?? noteColorFor(c.ev.category)}; --glow: {c
              .ev.sourceColor ?? 'transparent'}; opacity: {c.opacity}"
            role="button"
            tabindex="0"
            aria-label={cardLabel(c.ev)}
            on:click={(e) => openEv(e, c.ev)}
            on:keydown={(e) => keyEv(e, c.ev)}
            ><title>{cardLabel(c.ev)}</title></rect
          >
        {/each}

        <!-- Marks on the band: a day's cards where chips have no room -->
        {#each ring.marks as m (m.key)}
          <circle
            class="mark"
            cx={m.x}
            cy={m.y}
            r={m.r}
            style="opacity: {m.opacity}"
            ><title
              >{m.day.toLocaleDateString($locale, {
                day: "numeric",
                month: "long",
              })}{m.label ? ` · ${m.label}` : ""}</title
            ></circle
          >
        {/each}

        <!-- The now hand across the band -->
        {#if ring.now !== null}
          {@const a = ring.now * 2 * Math.PI}
          {@const r0 = ring.r - ring.half - 4 * upx}
          {@const r1 = ring.r + ring.half + 8 * upx}
          <line
            class="now"
            x1={C + r0 * Math.sin(a)}
            y1={C - r0 * Math.cos(a)}
            x2={C + r1 * Math.sin(a)}
            y2={C - r1 * Math.cos(a)}
          />
          <circle
            class="now-dot"
            cx={C + r1 * Math.sin(a)}
            cy={C - r1 * Math.cos(a)}
            r={4 * upx}
          />
        {/if}
      </g>
    {/each}

    <!-- Centre: what the outer dial is of, and tonight's moon, when there is room -->
    {#each scene.rings as ring (ring.level)}
      {#if ring.focus > 0.02 && scene.centreRoom >= 46 * upx}
        <g class="centre" style="opacity: {ring.focus}" aria-hidden="true">
          {#if ring.level === 1 && scene.centreRoom >= 80 * upx}
            <g
              class="tonight"
              transform="translate({C - 24 * upx} {C - 52 * upx}) scale({2 *
                upx})"
            >
              <circle cx="12" cy="12" r="9" class="tonight-disc" />
              {#each tonightPaths as p}
                <path d={p.d} class:fill={p.fill} />
              {/each}
            </g>
            <text class="centre-title" x={C} y={C + 18 * upx}
              >{ringTitle(ring)}</text
            >
            <text class="centre-sub" x={C} y={C + 36 * upx}
              >{$t(tonight.nameKey)} · {$t("cal.moonLit", {
                pct: tonight.pct,
              })}</text
            >
          {:else}
            <text class="centre-title" x={C} y={C + 6 * upx}
              >{ringTitle(ring)}</text
            >
          {/if}
        </g>
      {/if}
    {/each}
  </svg>
</div>

<style>
  /* ── Toolbar ───────────────────────────────────────────────────────────── */
  .fv-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.7rem;
    margin: 0.6rem 0.2rem 0;
  }
  .fv-readout {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem;
    font-size: 0.82rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .fv-part.on {
    color: var(--ink);
    font-weight: 800;
  }
  .fv-sep {
    opacity: 0.6;
  }
  .fv-hint {
    font-size: 0.78rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .fv-zoom {
    display: flex;
    gap: 0.3rem;
    margin-left: auto;
  }
  .fv-zbtn {
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
  .fv-zbtn.wide {
    font-size: 0.75rem;
  }
  .fv-zbtn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .fv-zbtn:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }

  /* ── The space ─────────────────────────────────────────────────────────── */
  .fv {
    position: relative;
    flex-shrink: 0;
    margin-top: 0.4rem;
    overflow: hidden;
    border-radius: 1rem;
    perspective: 1200px;
    perspective-origin: 50% 45%;
    transform-style: preserve-3d;
    background: radial-gradient(
      ellipse at 50% 45%,
      color-mix(in srgb, var(--season) 14%, var(--paper)) 0%,
      var(--paper) 72%
    );
    transition: background 600ms ease;
  }
  :global(:root[data-theme="dark"]) .fv {
    background: radial-gradient(
      ellipse at 50% 45%,
      color-mix(in srgb, var(--season) 20%, var(--paper)) 0%,
      var(--paper) 72%
    );
  }
  .fv-near {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    font-family: inherit;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
    will-change: transform;
  }
  .fv-near:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: -2px;
  }

  .band {
    fill: color-mix(in srgb, var(--line) 50%, transparent);
    stroke: var(--paper);
    stroke-width: calc(1.5px * var(--u, 1));
    pointer-events: none;
  }
  .band.alt {
    fill: color-mix(in srgb, var(--line) 85%, transparent);
  }
  .band-label {
    fill: var(--ink);
    font-size: calc(11px * var(--u, 1));
    font-weight: 600;
    text-anchor: middle;
    pointer-events: none;
  }
  .tick {
    stroke: var(--paper);
    stroke-width: calc(1.5px * var(--u, 1));
    pointer-events: none;
  }
  .tick-label {
    fill: var(--muted);
    font-size: calc(9.5px * var(--u, 1));
    text-anchor: middle;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
  /* Fixed fills, not theme tokens (as on the dial): the sun is warm and a
     full moon light, a new moon dark, in EITHER palette. */
  .sun {
    fill: #f2c14e;
    filter: drop-shadow(0 0 4px rgba(242, 193, 78, 0.65));
    pointer-events: none;
  }
  .moon {
    fill: #f4f0e4;
    stroke: var(--muted);
    stroke-width: calc(1px * var(--u, 1));
    pointer-events: none;
  }
  .moon.new {
    fill: #1f2a29;
  }
  .moon.quarter {
    fill: #a9a596;
  }
  .chip {
    cursor: pointer;
    stroke: var(--paper);
    stroke-width: calc(1px * var(--u, 1));
  }
  .chip.foreign {
    filter: drop-shadow(0 0 3px var(--glow));
  }
  .chip.done {
    opacity: 0.55;
  }
  .chip:focus-visible,
  .span:focus-visible {
    outline: none;
    stroke: var(--teal);
    stroke-width: calc(2.5px * var(--u, 1));
  }
  .mark {
    fill: var(--teal);
    stroke: var(--paper);
    stroke-width: calc(1px * var(--u, 1));
    pointer-events: none;
  }
  .span {
    fill: none;
    stroke-width: calc(5px * var(--u, 1));
    stroke-linecap: round;
    cursor: pointer;
    filter: drop-shadow(0 0 2px var(--glow));
  }
  .now {
    stroke: var(--teal);
    stroke-width: calc(2.5px * var(--u, 1));
    stroke-linecap: round;
    pointer-events: none;
  }
  .now-dot {
    fill: var(--teal);
    stroke: color-mix(in srgb, var(--teal) 30%, transparent);
    stroke-width: calc(4px * var(--u, 1));
    pointer-events: none;
  }
  .centre {
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
    font-size: calc(16px * var(--u, 1));
    font-weight: 700;
    text-anchor: middle;
  }
  .centre-sub {
    fill: var(--muted);
    font-size: calc(10.5px * var(--u, 1));
    text-anchor: middle;
  }
</style>
