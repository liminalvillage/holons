// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One-shot kiosk auto-scroll: smoothly glide a scroll container down to its
// bottom once, then stop. Built for unattended displays where nobody is around
// to drag the wall/timeline — so the whole list is shown before it rests.
//
// Any user interaction (wheel, touch, pointer, keydown) cancels the glide so a
// passer-by who grabs the screen keeps control. The returned function also
// cancels, for component teardown.

const STEP_PX_PER_SEC = 60; // gentle, readable pace

export function autoScrollToEnd(
  el: HTMLElement,
  opts: { startDelayMs?: number } = {},
): () => void {
  if (typeof window === "undefined") return () => {};

  let raf = 0;
  let timer = 0;
  let cancelled = false;
  let last = 0;

  const cancel = () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    detach();
  };

  // Programmatic scrolls mustn't cancel us; only genuine input does.
  const onInput = () => cancel();
  const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  const attach = () =>
    events.forEach((e) => el.addEventListener(e, onInput, { passive: true }));
  const detach = () =>
    events.forEach((e) => el.removeEventListener(e, onInput));

  const tick = (ts: number) => {
    if (cancelled) return;
    if (!last) last = ts;
    const dt = (ts - last) / 1000;
    last = ts;

    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0 || el.scrollTop >= max - 1) {
      cancel();
      return;
    }
    el.scrollTop = Math.min(max, el.scrollTop + STEP_PX_PER_SEC * dt);
    raf = requestAnimationFrame(tick);
  };

  attach();
  timer = window.setTimeout(() => {
    if (cancelled) return;
    raf = requestAnimationFrame(tick);
  }, opts.startDelayMs ?? 1200);

  return cancel;
}
