// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every commitment is an offer and a need joined by a reservation.
 *
 * `answerNeed` is the provider's one move: answer a need from a standing
 * offer, or — with none — raise an offer for exactly what the need asks
 * (`source: {kind:'need'}`, the dual of `need.wants`), then answer from
 * that. Either way the need gets a response that names the offer and the
 * offer holds a reservation, so the promise shows in the provider's supply,
 * cannot be promised twice, and settles through the shelf like any other.
 *
 * `releaseNeedReservations` is the requester's counterpart: when a need is
 * claimed or cancelled, the reservations behind the losing responses are
 * released, and an offer that was raised for this need alone is withdrawn —
 * nobody accumulates stray standing offers for asks that went elsewhere.
 */

import type { HoloSphere } from 'holosphere';
import type { QuestInitiator } from '../tasks/types.js';
import { demandQuantity, demandUnit } from '../inventory/scarcity.js';
import type { PublishedNeed } from '../needs/types.js';
import { NEED_RECORD_LENS } from '../needs/types.js';
import { acceptMatch, type AcceptDeps, type AcceptMatchInput, type AcceptMatchOutcome } from './accept.js';
import { releaseReservation, reserveOffer, withdrawOffer } from './lifecycle.js';
import { respondToNeed } from '../needs/responses.js';
import { publishOfferNearby, refreshPublishedOffer, withdrawPublishedOffer, type PublishOfferOptions } from './publish.js';
import { createOffer, isLiveReservation, normalizeOffer } from './transform.js';
import type { OfferRecord } from './types.js';

export interface OfferForNeedInput {
  /** The provider's holon — where the offer lives. */
  holonId: string | number;
  initiator: QuestInitiator;
  /** Units offered, in the need's unit. Default: what the need asks for. */
  quantity?: number;
  message?: string;
  price?: number;
  currency?: string;
  now?: number;
  /** Override the generated id. Mostly for tests. */
  id?: string;
}

