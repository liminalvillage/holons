// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Offers as supply — the dual of `inventory/scarcity.ts`, which reads needs
 * as demand. Both are keyed by category, because that is the granularity a
 * surplus and a deficit can meet at; the item id refines when both name one.
 */

import { sourceHolonId, sourceRef } from '../holosphere/provenance.js';
import { remainingSupply } from './transform.js';
import type { OfferMode, OfferRecord } from './types.js';

export interface StockSupply {
  holonId: string;
  offerId: string;
  category: string;
  itemId?: string;
  /** Units still on the table (supply minus reservations). */
  quantity: number;
  unit: string;
  mode: OfferMode;
  hex?: string;
}

/** Offers still on the market. */
export const OFFER_SUPPLY_STATUSES: ReadonlySet<string> = new Set(['open', 'reserved']);

/**
 * The holon a record belongs to: a federated copy's origin, a hologram's
 * source (stamped, or parsed from its soul `<app>/<holon>/<lens>/<key>`),
 * the record's own `holonId` / `holon`, else the fallback (the holon it was
 * read from).
 */
export function holonOf(record: unknown, fallback: string): string {
  const stamped = sourceHolonId(record);
  if (stamped) return stamped;
  const r = record as { _hologram?: { soul?: unknown }; holonId?: unknown; holon?: unknown } | null;
  const soul = r?._hologram?.soul;
  if (typeof soul === 'string') {
    const parts = soul.split('/').filter(Boolean);
    if (parts.length >= 3) return parts[parts.length - 3];
  }
  // Quests stamp the holon they were created in as `holon` (createTask);
  // needs and offers built elsewhere may say `holonId`. Either is provenance
  // once the federation envelope is gone.
  if (r?.holonId != null && String(r.holonId)) return String(r.holonId);
  if (r?.holon != null && String(r.holon)) return String(r.holon);
  return fallback;
}

/**
 * Where a write to this record must land: its owner `{holon, key}` when it
 * is a foreign record seen from `localHolon`, else undefined (write it in
 * place). `sourceRef` for enveloped copies; the record's own holon stamp
 * when the envelope is gone.
 */
export function ownerRef(
  record: unknown,
  localHolon: string,
  localId: string,
): { holon: string; key: string } | undefined {
  const ref = sourceRef(record, localId);
  if (ref) return ref;
  const holon = holonOf(record, localHolon);
  return holon !== localHolon ? { holon, key: localId } : undefined;
}

/** Read one offer as supply at `holonId`. Null when closed, uncategorised, or spent. */
export function supplyOf(offer: OfferRecord, holonId: string): StockSupply | null {
  if (!offer || !OFFER_SUPPLY_STATUSES.has(String(offer.status ?? ''))) return null;
  const category = typeof offer.category === 'string' ? offer.category.trim() : '';
  if (!category) return null;
  const quantity = remainingSupply(offer);
  if (quantity <= 0) return null;
  return {
    holonId,
    offerId: String(offer.id),
    category,
    ...(offer.supply.itemId ? { itemId: offer.supply.itemId } : {}),
    quantity,
    unit: offer.supply.unit,
    mode: offer.mode,
    ...(offer.hex ? { hex: offer.hex } : {}),
  };
}

export function suppliesOf(offers: OfferRecord[], holonId: string): StockSupply[] {
  const out: StockSupply[] = [];
  for (const o of offers ?? []) {
    const s = supplyOf(o, holonId);
    if (s) out.push(s);
  }
  return out;
}
