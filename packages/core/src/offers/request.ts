// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One tap on someone's offer: the viewer asks for it. This rides the need
 * lifecycle rather than booking the offer outright — a need is published on
 * the requester's holon naming the offer (`need.wants`), the matcher leans
 * toward that offer, and the provider's one tap ("Offer it", `acceptMatch`)
 * turns it into a response and a reservation. The provider stays the one
 * who promises their own stock; the requester's claim, the handoff code and
 * the settlement then work unchanged.
 */

import type { HoloSphere } from 'holosphere';
import type { QuestInitiator } from '../tasks/types.js';
import { createNeed } from '../needs/transform.js';
import { publishNeedNearby, type PublishNeedOptions } from '../needs/publish.js';
import type { PublishedNeed } from '../needs/types.js';
import { remainingSupply } from './transform.js';
import type { OfferRecord } from './types.js';

const EPS = 1e-9;

export interface NeedFromOfferInput {
  /** The requester's holon — where the need lives. */
  holonId: string | number;
  initiator: QuestInitiator;
  /** Units asked for, in the offer's unit. Default: one. */
  quantity?: number;
  message?: string;
  now?: number;
  /** Override the generated id. Mostly for tests. */
  id?: string;
}

export type RequestOfferReason = 'closed' | 'insufficient' | 'invalid_quantity' | 'own_offer' | 'write_failed';

export interface RequestOfferCheck {
  ok: boolean;
  reason?: RequestOfferReason;
}

/** Can this offer be asked for, in this quantity, by this holon? Pure. */
export function checkRequestOffer(offer: OfferRecord, offerHolonId: string, input: NeedFromOfferInput): RequestOfferCheck {
  if (String(offerHolonId) === String(input.holonId)) return { ok: false, reason: 'own_offer' };
  if (offer.status !== 'open' && offer.status !== 'reserved') return { ok: false, reason: 'closed' };
  const quantity = input.quantity ?? 1;
  if (!(typeof quantity === 'number' && Number.isFinite(quantity) && quantity > EPS)) return { ok: false, reason: 'invalid_quantity' };
  if (quantity > remainingSupply(offer) + EPS) return { ok: false, reason: 'insufficient' };
  return { ok: true };
}

/**
 * The need that asks for an offer: the offer's title, category and unit,
 * the asked quantity, and `wants` pointing back at it. Pure; throws on a
 * failed `checkRequestOffer`.
 */
export function needFromOffer(offer: OfferRecord, offerHolonId: string, input: NeedFromOfferInput): PublishedNeed {
  const check = checkRequestOffer(offer, offerHolonId, input);
  if (!check.ok) throw new Error(`requestOffer: ${check.reason}`);
  return createNeed({
    holonId: input.holonId,
    initiator: input.initiator,
    title: String(offer.title ?? '').trim() || offer.supply.itemId || 'offer',
    category: offer.category,
    demand: { quantity: input.quantity ?? 1, unit: offer.supply.unit },
    itemType: offer.itemType === 'service' ? 'service' : 'good',
    description: input.message?.trim() || undefined,
    wants: { offerId: String(offer.id), holonId: String(offerHolonId) },
    id: input.id,
    now: input.now,
  });
}

export interface RequestOfferInput extends NeedFromOfferInput {
  offer: OfferRecord;
  offerHolonId: string;
  federationSourceId?: PublishNeedOptions['federationSourceId'];
  onWriteDenied?: PublishNeedOptions['onWriteDenied'];
  /** Also light the requester's home cell on the map. Default true. */
  toHex?: boolean;
  upcastLevels?: number;
}

export interface RequestOfferOutcome {
  ok: boolean;
  need?: PublishedNeed;
  reason?: RequestOfferReason;
  errors: string[];
}

/**
 * Publish the need that asks for an offer — to the requester's partners and
 * home cell, so the provider's board proposes the pair. Nothing is written
 * on the provider's side: the reservation is theirs to make.
 */
export async function requestOffer(holosphere: HoloSphere, input: RequestOfferInput): Promise<RequestOfferOutcome> {
  const check = checkRequestOffer(input.offer, input.offerHolonId, input);
  if (!check.ok) return { ok: false, reason: check.reason, errors: [] };
  const need = needFromOffer(input.offer, input.offerHolonId, input);
  try {
    const r = await publishNeedNearby(holosphere, String(input.holonId), need, {
      toPartners: true,
      toHex: input.toHex !== false,
      federationSourceId: input.federationSourceId,
      onWriteDenied: input.onWriteDenied,
      upcastLevels: input.upcastLevels,
      now: input.now,
    });
    return { ok: true, need: r.need, errors: r.errors };
  } catch (err) {
    return { ok: false, need, reason: 'write_failed', errors: [(err as Error).message ?? String(err)] };
  }
}