/** The offer that answers a need: its title, category and unit, the need's quantity, and `source` pointing back. Pure. */
export function offerForNeed(need: PublishedNeed, needHolonId: string, input: OfferForNeedInput): OfferRecord {
  const unit = demandUnit(need) ?? 'one';
  return createOffer({
    holonId: input.holonId,
    initiator: input.initiator,
    title: String(need.title ?? '').trim() || 'offer',
    category: need.category,
    supply: { quantity: input.quantity ?? demandQuantity(need), unit },
    mode: 'give',
    itemType: need.itemType === 'service' ? 'service' : 'good',
    description: input.message?.trim() || undefined,
    ...(typeof input.price === 'number' ? { price: input.price } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    source: { kind: 'need', needId: String(need.id), holonId: String(needHolonId) },
    id: input.id,
    now: input.now,
  });
}

export interface AnswerNeedInput extends Omit<AcceptMatchInput, 'offer' | 'offerHolonId' | 'quantity'> {
  /** The provider's holon. */
  holonId: string;
  initiator: QuestInitiator;
  /** A standing offer to answer from; without one, an offer is raised for the need. */
  offer?: { record: OfferRecord; holonId: string };
  /** Units promised. Default: what the need asks for (capped by a standing offer's remainder upstream). */
  quantity?: number;
  price?: number;
  currency?: string;
  /** Where a raised offer is shared. Partners by default; the map only when asked. */
  toHex?: boolean;
  upcastLevels?: number;
}

export interface AnswerNeedOutcome extends AcceptMatchOutcome {
  /** True when an offer was raised for this need (none stood). */
  raised: boolean;
}

/**
 * Answer a need from a standing offer, or raise one for it first. A raised
 * offer is written unpublished, reserved through `acceptMatch` (which only
 * re-sends where an offer is already published), then shared once — already
 * holding its reservation, so partners never see it free.
 */
export async function answerNeed(deps: AcceptDeps, input: AnswerNeedInput): Promise<AnswerNeedOutcome> {
  const quantity = input.quantity ?? demandQuantity(input.need);
  if (input.offer) {
    const out = await acceptMatch(deps, { ...input, offer: input.offer.record, offerHolonId: input.offer.holonId, quantity });
    return { ...out, raised: false };
  }

  const fresh = offerForNeed(input.need, input.needHolonId, {
    holonId: input.holonId,
    initiator: input.initiator,
    quantity,
    message: input.message,
    price: input.price,
    currency: input.currency,
    now: input.now,
  });
  // Refuse before writing anything the need cannot take.
  const dry = respondToNeed(input.need, { responder: { id: input.actor.id }, now: input.now });
  if (!dry.ok) return { ok: false, need: input.need, offer: fresh, reason: dry.reason, errors: [], raised: false };
  const probe = reserveOffer(fresh, { needId: String(input.need.id), needHolonId: input.needHolonId, responseId: 'probe', quantity, now: input.now });
  if (!probe.ok) return { ok: false, need: input.need, offer: fresh, reason: probe.reason, errors: [], raised: false };

  const out = await acceptMatch(deps, { ...input, offer: fresh, offerHolonId: input.holonId, quantity });
  if (!out.ok) return { ...out, raised: false };
  const errors = [...out.errors];
  let offer = out.offer;
  try {
    const shared = await publishOfferNearby(deps.holosphere, input.holonId, offer, {
      toPartners: true,
      toHex: input.toHex === true,
      upcastLevels: input.upcastLevels,
      federationSourceId: input.federationSourceId,
      onWriteDenied: input.onWriteDenied,
      now: input.now,
    });
    offer = shared.offer;
    errors.push(...shared.errors);
  } catch (err) {
    errors.push(`share: ${(err as Error).message ?? String(err)}`);
  }
  return { ...out, offer, errors, raised: true };
}

export interface ReleaseNeedOptions extends Pick<PublishOfferOptions, 'federationSourceId' | 'onWriteDenied' | 'now'> {
  /** The response that won — its reservation stays. */
  except?: string;
  /** Reads go through this. Defaults to `holosphere`. */
  db?: { get(holonId: string, lens: string, key: string): Promise<unknown> };
}

export interface ReleaseNeedOutcome {
  released: OfferRecord[];
  withdrawn: OfferRecord[];
  errors: string[];
}

/**
 * Free what the losing (or every) response held: release each reservation
 * this need holds on an offer, and withdraw an offer raised for this need
 * once nothing else is promised from it. Reads and writes the providers'
 * offers; never touches the need.
 */
export async function releaseNeedReservations(
  holosphere: HoloSphere,
  need: PublishedNeed,
  opts: ReleaseNeedOptions = {},
): Promise<ReleaseNeedOutcome> {
  const out: ReleaseNeedOutcome = { released: [], withdrawn: [], errors: [] };
  const db = opts.db ?? (holosphere as unknown as NonNullable<ReleaseNeedOptions['db']>);
  const now = opts.now ?? Date.now();
  const needId = String(need.id);
  const seen = new Set<string>();
  for (const r of need.responses ?? []) {
    if (!r.offerId || !r.offerHolonId || r.id === opts.except) continue;
    const key = `${r.offerHolonId}::${r.offerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const raw = await db.get(String(r.offerHolonId), NEED_RECORD_LENS, String(r.offerId));
      let offer = normalizeOffer(raw, now);
      if (!offer) continue;
      let changed = false;
      for (const held of offer.reservations ?? []) {
        if (String(held.needId) !== needId || !isLiveReservation(held)) continue;
        if (opts.except && held.responseId === opts.except) continue;
        const rel = releaseReservation(offer, held.id, now);
        if (rel.ok) {
          offer = rel.offer;
          changed = true;
        }
      }
      if (!changed) continue;
      const raisedForThis = offer.source?.kind === 'need' && String(offer.source.needId) === needId;
      const stillHeld = (offer.reservations ?? []).some(isLiveReservation);
      if (raisedForThis && !stillHeld && withdrawOffer(offer, now).ok) {
        const w = await withdrawPublishedOffer(holosphere, String(r.offerHolonId), offer, opts);
        out.errors.push(...w.errors);
        if (w.ok) out.withdrawn.push(w.offer);
      } else {
        const refreshed = await refreshPublishedOffer(holosphere, String(r.offerHolonId), offer, opts);
        out.errors.push(...refreshed.errors);
        out.released.push(refreshed.offer);
      }
    } catch (err) {
      out.errors.push(`release ${r.offerId}: ${(err as Error).message ?? String(err)}`);
    }
  }
  return out;
}
