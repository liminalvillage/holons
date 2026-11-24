// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Letting go of the board on show. Which holon a screen shows is decided in
// three places at once — its star, the URL path, the host — so leaving
// one is not one switch to flip.

import { goto } from "$app/navigation";
import { get } from "svelte/store";
import { dropStar } from "./star";
import { holonId, settingsOpen, userMenuOpen } from "./stores";

/**
 * Let go of the displayed holon and fall back to the map (the dock).
 *
 * Dropping its star is only half of it: a holon named by the PATH
 * (`/<id>`) outranks the star and would bring the board straight back
 * on the next load — so leave that URL behind too. A holon named by the HOST
 * (`<hub>.hubs.network`) is that address's whole point and is deliberately NOT
 * overridden.
 */
export async function leaveBoard(): Promise<void> {
  // A removed board keeps no star, or the next bare visit would dock it
  // straight back. Another holon's star is not this one's to take.
  dropStar(get(holonId));
  holonId.set(null);
  settingsOpen.set(false);
  userMenuOpen.set(false);
  if (typeof location === "undefined") return;
  // A `?holon=` in the address names the holon on every load, so it has to
  // go the same way as the path.
  const named =
    location.pathname !== "/" ||
    new URLSearchParams(location.search).has("holon");
  if (named) await goto("/");
}
