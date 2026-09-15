<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Who gave what to whom, as a directed chord: each person is an arc as long
  // as everything they gave and received, and each ribbon narrows to an arrow
  // on the person it went to.
  //
  // Deliberately dumb, like SankeyChart next door: the matrix and every path
  // come from `@holons/core/flows` (`layoutChord`), so the kiosk and the
  // dashboard draw the same picture and the kiosk stays free of d3. The only
  // thing measured here is the box, so one SVG unit is one CSS pixel and the
  // names stay the size they claim to be.
  //
  // Hover answers in place (a name, what they gave and received; a ribbon,
  // from whom to whom); a tap on an arc hands the person to the parent.

  import {
    layoutChord,
    type ChordGroup,
    type ChordRibbon,
    type PeopleFlowTrack,
  } from "@holons/core/flows";

  export let track: PeopleFlowTrack | null;
  export let format: (value: number) => string = (v) => String(Math.round(v));
  /** Pre-translated strings the chart shows. */
  export let labels = { given: "Gave", received: "Received", others: "Others" };
  /** The chart never grows past this, however wide the screen. */
  export let maxSize = 560;
  export let onSelect: ((group: ChordGroup) => void) | null = null;
  /**
   * Extra rows for a hovered ribbon — the currencies behind its share, on a
   * combined chord. Given the two ends by id, because a ribbon may touch the
   * rolled-up arc and only the caller knows who that stands for.
   */
  export let ribbonDetails:
    | ((source: string, target: string) => { label: string; value: string }[])
    | null = null;

  /** Room outside the ring for the names. */
  const LABEL_ROOM = 92;
  const MAX_LABEL = 14;
  /** Same hues the Sankey uses, then a few more; the rollup is grey. */
  const PALETTE = [
    "#0f766e",
    "#8b5cf6",
    "#f59e0b",
    "#3b82f6",
    "#f43f5e",
    "#10b981",
    "#06b6d4",
    "#ec4899",
    "#84cc16",
    "#a16207",
    "#6366f1",
    "#ef4444",
  ];

  let boxWidth = 480;
  $: size = Math.max(280, Math.min(maxSize, boxWidth));
  $: layout = layoutChord(track, {
    innerRadius: size / 2 - LABEL_ROOM - 8,
    othersLabel: labels.others,
  });

  $: colorOf = new Map(
    layout.groups.map((g, i) => [
      g.id,
      g.kind === "other"
        ? "var(--muted)"
        : g.kind === "holon"
          ? "var(--teal-deep)"
          : PALETTE[i % PALETTE.length],
    ]),
  );
  $: labelOf = new Map(layout.groups.map((g) => [g.id, g.label]));

  $: ribbonRows = hoverRibbon
    ? (ribbonDetails?.(hoverRibbon.source, hoverRibbon.target) ?? [])
    : [];

  let box: HTMLDivElement | undefined;
  let hoverGroup: ChordGroup | null = null;
  let hoverRibbon: ChordRibbon | null = null;
  let px = 0;
  let py = 0;
  let tipWidth = 200;
  let tipHeight = 80;

  $: lit = hoverGroup
    ? (r: ChordRibbon) =>
        r.source === hoverGroup!.id || r.target === hoverGroup!.id
    : hoverRibbon
      ? (r: ChordRibbon) => r.id === hoverRibbon!.id
      : null;
  $: litGroup = hoverGroup
    ? (id: string) => id === hoverGroup!.id
    : hoverRibbon
      ? (id: string) => id === hoverRibbon!.source || id === hoverRibbon!.target
      : null;

  function short(label: string): string {
    return label.length > MAX_LABEL
      ? `${label.slice(0, MAX_LABEL - 1)}…`
      : label;
  }

  function trackPointer(event: MouseEvent) {
    const rect = box?.getBoundingClientRect();
    if (!rect) return;
    px = event.clientX - rect.left;
    py = event.clientY - rect.top;
  }

  function clear() {
    hoverGroup = null;
    hoverRibbon = null;
  }

  $: tipLeft = Math.min(
    Math.max(8, px + 14),
    Math.max(8, boxWidth - tipWidth - 8),
  );
  $: tipTop = Math.min(Math.max(8, py + 14), Math.max(8, size - tipHeight - 8));
</script>

