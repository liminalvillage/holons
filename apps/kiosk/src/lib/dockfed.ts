// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A hub brings its federation along. Docking a board (an add, a link opened,
// an orb tapped) also docks that holon's direct partners, each tagged `via`
// the hub that brought it in — so the constellation the dock draws is the
// real one, not only the hubs someone pasted by hand. Direct partners only:
// the dock is this device's view, not a crawl of the whole federation.
// Nothing here writes to the relays; the tags live in localStorage with the
// rest of the dock (dock.ts), and removing the hub can offer to take its
// retinue along (DockView).

import { get } from "svelte/store";
import { getFederationSnapshot } from "@holons/core/federation";
import { dockEntries, rememberBoard } from "./dock";
import { getHolosphere } from "./holosphere";

/** Hubs whose partners were already fetched this session — once is enough. */
const fetched = new Set<string>();

/**
 * Dock `id`'s federation partners that aren't on the dock yet, tagged with
 * `id`. Best-effort: offline, or a holon with no federation record, docks
 * nothing. Returns the ids it added.
 */
export async function dockPartnersOf(id: string): Promise<string[]> {
  if (!id || fetched.has(id)) return [];
  fetched.add(id);
  let federated: readonly string[] = [];
  let names: Record<string, string> = {};
  try {
    const hs = await getHolosphere();
    const snap = await getFederationSnapshot(hs, id);
    federated = snap.federated;
    names = snap.partnerNames;
  } catch {
    fetched.delete(id); // let a later open try again once the wire is back
    return [];
  }
  const here = new Set(get(dockEntries).map((e) => e.id));
  const added: string[] = [];
  for (const pid of federated) {
    if (!pid || pid === id || here.has(pid)) continue;
    rememberBoard(pid, names[pid] ?? "", { via: id });
    here.add(pid);
    added.push(pid);
  }
  return added;
}

/** Test/dev hook: forget which hubs were fetched (a fresh session). */
export function resetDockFed(): void {
  fetched.clear();
}
