// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Gestures for the flow calendar: pinch, wheel and drag drive a camera
// `{ z, t0 }` (see `flowgeom`) instead of a viewBox. The drawing re-lays
// itself out for every camera, so chips and text keep one size on screen at
// every depth; the `<svg>` keeps its fixed viewBox. The gesture skeleton is
// the year dial's (`svgzoom.ts`): pinch distance floored so a close pinch
// can't explode, a drag only after a few px of slop, pointer capture once a
// gesture is on, and the click that ends a drag swallowed so it never also
// taps what's underneath. The camera publishes at most once per frame.
//
// Zooming IN on a ring dives into what is under the fingers: the instant
// there becomes the focus, once per gesture (a pinch, or a burst of wheel
// notches), so the moon you pinch is the moon that grows. Zooming out keeps
// the focus. Dragging turns the ring under the finger — its hand follows.

import { writable, get, type Readable } from "svelte/store";
import { cubicOut } from "svelte/easing";
import type { FlowCamera } from "./flowgeom";

export interface FlowZoom {
  camera: Readable<FlowCamera>;
  /** A pan or pinch is under way. */
  busy: Readable<boolean>;
  /** Svelte action: wire the gestures onto the <svg>. */
  attach: (svg: SVGSVGElement) => { destroy: () => void };
  /** Zoom by `dz` (log2 days; negative = deeper), diving on `anchor` when deeper. */
  zoomBy: (dz: number, anchor?: { x: number; y: number }) => void;
  /** Move the focus by `dtMs`. */
  panBy: (dtMs: number) => void;
  /** Ease the camera to `to` over `ms`. */
  flyTo: (to: FlowCamera, ms?: number) => void;
  set: (cam: FlowCamera) => void;
  /** A screen point in drawing units, or null before layout. */
  toSvg: (clientX: number, clientY: number) => { x: number; y: number } | null;
}

export interface FlowZoomOptions {
  initial: FlowCamera;
  zMin: number;
  zMax: number;
  /** The instant drawn at a drawing point, or null off every ring. */
  instantAt: (x: number, y: number, cam: FlowCamera) => number | null;
  /** The time shift a pointer move from→to (drawing units) means. */
  dragDt: (
    from: { x: number; y: number },
    to: { x: number; y: number },
    cam: FlowCamera,
  ) => number;
  /** Injectable frame scheduler and clock (tests). */
  raf?: (cb: (now: number) => void) => number;
  now?: () => number;
}

const DRAG_SLOP_PX = 6;
/** The most one wheel event may zoom (log2), a mouse notch being ~100px. */
const WHEEL_DZ_MAX = 0.32;
/** The most one frame may zoom, so a fast pinch can't overshoot a level. */
const FRAME_DZ_MAX = 0.25;
/** Wheel notches closer than this are one gesture (one dive). */
const BURST_MS = 400;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** A wheel delta as a zoom step: positive deltaY (scroll down) zooms out. */
export function wheelDz(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
  return clamp(deltaY * px * 0.0035, -WHEEL_DZ_MAX, WHEEL_DZ_MAX);
}

/**
 * Where a zoom-in lands: the instant under the anchor becomes the focus
 * (null anchor or empty space keeps it); the zoom itself is clamped.
 */
export function dive(
  cam: FlowCamera,
  dz: number,
  anchor: { x: number; y: number } | undefined,
  bounds: { zMin: number; zMax: number },
  instantAt: (x: number, y: number, cam: FlowCamera) => number | null,
): FlowCamera {
  const z = clamp(cam.z + dz, bounds.zMin, bounds.zMax);
  if (dz >= 0 || !anchor) return { z, t0: cam.t0 };
  const t = instantAt(anchor.x, anchor.y, cam);
  return { z, t0: t ?? cam.t0 };
}

