<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The whole ecosystem in space, slowly turning.
  //
  // Like the Sankey it is dumb about meaning: core says where every party
  // stands, how big it is and how wide each line is (`layoutFlowSpace` — a
  // line's width is the share of the Pot it carries). This only looks at it:
  // a camera on an orbit, a projection, a canvas. Two thousand parties and
  // their lines are a few thousand strokes a frame, which a canvas does and
  // an SVG does not.
  //
  // The camera turns on its own until someone takes it. A drag turns it, a
  // pinch or the wheel goes in TOWARD what is under the fingers or the
  // pointer, a tap on a party selects it and brings it to the middle, where
  // the camera then turns about it. The pointer wears a small gimbal — three
  // rings that turn with the space — on the party it is nearest to.
  //
  // What travels the lines is drawn as drops. With `streams` at "money" they
  // are all water — the financial stream. At "eight" each drop takes one of
  // the eight capitals, in the mix of what the party it flows to has been
  // given (`capitals`), and every resourced party wears a halo and the count
  // of what it received: resources first, finance follows.
  //
  // `highlight` (what a search found) keeps those parties lit, ringed and
  // named, and fades the rest back.
  //
  // With "reduce motion" set nothing moves unless it is moved.
  //
  // A canvas says nothing to a screen reader: the page lists the same parties
  // under it, and that list is what a keyboard walks.

  import { onMount } from "svelte";
  import {
    CAPITALS,
    resourceCount,
    type Capital,
    type FlowSpace,
    type FlowSpaceNode,
  } from "@holons/core/flows";
  import Icon from "./Icon.svelte";
  import { clip } from "$lib/format";
  import { t } from "$lib/i18n";

  export let space: FlowSpace;
  /** Formats a share for display. */
  export let format: (share: number) => string = (v) => `${v}%`;
  export let selectedId: string | null = null;
  export let onSelect: ((node: FlowSpaceNode | null) => void) | null = null;
  /** One sentence saying what the drawing shows, for a screen reader. */
  export let label = "";
  /** Party → its received resource gifts per capital. */
  export let capitals: Map<string, Partial<Record<Capital, number>>> | null =
    null;
  /** What the drops in the lines are: money alone, or all eight capitals. */
  export let streams: "money" | "eight" = "eight";
  /** Parties to keep lit while the rest fade (a search's matches); null lights all. */
  export let highlight: Set<string> | null = null;

  /** Radians a second the camera drifts when left alone: a turn in three minutes. */
  const DRIFT = (2 * Math.PI) / 180;
  /** How long after a touch the drift takes up again. */
  const REST_MS = 2500;
  const FOV = (40 * Math.PI) / 180;
  const MAX_PITCH = 1.45;
  /** A fingertip, and a pointer, of room round a party. */
  const TOUCH_PX = 22;
  const HOVER_PX = 14;
  /** A drag shorter than this is a tap. */
  const TAP_PX = 6;
  /** Names drawn at once, besides the one under the pointer and the selected. */
  const NAMES = 14;
  /** Lines wide enough to show what travels them. */
  const PULSES = 240;
  const KINDS = ["pot", "fund", "project", "person", "placeholder"] as const;
  /** Hairlines are drawn together, by how faint they are. */
  const SHADES = [0.1, 0.2, 0.36, 0.6];
  /** Resourced parties given a badge with their count, the most resourced first. */
  const BADGES = 40;

  let box: HTMLDivElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let W = 358;
  let H = 420;

  // The scene, flattened for the frame loop.
  let nodes: FlowSpaceNode[] = [];
  let at = new Map<string, number>();
  let linkA = new Int32Array(0);
  let linkB = new Int32Array(0);
  let sx = new Float32Array(0);
  let sy = new Float32Array(0);
  let sz = new Float32Array(0);
  let sk = new Float32Array(0);
  let order = new Uint32Array(0);
  let shade = new Int8Array(0);
  /** Per party: received non-financial gifts, and the capitals drops take on the way to it. */
  let resCount = new Int32Array(0);
  let dropMix: Capital[][] = [];
  let haloCap: (Capital | null)[] = [];
  let badged = new Set<number>();
  /** Per party: 1 when `highlight` names it. */
  let hl = new Uint8Array(0);
  let hlOn = false;

  // The camera: on a sphere of `dist` about `target`, looking at it.
  let yaw = 0.6;
  let pitch = 0.32;
  let dist = 10;
  let target: [number, number, number] = [0, 0, 0];
  /** Where a selection is easing the camera to. */
  let goal: { target: [number, number, number]; dist: number } | null = null;

  let hoverIdx = -1;
  let touchedAt = 0;
  let dirty = true;
  let still = false;
  let palette: Record<string, string> = {};

  $: fit = (space.radius / Math.sin(FOV / 2)) * 1.02;
  $: if (space) load(space, capitals);
  // A switch of streams is a new picture, even when nothing moves.
  $: if (streams) dirty = true;
  $: lightUp(highlight, at);
  $: selectedIdx = selectedId != null ? (at.get(selectedId) ?? -1) : -1;
  $: if (selectedIdx >= -1) follow(selectedIdx);

  function load(
    s: FlowSpace,
    given: Map<string, Partial<Record<Capital, number>>> | null,
  ) {
    const fresh = nodes.length === 0;
    nodes = s.nodes;
    at = new Map(nodes.map((n, i) => [n.id, i]));
    linkA = Int32Array.from(s.links, (l) => at.get(l.source) ?? -1);
    linkB = Int32Array.from(s.links, (l) => at.get(l.target) ?? -1);
    sx = new Float32Array(nodes.length);
    sy = new Float32Array(nodes.length);
    sz = new Float32Array(nodes.length);
    sk = new Float32Array(nodes.length);
    order = Uint32Array.from(nodes, (_n, i) => i);
    shade = new Int8Array(s.links.length);
    resCount = new Int32Array(nodes.length);
    dropMix = [];
    haloCap = [];
    nodes.forEach((n, i) => {
      const by = given?.get(n.id) ?? null;
      resCount[i] = resourceCount(by);
      // Water always flows; each capital it was given rides along as often as it came.
      const mix: Capital[] = ["financial"];
      let top: Capital | null = null;
      for (const c of CAPITALS) {
        const k = Math.min(8, Math.floor(Number(by?.[c]) || 0));
        if (c !== "financial" && k > 0 && (!top || k > (by?.[top] ?? 0)))
          top = c;
        for (let j = 0; j < k; j++) mix.push(c);
      }
      dropMix.push(mix);
      haloCap.push(top);
    });
    badged = new Set(
      Array.from(resCount.keys())
        .filter((i) => resCount[i] > 0)
        .sort((a, b) => resCount[b] - resCount[a])
        .slice(0, BADGES),
    );
    hoverIdx = -1;
    // A refined graph is the same place: the view someone chose stays.
    if (fresh) home();
    dirty = true;
  }

  function lightUp(ids: Set<string> | null, where: Map<string, number>) {
    hl = new Uint8Array(nodes.length);
    for (const id of ids ?? []) {
      const i = where.get(id);
      if (i != null) hl[i] = 1;
    }
    hlOn = ids != null;
    dirty = true;
  }

  /** How much of itself a party keeps while a search lights others. */
  const lift = (i: number) => (hlOn && !hl[i] ? 0.18 : 1);
  const liftLine = (a: number, b: number) =>
    hlOn && !hl[a] && !hl[b] ? 0.25 : 1;

  function home() {
    yaw = 0.6;
    pitch = 0.32;
    target = [0, 0, 0];
    dist = (space.radius / Math.sin(FOV / 2)) * 1.02;
    goal = null;
    dirty = true;
  }

  function follow(idx: number) {
    const n = nodes[idx];
    if (!n) return;
    goal = {
      target: [n.x, n.y, n.z],
      // The Pot is already the middle of the whole: nothing to go in to.
      dist:
        n.depth === 0 ? dist : Math.min(dist, Math.max(fit * 0.3, n.r * 12)),
    };
    dirty = true;
  }

  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));
  const focal = () => (0.5 * Math.min(W, H)) / Math.tan(FOV / 2);

  /** The camera's right, up and forward, from where it is on its orbit. */
  function basis() {
    const cp = Math.cos(pitch);
    const f: [number, number, number] = [
      -Math.sin(yaw) * cp,
      -Math.sin(pitch),
      -Math.cos(yaw) * cp,
    ];
    const r: [number, number, number] = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const u: [number, number, number] = [
      r[1] * f[2] - r[2] * f[1],
      r[2] * f[0] - r[0] * f[2],
      r[0] * f[1] - r[1] * f[0],
    ];
    return { r, u, f };
  }

  /** Slide the orbit's centre across the screen plane by a pixel offset. */
  function slide(dx: number, dy: number) {
    const { r, u } = basis();
    const k = dist / focal();
    target = [
      target[0] - (r[0] * dx - u[0] * dy) * k,
      target[1] - (r[1] * dx - u[1] * dy) * k,
      target[2] - (r[2] * dx - u[2] * dy) * k,
    ];
  }

  /** Go in (factor < 1) or out, keeping what is under (px, py) under it. */
  function zoomAt(px: number, py: number, factor: number) {
    const next = clamp(dist * factor, 2.4, fit * 1.5);
    const applied = next / dist;
    if (applied === 1) return;
    goal = null;
    const ox = px - W / 2;
    const oy = py - H / 2;
    slide(-ox * (1 - applied), -oy * (1 - applied));
    dist = next;
    touch();
  }

  function touch() {
    touchedAt = performance.now();
    dirty = true;
  }

  // ── The frame ───────────────────────────────────────────────────────────

  function project() {
    const { r, u, f } = basis();
    const cx = target[0] - f[0] * dist;
    const cy = target[1] - f[1] * dist;
    const cz = target[2] - f[2] * dist;
    const fl = focal();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const vx = n.x - cx;
      const vy = n.y - cy;
      const vz = n.z - cz;
      const z = vx * f[0] + vy * f[1] + vz * f[2];
      sz[i] = z;
      if (z < 0.2) {
        sk[i] = 0;
        continue;
      }
      const k = fl / z;
      sk[i] = k;
      sx[i] = W / 2 + (vx * r[0] + vy * r[1] + vz * r[2]) * k;
      sy[i] = H / 2 - (vx * u[0] + vy * u[1] + vz * u[2]) * k;
    }
  }

  /** How much of itself something keeps at depth `z`: the far side recedes. */
  const fog = (z: number) =>
    clamp(1 - (z - dist) / (space.radius * 2.6), 0.45, 1);

  function readPalette() {
    if (!canvas) return;
    const css = getComputedStyle(canvas);
    const read = (name: string) => css.getPropertyValue(name).trim();
    palette = {
      ink: read("--ink"),
      soft: read("--ink-soft"),
      card: read("--card"),
      accent: read("--teal-ink"),
      ...Object.fromEntries(KINDS.map((k) => [k, read(`--kind-${k}`)])),
      ...Object.fromEntries(
        CAPITALS.map((c) => [`cap-${c}`, read(`--cap-${c}`)]),
      ),
    };
    dirty = true;
  }

  function draw(ctx: CanvasRenderingContext2D, now: number) {
    const links = space.links;
    const lit = selectedIdx >= 0 ? selectedIdx : hoverIdx;
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round";

    // Lines. Most are thinner than a pixel: those are drawn a pixel wide and
    // as faint as they are thin, a shade at a time. The rest get their width.
    const wide: number[] = [];
    for (let i = 0; i < links.length; i++) {
      const a = linkA[i];
      const b = linkB[i];
      shade[i] = -1;
      if (a < 0 || b < 0 || !sk[a] || !sk[b]) continue;
      if (lit >= 0 && (a === lit || b === lit)) {
        wide.push(i);
        continue;
      }
      const px = links[i].width * (sk[a] + sk[b]) * 0.5;
      if (px >= 1) {
        wide.push(i);
        continue;
      }
      const alpha =
        Math.max(0.1, px) *
        fog((sz[a] + sz[b]) / 2) *
        (lit >= 0 ? 0.4 : 1) *
        liftLine(a, b);
      shade[i] = alpha < 0.15 ? 0 : alpha < 0.28 ? 1 : alpha < 0.48 ? 2 : 3;
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.soft;
    for (let s = 0; s < SHADES.length; s++) {
      ctx.globalAlpha = SHADES[s];
      ctx.beginPath();
      for (let i = 0; i < links.length; i++) {
        if (shade[i] !== s) continue;
        ctx.moveTo(sx[linkA[i]], sy[linkA[i]]);
        ctx.lineTo(sx[linkB[i]], sy[linkB[i]]);
      }
      ctx.stroke();
    }
    for (const i of wide) {
      const a = linkA[i];
      const b = linkB[i];
      const on = lit >= 0 && (a === lit || b === lit);
      const px = links[i].width * (sk[a] + sk[b]) * 0.5;
      ctx.globalAlpha = on
        ? clamp(px, 0.3, 0.9)
        : 0.5 *
          fog((sz[a] + sz[b]) / 2) *
          (lit >= 0 ? 0.35 : 1) *
          liftLine(a, b);
      ctx.strokeStyle = on ? palette.accent : palette[nodes[a].kind];
      ctx.lineWidth = Math.max(1, px);
      ctx.beginPath();
      ctx.moveTo(sx[a], sy[a]);
      ctx.lineTo(sx[b], sy[b]);
      ctx.stroke();
    }

    // What travels the widest lines, on its way from payer to paid.
    if (!still) {
      const eight = streams === "eight";
      ctx.fillStyle = eight ? palette.card : palette["cap-financial"];
      const n = Math.min(PULSES, links.length);
      for (let i = 0; i < n; i++) {
        const a = linkA[i];
        const b = linkB[i];
        if (a < 0 || b < 0 || !sk[a] || !sk[b]) continue;
        const px = links[i].width * (sk[a] + sk[b]) * 0.5;
        if (px < 1.5) continue;
        const len = Math.hypot(sx[b] - sx[a], sy[b] - sy[a]);
        if (len < 24) continue;
        const travel = now * 0.00022 + i * 0.6180339;
        const along = travel % 1;
        if (eight) {
          // Each trip down the line carries another of what reached its end.
          const mix = dropMix[b] ?? ["financial"];
          const c = mix[(Math.floor(travel) * 7 + i) % mix.length];
          ctx.fillStyle = palette[`cap-${c}`];
        }
        ctx.globalAlpha = 0.9 * Math.sin(along * Math.PI);
        ctx.beginPath();
        ctx.arc(
          sx[a] + (sx[b] - sx[a]) * along,
          sy[a] + (sy[b] - sy[a]) * along,
          clamp(px * 0.32, 1, 5),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    // Parties, the far ones first.
    order.sort((p, q) => sz[q] - sz[p]);
    for (const kind of KINDS) {
      // Specks: too small to be a disc.
      ctx.fillStyle = palette[kind];
      for (const i of order) {
        if (!sk[i] || nodes[i].kind !== kind || nodes[i].r * sk[i] >= 1.6)
          continue;
        ctx.globalAlpha =
          fog(sz[i]) *
          (nodes[i].reached ? 0.9 : 0.45) *
          (lit >= 0 ? 0.6 : 1) *
          lift(i);
        // A found speck is drawn larger, so it can be seen at all.
        const d = hl[i] ? 2 : 1;
        ctx.fillRect(sx[i] - d, sy[i] - d, 2 * d, 2 * d);
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.card;
    for (const i of order) {
      const px = nodes[i].r * sk[i];
      if (!sk[i] || px < 1.6) continue;
      ctx.globalAlpha =
        fog(sz[i]) *
        (nodes[i].reached ? 1 : 0.45) *
        (lit >= 0 && i !== lit ? 0.75 : 1) *
        lift(i);
      ctx.fillStyle = palette[nodes[i].kind];
      ctx.beginPath();
      ctx.arc(sx[i], sy[i], px, 0, Math.PI * 2);
      ctx.fill();
      if (px >= 4) ctx.stroke();
    }

    if (streams === "eight") halos(ctx, now, lit);
    if (hlOn) rings(ctx);
    names(ctx);
    if (selectedIdx >= 0) gimbal(ctx, selectedIdx, palette.accent, 1);
    if (hoverIdx >= 0 && hoverIdx !== selectedIdx)
      gimbal(ctx, hoverIdx, palette.ink, 0.8);
    ctx.globalAlpha = 1;
  }

  /** A glow about every resourced party, in its main capital's colour, and its count. */
  function halos(ctx: CanvasRenderingContext2D, now: number, lit: number) {
    const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.003);
    for (const i of order) {
      if (!sk[i] || resCount[i] <= 0) continue;
      const px = Math.max(2, nodes[i].r * sk[i]);
      const colour = palette[`cap-${haloCap[i] ?? "financial"}`];
      const dim = (lit >= 0 && i !== lit ? 0.5 : 1) * lift(i);
      const glow = ctx.createRadialGradient(
        sx[i],
        sy[i],
        px,
        sx[i],
        sy[i],
        px + 6 + 4 * pulse,
      );
      glow.addColorStop(0, colour);
      glow.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.55 * fog(sz[i]) * dim;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx[i], sy[i], px + 6 + 4 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9 * fog(sz[i]) * dim;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx[i], sy[i], px + 2.5, 0, Math.PI * 2);
      ctx.stroke();
      if (!badged.has(i) || px < 2.5) continue;
      // The count, on a disc at the party's shoulder.
      const text = String(resCount[i]);
      ctx.font = "700 10px system-ui, -apple-system, 'Segoe UI', sans-serif";
      const w = Math.max(14, ctx.measureText(text).width + 8);
      const bx = sx[i] + px * 0.75 + 3;
      const by = sy[i] - px * 0.75 - 3;
      ctx.globalAlpha = dim;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.roundRect?.(bx - w / 2, by - 7, w, 14, 7);
      if (!ctx.roundRect) ctx.rect(bx - w / 2, by - 7, w, 14);
      ctx.fill();
      ctx.fillStyle = palette.card;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, bx, by + 0.5);
      ctx.textAlign = "start";
    }
  }

  /** A ring about each party a search found. */
  function rings(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 2;
    for (const i of order) {
      if (!hl[i] || !sk[i]) continue;
      ctx.globalAlpha = fog(sz[i]);
      ctx.beginPath();
      ctx.arc(
        sx[i],
        sy[i],
        Math.max(2, nodes[i].r * sk[i]) + 3,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }

  /** The 3D cursor: three rings about a party, turning with the space. */
  function gimbal(
    ctx: CanvasRenderingContext2D,
    i: number,
    colour: string,
    alpha: number,
  ) {
    if (!sk[i]) return;
    const { r, u } = basis();
    const rho = nodes[i].r * sk[i] + 7;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.25;
    // A world axis seen from the camera: where it points on the screen.
    const seen = (x: number, y: number, z: number): [number, number] => [
      x * r[0] + y * r[1] + z * r[2],
      -(x * u[0] + y * u[1] + z * u[2]),
    ];
    const axes = [seen(1, 0, 0), seen(0, 1, 0), seen(0, 0, 1)];
    for (let ring = 0; ring < 3; ring++) {
      const p = axes[ring];
      const q = axes[(ring + 1) % 3];
      ctx.globalAlpha = alpha * (ring === 0 ? 0.95 : 0.55);
      ctx.beginPath();
      for (let s = 0; s <= 40; s++) {
        const a = (s / 40) * Math.PI * 2;
        const x = sx[i] + (p[0] * Math.cos(a) + q[0] * Math.sin(a)) * rho;
        const y = sy[i] + (p[1] * Math.cos(a) + q[1] * Math.sin(a)) * rho;
        if (s) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }

  function names(ctx: CanvasRenderingContext2D) {
    const picked: number[] = [];
    if (selectedIdx >= 0) picked.push(selectedIdx);
    if (hoverIdx >= 0 && hoverIdx !== selectedIdx) picked.push(hoverIdx);
    const forced = picked.length;
    const bySize = (p: number, q: number) =>
      nodes[q].r * sk[q] - nodes[p].r * sk[p];
    // What a search found is named before whatever is merely large.
    const found = hlOn
      ? Array.from(order)
          .filter((i) => hl[i] && sk[i] && !picked.includes(i))
          .sort(bySize)
          .slice(0, NAMES * 2)
      : [];
    const large = Array.from(order)
      .filter(
        (i) =>
          sk[i] &&
          nodes[i].r * sk[i] >= 5 &&
          !picked.includes(i) &&
          !(hlOn && !hl[i]),
      )
      .sort(bySize)
      .slice(0, NAMES * 2);
    picked.push(...found, ...large.filter((i) => !found.includes(i)));

    ctx.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const taken: [number, number, number, number][] = [];
    let drawn = 0;
    for (let k = 0; k < picked.length && drawn < NAMES + forced; k++) {
      const i = picked[k];
      if (!sk[i]) continue;
      const must = k < forced;
      const text = must
        ? `${clip(nodes[i].label, 30)} · ${format(nodes[i].share)}`
        : clip(nodes[i].label, 22);
      const w = ctx.measureText(text).width;
      const gap = nodes[i].r * sk[i] + (must ? 12 : 5);
      // Beside the disc, on whichever side has the room.
      const x = sx[i] + gap + w > W - 4 ? sx[i] - gap - w : sx[i] + gap;
      const y = clamp(sy[i], 10, H - 10);
      const rect: [number, number, number, number] = [x, y - 9, x + w, y + 9];
      if (
        !must &&
        (x < 2 ||
          taken.some(
            (o) =>
              rect[0] < o[2] + 6 &&
              rect[2] > o[0] - 6 &&
              rect[1] < o[3] &&
              rect[3] > o[1],
          ))
      )
        continue;
      taken.push(rect);
      drawn++;
      ctx.globalAlpha = must ? 1 : Math.max(0.55, fog(sz[i]));
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = palette.card;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = palette.ink;
      ctx.fillText(text, x, y);
    }
  }

  /** The party nearest (px, py), within `room` pixels of its disc. */
  function pick(px: number, py: number, room: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (!sk[i]) continue;
      const rpx = nodes[i].r * sk[i];
      const d = Math.hypot(sx[i] - px, sy[i] - py) - rpx;
      if (d > room) continue;
      // Of two under the finger, the nearer to the eye.
      const score = Math.max(0, d) + sz[i] * 1e-4;
      if (score < bestD) {
        bestD = score;
        best = i;
      }
    }
    return best;
  }

  // ── Hands ───────────────────────────────────────────────────────────────

  const down = new Map<number, { x: number; y: number }>();
  let travelled = 0;
  let pinch = 0;
  let dragging = false;

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  function spread(): { x: number; y: number; d: number } {
    const [p, q] = [...down.values()];
    return {
      x: (p.x + q.x) / 2,
      y: (p.y + q.y) / 2,
      d: Math.hypot(p.x - q.x, p.y - q.y),
    };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    canvas?.setPointerCapture(e.pointerId);
    down.set(e.pointerId, local(e));
    if (down.size === 1) travelled = 0;
    if (down.size === 2) pinch = spread().d;
    dragging = true;
    touch();
  }

  function onPointerMove(e: PointerEvent) {
    const p = local(e);
    const was = down.get(e.pointerId);
    if (!was) {
      if (e.pointerType !== "touch") {
        const next = pick(p.x, p.y, HOVER_PX);
        if (next !== hoverIdx) {
          hoverIdx = next;
          dirty = true;
        }
      }
      return;
    }
    if (down.size === 1) {
      const dx = p.x - was.x;
      const dy = p.y - was.y;
      travelled += Math.hypot(dx, dy);
      if (travelled > TAP_PX) {
        goal = null;
        yaw -= dx * 0.006;
        pitch = clamp(pitch + dy * 0.006, -MAX_PITCH, MAX_PITCH);
      }
      down.set(e.pointerId, p);
    } else if (down.size === 2) {
      const before = spread();
      down.set(e.pointerId, p);
      const after = spread();
      travelled += TAP_PX;
      slide(after.x - before.x, after.y - before.y);
      if (pinch > 0 && after.d > 0) zoomAt(after.x, after.y, pinch / after.d);
      pinch = after.d;
    }
    touch();
  }

  function onPointerUp(e: PointerEvent) {
    const was = down.get(e.pointerId);
    if (!was) return;
    down.delete(e.pointerId);
    dragging = down.size > 0;
    if (down.size === 0 && travelled <= TAP_PX && e.type === "pointerup") {
      const idx = pick(
        was.x,
        was.y,
        e.pointerType === "touch" ? TOUCH_PX : HOVER_PX,
      );
      const node = idx >= 0 ? nodes[idx] : null;
      // A second tap on the selected party lets it go.
      onSelect?.(node && node.id === selectedId ? null : node);
    }
    touch();
  }

  function onPointerLeave() {
    if (hoverIdx >= 0) {
      hoverIdx = -1;
      dirty = true;
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = local(e);
    // A trackpad pinch arrives as a wheel with ctrl held, in small steps.
    const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(
      p.x,
      p.y,
      Math.exp(clamp(step, -120, 120) * (e.ctrlKey ? 0.012 : 0.0022)),
    );
  }

  function onKeyDown(e: KeyboardEvent) {
    const turn = 0.12;
    if (e.key === "ArrowLeft") yaw += turn;
    else if (e.key === "ArrowRight") yaw -= turn;
    else if (e.key === "ArrowUp")
      pitch = clamp(pitch + turn, -MAX_PITCH, MAX_PITCH);
    else if (e.key === "ArrowDown")
      pitch = clamp(pitch - turn, -MAX_PITCH, MAX_PITCH);
    else if (e.key === "+" || e.key === "=") zoomAt(W / 2, H / 2, 0.8);
    else if (e.key === "-" || e.key === "_") zoomAt(W / 2, H / 2, 1.25);
    else if (e.key === "0" || e.key === "Home") reset();
    else if (e.key === "Escape" && selectedId != null) onSelect?.(null);
    else return;
    e.preventDefault();
    touch();
  }

  function reset() {
    onSelect?.(null);
    home();
    touch();
  }

  onMount(() => {
    if (!canvas || !box) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const setStill = () => {
      still = !!motion?.matches;
      dirty = true;
    };
    setStill();
    motion?.addEventListener?.("change", setStill);

    readPalette();
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener?.("change", readPalette);
    const theme = new MutationObserver(readPalette);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const size = () => {
      if (!canvas || !box) return;
      W = Math.max(240, box.clientWidth);
      H = Math.max(240, box.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty = true;
    };
    const resize = new ResizeObserver(size);
    resize.observe(box);
    size();

    // Off the screen it neither turns nor draws.
    let seen = true;
    const watch = new IntersectionObserver(([entry]) => {
      seen = entry.isIntersecting;
    });
    watch.observe(box);

    // The wheel must be refusable, so the page does not scroll under a zoom.
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!seen || document.hidden) return;
      if (goal) {
        const k = still ? 1 : 1 - Math.exp(-dt * 4.5);
        target = [
          target[0] + (goal.target[0] - target[0]) * k,
          target[1] + (goal.target[1] - target[1]) * k,
          target[2] + (goal.target[2] - target[2]) * k,
        ];
        dist += (goal.dist - dist) * k;
        const left =
          Math.hypot(
            goal.target[0] - target[0],
            goal.target[1] - target[1],
            goal.target[2] - target[2],
          ) + Math.abs(goal.dist - dist);
        if (left < 1e-3) goal = null;
        dirty = true;
      }
      const resting = !dragging && now - touchedAt > REST_MS;
      if (!still && resting) yaw += DRIFT * dt;
      // Moving, it is drawn every frame; still, only when something changed.
      if (still && !dirty) return;
      dirty = false;
      project();
      draw(ctx, now);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      canvas?.removeEventListener("wheel", onWheel);
      motion?.removeEventListener?.("change", setStill);
      scheme?.removeEventListener?.("change", readPalette);
      theme.disconnect();
      resize.disconnect();
      watch.disconnect();
    };
  });
</script>

<div class="space" bind:this={box}>
  <!-- A canvas is no control to the linter; this one is turned by hand and by key. -->
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
  <canvas
    bind:this={canvas}
    class:dragging
    class:over={hoverIdx >= 0}
    role="application"
    aria-label={label}
    tabindex="0"
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    on:pointerleave={onPointerLeave}
    on:dblclick={reset}
    on:keydown={onKeyDown}
  ></canvas>
  <div class="tools">
    <button
      on:click={() => zoomAt(W / 2, H / 2, 0.7)}
      aria-label={$t("space.zoomIn")}><Icon name="plus" /></button
    >
    <button
      on:click={() => zoomAt(W / 2, H / 2, 1 / 0.7)}
      aria-label={$t("space.zoomOut")}><Icon name="minus" /></button
    >
    <button on:click={reset} aria-label={$t("space.reset")}
      ><Icon name="refresh" /></button
    >
  </div>
</div>

<style>
  .space {
    position: relative;
    height: min(68vh, 34rem);
    min-height: 320px;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: calc(var(--radius) - 4px);
    /* Every gesture on it is the drawing's: the page scrolls beside it. */
    touch-action: none;
    cursor: grab;
    outline-offset: 2px;
  }
  canvas.over {
    cursor: pointer;
  }
  canvas.dragging {
    cursor: grabbing;
  }
  .tools {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tools button {
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--card) 88%, transparent);
    border: 1px solid var(--line);
    color: var(--ink-soft);
    font-size: 1.15rem;
    box-shadow: var(--shadow-soft);
  }
</style>
