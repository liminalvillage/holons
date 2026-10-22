<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Who gave what to whom, as a directed chord: each person is an arc as long
  // as everything they gave and received, and each ribbon narrows to an arrow
  // on the person it went to.
  //
  // The dashboard twin of the kiosk's ChordChart: the matrix and every path
  // come from `@holons/core/flows` (`layoutChord`), so both surfaces draw the
  // same picture. Only the palette differs — this ground is near-black. The
  // box is measured so one SVG unit is one CSS pixel and names stay legible.

  import {
    layoutChord,
    type ChordGroup,
    type ChordRibbon,
    type PeopleFlowTrack,
  } from "@holons/core/flows";

  export let track: PeopleFlowTrack | null;
  export let format: (value: number) => string = (v) => String(Math.round(v));
  export let maxSize = 560;
  export let onSelect: ((group: ChordGroup) => void) | null = null;
  /** Closing line of an arc's tooltip — say what clicking it will do. */
  export let hint = "";

  const LABEL_ROOM = 92;
  const MAX_LABEL = 14;
  const PALETTE = [
    "#2dd4bf",
    "#a78bfa",
    "#fbbf24",
    "#60a5fa",
    "#fb7185",
    "#34d399",
    "#22d3ee",
    "#f472b6",
    "#a3e635",
    "#fdba74",
    "#818cf8",
    "#f87171",
  ];

  let boxWidth = 480;
  $: size = Math.max(280, Math.min(maxSize, boxWidth));
  $: layout = layoutChord(track, {
    innerRadius: size / 2 - LABEL_ROOM - 8,
    othersLabel: "Others",
  });

  $: colorOf = new Map(
    layout.groups.map((g, i) => [
      g.id,
      g.kind === "other" ? "#64748b" : g.kind === "holon" ? "#14b8a6" : PALETTE[i % PALETTE.length],
    ]),
  );
  $: labelOf = new Map(layout.groups.map((g) => [g.id, g.label]));

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
    return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
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

  $: tipLeft = Math.min(Math.max(8, px + 14), Math.max(8, boxWidth - tipWidth - 8));
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
    <svg width={size} height={size} viewBox="{-size / 2} {-size / 2} {size} {size}" role="img">
      <g>
        {#each layout.ribbons as ribbon (ribbon.id)}
          <path
            class="ribbon"
            class:lit={lit?.(ribbon)}
            class:dim={lit && !lit(ribbon)}
            d={ribbon.path}
            style:fill={colorOf.get(ribbon.source)}
            role="img"
            aria-label="{labelOf.get(ribbon.source)} → {labelOf.get(ribbon.target)}: {format(ribbon.value)}"
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

      <g>
        {#each layout.groups as group (group.id)}
          <g
            class="group"
            class:tappable={!!onSelect}
            class:dim={litGroup && !litGroup(group.id)}
            role="button"
            tabindex={onSelect ? 0 : -1}
            aria-label="{group.label}: gave {format(group.given)}, received {format(group.received)}"
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
            <path class="arc" d={group.path} style:fill={colorOf.get(group.id)} />
            <text transform={group.labelTransform} text-anchor={group.labelAnchor} dominant-baseline="middle"
              >{short(group.label)}</text
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
            <div class="tip-row"><dt>Gave</dt><dd>{format(hoverGroup.given)}</dd></div>
            <div class="tip-row"><dt>Received</dt><dd>{format(hoverGroup.received)}</dd></div>
          </dl>
          {#if hint && onSelect}
            <div class="tip-hint">{hint}</div>
          {/if}
        {:else if hoverRibbon}
          <div class="tip-head">
            <span class="tip-title">{labelOf.get(hoverRibbon.source)} → {labelOf.get(hoverRibbon.target)}</span>
            <span class="tip-value">{format(hoverRibbon.value)}</span>
          </div>
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
    opacity: 0.6;
    mix-blend-mode: screen;
  }
  .ribbon.lit {
    opacity: 0.9;
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
    stroke: #e2e8f0;
    stroke-width: 1.5;
  }

  text {
    font-size: 12px;
    fill: var(--color-text-primary, #e2e8f0);
    pointer-events: none;
  }

  .tip {
    position: absolute;
    z-index: 10;
    pointer-events: none;
    min-width: 10rem;
    max-width: 18rem;
    background: #0f172a;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 0.6rem;
    padding: 0.55rem 0.7rem;
    box-shadow: 0 10px 28px rgb(0 0 0 / 0.4);
    font-size: 0.8rem;
    line-height: 1.35;
    color: #e2e8f0;
  }

  .tip-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .tip-title {
    font-weight: 500;
  }

  .tip-value {
    color: #5eead4;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .tip-hint {
    margin-top: 0.35rem;
    color: #94a3b8;
    font-size: 0.72rem;
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
    color: #94a3b8;
  }

  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
