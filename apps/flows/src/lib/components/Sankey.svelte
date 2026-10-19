<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A Sankey for a phone, drawn from geometry core already worked out.
  //
  // Like the kiosk's chart it is deliberately dumb: it takes a `SankeyLayout`
  // and renders it; all the arithmetic lives in `@holons/core/flows`. What is
  // different is who it is for. There is no pointer to hover with, so nothing
  // is said in a tooltip: a tap SELECTS a bar or a ribbon and the parent says
  // the rest in a sheet. A finger is not a cursor either, so a tap is not left
  // to whichever shape happens to be under it — `sankeyHit` resolves it with a
  // fingertip of room (`$lib/sankeyHit`).
  //
  // The layout is normalized to 0..1 and has no size of its own. The width is
  // the container's, or wider when there are more columns than it can hold —
  // then the drawing scrolls sideways inside itself, opened on the focus, and
  // the page never does. The height grows with the fullest column and the
  // page scrolls. One SVG unit is one CSS pixel, so text is the size it claims.
  //
  // Bars too thin to label or to hit comfortably are why every diagram is
  // followed by the same parties as a list (`FlowList`): that list is also
  // what a keyboard or a screen reader walks.

  import { onMount, tick } from "svelte";
  import type {
    SankeyLayout,
    SankeyLayoutLink,
    SankeyLayoutNode,
  } from "@holons/core/flows";
  import { clip } from "$lib/format";
  import { sankeyHit } from "$lib/sankeyHit";

  /** Null is a legitimate "nothing to draw" — the empty slot renders. */
  export let layout: SankeyLayout | null;
  /** Formats a value for display (a percent, an amount). */
  export let format: (value: number) => string = (v) => String(Math.round(v));
  /** The bar or ribbon id that is selected, when one is. */
  export let selectedId: string | null = null;
  /** The bar the view is about: the drawing opens scrolled to it. */
  export let focusId: string | null = null;
  export let onSelectNode: ((node: SankeyLayoutNode) => void) | null = null;
  export let onSelectLink: ((link: SankeyLayoutLink) => void) | null = null;
  /** One sentence saying what the drawing shows, for a screen reader. */
  export let label = "";

  /** Room a column needs for its bar and the names beside it. */
  const COLUMN_PX = 110;
  const ROW_PX = 52;
  const FONT_PX = 13;
  /** Rough advance per character at FONT_PX; labels are never measured. */
  const CHAR_PX = 7.2;
  const LABEL_H = 17;

  let scroller: HTMLDivElement | undefined;
  let boxWidth = 358;

  $: nodes = layout?.nodes ?? [];
  $: links = layout?.links ?? [];
  $: columns = layout?.columns ?? 0;
  $: W = Math.max(280, boxWidth, columns * COLUMN_PX);
  $: rows = nodes.reduce((max, n) => {
    const count = nodes.filter((m) => m.depth === n.depth).length;
    return Math.max(max, count);
  }, 0);
  $: H = Math.min(1400, Math.max(320, rows * ROW_PX + 32));
  $: scrolls = W > boxWidth + 1;

  $: nodeById = new Map(nodes.map((n) => [n.id, n]));
  $: selectedNode = selectedId ? (nodeById.get(selectedId) ?? null) : null;
  $: selectedLink = selectedId
    ? (links.find((l) => l.id === selectedId) ?? null)
    : null;

  /** Ribbons that touch the selected bar; everything else recedes. */
  $: litLinks = selectedNode
    ? new Set(
        links
          .filter(
            (l) =>
              l.source === selectedNode!.id || l.target === selectedNode!.id,
          )
          .map((l) => l.id),
      )
    : selectedLink
      ? new Set([selectedLink.id])
      : null;
  $: litNodes = selectedNode
    ? new Set([
        selectedNode.id,
        ...links
          .filter(
            (l) =>
              l.source === selectedNode!.id || l.target === selectedNode!.id,
          )
          .flatMap((l) => [l.source, l.target]),
      ])
    : selectedLink
      ? new Set([selectedLink.source, selectedLink.target])
      : null;

  /** Scale a normalized path string into viewBox (= pixel) units. */
  function scalePath(d: string, vw: number, vh: number): string {
    return d.replace(
      /(-?\d*\.?\d+),(-?\d*\.?\d+)/g,
      (_m, x, y) =>
        `${(Number(x) * vw).toFixed(2)},${(Number(y) * vh).toFixed(2)}`,
    );
  }

  /** Where each slice of a stacked bar sits, in viewBox pixels. */
  function stackOf(
    node: SankeyLayoutNode,
    vh: number,
  ): { kind: string; y: number; h: number }[] {
    const segments = node.segments ?? [];
    if (!segments.length || node.value <= 0) return [];
    const full = Math.max(3, node.h * vh);
    let y = node.y * vh;
    return segments.map((s) => {
      const h = (s.value / node.value) * full;
      const slice = { kind: s.kind, y, h };
      y += h;
      return slice;
    });
  }

  interface Placed {
    node: SankeyLayoutNode;
    /** The side of the bar the text is on, or `in`: turned, inside the bar. */
    side: "right" | "left" | "in";
    x: number;
    y: number;
    name: string;
    value: string;
  }

  /**
   * Which bars get a name, where, and how much of it fits.
   *
   * A column with one bar wears its name turned inside the bar, which leaves
   * the gaps beside it free. Every other column writes beside its bars, into
   * the gap toward the middle of the drawing that no other column has taken:
   * the last column to its left, the others to their right, a middle column
   * to whichever side is still free. Within a column the bigger bar is named
   * first and a name never lands on another — a bar left unnamed is in the
   * list underneath.
   */
  function planLabels(
    all: SankeyLayoutNode[],
    cols: number,
    vw: number,
    vh: number,
    fmt: (v: number) => string,
  ): Placed[] {
    const byDepth = new Map<number, SankeyLayoutNode[]>();
    for (const n of all) {
      const bucket = byDepth.get(n.depth);
      if (bucket) bucket.push(n);
      else byDepth.set(n.depth, [n]);
    }
    const barW = (all[0]?.w ?? 0.06) * vw;
    const gap = cols > 1 ? (vw - cols * barW) / (cols - 1) : vw - barW;
    const out: Placed[] = [];
    /** Gap `g` lies between column g and g + 1. */
    const takenGaps = new Set<number>();
    const depths = [...byDepth.keys()].sort((a, b) => b - a);

    for (const depth of depths) {
      const group = byDepth.get(depth)!;
      if (group.length === 1 && group[0].h * vh >= 60) {
        const n = group[0];
        const value = fmt(n.value);
        const room = Math.floor((n.h * vh - 16) / CHAR_PX) - value.length - 1;
        if (barW >= FONT_PX + 4 && room >= 3) {
          out.push({
            node: n,
            side: "in",
            x: (n.x + n.w / 2) * vw,
            y: (n.y + n.h / 2) * vh,
            name: clip(n.label, room),
            value,
          });
          continue;
        }
      }

      let side: "right" | "left";
      if (cols === 1) side = "right";
      else if (depth === cols - 1) side = "left";
      else if (!takenGaps.has(depth)) side = "right";
      else if (depth > 0 && !takenGaps.has(depth - 1)) side = "left";
      else side = "right";
      takenGaps.add(side === "right" ? depth : depth - 1);

      const taken: [number, number][] = [];
      for (const n of [...group].sort((a, b) => b.value - a.value)) {
        const cy = Math.min(
          Math.max((n.y + n.h / 2) * vh, LABEL_H / 2),
          vh - LABEL_H / 2,
        );
        const top = cy - LABEL_H / 2;
        const bottom = cy + LABEL_H / 2;
        if (taken.some(([a, b]) => top < b && bottom > a)) continue;
        const value = fmt(n.value);
        const room = Math.floor((gap - 14) / CHAR_PX) - value.length - 1;
        if (room < 3) continue;
        taken.push([top, bottom]);
        out.push({
          node: n,
          side,
          x: side === "right" ? (n.x + n.w) * vw + 7 : n.x * vw - 7,
          y: cy,
          name: clip(n.label, room),
          value,
        });
      }
    }
    return out;
  }

  $: labels = planLabels(nodes, columns, W, H, format);

  function tap(event: MouseEvent) {
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const hit = sankeyHit(
      layout,
      event.clientX - rect.left,
      event.clientY - rect.top,
      { w: rect.width, h: rect.height },
    );
    if (hit?.type === "node") onSelectNode?.(hit.node);
    else if (hit?.type === "link") onSelectLink?.(hit.link);
  }

  /** Open a drawing wider than its box on the bar it is about. */
  async function showFocus() {
    await tick();
    if (!scroller || !scrolls) return;
    const focus = focusId ? nodeById.get(focusId) : null;
    const centre = focus ? (focus.x + focus.w / 2) * W : W;
    scroller.scrollLeft = Math.max(0, centre - boxWidth / 2);
  }
  let shownFor = "";
  $: {
    const key = `${focusId ?? ""}:${columns}:${scrolls}`;
    if (scroller && key !== shownFor) {
      shownFor = key;
      void showFocus();
    }
  }
  onMount(() => void showFocus());

  const valueOf = (item: { value: number; display?: string }) =>
    item.display ?? format(item.value);
