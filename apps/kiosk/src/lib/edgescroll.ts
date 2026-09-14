// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Edge auto-scroll for drags: while a dragged card hovers near the top or
// bottom edge of the scroll container under the pointer, glide that container
// in that direction — faster the closer to the edge. A still pointer keeps it
// gliding (a rAF loop, not the move events), so a card can be carried to a day
// or hour that starts out of view. When the chosen container can't move any
// further that way, the next scrollable ancestor takes over.

/** Height of the active band at each edge (shrinks for short containers). */
export const EDGE_PX = 56;
/** Glide speed at the very edge. */
export const MAX_PX_PER_SEC = 900;

/**
 * Vertical glide speed (px/s, negative = up) for a pointer at `y` over a
 * container visible between `top` and `bottom`. Zero outside the edge bands
 * and outside the container.
 */
export function edgeSpeed(
  y: number,
  top: number,
  bottom: number,
  edge = EDGE_PX,
  max = MAX_PX_PER_SEC,
): number {
  if (!(bottom > top) || y < top || y > bottom) return 0;
  const band = Math.min(edge, (bottom - top) / 3);
  if (band <= 0) return 0;
  const depth = (d: number) => max * Math.max(0.15, Math.min(1, d / band)) ** 2;
  if (y < top + band) return -depth(top + band - y);
  if (y > bottom - band) return depth(y - (bottom - band));
  return 0;
}

function isScrollable(el: Element): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  if (el === document.scrollingElement) return true;
  const oy = getComputedStyle(el).overflowY;
  return oy === "auto" || oy === "scroll" || oy === "overlay";
}

/** The scroller under (x, y) that would actually move, and how fast. */
function pick(x: number, y: number): { el: Element; speed: number } | null {
  let el: Element | null = document.elementFromPoint(x, y);
  const root = document.scrollingElement;
  for (; el; el = el.parentElement) {
    if (!isScrollable(el)) continue;
    const r =
      el === root
        ? { top: 0, bottom: window.innerHeight }
        : el.getBoundingClientRect();
    const speed = edgeSpeed(
      y,
      Math.max(0, r.top),
      Math.min(window.innerHeight, r.bottom),
    );
    if (speed < 0 && el.scrollTop > 0) return { el, speed };
    if (speed > 0 && el.scrollTop < el.scrollHeight - el.clientHeight - 1)
      return { el, speed };
  }
  return null;
}

export function createEdgeScroll(opts: { onScroll?: () => void } = {}) {
  let x = 0;
  let y = 0;
  let raf = 0;
  let last = 0;

  const tick = (ts: number) => {
    const hit = pick(x, y);
    if (!hit) {
      raf = 0;
      last = 0;
      return;
    }
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 1 / 60;
    last = ts;
    const before = hit.el.scrollTop;
    hit.el.scrollTop = before + hit.speed * dt;
    if (hit.el.scrollTop !== before) opts.onScroll?.();
    raf = requestAnimationFrame(tick);
  };

  return {
    /** Report the pointer; starts the glide when it's in an edge band. */
    move(px: number, py: number) {
      x = px;
      y = py;
      if (!raf && typeof window !== "undefined")
        raf = requestAnimationFrame(tick);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    },
  };
}
