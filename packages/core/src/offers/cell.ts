// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading a scale. A hex cell carries holograms of every offer and need
 * published under it, and — because publishing upcasts — everything under
 * its children too. So the market at any zoom is one read per lens, deduped.
 */

import type { HoloSphere } from 'holosphere';
import { cellToParent, getResolution, isValidCell } from 'h3-js';
import { NEEDS_LENS, OPEN_NEED_STATUSES, type PublishedNeed } from '../needs/types.js';
import { normalizeNeed } from '../needs/transform.js';
import { holonOf } from './supply.js';
import { dedupeMarket } from './match.js';
import { normalizeOffer } from './transform.js';
import { OFFERS_LENS, OPEN_OFFER_STATUSES, type OfferRecord } from './types.js';

export interface CellMarket {
  cell: string;
  offers: OfferRecord[];
  needs: PublishedNeed[];
  /** The holons with something on this market. */
  holons: string[];
}

export interface ReadCellMarketOptions {
  /** Keep fulfilled / withdrawn / expired offers and closed needs. Default false. */
  includeClosed?: boolean;
  now?: number;
}

/** The market under a cell. Read errors are swallowed into an empty side. */
export async function readCellMarket(
  holosphere: HoloSphere,
  cell: string,
  opts: ReadCellMarketOptions = {},
): Promise<CellMarket> {
  const now = opts.now ?? Date.now();
  const read = async (lens: string): Promise<unknown[]> => {
    try {
      const all = await (holosphere as any).getAll(cell, lens);
      return Array.isArray(all) ? all : [];
    } catch {
      return [];
    }
  };
  const [rawOffers, rawNeeds] = await Promise.all([read(OFFERS_LENS), read(NEEDS_LENS)]);
  const holons = new Set<string>();

  const offers: OfferRecord[] = [];
  for (const rec of dedupeMarket(rawOffers)) {
    const o = normalizeOffer(rec, now);
    if (!o) continue;
    if (!opts.includeClosed && !OPEN_OFFER_STATUSES.includes(o.status)) continue;
    holons.add(holonOf(rec, cell));
    offers.push(o);
  }
  const needs: PublishedNeed[] = [];
  for (const rec of dedupeMarket(rawNeeds)) {
    const n = normalizeNeed(rec);
    if (!n) continue;
    if (!opts.includeClosed && !OPEN_NEED_STATUSES.includes(n.status)) continue;
    holons.add(holonOf(rec, cell));
    needs.push(n);
  }
  return { cell, offers, needs, holons: [...holons].sort() };
}

/** The cell and its ancestors, nearest first, up to `levels` parents (stops at res 0). */
export function scaleChain(homeCell: string, levels: number): string[] {
  if (!homeCell || !isValidCell(homeCell)) return [];
  const chain = [homeCell];
  let cur = homeCell;
  for (let i = 0; i < Math.max(0, levels); i++) {
    const res = getResolution(cur);
    if (res <= 0) break;
    cur = cellToParent(cur, res - 1);
    chain.push(cur);
  }
  return chain;
}

/** A short label for a cell on a scale control: its resolution and a prefix. */
export function cellLabel(cell: string): string {
  if (!cell || !isValidCell(cell)) return cell ?? '';
  return `res ${getResolution(cell)} · ${cell.slice(0, 6)}…`;
}
