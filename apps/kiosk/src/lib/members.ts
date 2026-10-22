// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The holon's member roster (`users` lens), read once per holon and cached,
// for anything that needs to name a person: the completion dialog's "add
// someone" list, and the voice agent resolving "add Marco" against real
// people. A cold lens read takes a moment, so the store fills asynchronously
// and `loadMembers` can be awaited where the list is needed right now.

import { get, writable } from "svelte/store";
import { holonId } from "$lib/stores";
import { getHolosphere } from "$lib/holosphere";

export type Member = {
  id: string | number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

/** The roster of the holon on screen; empty until loaded. */
export const members = writable<Member[]>([]);

let loadedFor: string | null = null;
let inflight: Promise<Member[]> | null = null;

/**
 * The roster of `hid` (defaults to the holon on screen). Cached per holon;
 * pass `force` to re-read (after a join, say).
 */
export async function loadMembers(
  hid?: string,
  force = false,
): Promise<Member[]> {
  const holon = hid ?? get(holonId);
  if (!holon) return [];
  if (!force && loadedFor === holon) return get(members);
  if (inflight && loadedFor === holon) return inflight;
  loadedFor = holon;
  inflight = (async () => {
    try {
      const hs = await getHolosphere();
      const all = await hs.getAll(holon, "users");
      const list = (Array.isArray(all) ? all : Object.values(all ?? {})).filter(
        (m) => m && (m as Member).id != null,
      ) as Member[];
      if (loadedFor === holon) members.set(list);
      return list;
    } catch {
      if (loadedFor === holon) members.set([]);
      return [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// A holon switch invalidates the roster.
holonId.subscribe((hid) => {
  if (hid !== loadedFor) {
    loadedFor = null;
    members.set([]);
  }
});