export function createFlowZoom(opts: FlowZoomOptions): FlowZoom {
  const raf =
    opts.raf ??
    ((cb: (now: number) => void) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(cb)
        : (setTimeout(() => cb(Date.now()), 16) as unknown as number));
  const clock =
    opts.now ??
    (() =>
      typeof performance !== "undefined" ? performance.now() : Date.now());
  const bounds = { zMin: opts.zMin, zMax: opts.zMax };
  const camera = writable<FlowCamera>({ ...opts.initial });
  const busy = writable(false);
  let cam: FlowCamera = { ...opts.initial };
  let node: SVGSVGElement | null = null;
  let flight: number | null = null;
  let flightSeq = 0;

  // Publish once per frame: gestures write `cam`, the store follows.
  let dirty = false;
  const publish = () => {
    if (dirty) return;
    dirty = true;
    raf(() => {
      dirty = false;
      camera.set({ ...cam });
    });
  };
  const set = (next: FlowCamera) => {
    cam = { z: clamp(next.z, bounds.zMin, bounds.zMax), t0: next.t0 };
    publish();
  };
  const stopFlight = () => {
    flight = null;
  };

  // Zoom is coalesced per frame so a burst of wheel events (a trackpad
  // pinch) and a fast finger pinch both land at a bounded pace. The dive —
  // refocusing on what is under the anchor — happens once per burst.
  let pendingDz = 0;
  let zoomQueued = false;
  let lastZoomAt = -Infinity;
  const applyZoom = () => {
    zoomQueued = false;
    const dz = clamp(pendingDz, -FRAME_DZ_MAX, FRAME_DZ_MAX);
    pendingDz -= dz;
    cam = dive(cam, dz, undefined, bounds, opts.instantAt);
    publish();
    if (Math.abs(pendingDz) > 1e-4) {
      zoomQueued = true;
      raf(applyZoom);
    } else pendingDz = 0;
  };
  const zoomBy = (dz: number, anchor?: { x: number; y: number }) => {
    stopFlight();
    const t = clock();
    if (dz < 0 && anchor && t - lastZoomAt > BURST_MS) {
      const at = opts.instantAt(anchor.x, anchor.y, cam);
      if (at != null) cam = { z: cam.z, t0: at };
    }
    lastZoomAt = t;
    pendingDz += dz;
    if (!zoomQueued) {
      zoomQueued = true;
      raf(applyZoom);
    }
  };
  const panBy = (dtMs: number) => {
    stopFlight();
    cam = { z: cam.z, t0: cam.t0 + dtMs };
    publish();
  };
  const flyTo = (to: FlowCamera, ms = 520) => {
    const from = { ...cam };
    const target = { z: clamp(to.z, bounds.zMin, bounds.zMax), t0: to.t0 };
    const start = clock();
    const id = ++flightSeq;
    flight = id;
    const step = (t: number) => {
      if (flight !== id) return;
      const u = ms <= 0 ? 1 : clamp((t - start) / ms, 0, 1);
      const e = cubicOut(u);
      cam = {
        z: from.z + (target.z - from.z) * e,
        t0: from.t0 + (target.t0 - from.t0) * e,
      };
      publish();
      if (u < 1) raf(step);
      else flight = null;
    };
    raf(step);
  };

  function toSvg(clientX: number, clientY: number) {
    const ctm = node?.getScreenCTM();
    if (!node || !ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function attach(svg: SVGSVGElement) {
    node = svg;
    const pointers = new Map<number, { x: number; y: number }>();
    type Pan = {
      kind: "pan";
      id: number;
      x: number;
      y: number;
      t0: number;
      active: boolean;
    };
    type Pinch = { kind: "pinch"; dist: number; z: number };
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
          t0: cam.t0,
          active: false,
        };
      } else if (pointers.size === 2) {
        stopFlight();
        const { dist, mx, my } = pinch();
        // The pinch dives into what sits between the fingers.
        const at = toSvg(mx, my);
        const t = at ? opts.instantAt(at.x, at.y, cam) : null;
        if (t != null) cam = { z: cam.z, t0: t };
        gesture = { kind: "pinch", dist, z: cam.z };
        dragged = true;
        busy.set(true);
        for (const id of pointers.keys()) capture(id);
      }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture?.kind === "pinch" && pointers.size >= 2) {
        const { dist } = pinch();
        const target = gesture.z + Math.log2(gesture.dist / dist);
        const dz = clamp(target - cam.z, -FRAME_DZ_MAX, FRAME_DZ_MAX);
        cam = { z: clamp(cam.z + dz, bounds.zMin, bounds.zMax), t0: cam.t0 };
        publish();
        return;
      }
      if (gesture?.kind === "pan" && gesture.id === e.pointerId) {
        const dx = e.clientX - gesture.x;
        const dy = e.clientY - gesture.y;
        if (!gesture.active && Math.hypot(dx, dy) > DRAG_SLOP_PX) {
          gesture.active = true;
          dragged = true;
          busy.set(true);
          stopFlight();
          capture(e.pointerId);
        }
        if (gesture.active) {
          const from = toSvg(gesture.x, gesture.y);
          const to = toSvg(e.clientX, e.clientY);
          if (from && to) {
            const base = { z: cam.z, t0: gesture.t0 };
            cam = { z: cam.z, t0: gesture.t0 + opts.dragDt(from, to, base) };
            publish();
          }
        }
      }
    };
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (gesture?.kind === "pinch" && pointers.size === 1) {
        // Lifting one finger of a pinch carries on as a pan with the other.
        const [[id, p]] = Array.from(pointers.entries());
        gesture = { kind: "pan", id, x: p.x, y: p.y, t0: cam.t0, active: true };
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
      e.preventDefault();
      const at = toSvg(e.clientX, e.clientY);
      // Sideways (or shift+wheel) turns the ring; otherwise zoom — there
      // is no page under the flow to scroll.
      const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (sideways && at) {
        const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        const dpx = (e.shiftKey ? e.deltaY || e.deltaX : e.deltaX) * px;
        // Turn the ring under the cursor by the same arc a drag of `dpx` would.
        const ctm = svg.getScreenCTM();
        const unit = ctm ? 1 / ctm.a : 1;
        const ang = Math.atan2(at.x - 500, -(at.y - 500));
        const rr = Math.hypot(at.x - 500, at.y - 500) || 1;
        const da = (dpx * unit) / rr;
        const to = {
          x: 500 + rr * Math.sin(ang + da),
          y: 500 - rr * Math.cos(ang + da),
        };
        panBy(opts.dragDt(at, to, cam));
        return;
      }
      zoomBy(wheelDz(e.deltaY, e.deltaMode), at ?? undefined);
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

  return {
    camera: { subscribe: camera.subscribe },
    busy: { subscribe: busy.subscribe },
    attach,
    zoomBy,
    panBy,
    flyTo,
    set,
    toSvg,
  };
}

/** The current camera, for callers outside Svelte markup. */
export function readCamera(zoom: FlowZoom): FlowCamera {
  return get(zoom.camera);
}
