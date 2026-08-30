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
  // A wall kiosk is touched, so tap still opens the parent's modal — but a
  // kiosk browsed with a mouse (or the same board on a laptop) hovers, and
  // hover answers in place: what a bar is worth, its share of the flow shown,
  // and whatever rows the parent adds through `nodeDetails` / `linkDetails`.
  // Same contract as the dashboard twin, so the two surfaces say the same
  // thing about the same picture.
  //
  // The layout is normalized to a 0..1 box, so it has no aspect ratio of its
  // own and must be told one. The viewBox is measured from the container rather
  // than fixed: a fixed one either letterboxes (leaving dead margins on a wide
  // kiosk screen) or, with `preserveAspectRatio="none"`, stretches the label
  // text. Measuring means one SVG unit is one CSS pixel, so ribbons fill the
  // width and text stays exactly the size it claims to be.

  import type {
    SankeyLayout,
    SankeyLayoutLink,
    SankeyLayoutNode,
  } from "@holons/core/flows";

  /** Null is a legitimate "nothing to draw" — the empty slot renders. */
  export let layout: SankeyLayout | null;
  /** Formats a node's value for display (currency, hours, kudos, percent). */
  export let format: (value: number) => string = (v) => String(Math.round(v));
  /** Height of the drawing area, in px. Width always fills the container. */
  export let height = 320;
  export let onSelect: ((node: SankeyLayoutNode) => void) | null = null;
  /** Extra tooltip rows for a bar. The parent owns what "more" means here. */
  export let nodeDetails:
    | ((node: SankeyLayoutNode) => { label: string; value: string }[])
    | null = null;
  /** Extra tooltip rows for a ribbon. */
  export let linkDetails:
    | ((link: SankeyLayoutLink) => { label: string; value: string }[])
    | null = null;
  /** "{pct}% of the flow shown" line, pre-translated by the parent. */
  export let shareLine: ((pct: number) => string) | null = null;

  /** Measured container width; the fallback only applies before first layout. */
  let boxWidth = 960;
  $: VW = Math.max(320, boxWidth);
  $: VH = height;

  $: nodes = layout?.nodes ?? [];
  $: links = layout?.links ?? [];

  $: nodeById = new Map(nodes.map((n) => [n.id, n]));

  /**
   * What a share is measured against: the heaviest column, which is the hub in
   * a movement chart and the pot in an allocation. Flow through a holon is not
   * conserved, so there is no single "total" to divide by — the widest column
   * is the honest denominator, and it is the one the eye compares against.
   */
  $: shownTotal = nodes.reduce((max, node) => {
    const column = nodes
      .filter((n) => n.depth === node.depth)
      .reduce((sum, n) => sum + n.value, 0);
    return Math.max(max, column);
  }, 0);

  let box: HTMLDivElement | undefined;
  let hoverNode: SankeyLayoutNode | null = null;
  let hoverLink: SankeyLayoutLink | null = null;
  let px = 0;
  let py = 0;
  let tipWidth = 240;
  let tipHeight = 120;

  // Only re-asks the parent when the hovered thing changes, not on every
  // pointer move — `px`/`py` are deliberately not read here.
  $: rows = hoverNode
    ? (nodeDetails?.(hoverNode) ?? [])
    : hoverLink
      ? (linkDetails?.(hoverLink) ?? [])
      : [];

  $: title = hoverNode
    ? hoverNode.label
    : hoverLink
      ? `${nodeById.get(hoverLink.source)?.label ?? hoverLink.source} → ${
          nodeById.get(hoverLink.target)?.label ?? hoverLink.target
        }`
      : "";

  $: hoveredValue = hoverNode?.value ?? hoverLink?.value ?? 0;

  $: share =
    shownTotal > 0 ? Math.round((hoveredValue / shownTotal) * 100) : null;

  /** Ribbons that touch the hovered bar; everything else recedes. */
  $: litLinks = hoverNode
    ? new Set(
        links
          .filter(
            (l) => l.source === hoverNode!.id || l.target === hoverNode!.id,
          )
          .map((l) => l.id),
      )
    : hoverLink
      ? new Set([hoverLink.id])
      : null;

  /** Bars at either end of the hovered ribbon stay lit with it. */
  $: litNodes = hoverNode
    ? new Set([hoverNode.id])
    : hoverLink
      ? new Set([hoverLink.source, hoverLink.target])
      : null;

  /**
   * Pointer position in the chart's own CSS pixels.
   *
   * Measured off the container rather than read from `offsetX`, which browsers
   * still disagree about for SVG children. The SVG is stretched to the box
   * (`preserveAspectRatio="none"`), so a fraction of the box is a fraction of
   * the viewBox and the two coordinate systems line up.
   */
  function track(event: MouseEvent) {
    const rect = box?.getBoundingClientRect();
    if (!rect) return;
    px = event.clientX - rect.left;
    py = event.clientY - rect.top;
  }

  /** Keyboard focus has no pointer, so anchor the tooltip on the bar itself. */
  function anchor(node: SankeyLayoutNode) {
    px = (node.x + node.w) * boxWidth;
    py = (node.y + node.h / 2) * height;
  }

  /**
   * Leaving a shape closes the tooltip, so the blank space between bars is not
   * left showing whatever the pointer last passed over. Moving between two
   * shapes fires leave-then-enter inside one task, so nothing flickers.
   */
  function clear() {
    hoverNode = null;
    hoverLink = null;
  }

  // Keep the tooltip inside the chart rather than letting it run off the edge.
  $: tipLeft = Math.min(
    Math.max(8, px + 14),
    Math.max(8, boxWidth - tipWidth - 8),
  );
  $: tipTop = Math.min(
    Math.max(8, py + 14),
    Math.max(8, height - tipHeight - 8),
  );

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
  <div
    class="chart"
    style="height: {height}px"
    bind:this={box}
    bind:clientWidth={boxWidth}
    on:mouseleave={clear}
    role="presentation"
  >
    <svg viewBox="0 0 {VW} {VH}" preserveAspectRatio="none" role="img">
      <g class="ribbons">
        {#each links as link (link.id)}
          <path
            class="ribbon {link.kind ?? ''}"
            class:lit={litLinks?.has(link.id)}
            class:dim={litLinks && !litLinks.has(link.id)}
            d={scalePath(link.path, VW, VH)}
            role="img"
            aria-label="{nodeById.get(link.source)?.label ??
              link.source} to {nodeById.get(link.target)?.label ??
              link.target}: {format(link.value)}"
            on:mouseenter={(e) => {
              hoverNode = null;
              hoverLink = link;
              track(e);
            }}
            on:mousemove={track}
            on:mouseleave={clear}
          />
        {/each}
      </g>

      <g class="bars">
        {#each nodes as node (node.id)}
          <rect
            class="bar {node.kind ?? ''}"
            class:tappable={!!onSelect}
            class:dim={litNodes && !litNodes.has(node.id)}
            x={node.x * VW}
            y={node.y * VH}
            width={node.w * VW}
            height={Math.max(2, node.h * VH)}
            rx="2"
            role="button"
            tabindex={onSelect ? 0 : -1}
            aria-label="{node.label}: {format(node.value)}"
            on:click={() => onSelect?.(node)}
            on:mouseenter={(e) => {
              hoverLink = null;
              hoverNode = node;
              track(e);
            }}
            on:mousemove={track}
            on:mouseleave={clear}
            on:focus={() => {
              hoverLink = null;
              hoverNode = node;
              anchor(node);
            }}
            on:blur={clear}
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
              class:dim={litNodes && !litNodes.has(node.id)}
            >
              <tspan class="name">{node.label}</tspan>
              <tspan class="value" dx="6">{format(node.value)}</tspan>
            </text>
          {/if}
        {/each}
      </g>
    </svg>

    {#if hoverNode || hoverLink}
      <div
        class="tip"
        style="left: {tipLeft}px; top: {tipTop}px"
        bind:clientWidth={tipWidth}
        bind:clientHeight={tipHeight}
        role="tooltip"
      >
        <div class="tip-head">
          <span class="tip-title">{title}</span>
          <span class="tip-value">{format(hoveredValue)}</span>
        </div>
        {#if share != null && shareLine}
          <div class="tip-share">{shareLine(share)}</div>
        {/if}
        {#if rows.length}
          <dl>
            {#each rows as row (row.label)}
              <div class="tip-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            {/each}
          </dl>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .chart {
    width: 100%;
    position: relative;
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

  /* Hovering one part of the picture quiets the rest of it. */
  .ribbon.lit {
    opacity: 0.55;
  }
  .ribbon.dim {
    opacity: 0.07;
  }
  .bar.dim,
  text.dim {
    opacity: 0.3;
  }
  .ribbon,
  .bar,
  text {
    transition: opacity 120ms ease;
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

  .tip {
    position: absolute;
    z-index: 10;
    pointer-events: none;
    min-width: 11rem;
    max-width: 20rem;
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

  .tip-share {
    color: var(--muted);
    font-size: 0.72rem;
  }

  dl {
    margin: 0.45rem 0 0;
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
    white-space: nowrap;
  }

  dd {
    margin: 0;
    color: var(--ink);
    text-align: right;
  }
</style>