{#if layout.empty}
  <slot name="empty" />
{:else}
  <div
    class="chart"
    style="height: {size}px"
    bind:this={box}
    bind:clientWidth={boxWidth}
    on:mouseleave={clear}
    role="presentation"
  >
    <svg
      width={size}
      height={size}
      viewBox="{-size / 2} {-size / 2} {size} {size}"
      role="img"
    >
      <g class="ribbons">
        {#each layout.ribbons as ribbon (ribbon.id)}
          <path
            class="ribbon"
            class:lit={lit?.(ribbon)}
            class:dim={lit && !lit(ribbon)}
            d={ribbon.path}
            style:fill={colorOf.get(ribbon.source)}
            role="img"
            aria-label="{labelOf.get(ribbon.source)} → {labelOf.get(
              ribbon.target,
            )}: {format(ribbon.value)}"
            on:mouseenter={(e) => {
              hoverGroup = null;
              hoverRibbon = ribbon;
              trackPointer(e);
            }}
            on:mousemove={trackPointer}
            on:mouseleave={clear}
          />
        {/each}
      </g>

      <g class="groups">
        {#each layout.groups as group (group.id)}
          <g
            class="group"
            class:tappable={!!onSelect}
            class:dim={litGroup && !litGroup(group.id)}
            role="button"
            tabindex={onSelect ? 0 : -1}
            aria-label="{group.label}: {labels.given} {format(
              group.given,
            )}, {labels.received} {format(group.received)}"
            on:click={() => onSelect?.(group)}
            on:mouseenter={(e) => {
              hoverRibbon = null;
              hoverGroup = group;
              trackPointer(e);
            }}
            on:mousemove={trackPointer}
            on:mouseleave={clear}
            on:focus={() => {
              hoverRibbon = null;
              hoverGroup = group;
              px = boxWidth / 2;
              py = size / 2;
            }}
            on:blur={clear}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(group);
              }
            }}
          >
            <path
              class="arc"
              d={group.path}
              style:fill={colorOf.get(group.id)}
            />
            <text
              transform={group.labelTransform}
              text-anchor={group.labelAnchor}
              dominant-baseline="middle">{short(group.label)}</text
            >
          </g>
        {/each}
      </g>
    </svg>

    {#if hoverGroup || hoverRibbon}
      <div
        class="tip"
        style="left: {tipLeft}px; top: {tipTop}px"
        bind:clientWidth={tipWidth}
        bind:clientHeight={tipHeight}
        role="tooltip"
      >
        {#if hoverGroup}
          <div class="tip-title">{hoverGroup.label}</div>
          <dl>
            <div class="tip-row">
              <dt>{labels.given}</dt>
              <dd>{format(hoverGroup.given)}</dd>
            </div>
            <div class="tip-row">
              <dt>{labels.received}</dt>
              <dd>{format(hoverGroup.received)}</dd>
            </div>
          </dl>
        {:else if hoverRibbon}
          <div class="tip-head">
            <span class="tip-title"
              >{labelOf.get(hoverRibbon.source)} → {labelOf.get(
                hoverRibbon.target,
              )}</span
            >
            <span class="tip-value">{format(hoverRibbon.value)}</span>
          </div>
          {#if ribbonRows.length}
            <dl>
              {#each ribbonRows as row (row.label)}
                <div class="tip-row">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              {/each}
            </dl>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .chart {
    width: 100%;
    position: relative;
    display: flex;
    justify-content: center;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .ribbon {
    opacity: 0.55;
    mix-blend-mode: multiply;
  }
  :global(:root[data-theme="dark"]) .ribbon {
    mix-blend-mode: screen;
  }

  .ribbon.lit {
    opacity: 0.85;
  }
  .ribbon.dim {
    opacity: 0.08;
  }
  .group.dim {
    opacity: 0.35;
  }
  .ribbon,
  .group {
    transition: opacity 120ms ease;
  }

  .group.tappable {
    cursor: pointer;
  }
  .group:focus-visible {
    outline: none;
  }
  .group:focus-visible .arc {
    stroke: var(--ink);
    stroke-width: 1.5;
  }

  text {
    font-size: 12px;
    fill: var(--ink);
    pointer-events: none;
  }

  .tip {
    position: absolute;
    z-index: 10;
    pointer-events: none;
    min-width: 10rem;
    max-width: 18rem;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 0.6rem;
    padding: 0.55rem 0.7rem;
    box-shadow: 0 10px 28px rgb(20 30 30 / 0.18);
    font-size: 0.8rem;
    line-height: 1.35;
  }

  .tip-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .tip-title {
    color: var(--ink);
    font-weight: 500;
  }

  .tip-value {
    color: var(--teal);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  dl {
    margin: 0.35rem 0 0;
    display: grid;
    gap: 0.15rem;
  }

  .tip-row {
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    color: var(--ink);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
