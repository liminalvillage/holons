// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

// The kiosk never zooms as a page. The viewport meta says
// `user-scalable=no`, but iOS Safari has ignored that since iOS 10, and a
// trackpad pinch on a desktop browser arrives as ctrl+wheel and scales the
// whole page. This covers each path a pinch can take to page zoom:
//
//   - iOS/iPadOS: the proprietary `gesture*` events, plus any multi-finger
//     `touchmove` (the pinch itself);
//   - trackpads: ctrl+wheel.
//
// Only the browser's default is cancelled. Views that zoom their own
// content (the year timeline, the task graph) read pointer and wheel events
// that still reach them, so their pinch keeps working. Kept as a pure
// decision so it has a test.

/** Is this event the browser about to zoom the page? */
export function isPageZoom(e: {
  type: string;
  ctrlKey?: boolean;
  touches?: { length: number };
}): boolean {
  if (e.type.startsWith("gesture")) return true;
  if (e.type === "touchmove") return (e.touches?.length ?? 0) > 1;
  if (e.type === "wheel") return !!e.ctrlKey;
  return false;
}

const EVENTS = [
  "gesturestart",
  "gesturechange",
  "gestureend",
  "touchmove",
  "wheel",
] as const;

/** Cancel page zoom on `target`; returns the teardown. */
export function lockPageZoom(target: EventTarget): () => void {
  const handler = (e: Event) => {
    if (isPageZoom(e as Event & { ctrlKey?: boolean })) e.preventDefault();
  };
  // Non-passive, or preventDefault is ignored on touchmove/wheel.
  const opts: AddEventListenerOptions = { passive: false };
  for (const type of EVENTS) target.addEventListener(type, handler, opts);
  return () => {
    for (const type of EVENTS) target.removeEventListener(type, handler, opts);
  };
}
