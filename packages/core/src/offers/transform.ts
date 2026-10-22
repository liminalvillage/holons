// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Building and coercing offers. Pure; storage is the publisher's job.
 *
 * Every offer that already exists — the bot's `/offer`, the dashboard's old
 * board, the flywheel offer minted on a fulfilled need — is a bare market
 * quest with no status, quantity or reservations. `normalizeOffer` reads
 * them all as an open, one-unit offer so nothing needs migrating.
 */

import { createMarketItem } from '../tasks/marketplace.js';
import type { Quest, QuestInitiator } from '../tasks/types.js';
import type { StockItemSpec } from '../inventory/types.js';
import { VF_UNIT_ONE } from '../rea/valueflows.js';
import {
  OFFER_STATUSES,
  type OfferMode,
  type OfferRecord,
  type OfferReservation,
  type OfferSource,
  type OfferStatus,
  type OfferSupply,
} from './types.js';

export interface CreateOfferInput {
  holonId: string | number;
  initiator: QuestInitiator;
  title: string;
  description?: string;
  category?: string;
  supply: OfferSupply;
  mode?: OfferMode;
  price?: number;
  currency?: string;
  itemType?: 'good' | 'service';
  tags?: string[];
  /** Expiry as ms since epoch. */
  expiresAt?: number;
  hex?: string;
  source?: OfferSource;
  picture?: string | null;
  /** Override the generated id. */
  id?: string;
  /** Override the creation timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

/** Murmurations transaction type for a mode, so the 30402 projection keeps reading. */
const TRANSACTION_TYPE: Record<OfferMode, string> = {
  give: 'receive-donate',
  lend: 'borrow-lend',
  sell: 'buy-sell',
};

/** The mode a legacy `transaction_type` list implies; `give` when unsure. */
export function modeOf(transactionTypes: unknown): OfferMode {
  const list = Array.isArray(transactionTypes) ? transactionTypes.map(String) : [];
  if (list.includes('buy-sell') || list.includes('rent-lease')) return 'sell';
  if (list.includes('borrow-lend')) return 'lend';
  return 'give';
}

/** Build a fresh offer. The id is `offer-<now>-<rand>` unless given. */
export function createOffer(input: CreateOfferInput): OfferRecord {
  const now = input.now ?? Date.now();
  const mode: OfferMode = input.mode ?? 'give';
  const offer = createMarketItem({
    holonId: input.holonId,
    initiator: input.initiator,
    kind: 'offer',
    title: String(input.title ?? '').trim(),
    description: input.description,
    itemType: input.itemType ?? 'good',
    transactionTypes: [TRANSACTION_TYPE[mode]],
    tags: input.tags,
    expiresAt: input.expiresAt,
    category: input.category || undefined,
    picture: input.picture,
    now,
  }) as OfferRecord;
  offer.id = input.id ?? `offer-${now}-${Math.random().toString(36).slice(2, 8)}`;
  offer.status = 'open';
  offer.mode = mode;
  offer.supply = normalizeSupply(input.supply) ?? { quantity: 1, unit: VF_UNIT_ONE };
  if (typeof input.price === 'number' && Number.isFinite(input.price) && input.price >= 0) {
    offer.price = input.price;
    if (input.currency) offer.currency = input.currency;
  }
  offer.reservations = [];
  if (input.hex) offer.hex = input.hex;
  if (input.source) offer.source = input.source;
  return offer;
}

/** A standing offer for a shelf item's surplus: id `offer-stock-<itemId>`, source stock. */
export function offerFromStockSurplus(
  spec: StockItemSpec,
  quantity: number,
  opts: Omit<CreateOfferInput, 'title' | 'supply' | 'category' | 'source' | 'id'>,
): OfferRecord {
  return createOffer({
    ...opts,
    id: stockOfferId(spec.id),
    title: spec.name,
    category: spec.category,
    supply: { itemId: spec.id, quantity, unit: spec.unit },
    source: { kind: 'stock', itemId: spec.id },
  });
}

/** The id the surplus sync keeps for an item, one per shelf item. */
export function stockOfferId(itemId: string): string {
  return `offer-stock-${itemId}`;
}

function normalizeSupply(raw: unknown): OfferSupply | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { itemId?: unknown; quantity?: unknown; unit?: unknown };
  const quantity = typeof r.quantity === 'number' && Number.isFinite(r.quantity) && r.quantity > 0 ? r.quantity : 1;
  const unit = typeof r.unit === 'string' && r.unit ? r.unit : VF_UNIT_ONE;
  return {
    ...(typeof r.itemId === 'string' && r.itemId ? { itemId: r.itemId } : {}),
    quantity,
    unit,
  };
}

function normalizeReservations(raw: unknown): OfferReservation[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is OfferReservation =>
      !!r && typeof r === 'object' && typeof (r as OfferReservation).id === 'string' && typeof (r as OfferReservation).needId === 'string',
  );
}

/**
 * Coerce a raw record into an offer, or null when it is not one or was
 * deleted. Legacy records (no status / supply) read as open, one unit;
 * `ongoing` (createTask's default) is open, `completed` is fulfilled; an
 * `expires_at` in the past reads as expired unless the offer already closed.
 * The federation and hologram envelopes are kept so `sourceRef` still works.
 */
export function normalizeOffer(raw: unknown, now: number = Date.now()): OfferRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Quest & Record<string, unknown>;
  if (d._deleted || d.type !== 'offer') return null;

  let status: OfferStatus;
  if (OFFER_STATUSES.includes(d.status as OfferStatus)) status = d.status as OfferStatus;
  else if (d.status === 'completed' || d.status === 'fulfilled') status = 'fulfilled';
  else status = 'open';
  const expiresAt = typeof d.expires_at === 'number' ? d.expires_at : null;
  if ((status === 'open' || status === 'reserved') && expiresAt != null && expiresAt <= now) status = 'expired';

  const reservations = normalizeReservations(d.reservations);
  const supply = normalizeSupply(d.supply) ?? { quantity: 1, unit: VF_UNIT_ONE };
  const mode: OfferMode =
    d.mode === 'give' || d.mode === 'lend' || d.mode === 'sell' ? d.mode : modeOf(d.transaction_type);

  let source = d.source as OfferSource | undefined;
  const minted = d.mintedFrom as { needId?: unknown; holonId?: unknown; at?: unknown } | undefined;
  if (!source && minted && typeof minted.needId !== 'undefined') {
    source = {
      kind: 'minted',
      needId: String(minted.needId),
      holonId: String(minted.holonId ?? ''),
      ...(typeof minted.at === 'number' ? { at: minted.at } : {}),
    };
  }

  return {
    ...(d as Quest),
    type: 'offer',
    status,
    supply,
    mode,
    reservations,
    ...(source ? { source } : {}),
  } as OfferRecord;
}

/** A reservation still holding units: not released, not settled. */
export function isLiveReservation(r: OfferReservation): boolean {
  return !r.releasedAt && !r.settledAt;
}

/** Units not yet promised or delivered: supply minus live and settled reservations. */
export function remainingSupply(offer: OfferRecord): number {
  const held = (offer.reservations ?? []).reduce((sum, r) => (r.releasedAt ? sum : sum + r.quantity), 0);
  return Math.max(0, Math.round((offer.supply.quantity - held) * 1000) / 1000);
}
