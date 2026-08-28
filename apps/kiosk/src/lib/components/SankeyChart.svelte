<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A read-only Sankey, drawn from geometry core already worked out.
  //
  // Deliberately dumb: it takes a `SankeyLayout` and renders it. All the
  // arithmetic — column placement, ribbon stacking, bezier control points —
  // lives in `@holons/core/flows` so the kiosk and the dashboard draw the same
  // picture from the same numbers and cannot drift. That also keeps the kiosk
  // free of a charting dependency.
  //
  // The layout is normalized to a 0..1 box, so it has no aspect ratio of its
  // own and must be told one. The viewBox is measured from the container rather
  // than fixed: a fixed one either letterboxes (leaving dead margins on a wide
  // kiosk screen) or, with `preserveAspectRatio="none"`, stretches the label
  // text. Measuring means one SVG unit is one CSS pixel, so ribbons fill the
  // width and text stays exactly the size it claims to be.

  import type { SankeyLayout, SankeyLayoutNode } from "@holons/core/flows";

  /** Null is a legitimate "nothing to draw" — the empty slot renders. */
  export let layout: SankeyLayout | null;
  /** Formats a node's value for display (currency, hours, kudos, percent). */
  export let format: (value: number) => string = (v) => String(Math.round(v));
  /** Height of the drawing area, in px. Width always fills the container. */
  export let height = 320;
  export let onSelect: ((node: SankeyLayoutNode) => void) | null = null;

  /** Measured container width; the fallback only applies before first layout. */
  let boxWidth = 960;
  $: VW = Math.max(320, boxWidth);
  $: VH = height;

  $: nodes = layout?.nodes ?? [];
  $: links = layout?.links ?? [];

  /** Scale a normalized path string into viewBox (= pixel) units. */
  function scalePath(d: string, vw: number, vh: number): string {
    return d.replace(
      /(-?\d*\.?\d+),(-?\d*\.?\d+)/g,
      (_m, x, y) =>
        `${(Number(x) * vw).toFixed(2)},${(Number(y) * vh).toFixed(2)}`,
    );
  }

  /**
   * Which side of its node a label sits on. The last column reads better with
   * its text inside the diagram rather than running off the right edge.
   */
  function labelAnchor(node: SankeyLayoutNode): "start" | "end" {
    return node.depth === (layout?.columns ?? 1) - 1 ? "end" : "start";
  }

  function labelX(node: SankeyLayoutNode, vw: number): number {
    return labelAnchor(node) === "end"
      ? node.x * vw - 8
      : (node.x + node.w) * vw + 8;
  }

  // Only label a node tall enough to carry text without colliding with its
  // neighbours; the rest stay readable on tap.
  const MIN_LABEL_H = 16;
</script>

{#if !layout || layout.empty}
  <slot name="empty" />
{:else}
  <div class="chart" style="height: {height}px" bind:clientWidth={boxWidth}>
    <svg viewBox="0 0 {VW} {VH}" preserveAspectRatio="none" role="img">
      <g class="ribbons">
        {#each links as link (link.id)}
          <path
            class="ribbon {link.kind ?? ''}"
            d={scalePath(link.path, VW, VH)}
          />
        {/each}
      </g>

      <g class="bars">
        {#each nodes as node (node.id)}
          <rect
            class="bar {node.kind ?? ''}"
            class:tappable={!!onSelect}
            x={node.x * VW}
            y={node.y * VH}
            width={node.w * VW}
            height={Math.max(2, node.h * VH)}
            rx="2"
            role="button"
            tabindex={onSelect ? 0 : -1}
            aria-label="{node.label}: {format(node.value)}"
            on:click={() => onSelect?.(node)}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(node);
              }
            }}
          />
        {/each}
      </g>

      <g class="labels">
        {#each nodes as node (node.id)}
          {#if node.h * VH >= MIN_LABEL_H}
            <text
              x={labelX(node, VW)}
              y={(node.y + node.h / 2) * VH}
              text-anchor={labelAnchor(node)}
              dominant-baseline="middle"
            >
              <tspan class="name">{node.label}</tspan>
              <tspan class="value" dx="6">{format(node.value)}</tspan>
            </text>
          {/if}
        {/each}
      </g>
    </svg>
  </div>
{/if}

<style>
  .chart {
    width: 100%;
  }

  svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .ribbon {
    fill: var(--teal);
    /* Low enough that overlapping ribbons stay individually readable, high
       enough to register against the paper ground. */
    opacity: 0.22;
  }

  /* Each source of value gets its own hue so a glance separates them. */
  .ribbon.opencollective {
    fill: #3b82f6;
    opacity: 0.3;
  }
  .ribbon.library {
    fill: #10b981;
    opacity: 0.28;
  }
  .ribbon.treasury {
    fill: #f59e0b;
    opacity: 0.32;
  }
  .ribbon.expense {
    fill: var(--teal);
  }
  .ribbon.interior {
    fill: #8b5cf6;
    opacity: 0.3;
  }
  .ribbon.exterior {
    fill: #06b6d4;
    opacity: 0.3;
  }
  .ribbon.other {
    fill: var(--muted);
    opacity: 0.18;
  }

  .bar {
    fill: var(--ink-soft);
  }
  .bar.hub,
  .bar.pot {
    fill: var(--teal-deep);
  }
  .bar.opencollective {
    fill: #3b82f6;
  }
  .bar.library {
    fill: #10b981;
  }
  .bar.treasury {
    fill: #f59e0b;
  }
  .bar.interior,
  .bar.member {
    fill: #8b5cf6;
  }
  .bar.exterior,
  .bar.zone,
  .bar.partner {
    fill: #06b6d4;
  }
  .bar.other {
    fill: var(--muted);
  }

  .bar.tappable {
    cursor: pointer;
  }
  .bar.tappable:hover,
  .bar.tappable:focus-visible {
    opacity: 0.75;
    outline: none;
  }

  text {
    font-size: 13px;
    pointer-events: none;
  }

  .name {
    fill: var(--ink);
  }

  .value {
    fill: var(--muted);
  }
</style>
