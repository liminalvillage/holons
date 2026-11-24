// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The star: the one holon this device opens by itself. Opening Holons with
// no holon in the address goes straight to the starred one; a direct link
// (`/<id>`, a hub's own address, `?holon=`) always wins for that visit and
// never moves the star. One star per device — starring another holon takes
// it from the last.

import { writable } from "svelte/store";
import { resolveStarredHolon, starHolon, unstarHolon } from "./config";

/** The starred holon's id, or null when nothing is starred. */
export const starredHolon = writable<string | null>(resolveStarredHolon());

/** Put the star on `id`, or take it off when it is already there. */
export function toggleStar(id: string): boolean {
  const on = resolveStarredHolon() !== id;
  if (on) starHolon(id);
  else unstarHolon();
  starredHolon.set(on ? id : null);
  return on;
}

/** Take the star off `id` if it is the starred one (its board was removed). */
export function dropStar(id: string | null): void {
  if (!id || resolveStarredHolon() !== id) return;
  unstarHolon();
  starredHolon.set(null);
}
