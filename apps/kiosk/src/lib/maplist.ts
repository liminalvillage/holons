// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The map as a list: the hubs on the dock, and what the selected lens holds
// in the cells on screen. This module is the pure part — which rows there
// are and in what order — the map (DockMap) supplies the records it has
// heard and the list (MapList) only renders.

import { countsAsPresent, itemLabel, type LensId } from "./maplens";

/** A docked hub in the list: its name, and its cell when it has a place. */
export type HubRow = { id: string; name: string; hex: string | null };

/** One record of the selected lens, and the visible cell it was heard in. */
export type LensRow = {
  id: string;
  cell: string;
  label: string;
  item: Record<string, unknown>;
};

const byName = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * The dock's hubs in name order — a list is for finding one by name, and the
 * order the orbs were docked in means nothing to someone scanning it.
 */
export function hubRows(
  entries: readonly { id: string; name: string }[],
  hexOf: (id: string) => string | null | undefined,
): HubRow[] {
  return entries
    .map((e) => ({ id: e.id, name: e.name, hex: hexOf(e.id) || null }))
    .sort((a, b) => byName.compare(a.name, b.name));
}

/**
 * The selected lens's records in the cells on screen, in label order.
 *
 * Only `cells` count — the cells in view at the zoom's own resolution. The
 * map keeps what it heard in cells that have since scrolled away, or at a
 * zoom since left, and a record propagated up the grid is held once per
 * resolution: listing everything held would repeat it and show what is no
 * longer in view. The rule for what counts is the one that lights a cell
 * (`countsAsPresent`), so the list and the lit hexagons always agree.
 *
 * `total` is the count before the cap, so the list can say it was cut short.
 */
export function lensRows(
  lens: LensId,
  held: ReadonlyMap<string, ReadonlyMap<string, Record<string, unknown>>>,
  cells: Iterable<string>,
  limit = 200,
): { rows: LensRow[]; total: number } {
  const seen = new Set<string>();
  const rows: LensRow[] = [];
  for (const cell of cells) {
    const records = held.get(cell);
    if (!records) continue;
    for (const [id, item] of records) {
      if (seen.has(id) || !countsAsPresent(lens, item)) continue;
      seen.add(id);
      rows.push({ id, cell, label: itemLabel(item) || id, item });
    }
  }
  rows.sort((a, b) => byName.compare(a.label, b.label));
  return { rows: rows.slice(0, limit), total: rows.length };
}
