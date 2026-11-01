<script context="module" lang="ts">
  import type { Quest } from "@holons/core/tasks";

  /** One series to draw: the record, plus how the board names and tints it. */
  export interface OrbitItem {
    id: string;
    title: string;
    category?: string;
    sourceColor?: string;
    quest: Quest;
  }
</script>

<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Recurring quests as orbits — the kiosk's version of the dashboard's
  // orbits view. The holon is the sun; every cadence that has quests is one
  // ring (fastest nearest the sun); every series is a planet on its ring,
  // as far round as it is through its current lap. 12 o'clock is due: a
  // planet arrives there on its next open occurrence, and once that
  // occurrence is ticked off it sets out on the next lap. The trail behind
  // a planet is the lap so far.
  //
  // Where a planet sits is core's rule (`orbitPhase`, @holons/core/tasks),
  // so the dashboard draws the same series at the same angle. Below the
  // dial the same planets list soonest first — the tap-friendly way in.
  // Hovering a planet shows its lap in full; the orbits zoom and pan like
  // the year dial (pinch, Ctrl/⌘-scroll, drag, or the toolbar), planets
  // keeping a readable size so a crowded ring pulls apart.
  import { t, locale, type MessageKey } from "$lib/i18n";
  import { createSvgZoom } from "$lib/svgzoom";
  import {
    orbitPhase,
    orbitRing,
    type OrbitPhase,
    type QuestFrequency,
  } from "@holons/core/tasks";

  export let items: OrbitItem[] = [];
  export let now: Date;
  export let noteColorFor: (category: string | undefined) => string;
  /** The holon at the centre. */
  export let holonName = "";
  /** Open a series on its next occurrence (`when` in the series' own form). */
  export let onOpen: (id: string, when: string) => void;
  /**
   * The height the board has for this window (its scroll area), px. The
   * drawing fills it — toolbar included — rather than a capped square; 0
   * falls back to a square as wide as the board.
   */
  export let height = 0;

  const C = 500;
  const SUN_R = 62;
  const INNER = 118; // the first ring
  const OUTER = 440; // the last ring
  const PLANET_R = 15;

  const zoom = createSvgZoom(1000, 8);
  const { view, busy } = zoom;
  $: zoomed = $view.zoom > 1.001;
  // The viewport is the board's area, whatever its shape.
  let barH = 0;
  let wrapW = 0;
  let wrapH = 0;
  $: if (wrapW && wrapH) zoom.setAspect(wrapW / wrapH);
  // Planets shrink in drawing units by √zoom: bigger on screen, but with
  // room between them.
  $: k = 1 / Math.sqrt($view.zoom);
  $: pr = PLANET_R * k;
  $: minGap = 2 * pr + 8 * k; // planets closer than this along a ring step aside

  type Planet = OrbitItem & {
    phase: OrbitPhase;
    color: string;
    x: number;
    y: number;
    r: number; // ring radius after stepping aside
  };

  function pt(f: number, r: number): [number, number] {
    const a = f * 2 * Math.PI;
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  }
  function trail(f: number, r: number): string {
    const sweep = Math.min(Math.max(f, 0.0005), 0.9995);
    const [x0, y0] = pt(0, r);
    const [x1, y1] = pt(sweep, r);
    return `M${x0} ${y0}A${r} ${r} 0 ${sweep > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
  }

  $: phased = items
    .map((it) => ({ it, phase: orbitPhase(it.quest, now) }))
    .filter((p): p is { it: OrbitItem; phase: OrbitPhase } => p.phase !== null);

  $: frequencies = [...new Set(phased.map((p) => p.phase.frequency))].sort(
    (a, b) => orbitRing(a) - orbitRing(b),
  );
  $: ringR = new Map<QuestFrequency, number>(
    frequencies.map((f, i) => [
      f,
      frequencies.length === 1
        ? (INNER + OUTER) / 2
        : INNER + ((OUTER - INNER) * i) / (frequencies.length - 1),
    ]),
  );

  // Place each ring's planets; ones that would sit on top of a neighbour
  // step alternately in and out of the ring instead of moving in time.
  $: planets = (() => {
    const out: Planet[] = [];
    for (const f of frequencies) {
      const base = ringR.get(f) ?? INNER;
      const onRing = phased
        .filter((p) => p.phase.frequency === f)
        .sort((a, b) => a.phase.progress - b.phase.progress);
      let lastArc = -Infinity;
      let side = 0;
      for (const { it, phase } of onRing) {
        const arcLen = phase.progress * 2 * Math.PI * base;
        side = arcLen - lastArc < minGap ? side + 1 : 0;
        if (side === 0) lastArc = arcLen;
        const shift =
          side === 0
            ? 0
            : (side % 2 ? 1 : -1) * Math.ceil(side / 2) * (pr + 4 * k);
        const r = base + shift;
        const [x, y] = pt(phase.progress, r);
        out.push({ ...it, phase, color: noteColorFor(it.category), x, y, r });
      }
    }
    return out;
  })();
  $: soonest = [...planets].sort(
    (a, b) => a.phase.next.getTime() - b.phase.next.getTime(),
  );

  const freqKey = (f: QuestFrequency) => `detail.freq.${f}` as MessageKey;
  function countdown(p: OrbitPhase): string {
    if (p.due) return $t("cal.orbitDue");
    const ms = p.next.getTime() - now.getTime();
    const hours = ms / 3600000;
    if (hours < 36)
      return $t("cal.orbitInHours", { n: Math.max(1, Math.ceil(hours)) });
    return $t("cal.orbitInDays", { n: Math.ceil(hours / 24) });
  }
  function aria(p: Planet): string {
    return $t("cal.orbitAria", {
      title: p.title,
      freq: $t(freqKey(p.phase.frequency)),
      when: `${countdown(p.phase)} · ${p.phase.next.toLocaleDateString(
        $locale,
        {
          weekday: "short",
          day: "numeric",
          month: "short",
        },
      )}`,
    });
  }
  function onKey(e: KeyboardEvent, p: Planet) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(p.id, p.phase.nextWhen);
    }
  }
  const short = (s: string, n = 16) =>
    s.length > n ? `${s.slice(0, n - 1)}…` : s;

  // ── Hover card ────────────────────────────────────────────────────────────
  let wrap: HTMLElement;
  let hover: { p: Planet; x: number; y: number; flipX: boolean } | null = null;
  function enter(e: PointerEvent, p: Planet) {
    if (e.pointerType !== "mouse" || $busy || !wrap) return;
    const box = wrap.getBoundingClientRect();
    const x = e.clientX - box.left;
    hover = { p, x, y: e.clientY - box.top, flipX: x > box.width * 0.6 };
  }
  $: if ($busy) hover = null;
  // Keep the card on the live planet as the clock moves it.
  $: if (hover) {
    const live = planets.find((p) => p.id === hover?.p.id);
    if (!live) hover = null;
    else if (live !== hover.p) hover = { ...hover, p: live };
  }
  function nextLabel(p: Planet): string {
    const timed = /T/.test(p.phase.nextWhen);
    return p.phase.next.toLocaleString($locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      ...(timed ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  }
</script>

{#if planets.length === 0}
  <p class="empty">{$t("cal.orbitsEmpty")}</p>
{:else}
  <div class="o-bar" bind:offsetHeight={barH}>
    <span class="o-hint" class:on={zoomed}
      >{zoomed
        ? `${Math.round($view.zoom * 10) / 10}×`
        : $t("cal.zoomHint")}</span
    >
    <div class="o-zoom">
      <button
        type="button"
        class="o-zbtn"
        on:click={() => zoom.zoomBy(1 / 1.6)}
        disabled={!zoomed}
        aria-label={$t("cal.zoomOut")}
        title={$t("cal.zoomOut")}>−</button
      >
      <button
        type="button"
        class="o-zbtn wide"
        on:click={zoom.reset}
        disabled={!zoomed}
        title={$t("cal.zoomFit")}>{$t("cal.zoomFit")}</button
      >
      <button
        type="button"
        class="o-zbtn"
        on:click={() => zoom.zoomBy(1.6)}
        disabled={$view.zoom >= 7.99}
        aria-label={$t("cal.zoomIn")}
        title={$t("cal.zoomIn")}>+</button
      >
    </div>
  </div>

  <div
    class="o-wrap"
    bind:this={wrap}
    bind:clientWidth={wrapW}
    bind:clientHeight={wrapH}
    style={height > 0
      ? `height: ${Math.max(320, height - barH - 12)}px`
      : "aspect-ratio: 1"}
  >
    <svg
      class="orbits"
      class:zoomed
      viewBox={$view.box}
      use:zoom.attach
      on:pointerleave={() => (hover = null)}
      role="group"
      aria-label={$t("cal.orbitsTitle")}
    >
      <!-- 12 o'clock: where every planet is due -->
      <line
        class="due-line"
        x1={C}
        y1={C - SUN_R - 10}
        x2={C}
        y2={C - OUTER - 34}
      />

      {#each frequencies as f (f)}
        {@const r = ringR.get(f) ?? INNER}
        <circle class="ring" cx={C} cy={C} {r} />
        <text class="ring-label" x={C - 8} y={C - r - 8}>{$t(freqKey(f))}</text>
      {/each}

      <!-- Laps so far -->
      {#each planets as p (p.id)}
        <path
          class="trail"
          d={trail(p.phase.progress, p.r)}
          style="stroke: {p.color}"
        />
      {/each}

      <!-- The sun: the holon -->
      <circle class="sun-glow" cx={C} cy={C} r={SUN_R + 16} />
      <circle class="sun" cx={C} cy={C} r={SUN_R} />
      <text class="sun-name" dominant-baseline="central" x={C} y={C}
        >{short(holonName || "·", 12)}</text
      >

      {#each planets as p (p.id)}
        {@const ringC = 2 * Math.PI * (pr + 6 * k)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <g
          class="planet"
          class:due={p.phase.due}
          role="button"
          tabindex="0"
          aria-label={aria(p)}
          on:click={() => onOpen(p.id, p.phase.nextWhen)}
          on:keydown={(e) => onKey(e, p)}
          on:pointerenter={(e) => enter(e, p)}
          on:pointermove={(e) => enter(e, p)}
          on:pointerleave={() => (hover = null)}
        >
          <circle class="hit" cx={p.x} cy={p.y} r={pr + 16 * k} />
          {#if p.phase.due}
            <circle
              class="halo"
              cx={p.x}
              cy={p.y}
              r={pr + 11 * k}
              style="stroke-width: {3 * k}"
            />
          {/if}
          <circle
            class="progress"
            cx={p.x}
            cy={p.y}
            r={pr + 6 * k}
            style="stroke: {p.color}; stroke-dasharray: {ringC *
              p.phase.progress} {ringC}; stroke-width: {3.5 * k}"
            transform="rotate(-90 {p.x} {p.y})"
          />
          <circle
            class="body"
            class:foreign={!!p.sourceColor}
            cx={p.x}
            cy={p.y}
            r={pr}
            style="fill: {p.color}; --glow: {p.sourceColor ??
              'transparent'}; stroke-width: {2.5 * k}"
          />
          <text
            class="p-title"
            x={p.x}
            y={p.y + pr + 22 * k}
            style="font-size: {15 * k}px"
            >{short(p.title, zoomed ? 28 : 16)}</text
          >
          <text
            class="p-when"
            class:due={p.phase.due}
            x={p.x}
            y={p.y + pr + 42 * k}
            style="font-size: {13 * k}px">{countdown(p.phase)}</text
          >
        </g>
      {/each}
    </svg>

    {#if hover}
      {@const p = hover.p}
      <div
        class="o-readout"
        class:flip-x={hover.flipX}
        style="left: {hover.x}px; top: {hover.y}px"
        aria-hidden="true"
      >
        <div class="ro-title">
          <span class="ro-dot" style="background: {p.color}"></span>{p.title}
        </div>
        <div class="ro-line">{$t(freqKey(p.phase.frequency))}</div>
        <div class="ro-line">{nextLabel(p)}</div>
        <div class="ro-line" class:due={p.phase.due}>
          {countdown(p.phase)} · {$t("cal.orbitLap", {
            pct: Math.round(p.phase.progress * 100),
          })}
        </div>
      </div>
    {/if}
  </div>

  <ol class="next-up">
    {#each soonest as p (p.id)}
      <li>
        <button type="button" on:click={() => onOpen(p.id, p.phase.nextWhen)}>
          <span class="dot" style="background: {p.color}"></span>
          <span class="t">{p.title}</span>
          <span class="f">{$t(freqKey(p.phase.frequency))}</span>
          <span class="w" class:due={p.phase.due}>{countdown(p.phase)}</span>
        </button>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .empty {
    margin: 3rem auto;
    max-width: 28rem;
    text-align: center;
    color: var(--muted);
  }
  .o-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.7rem;
    margin: 0.6rem 0.2rem 0;
  }
  .o-hint {
    font-size: 0.78rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .o-hint.on {
    color: var(--ink);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .o-zoom {
    display: flex;
    gap: 0.3rem;
    margin-left: auto;
  }
  .o-zbtn {
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
  .o-zbtn.wide {
    font-size: 0.75rem;
  }
  .o-zbtn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .o-zbtn:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }
  .o-wrap {
    position: relative;
    flex-shrink: 0;
    margin-top: 0.4rem;
  }
  .orbits.zoomed {
    touch-action: none;
    cursor: grab;
  }
  .o-readout {
    position: absolute;
    z-index: 4;
    width: max-content;
    max-width: min(18rem, 80vw);
    transform: translate(16px, 16px);
    padding: 0.55rem 0.7rem;
    border-radius: 12px;
    background: var(--card);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-soft);
    color: var(--ink);
    font-size: 0.8rem;
    pointer-events: none;
  }
  .o-readout.flip-x {
    transform: translate(calc(-100% - 16px), 16px);
  }
  .ro-title {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-weight: 800;
    margin-bottom: 0.2rem;
  }
  .ro-dot {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .ro-line {
    color: var(--muted);
  }
  .ro-line.due {
    color: var(--danger);
    font-weight: 700;
  }
  .orbits {
    display: block;
    width: 100%;
    height: 100%;
    user-select: none;
    -webkit-user-select: none;
  }
  .ring {
    fill: none;
    stroke: var(--line);
    stroke-width: 2;
    stroke-dasharray: 3 7;
  }
  .ring-label {
    fill: var(--muted);
    font-size: 15px;
    text-anchor: end;
  }
  .due-line {
    stroke: color-mix(in srgb, var(--teal) 55%, transparent);
    stroke-width: 2;
    stroke-dasharray: 2 6;
  }
  .trail {
    fill: none;
    stroke-width: 5;
    stroke-linecap: round;
    opacity: 0.28;
  }
  .sun {
    fill: var(--teal);
  }
  .sun-glow {
    fill: color-mix(in srgb, var(--teal) 18%, transparent);
  }
  .sun-name {
    fill: var(--on-teal);
    font-size: 19px;
    font-weight: 700;
    text-anchor: middle;
  }
  .planet {
    cursor: pointer;
    outline: none;
  }
  .hit {
    fill: transparent;
  }
  .body {
    stroke: var(--paper);
    stroke-width: 2.5;
    filter: drop-shadow(0 0 4px var(--glow));
    transition: transform 0.15s ease;
    transform-box: fill-box;
    transform-origin: center;
  }
  .planet:hover .body,
  .planet:focus-visible .body {
    transform: scale(1.18);
  }
  .planet:focus-visible .progress {
    stroke: var(--teal) !important;
  }
  .progress {
    fill: none;
    stroke-width: 3.5;
    stroke-linecap: round;
  }
  .halo {
    fill: none;
    stroke: var(--danger);
    stroke-width: 3;
    animation: pulse 2.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .halo {
      animation: none;
    }
  }
  .p-title {
    fill: var(--ink);
    font-size: 15px;
    font-weight: 600;
    text-anchor: middle;
    pointer-events: none;
  }
  .p-when {
    fill: var(--muted);
    font-size: 13px;
    text-anchor: middle;
    pointer-events: none;
  }
  .p-when.due {
    fill: var(--danger);
    font-weight: 700;
  }

  .next-up {
    list-style: none;
    margin: 1rem auto 0;
    padding: 0;
    max-width: 36rem;
    display: grid;
    gap: 0.35rem;
  }
  .next-up button {
    width: 100%;
    min-height: 44px;
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.8rem;
    border-radius: 0.7rem;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .next-up button:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }
  .dot {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .f {
    color: var(--muted);
    font-size: 0.85em;
  }
  .w {
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
  }
  .w.due {
    color: var(--danger);
    font-weight: 700;
  }
</style>
