// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A person's hubs, on every device: the dock is per device (localStorage),
// so a key user signing in on another screen would start from an empty sky.
// With a session key up, every board shown is also remembered in the
// person's OWN holon (`<pubkey>/holons`, @holons/core/holons), where only
// their key writes — and on key login the list is folded into the dock.

import { get } from "svelte/store";
import { myHolons, rememberHolon } from "@holons/core/holons";
import { getHolosphere } from "./holosphere";
import { dockEntries, rememberBoard } from "./dock";
import { sessionKeyPub } from "./sessionKey";

/** Remember `id` in the signed-in person's own list (a no-op without a session key). */
export async function recordMyHub(id: string, name = ""): Promise<void> {
  const person = get(sessionKeyPub);
  if (!person || !id || id === person) return;
  try {
    const hs = await getHolosphere();
    await rememberHolon(hs, person, { id, name });
  } catch (err) {
    console.warn("[kiosk] could not remember the hub in your holon", err);
  }
}

/** Fold the person's remembered hubs into this device's dock. */
export async function loadMyHubs(): Promise<number> {
  const person = get(sessionKeyPub);
  if (!person) return 0;
  try {
    const hs = await getHolosphere();
    const mine = await myHolons(hs, person);
    const docked = new Set(get(dockEntries).map((e) => e.id));
    let added = 0;
    for (const h of mine) {
      if (docked.has(h.id)) continue;
      rememberBoard(h.id, h.name ?? "");
      added += 1;
    }
    return added;
  } catch (err) {
    console.warn("[kiosk] could not read your hubs", err);
    return 0;
  }
}
