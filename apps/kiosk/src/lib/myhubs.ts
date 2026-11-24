// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A person's hubs, on every device: the dock is per device (localStorage),
// so a key user signing in on another screen would start from an empty sky.
// With a session key up, every board shown is also remembered in the
// person's OWN holon (`<pubkey>/holons`, @holons/core/holons), where only
// their key writes — and on key login the list is folded into the dock,
// minus the hubs this device removed (dock.ts `isForgotten`).

import { get } from "svelte/store";
import { myHolons, rememberHolon } from "@holons/core/holons";
import { getHolosphere } from "./holosphere";
import { dockEntries, isForgotten, rememberBoard } from "./dock";
import { sessionKeyPub } from "./sessionKey";
import { isShortName, resolveNames } from "./names";

/**
 * The name to keep for `id`: what the name resolver learned, when it learned
 * anything — the label the caller holds may be a stale one (a federation
 * partner's old label docked with the retinue), and this is written to the
 * relays. Falls back to `given` while the resolver knows nothing.
 */
export async function nameToKeep(
  id: string,
  given: string,
  resolve: (id: string) => Promise<string | undefined> = resolvedName,
): Promise<string> {
  try {
    const learned = await resolve(id);
    if (learned && !isShortName(learned, id)) return learned;
  } catch {
    /* resolver offline — keep what the caller had */
  }
  return given;
}

async function resolvedName(id: string): Promise<string | undefined> {
  return (await resolveNames([id])).get(id);
}

/** Remember `id` in the signed-in person's own list (a no-op without a session key). */
export async function recordMyHub(id: string, name = ""): Promise<void> {
  const person = get(sessionKeyPub);
  if (!person || !id || id === person) return;
  try {
    const hs = await getHolosphere();
    const keep = await nameToKeep(id, name);
    await rememberHolon(hs, person, { id, name: keep });
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
      if (docked.has(h.id) || isForgotten(h.id)) continue;
      rememberBoard(h.id, h.name ?? "");
      added += 1;
    }
    return added;
  } catch (err) {
    console.warn("[kiosk] could not read your hubs", err);
    return 0;
  }
}
