// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Offers: resources a holon puts on the table, the supply side of the needs
 * network. An offer is a Quest of `type: 'offer'` on the `quests` lens (the
 * shape every UI, the Telegram bot and the NIP-99 projection already read)
 * with a lifecycle, a quantity and a category attached, so the transport
 * plan in `@holons/core/inventory` can match it to needs the way it moves
 * stock between shelves: offers are supply, needs are demand, and the LP
 * decides who serves whom at the least cost.
 */

import type { Quest } from '../tasks/types.js';

/** Where the canonical offer record lives (shared with tasks and needs). */
export const OFFER_RECORD_LENS = 'quests' as const;

/** The hex-cell projection layer: holograms of offers, lit on the map. */
export const OFFERS_LENS = 'offers' as const;

/** open → reserved → fulfilled, or withdrawn / expired out of the market. */
export type OfferStatus = 'open' | 'reserved' | 'fulfilled' | 'withdrawn' | 'expired';

export const OFFER_STATUSES: readonly OfferStatus[] = [
  'open',
  'reserved',
  'fulfilled',
  'withdrawn',
  'expired',
];

/** Still on the market: can take a reservation. */
export const OPEN_OFFER_STATUSES: readonly OfferStatus[] = ['open', 'reserved'];

/** How the resource changes hands. */
export type OfferMode = 'give' | 'lend' | 'sell';

/** The dual of `PublishedNeed.stock`: how much, in what unit, of which item. */
export interface OfferSupply {
  /** The stock item this offer draws on, when it is on a shelf. */
  itemId?: string;
  quantity: number;
  unit: string;
}

/** Where the offer came from, for provenance badges and settlement. */
export type OfferSource =
  | { kind: 'stock'; itemId: string }
  | { kind: 'minted'; needId: string; holonId: string; at?: number }
  | { kind: 'library'; itemId: string };

/**
 * A slice of the offer promised to one need. Created when a match is
 * accepted (`acceptMatch`), settled when the need's handoff completes,
 * released when it is cancelled.
 */
export interface OfferReservation {
  id: string;
  needId: string;
  needHolonId: string;
  responseId: string;
  quantity: number;
  /** ISO timestamps. */
  createdAt: string;
  settledAt?: string;
  releasedAt?: string;
}

export interface OfferRecord extends Quest {
  type: 'offer';
  status: OfferStatus;
  category?: string;
  supply: OfferSupply;
  mode: OfferMode;
  price?: number;
  currency?: string;
  /** H3 cell this offer was published to, when shared on the public map. */
  hex?: string;
  source?: OfferSource;
  reservations: OfferReservation[];
  /** Publication stamp — which targets this offer has been shared with. */
  published?: { at: number; toHex?: string; toPartners?: boolean };
  /** Expiry as ms since epoch (Murmurations field, shared with needs). */
  expires_at?: number;
  withdrawnAt?: string;
  fulfilledAt?: string;
}

/** Type guard: an offer in the offers-network sense (normalised or native). */
export function isOfferRecord(item: unknown): item is OfferRecord {
  if (!item || typeof item !== 'object') return false;
  const d = item as Record<string, unknown>;
  return d.type === 'offer' && typeof d.status === 'string' && !!d.supply && Array.isArray(d.reservations);
}
