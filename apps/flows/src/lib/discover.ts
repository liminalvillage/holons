// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Finding pots the map does not reach yet: one someone just started, that
// nobody has seated. Every pot started here is written into the global
// registry (core `startHolon` → `registerHolon`); this searches it by name.

import { searchHolons, type HolonSearchHit } from "@holons/core/holosphere";
import { getHolosphere } from "./holosphere";

/** Pots on the network matching `query` by name or id. Quiet: none when unreadable. */
export async function findPots(
  query: string,
  limit = 20,
): Promise<HolonSearchHit[]> {
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];
  try {
    const hits = await searchHolons(await getHolosphere(), q, limit);
    // A bare key is a person, not a pot: people are found on the map.
    return hits.filter((h) => h.type !== "personal");
  } catch {
    return [];
  }
}

/**
 * `findPots`, for a field typed into: only the last query's answer lands.
 * Returns the function to call on each keystroke.
 */
export function potFinder(
  onHits: (hits: HolonSearchHit[]) => void,
  waitMs = 250,
): (query: string) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let asked = 0;
  return (query: string) => {
    if (timer) clearTimeout(timer);
    const ask = ++asked;
    if (String(query ?? "").trim().length < 2) {
      onHits([]);
      return;
    }
    timer = setTimeout(async () => {
      const hits = await findPots(query);
      if (ask === asked) onHits(hits);
    }, waitMs);
  };
}
