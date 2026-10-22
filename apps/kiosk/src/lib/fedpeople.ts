// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The people of the holon's federation who are not its members, for the
// pickers that put someone on a card: the holon's own roster comes first, at
// once (`members.ts`); these are what "Search the federation…" looks
// through. Who counts is core's (`@holons/core/holons` loadFederationPeople:
// direct partners' `users`, linked keys folded, members left out). A roster
// per partner is a read per partner, so nothing is fetched until a search
// opens, and the answer is kept for the holon on screen for a few minutes.

import { get } from "svelte/store";
import {
  loadFederationPeople,
  type FederationPerson,
} from "@holons/core/holons";
import { holonId } from "$lib/stores";
import { getHolosphere } from "$lib/holosphere";
import { primeNames } from "$lib/names";

export type { FederationPerson };

const FRESH_MS = 5 * 60_000;
let cached: { holon: string; at: number; people: FederationPerson[] } | null =
  null;
let inflight: { holon: string; p: Promise<FederationPerson[]> } | null = null;

/** The federation's people for `hid` (defaults to the holon on screen). */
export async function loadFedPeople(hid?: string): Promise<FederationPerson[]> {
  const holon = hid ?? get(holonId);
  if (!holon) return [];
  if (cached?.holon === holon && Date.now() - cached.at < FRESH_MS)
    return cached.people;
  if (inflight?.holon === holon) return inflight.p;
  const p = (async () => {
    try {
      const hs = await getHolosphere();
      const people = await loadFederationPeople(hs, holon, {
        format: { lastName: "initial" },
      });
      primeNames(people.filter((x) => x.name).map((x) => [x.id, x.name]));
      cached = { holon, at: Date.now(), people };
      return people;
    } catch {
      return [];
    } finally {
      if (inflight?.holon === holon) inflight = null;
    }
  })();
  inflight = { holon, p };
  return p;
}
