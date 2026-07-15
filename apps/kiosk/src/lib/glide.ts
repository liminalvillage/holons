// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Translate-only FLIP for keyed {#each} reorders (drop-in for svelte/animate's
// `flip`). Svelte's flip also animates SCALE from the measured rects — and a
// reorder interrupting an in-flight animation measures mid-transform rects,
// so cards visibly deform while the wall/list rearranges. Position is the only
// thing a reorder changes here; gliding it is enough.

import { cubicOut } from "svelte/easing";

export interface GlideParams {
  duration?: number;
  easing?: (t: number) => number;
}

export function glide(
  _node: Element,
  { from, to }: { from: DOMRect; to: DOMRect },
  params: GlideParams = {},
): {
  duration: number;
  easing: (t: number) => number;
  css: (t: number, u: number) => string;
} {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  return {
    duration: params.duration ?? 220,
    easing: params.easing ?? cubicOut,
    css: (_t, u) => `transform: translate(${u * dx}px, ${u * dy}px);`,
  };
}
