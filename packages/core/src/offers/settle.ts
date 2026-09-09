// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The REA leg of a fulfilled match. When a need's handoff completes
 * (`needs/settle.ts`) and the winning response drew on a standing offer,
 * the reservation settles and the resource's movement is recorded as one
 * ValueFlows event stored on both holons under one id, the way stock
 * transfers already are:
 *
 *   offer from a shelf   → `stock:transferred`   (the shelf fold sees it)
 *   a loan               → `offer:lent`          (transferCustody)
 *   a service            → `offer:service_delivered` (deliverService)
 *   anything else given  → `offer:delivered`     (transfer)
 */

import type { HoloSphere } from 'holosphere';
import { buildStockTransfer } from '../inventory/events.js';
import { REAEventFactory, REAEventStore, normalizeReaEvent, type EconomicEvent } from '../rea/index.js';
import { fulfillReservation } from './lifecycle.js';
import { refreshPublishedOffer, type PublishOfferOptions } from './publish.js';
import type { OfferRecord, OfferReservation } from './types.js';

/** Stable per (offer, reservation): a double settle upserts, never stacks. */
export function offerDeliveryEventId(offerHolonId: string, offerId: string, reservationId: string): string {
  return REAEventFactory.stableEventId(offerHolonId, 'offer_delivery', offerId, reservationId);
}

export interface BuildOfferDeliveryInput {
  offer: OfferRecord;
  offerHolonId: string;
  needHolonId: string;
  reservation: OfferReservation;
  actor: { id: string | number; name?: string };
  now?: number;
}

export function buildOfferDelivery(input: BuildOfferDeliveryInput): EconomicEvent {
  const { offer, reservation } = input;
  const from = String(input.offerHolonId);
  const to = String(input.needHolonId);
  const id = offerDeliveryEventId(from, String(offer.id), reservation.id);
  const now = input.now ?? Date.now();
  const context = {
    holonId: from,
    offerId: String(offer.id),
    needId: reservation.needId,
    reservationId: reservation.id,
    recordedBy: String(input.actor.id),
    toHolonId: to,
  };

  if (offer.source?.kind === 'stock' && from !== to) {
    const ev = buildStockTransfer({
      fromHolonId: from,
      toHolonId: to,
      itemId: offer.source.itemId,
      quantity: reservation.quantity,
      unit: offer.supply.unit,
      actor: input.actor,
      status: 'confirmed',
      now,
      note: `offer ${offer.id}`,
    });
    return { ...ev, id, context: { ...ev.context, ...context } } as EconomicEvent;
  }

  const isService = (offer as { item_type?: unknown }).item_type === 'service';
  const eventType = offer.mode === 'lend' ? 'offer:lent' : isService ? 'offer:service_delivered' : 'offer:delivered';
  return normalizeReaEvent({
    id,
    timestamp: now,
    eventType,
    resource: {
      type: isService ? 'time' : 'item',
      quantity: reservation.quantity,
      unit: offer.supply.unit,
      resourceId: offer.supply.itemId ?? String(offer.id),
    },
    resourceQuantity: { hasNumericalValue: reservation.quantity, hasUnit: offer.supply.unit },
    resourceInventoriedAs: offer.supply.itemId ?? String(offer.id),
    provider: REAEventFactory.createHolonAgent(from),
    receiver: REAEventFactory.createHolonAgent(to),
    inScopeOf: from,
    context,
    status: 'confirmed',
  }) as EconomicEvent;
}

export interface SettleOfferDeps {
  holosphere: HoloSphere;
  /** Writes go through this (e.g. an actingAs wrapper). Defaults to `holosphere`. */
  db?: { put(holonId: string, lens: string, value: unknown): Promise<unknown> };
}

export interface SettleOfferOptions {
  needHolonId: string;
  actor: { id: string | number; name?: string };
  now?: number;
  federationSourceId?: PublishOfferOptions['federationSourceId'];
  onWriteDenied?: PublishOfferOptions['onWriteDenied'];
}

export interface SettleOfferOutcome {
  ok: boolean;
  offer: OfferRecord;
  event: EconomicEvent | null;
  /** The event landed on the need's holon too. */
  wroteBoth: boolean;
  reason?: 'no_such_reservation' | 'already_released' | 'already_settled';
  errors: string[];
}

/**
 * Settle one reservation: mark it delivered on the offer (closing the offer
 * when nothing is left), re-publish, and record the movement on the offer's
 * holon and — best effort — on the need's.
 */
export async function settleOfferReservation(
  deps: SettleOfferDeps,
  offerHolonId: string,
  offer: OfferRecord,
  reservationId: string,
  opts: SettleOfferOptions,
): Promise<SettleOfferOutcome> {
  const errors: string[] = [];
  const now = opts.now ?? Date.now();
  const reservation = (offer.reservations ?? []).find((r) => r.id === reservationId);
  const done = fulfillReservation(offer, reservationId, now);
  if (!done.ok || !reservation) {
    return { ok: false, offer, event: null, wroteBoth: false, reason: done.reason ?? 'no_such_reservation', errors };
  }

  let persisted = done.offer;
  try {
    const out = await refreshPublishedOffer(deps.holosphere, offerHolonId, done.offer, {
      federationSourceId: opts.federationSourceId,
      onWriteDenied: opts.onWriteDenied,
    });
    persisted = out.offer;
    errors.push(...out.errors);
  } catch (err) {
    errors.push(`offer: ${(err as Error).message ?? String(err)}`);
  }

  const event = buildOfferDelivery({
    offer,
    offerHolonId,
    needHolonId: opts.needHolonId,
    reservation,
    actor: opts.actor,
    now,
  });
  const store = new REAEventStore((deps.db ?? deps.holosphere) as never);
  try {
    await store.put(offerHolonId, event);
  } catch (err) {
    errors.push(`rea ${offerHolonId}: ${(err as Error).message ?? String(err)}`);
  }
  let wroteBoth = false;
  if (opts.needHolonId && opts.needHolonId !== offerHolonId) {
    try {
      await store.put(opts.needHolonId, event);
      wroteBoth = true;
    } catch (err) {
      errors.push(`rea ${opts.needHolonId}: ${(err as Error).message ?? String(err)}`);
    }
  }
  return { ok: true, offer: persisted, event, wroteBoth, errors };
}