</script>

{#if !layout || layout.empty}
  <slot name="empty" />
{:else}
  <div class="frame" class:scrolls bind:clientWidth={boxWidth}>
    <div class="scroller" bind:this={scroller}>
      <!-- The bars inside are the buttons; the click here only resolves a tap
           that landed near one (see sankeyHit). -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <svg
        viewBox="0 0 {W} {H}"
        width={W}
        height={H}
        role="group"
        aria-label={label}
        on:click={tap}
      >
        <g class="ribbons" aria-hidden="true">
          {#each links as link (link.id)}
            <path
              class="ribbon {link.kind ?? ''}"
              class:lit={litLinks?.has(link.id)}
              class:dim={litLinks && !litLinks.has(link.id)}
              d={scalePath(link.path, W, H)}
            />
          {/each}
        </g>

        <g class="bars">
          {#each nodes as node (node.id)}
            <g
              class="bar-group"
              class:dim={litNodes && !litNodes.has(node.id)}
              class:selected={selectedId === node.id}
              role="button"
              tabindex="0"
              aria-label="{node.label}: {valueOf(node)}"
              aria-pressed={selectedId === node.id}
              on:keydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectNode?.(node);
                }
              }}
            >
              <rect
                class="bar {node.kind ?? ''}"
                x={node.x * W}
                y={node.y * H}
                width={node.w * W}
                height={Math.max(3, node.h * H)}
                rx="3"
              />
              {#each stackOf(node, H) as slice (slice.kind)}
                <rect
                  class="bar slice {slice.kind}"
                  x={node.x * W}
                  y={slice.y}
                  width={node.w * W}
                  height={slice.h}
                />
              {/each}
            </g>
          {/each}
        </g>

        <g class="labels" aria-hidden="true">
          {#each labels as l (l.node.id)}
            {#if l.side === "in"}
              <text
                x={l.x}
                y={l.y}
                text-anchor="middle"
                dominant-baseline="middle"
                transform="rotate(-90 {l.x} {l.y})"
                class="inside"
                class:dim={litNodes && !litNodes.has(l.node.id)}
              >
                <tspan class="name">{l.name}</tspan>
                <tspan class="value" dx="6">{l.value}</tspan>
              </text>
            {:else}
              <text
                x={l.x}
                y={l.y}
                text-anchor={l.side === "right" ? "start" : "end"}
                dominant-baseline="middle"
                class:dim={litNodes && !litNodes.has(l.node.id)}
              >
                <tspan class="name">{l.name}</tspan>
                <tspan class="value" dx="5">{l.value}</tspan>
              </text>
            {/if}
          {/each}
        </g>
      </svg>
    </div>
  </div>
{/if}

<style>
  .frame {
    width: 100%;
    position: relative;
  }
  .scroller {
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
  }
  /* A drawing wider than its box fades at the edges: there is more that way. */
  .frame.scrolls::before,
  .frame.scrolls::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    width: 18px;
    pointer-events: none;
    z-index: 1;
  }
  .frame.scrolls::before {
    left: 0;
    background: linear-gradient(to right, var(--card), transparent);
  }
  .frame.scrolls::after {
    right: 0;
    background: linear-gradient(to left, var(--card), transparent);
  }

  svg {
    display: block;
    touch-action: pan-x pan-y pinch-zoom;
    -webkit-tap-highlight-color: transparent;
    cursor: pointer;
  }

  .ribbon {
    fill: var(--teal);
    opacity: 0.2;
    transition: opacity 0.15s ease;
  }
  /* What a holon gives its own contributors, and what it gives outward. */
  .ribbon.interior {
    fill: var(--kind-project);
    opacity: 0.24;
  }
  .ribbon.exterior {
    fill: var(--kind-fund);
    opacity: 0.24;
  }
  .ribbon.retained {
    fill: var(--kind-other);
    opacity: 0.22;
  }
  .ribbon.lit {
    opacity: 0.55;
  }
  .ribbon.dim {
    opacity: 0.07;
  }

  .bar {
    fill: var(--kind-other);
    transition: opacity 0.15s ease;
  }
  .bar.pot {
    fill: var(--kind-pot);
  }
  .bar.fund {
    fill: var(--kind-fund);
  }
  .bar.project {
    fill: var(--kind-project);
  }
  .bar.person {
    fill: var(--kind-person);
  }
  .bar.placeholder {
    fill: var(--kind-placeholder);
  }
  /* A stacked bar: collected, to collect, accruing — top to bottom. */
  .bar.slice.spent {
    fill: var(--muted);
  }
  .bar.slice.claimed {
    fill: var(--teal);
  }
  .bar.slice.available {
    fill: color-mix(in srgb, var(--teal) 45%, var(--card));
  }

  .bar-group {
    outline: none;
  }
  .bar-group.dim .bar {
    opacity: 0.3;
  }
  .bar-group.selected .bar:not(.slice),
  .bar-group:focus-visible .bar:not(.slice) {
    stroke: var(--ink);
    stroke-width: 2;
  }

  text {
    font-size: 13px;
    fill: var(--ink);
    /* A name may cross a ribbon: a halo of the ground keeps it readable. */
    paint-order: stroke;
    stroke: var(--card);
    stroke-width: 3px;
    stroke-linejoin: round;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }
  text.dim {
    opacity: 0.35;
  }
  .name {
    font-weight: 600;
  }
  .value {
    fill: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  /* Inside a bar the ground is the bar: dark by day, light by night, so the
     text takes the card's colour, which is the opposite of both. */
  text.inside {
    stroke: none;
    fill: var(--card);
  }
  text.inside .value {
    fill: var(--card);
    opacity: 0.8;
  }

  @media (prefers-reduced-motion: reduce) {
    .ribbon,
    .bar,
    text {
      transition: none;
    }
  }
</style>
