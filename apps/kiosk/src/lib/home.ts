// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Getting back to the front door. Which holon a screen shows is decided in
// three places at once — a remembered id, the URL path, the host — so "show me
// the home page again" is not one switch to flip, and every caller that offers
// it (Settings, the user menu) must undo the same set.

import { goto } from "$app/navigation";
import { clearHolonId } from "./config";
import { holonId, settingsOpen, userMenuOpen } from "./stores";

/**
 * Unpin this screen and show the home page.
 *
 * Forgetting the remembered id is only half of it: a holon named by the PATH
 * (`/<id>`, which is how the home page's "open the board" field navigates)
 * outranks the stored one and would bring the board straight back on the next
 * load — so leave that URL behind too. A holon named by the HOST
 * (`<hub>.hubs.network`) is that address's whole point and is deliberately NOT
 * overridden; there, the home page lives at the bare domain.
 */
export async function showHomePage(): Promise<void> {
  clearHolonId();
  holonId.set(null);
  settingsOpen.set(false);
  userMenuOpen.set(false);
  if (typeof location !== "undefined" && location.pathname !== "/")
    await goto("/");
}
