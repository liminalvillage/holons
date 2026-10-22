// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The hub half of the map's search box (places are lib/placesearch): the
// index behind it is the hubs already on this dock, this deploy's registered
// labels (hubs.json) and the global holon registry (`holons_registry`,
// @holons/core/holosphere), with a pasted id, npub, address or link accepted
// outright. This module is the pure part — what a query matches and in what
// order — so the box itself only renders.

import type { HolonSearchHit } from "@holons/core/holosphere";
import { labelFor } from "./dock";
import { parseHolonPaste, SUBDOMAIN_HOLONS } from "./holons";

/** A row in the search box: a hub, and whether it is already on the dock. */
export type HubHit = HolonSearchHit & { docked: boolean };

/** A hub on the dock, as far as the search cares: its id and its name. */
export type DockedHub = { id: string; name: string };

/**
 * The registered labels a query matches (`lim` → Liminal), as hits, named
 * by the label that matched. A label is this deploy's own name for a hub,
 * so it ranks above the registry's; a hub with two labels lists once.
 */
export function searchLabels(
  query: string,
  labels: Record<string, string> = SUBDOMAIN_HOLONS,
): HolonSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  return Object.entries(labels)
    .filter(([label, id]) => label.includes(q) || id === q)
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, id]) => !seen.has(id) && seen.add(id))
    .map(([label, id]) => ({
      id,
      name: label.charAt(0).toUpperCase() + label.slice(1),
      type: "community",
    }));
}

/**
 * The hubs already on the dock that a query names, in name order. The dock
 * knows hubs no index does — one made on this kiosk, or docked from a link —
 * so searching for a hub that is right there on the map must find it.
 */
export function searchDocked(
  query: string,
  docked: readonly DockedHub[],
): HolonSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return docked
    .filter((e) => e.name.toLowerCase().includes(q) || e.id === q)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ id: e.id, name: e.name, type: "community" }));
}

/**
 * Something pasted whole — an id, an npub, an address, a link — is a hub
 * even when no index knows it yet.
 */
export function pastedHit(query: string): HolonSearchHit | null {
  const id = parseHolonPaste(query);
  return id ? { id, name: labelFor(id), type: "community" } : null;
}

/**
 * One list for the box: the pasted id first, then the docked hubs the query
 * names, then label matches, then the registry's, deduplicated by id and
 * capped. Every row keeps the name the query matched — a hub found by its
 * label is listed by that label even when its orb wears another name — and
 * a registry name that is only the id's placeholder gives way to the label
 * when both name the same hub. Each row says whether the hub is docked
 * already, so picking it can fly to it instead of adding it twice.
 */
export function mergeHits(
  query: string,
  registry: readonly HolonSearchHit[],
  docked: readonly DockedHub[],
  limit = 8,
  labels: Record<string, string> = SUBDOMAIN_HOLONS,
): HubHit[] {
  const out: HubHit[] = [];
  const seen = new Set<string>();
  const onDock = new Set(docked.map((e) => e.id));
  const push = (h: HolonSearchHit) => {
    if (!h.id || seen.has(h.id)) return;
    seen.add(h.id);
    out.push({ ...h, docked: onDock.has(h.id) });
  };
  const pasted = pastedHit(query);
  if (pasted) push(pasted);
  for (const h of searchDocked(query, docked)) push(h);
  for (const h of searchLabels(query, labels)) push(h);
  for (const h of registry) push(h);
  return out.slice(0, limit);
}
