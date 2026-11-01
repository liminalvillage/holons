// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Zoom and pan for an SVG drawing that lives in a 0..size square — the
// year dial and the orbits — shown in a viewport of ANY shape: the board's
// whole area. Unzoomed, the square is fitted (whole) into the viewport and
// the spare width or height is just room; zoomed in, the viewport's full
// rectangle shows the drawing. The drawing never changes; only the viewBox
// does, so everything under it (hit-testing included, via `toSvg`) keeps
// working in drawing units.
//
// Gestures match the year line's: pinch or Ctrl/⌘-scroll zooms around the
// fingers/cursor, a drag pans once zoomed in (scrolling too), and the click
// that ends a pan or pinch is swallowed so it doesn't also tap what's under
// it. A mouse press on a card stops propagation (the board's drag), so a
// card never pans the view out from under itself.

import { writable, get, type Readable } from "svelte/store";

export interface SvgView {
  x: number;
  y: number;
  /** Visible width and height, in drawing units. */
  w: number;
  h: number;
  /** 1 = the whole drawing fitted. */
  zoom: number;
  /** The viewBox attribute. */
  box: string;
}

export interface SvgZoom {
  view: Readable<SvgView>;
  /** Svelte action: wire the gestures onto the <svg>. */
  attach: (node: SVGSVGElement) => { destroy: () => void };
  /** The viewport's width/height ratio (call on resize). */
  setAspect: (aspect: number) => void;
  /** Zoom by `factor` around the drawing point (cx, cy), the centre by default. */
  zoomBy: (factor: number, cx?: number, cy?: number) => void;
  reset: () => void;
  /** A screen point in drawing units, or null before the svg is laid out. */
  toSvg: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** A pan or pinch is under way (hover readouts should yield). */
  busy: Readable<boolean>;
}

const DRAG_SLOP_PX = 6;

export function createSvgZoom(size = 1000, maxZoom = 8): SvgZoom {
  const busy = writable(false);
  let node: SVGSVGElement | null = null;
  let aspect = 1;
  let zoom = 1;
  let cx = size / 2;
  let cy = size / 2;

  const build = (): SvgView => {
    // The fitted (zoom 1) viewport: the square plus the spare room.
    const baseW = aspect >= 1 ? size * aspect : size;
    const baseH = aspect >= 1 ? size : size / aspect;
    const w = baseW / zoom;
    const h = baseH / zoom;
    // Pan only within the drawing; along an axis the viewport still
    // overflows, the drawing stays centred.
    cx = w >= size ? size / 2 : Math.min(size - w / 2, Math.max(w / 2, cx));
    cy = h >= size ? size / 2 : Math.min(size - h / 2, Math.max(h / 2, cy));
    const x = cx - w / 2;
    const y = cy - h / 2;
    return { x, y, w, h, zoom, box: `${x} ${y} ${w} ${h}` };
  };
  const view = writable<SvgView>(build());
  const publish = () => view.set(build());

  function setAspect(a: number) {
    if (!isFinite(a) || a <= 0 || Math.abs(a - aspect) < 1e-4) return;
    aspect = a;
    publish();
  }
  function setCentre(x: number, y: number) {
    cx = x;
    cy = y;
    publish();
  }
  function zoomBy(factor: number, px?: number, py?: number) {
    const next = Math.min(maxZoom, Math.max(1, zoom * factor));
    const k = zoom / next;
    const ax = px ?? cx;
    const ay = py ?? cy;
    // Keep the drawing point under the cursor/fingers still.
    cx = ax + (cx - ax) * k;
    cy = ay + (cy - ay) * k;
    zoom = next;
    publish();
  }
  function reset() {
    zoom = 1;
    setCentre(size / 2, size / 2);
  }
  function toSvg(clientX: number, clientY: number) {
    const ctm = node?.getScreenCTM();
    if (!node || !ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }
  /** Drawing units per screen px. */
  function unit(): number {
    const w = node?.getBoundingClientRect().width || 1;
    return get(view).w / w;
  }

  function attach(svg: SVGSVGElement) {
    node = svg;
    const pointers = new Map<number, { x: number; y: number }>();
    type Pan = {
      kind: "pan";
      id: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      active: boolean;
    };
    type Pinch = { kind: "pinch"; dist: number; zoom: number };
    let gesture: Pan | Pinch | null = null;
    let dragged = false;

    const pinch = () => {
      const [a, b] = Array.from(pointers.values());
      return {
        dist: Math.max(24, Math.hypot(a.x - b.x, a.y - b.y)),
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
      };
    };
    const capture = (id: number) => {
      try {
        svg.setPointerCapture(id);
      } catch {
        /* pointer already gone */
      }
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragged = false;
        gesture = {
          kind: "pan",
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          vx: cx,
          vy: cy,
          active: false,
        };
      } else if (pointers.size === 2) {
        gesture = { kind: "pinch", dist: pinch().dist, zoom };
        dragged = true;
        busy.set(true);
        for (const id of pointers.keys()) capture(id);
      }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture?.kind === "pinch" && pointers.size >= 2) {
        const { dist, mx, my } = pinch();
        const at = toSvg(mx, my);
        const target = gesture.zoom * (dist / gesture.dist);
        if (at) zoomBy(target / zoom, at.x, at.y);
        return;
      }
      if (gesture?.kind === "pan" && gesture.id === e.pointerId) {
        if (zoom <= 1.001) return; // nothing to pan: let the page scroll
        const dx = e.clientX - gesture.x;
        const dy = e.clientY - gesture.y;
        if (!gesture.active && Math.hypot(dx, dy) > DRAG_SLOP_PX) {
          gesture.active = true;
          dragged = true;
          busy.set(true);
          capture(e.pointerId);
        }
        if (gesture.active) {
          const u = unit();
          setCentre(gesture.vx - dx * u, gesture.vy - dy * u);
        }
      }
    };
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (gesture?.kind === "pinch" && pointers.size === 1) {
        // Lifting one finger of a pinch carries on as a pan with the other.
        const [[id, p]] = Array.from(pointers.entries());
        gesture = {
          kind: "pan",
          id,
          x: p.x,
          y: p.y,
          vx: cx,
          vy: cy,
          active: true,
        };
      } else if (pointers.size === 0) {
        gesture = null;
        busy.set(false);
      }
    };
    const click = (e: MouseEvent) => {
      if (!dragged) return;
      dragged = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    const wheel = (e: WheelEvent) => {
      const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const at = toSvg(e.clientX, e.clientY);
        // One notch of a mouse wheel is ~100px of delta; a trackpad pinch
        // sends many small ones. Cap each step so a wheel doesn't leap.
        const f = Math.exp(-e.deltaY * px * 0.01);
        zoomBy(Math.min(1.25, Math.max(0.8, f)), at?.x, at?.y);
        return;
      }
      if (zoom > 1.001) {
        e.preventDefault();
        const u = unit();
        setCentre(cx + e.deltaX * px * u, cy + e.deltaY * px * u);
      }
    };

    svg.addEventListener("pointerdown", down);
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("click", click, true);
    svg.addEventListener("wheel", wheel, { passive: false });
    return {
      destroy() {
        svg.removeEventListener("pointerdown", down);
        svg.removeEventListener("pointermove", move);
        svg.removeEventListener("pointerup", end);
        svg.removeEventListener("pointercancel", end);
        svg.removeEventListener("click", click, true);
        svg.removeEventListener("wheel", wheel);
        if (node === svg) node = null;
      },
    };
  }

  return { view, attach, setAspect, zoomBy, reset, toSvg, busy };
}
