<script lang="ts">
  import { onMount } from "svelte";
  import { nameOf as resolvedName } from "$lib/names";
  import { unitHue } from "$lib/unithues";
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A read-only Sankey, drawn from geometry core already worked out.
  //
  // Deliberately dumb: it takes a `SankeyLayout` and renders it. All the
  // arithmetic — column placement, ribbon stacking, bezier control points —
  // lives in `@holons/core/flows` so the kiosk and the dashboard draw the same
  // picture from the same numbers and cannot drift.
  //
  // Drawn the way the Flows app pours its pots: every bar is a vessel — a
  // rounded shell tinted with its kind's colour — and every ribbon a band that
  // fades from the giver's colour into the receiver's, with drops running down
  // its middle. On a portrait screen the picture turns: the first column sits
  // on top and pours DOWN to the last, so a tall wall or a phone reads it the
  // way water falls instead of squeezing columns side by side.
  //
  // Turning is the renderer's business, not core's: the layout is a 0..1 box
  // with columns along x, so a vertical drawing maps that axis onto the
  // screen's y. Columns are mapped piecewise — each bar to a vessel of a fixed
  // thickness, each gap to the room between — which is affine within a gap, so
  // core's bezier ribbons map exactly and still meet the vessels' edges.
  //
  // A wall kiosk is touched, so tap opens the parent's modal; a mouse hovers,
  // and hover answers in place (value, share, the parent's `nodeDetails` /
  // `linkDetails` rows) — same contract as the dashboard twin.

  import type {
    SankeyLayout,
    SankeyLayoutLink,
    SankeyLayoutNode,
  } from "@holons/core/flows";

  /** Null is a legitimate "nothing to draw" — the empty slot renders. */
  export let layout: SankeyLayout | null;
  /** Formats a node's value for display (currency, hours, kudos, percent). */
  export let format: (value: number) => string = (v) => String(Math.round(v));
  /** Height of a SIDEWAYS drawing, in px. A vertical one grows with its rows. */
  export let height = 320;
  /** `auto` turns the drawing top-to-bottom on a portrait screen. */
  export let orientation: "auto" | "horizontal" | "vertical" = "auto";
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
  /** Share line for a combined ribbon, which is a share of its own unit. */
  export let unitShareLine: ((pct: number, unit: string) => string) | null =
    null;
  /** Accessible name for the unit legend, when one is drawn. */
  export let legendLabel: string | null = null;

  // ── Orientation ─────────────────────────────────────────────────────────
  let portrait = false;
  onMount(() => {
    const query = window.matchMedia("(orientation: portrait)");
    portrait = query.matches;
    const change = (e: MediaQueryListEvent) => (portrait = e.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  });
  $: vertical =
    orientation === "vertical" || (orientation === "auto" && portrait);

  // ── Geometry ────────────────────────────────────────────────────────────
  const FONT_PX = 13;
  /** Rough advance per character at FONT_PX; labels are never measured. */
  const CHAR_PX = 7;
  /** A sideways vessel's width: room for two turned lines inside it. */
  const BAR_H_PX = 38;
  /** A falling vessel's thickness, and the fall between two rows. */
  const BAR_V_PX = 46;
  $: DROP_PX = boxWidth < 560 ? 104 : 132;
  /** Side margin of a falling drawing, so its outer vessels keep their stroke. */
  const PAD = 4;

  /** Measured container width; the fallback only applies before first layout. */
  let boxWidth = 960;

  $: nodes = layout?.nodes ?? [];
  $: links = layout?.links ?? [];
  $: columns = Math.max(1, layout?.columns ?? 1);
  $: lastDepth = columns - 1;
  $: normW = nodes[0]?.w ?? 0.06;

  $: VW = Math.max(vertical ? 280 : 320, boxWidth);
  $: thick = vertical ? BAR_V_PX : BAR_H_PX;
  /** Length of the column axis, in px. */
  $: axisLen = vertical ? (columns - 1) * (BAR_V_PX + DROP_PX) + BAR_V_PX : VW;
  /** Where the column axis starts (the top margin of a falling drawing). */
  $: axisOff = vertical ? 4 : 0;
  /** Length of the cross axis (the one bars stack along), in px. */
  $: crossLen = vertical ? VW - 2 * PAD : height;
  $: crossOff = vertical ? PAD : 0;

  /** Pixel centre of column `d` along the column axis. */
  function columnCentre(d: number, cols: number, len: number, t: number) {
    return cols === 1 ? len / 2 : t / 2 + (d * (len - t)) / (cols - 1);
  }

  /** Knots of the piecewise map from the layout's x to the column axis. */
  $: knots = (() => {
    const src = [0];
    const dst = [axisOff];
    for (let d = 0; d < columns; d++) {
      const x =
        columns === 1 ? (1 - normW) / 2 : (d * (1 - normW)) / (columns - 1);
      const c = axisOff + columnCentre(d, columns, axisLen, thick);
      src.push(x, x + normW);
      dst.push(c - thick / 2, c + thick / 2);
    }
    src.push(1);
    dst.push(axisOff + axisLen);
    return { src, dst };
  })();

  /** Layout x (0..1) → px along the column axis. */
  function along(a: number, k: { src: number[]; dst: number[] }): number {
    const { src, dst } = k;
    for (let i = 1; i < src.length; i++) {
      if (a <= src[i] + 1e-9) {
        const span = src[i] - src[i - 1];
        if (span < 1e-9) return dst[i];
        return dst[i - 1] + ((a - src[i - 1]) / span) * (dst[i] - dst[i - 1]);
      }
    }
    return dst[dst.length - 1];
  }
  /** Layout y (0..1) → px across. */
  $: across = (b: number) => crossOff + b * crossLen;

  /** A normalized layout point → screen px. */
  $: point = (x: number, y: number): [number, number] =>
    vertical ? [across(y), along(x, knots)] : [along(x, knots), across(y)];

  interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  /** A bar's vessel on screen. Its column end is snapped to its depth. */
  $: boxOf = (n: SankeyLayoutNode): Box => {
    const c = axisOff + columnCentre(n.depth, columns, axisLen, thick);
    const a0 = c - thick / 2;
    const b0 = crossOff + n.y * crossLen;
    const len = Math.max(3, n.h * crossLen);
    return vertical
      ? { x: b0, y: a0, w: len, h: thick }
      : { x: a0, y: b0, w: thick, h: len };
  };
  $: boxes = new Map(nodes.map((n) => [n.id, boxOf(n)]));

  $: VH = vertical ? axisOff + axisLen + namesRoom + 6 : height;

  /** Scale a normalized path string into screen px, turning it if vertical. */
  function scalePath(d: string, map: typeof point): string {
    return d.replace(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g, (_m, x, y) => {
      const [sx, sy] = map(Number(x), Number(y));
      return `${sx.toFixed(2)},${sy.toFixed(2)}`;
    });
  }

  /**
   * The line down the middle of a ribbon, for its drops, and how thick the
   * ribbon is. Core writes a ribbon as eight points: the top edge out and the
   * bottom edge back; the spine runs between the two edges' midpoints.
   */
  function spineOf(
    d: string,
    map: typeof point,
  ): { d: string; width: number } | null {
    const pts = [...d.matchAll(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as const,
    );
    if (pts.length !== 8) return null;
    const [x0, y0t] = pts[0];
    const [xm] = pts[1];
    const [x1, y1t] = pts[3];
    const y1b = pts[4][1];
    const y0b = pts[7][1];
    const ys = (y0t + y0b) / 2;
    const ye = (y1t + y1b) / 2;
    const p = (x: number, y: number) =>
      map(x, y)
        .map((v) => v.toFixed(1))
        .join(",");
    const width = Math.min(y0b - y0t, y1b - y1t) * crossLen;
    return {
      d: `M${p(x0, ys)}C${p(xm, ys)} ${p(xm, ye)} ${p(x1, ye)}`,
      width,
    };
  }

  // ── Colour ──────────────────────────────────────────────────────────────
  /** A bar's colour by kind; the bands fade from one to the next. */
  const KIND_COLOUR: Record<string, string> = {
    hub: "var(--teal-deep)",
    pot: "var(--teal-deep)",
    opencollective: "#3b82f6",
    library: "#10b981",
    treasury: "#f59e0b",
    expense: "var(--teal)",
    interior: "#8b5cf6",
    member: "#8b5cf6",
    retained: "#8b5cf6",
    exterior: "#06b6d4",
    zone: "#06b6d4",
    partner: "#06b6d4",
    unattributed: "#64748b",
    other: "var(--muted)",
  };
  const colourOf = (kind?: string) =>
    KIND_COLOUR[kind ?? ""] ?? "var(--ink-soft)";

  /**
   * A hue per unit, for a track that carries several — computed from the
   * unit's name (`$lib/unithues`), so a unit is the same colour on every
   * board and in the unit chips above.
   */
  $: unitsShown = [
    ...new Set(links.map((l) => l.unit).filter((u): u is string => !!u)),
  ];

  /** Two charts share a page: gradient ids must not collide. */
  const uid = `sk${Math.random().toString(36).slice(2, 8)}`;

  $: nodeById = new Map(nodes.map((n) => [n.id, n]));

  // ── Hover ───────────────────────────────────────────────────────────────
  /**
   * What a share is measured against: the heaviest column, which is the hub in
   * a movement chart and the pot in an allocation. Flow through a holon is not
   * conserved, so the widest column is the honest denominator.
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

  // Only re-asks the parent when the hovered thing changes.
  $: rows = hoverNode
    ? (nodeDetails?.(hoverNode) ?? [])
    : hoverLink
      ? (linkDetails?.(hoverLink) ?? [])
      : [];

  $: title = hoverNode
    ? hoverNode.label
    : hoverLink
      ? `${nodeById.get(hoverLink.source)?.label ?? $resolvedName(hoverLink.source)} → ${
          nodeById.get(hoverLink.target)?.label ??
          $resolvedName(hoverLink.target)
        }`
      : "";

  $: hoveredValue = hoverNode?.value ?? hoverLink?.value ?? 0;
  $: hoveredDisplay = (hoverNode ?? hoverLink)?.display ?? format(hoveredValue);
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
  $: litNodes = hoverNode
    ? new Set([hoverNode.id])
    : hoverLink
      ? new Set([hoverLink.source, hoverLink.target])
      : null;

  /** Pointer position in the chart's own CSS pixels (= SVG units). */
  function track(event: MouseEvent) {
    const rect = box?.getBoundingClientRect();
    if (!rect) return;
    px = event.clientX - rect.left;
    py = event.clientY - rect.top;
  }

  /** Keyboard focus has no pointer, so anchor the tooltip on the vessel. */
  function anchor(node: SankeyLayoutNode) {
    const b = boxes.get(node.id);
    if (!b) return;
    px = b.x + b.w;
    py = b.y + b.h / 2;
  }

  /** Leaving a shape closes the tooltip; leave-then-enter never flickers. */
  function clear() {
    hoverNode = null;
    hoverLink = null;
  }

  $: tipLeft = Math.min(
    Math.max(8, px + 14),
    Math.max(8, boxWidth - tipWidth - 8),
  );
  $: tipTop = Math.min(Math.max(8, py + 14), Math.max(8, VH - tipHeight - 8));

  // ── Labels ──────────────────────────────────────────────────────────────
  function clip(text: string, room: number): string {
    if (room <= 0) return "";
    return text.length <= room
      ? text
      : `${text.slice(0, Math.max(1, room - 1))}…`;
  }

  /** What a bar or ribbon SAYS — a combined track's truth is its `display`. */
  function shown(item: { value: number; display?: string }): string {
    return item.display ?? format(item.value);
  }

  /** The bar for a screen reader: its value, then its stack if it has one. */
  function stackLabel(node: SankeyLayoutNode): string {
    const head = `${node.label}: ${shown(node)}`;
    const segments = node.segments ?? [];
    if (!segments.length) return head;
    return `${head} (${segments.map((s) => `${s.label} ${shown(s)}`).join(", ")})`;
  }

  // Sideways: a STRUCTURAL bar (pot, branch, zone, hub, rollup) is tall and
  // wears its text turned inside itself; a PERSON bar keeps its name
  // horizontal beside it when tall enough, turned beside it when not and
  // there is room, and is otherwise read on hover or tap. Text never stacks.
  const MIN_LABEL_H = 16;
  const LABEL_GAP = 4;
  const STRUCTURAL = new Set([
    "pot",
    "interior",
    "exterior",
    "unattributed",
    "zone",
    "hub",
    "other",
  ]);

  /**
   * One label. Sideways: `h` horizontal beside, `v` turned beside, `in` one
   * turned line inside, `in2` two turned lines inside. Falling: `one` a line
   * inside, `two` name over value inside, `below` turned under the last row.
   */
  interface Label {
    mode: "h" | "v" | "in" | "in2" | "one" | "two" | "below";
    x: number;
    y: number;
    name: string;
    value: string;
    /** Text sits on the left of its anchor (the last sideways column). */
    end?: boolean;
  }

  function planSideways(
    all: SankeyLayoutNode[],
    bx: Map<string, Box>,
    vh: number,
    _fmt: typeof format,
  ): Map<string, Label> {
    const plan = new Map<string, Label>();
    const byDepth = new Map<number, SankeyLayoutNode[]>();
    for (const n of all) {
      const bucket = byDepth.get(n.depth);
      if (bucket) bucket.push(n);
      else byDepth.set(n.depth, [n]);
    }
    const chars = (count: number) => count * CHAR_PX;
    for (const [depth, group] of byDepth) {
      const end = depth === lastDepth && columns > 1;
      const sorted = [...group].sort((a, b) => a.y - b.y);
      const taken: [number, number][] = [];
      const leftStructural: SankeyLayoutNode[] = [];
      const leftPeople: SankeyLayoutNode[] = [];
      const beside = (b: Box, gap: number) =>
        end ? b.x - gap : b.x + b.w + gap;

      for (const n of sorted) {
        const b = bx.get(n.id)!;
        const value = shown(n);
        const one = chars(n.label.length + value.length + 1);
        const two = chars(Math.max(n.label.length, value.length));
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        if (STRUCTURAL.has(n.kind ?? "")) {
          if (b.h >= one + 12)
            plan.set(n.id, { mode: "in", x: cx, y: cy, name: n.label, value });
          else if (b.h >= two + 12 && b.w >= 2 * FONT_PX + 6)
            plan.set(n.id, { mode: "in2", x: cx, y: cy, name: n.label, value });
          else leftStructural.push(n);
        } else if (b.h >= MIN_LABEL_H) {
          taken.push([cy - MIN_LABEL_H / 2, cy + MIN_LABEL_H / 2]);
          plan.set(n.id, {
            mode: "h",
            x: beside(b, 8),
            y: cy,
            name: n.label,
            value,
            end,
          });
        } else {
          leftPeople.push(n);
        }
      }

      // Bigger bars first: the one carrying more of the flow gets the edge.
      const byValue = (a: SankeyLayoutNode, b: SankeyLayoutNode) =>
        b.value - a.value;
      for (const n of [
        ...leftStructural.sort(byValue),
        ...leftPeople.sort(byValue),
      ]) {
        const b = bx.get(n.id)!;
        const value = shown(n);
        const len = chars(n.label.length + value.length + 1);
        if (len > vh) continue;
        let cy = b.y + b.h / 2;
        cy = Math.min(Math.max(cy, len / 2), vh - len / 2);
        const top = cy - len / 2 - LABEL_GAP;
        const bottom = cy + len / 2 + LABEL_GAP;
        if (taken.some(([a, z]) => top < z && bottom > a)) continue;
        taken.push([top, bottom]);
        plan.set(n.id, {
          mode: "v",
          x: beside(b, 4 + FONT_PX / 2),
          y: cy,
          name: n.label,
          value,
        });
      }
    }
    return plan;
  }

  /**
   * Falling: every vessel says what it can inside itself — a line, or the
   * name over the value. The last row, whose vessels are often slivers,
   * writes its names turned underneath, reading downward, biggest first,
   * never one name on another.
   */
  function planFalling(
    all: SankeyLayoutNode[],
    bx: Map<string, Box>,
    _fmt: typeof format,
  ): Map<string, Label> {
    const plan = new Map<string, Label>();
    const below: SankeyLayoutNode[] = [];
    for (const n of all) {
      const b = bx.get(n.id)!;
      const value = shown(n);
      const room = Math.floor((b.w - 14) / CHAR_PX);
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const last = n.depth === lastDepth && columns > 1;
      if (room >= n.label.length + value.length + 2) {
        plan.set(n.id, { mode: "one", x: cx, y: cy, name: n.label, value });
      } else if (last && room < Math.min(n.label.length, 8)) {
        below.push(n);
      } else if (room >= 4) {
        plan.set(n.id, {
          mode: "two",
          x: cx,
          y: cy,
          name: clip(n.label, room),
          value: value.length <= room ? value : "",
        });
      } else if (last) {
        below.push(n);
      }
    }
    const taken: number[] = [];
    for (const n of below.sort((a, b) => b.value - a.value)) {
      const b = bx.get(n.id)!;
      const cx = b.x + b.w / 2;
      if (taken.some((t) => Math.abs(t - cx) < FONT_PX + 2)) continue;
      taken.push(cx);
      plan.set(n.id, {
        mode: "below",
        x: cx,
        y: b.y + b.h + 8,
        name: clip(n.label, 18),
        value: shown(n),
      });
    }
    return plan;
  }

  // `format` is passed so a new formatter re-plans the labels it measures.
  $: labels = vertical
    ? planFalling(nodes, boxes, format)
    : planSideways(nodes, boxes, height, format);

  /** Room under the last row for the names turned beneath it. */
  $: namesRoom = vertical
    ? [...labels.values()]
        .filter((l) => l.mode === "below")
        .reduce(
          (max, l) =>
            Math.max(max, (l.name.length + l.value.length + 1) * CHAR_PX + 14),
          0,
        )
    : 0;

  /**
   * Where each slice of a stacked bar sits on screen: along the vessel's
   * length — top to bottom sideways, left to right falling — in the order
   * the builder gave them.
   */
  /**
   * The ends of each unit-coloured ribbon, per bar, in layout units: where
   * along the bar it arrives (`in`) or leaves (`out`). Read off core's path —
   * eight points, the top edge out and the bottom edge back — so they are
   * exactly where the ribbon touches the bar.
   */
  interface Port {
    id: string;
    side: "in" | "out";
    b0: number;
    b1: number;
    fill: string;
  }
  $: ports = (() => {
    const byNode = new Map<string, Port[]>();
    const push = (id: string, port: Port) => {
      const list = byNode.get(id);
      if (list) list.push(port);
      else byNode.set(id, [port]);
    };
    for (const link of links) {
      if (!link.unit) continue;
      const pts = [...link.path.matchAll(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g)].map(
        (m) => Number(m[2]),
      );
      if (pts.length !== 8) continue;
      const fill = unitHue(link.unit) ?? "var(--muted)";
      push(link.source, {
        id: `${link.id}:out`,
        side: "out",
        b0: pts[0],
        b1: pts[7],
        fill,
      });
      push(link.target, {
        id: `${link.id}:in`,
        side: "in",
        b0: pts[3],
        b1: pts[4],
        fill,
      });
    }
    return byNode;
  })();

  /**
   * A bar on a combined track, partitioned by the ribbons that touch it: the
   * entry half wears what arrives, the exit half what leaves, so every
   * ribbon meets its own colour. A bar with ribbons on one side only wears
   * them across its whole thickness.
   */
  function portSlices(
    node: SankeyLayoutNode,
    b: Box,
    list: Port[],
  ): (Box & { id: string; fill: string })[] {
    const both =
      list.some((p) => p.side === "in") && list.some((p) => p.side === "out");
    return list.map((p) => {
      const c0 = crossOff + p.b0 * crossLen;
      const len = Math.max(0, (p.b1 - p.b0) * crossLen);
      const half = both ? (p.side === "in" ? 0 : 0.5) : 0;
      const part = both ? 0.5 : 1;
      return vertical
        ? {
            id: p.id,
            fill: p.fill,
            x: c0,
            y: b.y + half * b.h,
            w: len,
            h: part * b.h,
          }
        : {
            id: p.id,
            fill: p.fill,
            x: b.x + half * b.w,
            y: c0,
            w: part * b.w,
            h: len,
          };
    });
  }

  function stackOf(node: SankeyLayoutNode, b: Box): (Box & { kind: string })[] {
    const segments = node.segments ?? [];
    if (!segments.length || node.value <= 0) return [];
    const full = vertical ? b.w : b.h;
    let at = vertical ? b.x : b.y;
    return segments.map((s) => {
      const len = (s.value / node.value) * full;
      const slice = vertical
        ? { kind: s.kind, x: at, y: b.y, w: len, h: b.h }
        : { kind: s.kind, x: b.x, y: at, w: b.w, h: len };
      at += len;
      return slice;
    });
  }
</script>

{#if !layout || layout.empty}
  <slot name="empty" />
{:else}
  <div
    class="chart"
    class:vertical
    style="height: {VH}px"
    bind:this={box}
    bind:clientWidth={boxWidth}
    on:mouseleave={clear}
    role="presentation"
  >
    <svg viewBox="0 0 {VW} {VH}" width={VW} height={VH} role="img">
      <defs>
        {#each links as link (link.id)}
          {#if !link.unit}
            <linearGradient
              id="{uid}-{link.id}"
              x1="0"
              y1="0"
              x2={vertical ? 0 : 1}
              y2={vertical ? 1 : 0}
            >
              <stop
                offset="0"
                style="stop-color:{colourOf(nodeById.get(link.source)?.kind)}"
              />
              <stop
                offset="1"
                style="stop-color:{colourOf(nodeById.get(link.target)?.kind)}"
              />
            </linearGradient>
          {/if}
        {/each}
      </defs>

      <g class="ribbons">
        {#each links as link (link.id)}
          {@const spine = spineOf(link.path, point)}
          {@const depth = nodeById.get(link.source)?.depth ?? 0}
          <g
            class="band"
            class:lit={litLinks?.has(link.id)}
            class:dim={litLinks && !litLinks.has(link.id)}
            style="--row:{depth}"
          >
            <path
              class="ribbon"
              style:fill={link.unit
                ? unitHue(link.unit)
                : `url(#${uid}-${link.id})`}
              d={scalePath(link.path, point)}
              role="img"
              aria-label="{nodeById.get(link.source)?.label ??
                $resolvedName(link.source)} to {nodeById.get(link.target)
                ?.label ?? $resolvedName(link.target)}: {shown(link)}"
              on:mouseenter={(e) => {
                hoverNode = null;
                hoverLink = link;
                track(e);
              }}
              on:mousemove={track}
              on:mouseleave={clear}
            />
            {#if spine && spine.width >= 5}
              <path
                class="drops"
                d={spine.d}
                style="stroke-width:{Math.max(
                  1.2,
                  Math.min(3.5, spine.width / 5),
                )}px"
              />
            {/if}
          </g>
        {/each}
      </g>

      <g class="bars">
        {#each nodes as node (node.id)}
          {@const b = boxes.get(node.id) ?? boxOf(node)}
          <!-- A vessel is one shell, or a stack: its slices drawn inside it in
               order, so a right reads as spent / claimed / available along
               its length. The shell keeps the vessel one shape for the
               pointer, the keyboard and the label. -->
          <g
            class="vessel"
            class:top={node.depth === 0}
            class:tappable={!!onSelect}
            class:dim={litNodes && !litNodes.has(node.id)}
            class:on={hoverNode?.id === node.id}
            style="--k:{colourOf(node.kind)};--row:{node.depth}"
            role="button"
            tabindex={onSelect ? 0 : -1}
            aria-label={stackLabel(node)}
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
          >
            <rect
              class="shell"
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={Math.min(10, b.w / 3, b.h / 3)}
            />
            {#if ports.has(node.id)}
              {#each portSlices(node, b, ports.get(node.id) ?? []) as slice (slice.id)}
                <rect
                  class="slice"
                  style:fill={slice.fill}
                  x={slice.x}
                  y={slice.y}
                  width={slice.w}
                  height={slice.h}
                />
              {/each}
            {:else}
              {#each stackOf(node, b) as slice (slice.kind)}
                <rect
                  class="slice {slice.kind}"
                  x={slice.x}
                  y={slice.y}
                  width={Math.max(0, slice.w)}
                  height={Math.max(0, slice.h)}
                />
              {/each}
            {/if}
          </g>
        {/each}
      </g>

      <g class="labels">
        {#each nodes as node (node.id)}
          {@const l = labels.get(node.id)}
          {@const dim = !!litNodes && !litNodes.has(node.id)}
          {#if l?.mode === "h"}
            <text
              x={l.x}
              y={l.y}
              text-anchor={l.end ? "end" : "start"}
              dominant-baseline="middle"
              class:dim
            >
              <tspan class="name">{l.name}</tspan>
              <tspan class="value" dx="6">{l.value}</tspan>
            </text>
          {:else if l?.mode === "v" || l?.mode === "in"}
            <text
              x={l.x}
              y={l.y}
              text-anchor="middle"
              dominant-baseline="middle"
              transform="rotate(-90 {l.x} {l.y})"
              class:inside={l.mode === "in"}
              class:dim
            >
              <tspan class="name">{l.name}</tspan>
              <tspan class="value" dx="6">{l.value}</tspan>
            </text>
          {:else if l?.mode === "in2"}
            <text
              text-anchor="middle"
              dominant-baseline="middle"
              transform="rotate(-90 {l.x} {l.y})"
              class="inside"
              class:dim
            >
              <tspan class="name" x={l.x} y={l.y - FONT_PX * 0.6}
                >{l.name}</tspan
              >
              <tspan class="value" x={l.x} y={l.y + FONT_PX * 0.6}
                >{l.value}</tspan
              >
            </text>
          {:else if l?.mode === "one"}
            <text
              x={l.x}
              y={l.y}
              text-anchor="middle"
              dominant-baseline="middle"
              class="inside"
              class:big={node.depth === 0}
              class:dim
            >
              <tspan class="name">{l.name}</tspan>
              <tspan class="value" dx="6">{l.value}</tspan>
            </text>
          {:else if l?.mode === "two"}
            <text text-anchor="middle" class="inside" class:dim>
              <tspan class="name" x={l.x} y={l.value ? l.y - 2 : l.y + 4}
                >{l.name}</tspan
              >
              {#if l.value}
                <tspan class="value" x={l.x} y={l.y + 13}>{l.value}</tspan>
              {/if}
            </text>
          {:else if l?.mode === "below"}
            <text
              class="below"
              dominant-baseline="middle"
              class:dim
              transform="translate({l.x + 4},{l.y}) rotate(90)"
            >
              <tspan class="name">{l.name}</tspan>
              <tspan class="value" dx="5">{l.value}</tspan>
            </text>
          {/if}
        {/each}
      </g>
    </svg>

    {#if unitsShown.length > 1}
      <ul class="legend" aria-label={legendLabel ?? undefined}>
        {#each unitsShown as unit (unit)}
          <li>
            <i class="swatch" style:background={unitHue(unit)}></i>{unit}
          </li>
        {/each}
      </ul>
    {/if}

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
          <span class="tip-value">{hoveredDisplay}</span>
        </div>
        {#if hoverLink?.unit}
          <!-- A combined ribbon's width is its share of ITS OWN unit, so the
               share line has to name that unit. -->
          <div class="tip-share">
            <i class="swatch" style:background={unitHue(hoverLink.unit)}></i>
            {unitShareLine
              ? unitShareLine(Math.round(hoverLink.value), hoverLink.unit)
              : `${Math.round(hoverLink.value)}% · ${hoverLink.unit}`}
          </div>
        {:else if hoverNode?.segments?.length && hoverNode.segments[0].unit}
          <dl class="tip-units">
            {#each hoverNode.segments as seg (seg.label)}
              <div class="tip-row">
                <dt>
                  <i class="swatch" style:background={unitHue(seg.label)}
                  ></i>{seg.label}
                </dt>
                <dd>{seg.display ?? format(seg.value)}</dd>
              </div>
            {/each}
          </dl>
        {:else if share != null && shareLine}
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
  /* A falling drawing grows downward; its legend sits under it. */
  .chart.vertical {
    height: auto !important;
  }

  svg {
    display: block;
    overflow: visible;
  }

  /* One hue per unit, named once, so the bands read without hovering. */
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.9rem;
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
  }
  .swatch {
    display: inline-block;
    width: 0.62em;
    height: 0.62em;
    border-radius: 999px;
    margin-right: 0.4em;
    vertical-align: 0.02em;
    flex: 0 0 auto;
  }

  /* ── Bands: what flows, fading from giver to receiver ── */
  .band {
    animation: pour-x 0.7s ease-out backwards;
    animation-delay: calc(var(--row) * 200ms + 120ms);
    transition: opacity 0.2s ease;
  }
  .vertical .band {
    animation-name: pour-y;
  }
  .ribbon {
    opacity: 0.4;
    transition: opacity 0.2s ease;
  }
  .band.lit .ribbon {
    opacity: 0.72;
  }
  .band.dim {
    opacity: 0.25;
  }
  .drops {
    fill: none;
    stroke: var(--card);
    stroke-linecap: round;
    stroke-dasharray: 1 11;
    opacity: 0.75;
    animation: drip 1.4s linear infinite;
    pointer-events: none;
  }

  /* ── Vessels: who holds it ── */
  .vessel {
    outline: none;
    animation: pour-x 0.5s ease-out backwards;
    animation-delay: calc(var(--row) * 200ms);
    transition: opacity 0.2s ease;
  }
  .vertical .vessel {
    animation-name: pour-y;
  }
  .vessel.tappable {
    cursor: pointer;
  }
  .vessel.dim {
    opacity: 0.45;
  }
  .shell {
    fill: color-mix(in srgb, var(--k) 22%, var(--card));
    stroke: var(--k);
    stroke-width: 1.5;
    transition: stroke-width 0.15s ease;
  }
  .vessel.top .shell {
    fill: color-mix(in srgb, var(--k) 32%, var(--card));
    stroke-width: 2;
  }
  .vessel.on .shell,
  .vessel:focus-visible .shell {
    stroke-width: 3;
  }
  .vessel:focus-visible .shell {
    stroke: var(--ink);
  }

  /* The slices of a stacked vessel: what a right has come to. */
  .slice {
    pointer-events: none;
    opacity: 0.55;
    fill: transparent;
  }
  .slice.spent {
    fill: #f43f5e;
  }
  .slice.claimed {
    fill: #f59e0b;
  }
  .slice.available {
    fill: #10b981;
  }
  /* Cascade: the part a party forwards by its own split. */
  .slice.passed {
    fill: #94a3b8;
  }
  .slice.over {
    fill: #dc2626;
  }

  /* ── Text ── */
  text {
    font-size: 13px;
    pointer-events: none;
    transition: opacity 0.2s ease;
    /* A name may cross a band: a halo of the ground keeps it readable. */
    paint-order: stroke;
    stroke: var(--card);
    stroke-width: 3px;
    stroke-linejoin: round;
  }
  text.dim {
    opacity: 0.35;
  }
  .name {
    fill: var(--ink);
    font-weight: 700;
  }
  .value {
    fill: var(--ink-soft);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  /* Inside a vessel the ground is its own tint: no halo needed. */
  text.inside {
    stroke: none;
    font-size: 12px;
  }
  text.inside.big {
    font-size: 15px;
  }
  text.below {
    font-size: 12px;
    text-anchor: start;
  }
  text.below .name {
    font-weight: 600;
    fill: var(--ink-soft);
  }
  text.below .value {
    fill: var(--muted);
  }

  @keyframes pour-x {
    from {
      opacity: 0;
      transform: translateX(-8px);
    }
  }
  @keyframes pour-y {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
  }
  @keyframes drip {
    to {
      stroke-dashoffset: -24;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .band,
    .vessel,
    .drops,
    text {
      animation: none;
      transition: none;
    }
  }

  /* ── Tooltip ── */
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
    color: var(--teal-ink);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .tip-share {
    color: var(--muted);
    font-size: 0.72rem;
  }
  .tip-units {
    margin: 0.35rem 0 0;
    display: grid;
    gap: 0.15rem;
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
