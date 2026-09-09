// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Offer state transitions. Pure functions returning a new record; the
 * publisher persists. Mirrors `needs/responses.ts` on the supply side.
 */

import { isLiveReservation, remainingSupply } from './transform.js';
import type { OfferRecord, OfferReservation } from './types.js';

const EPS = 1e-9;

export interface ReserveInput {
  needId: string;
  needHolonId: string;
  responseId: string;
  quantity: number;
  /** Override the generated reservation id. Mostly for tests. */
  id?: string;
  /** Override the timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

export interface ReserveResult {
  ok: boolean;
  offer: OfferRecord;
  reservation?: OfferReservation;
  reason?: 'closed' | 'insufficient' | 'duplicate' | 'invalid_quantity';
}

/** Promise part of the offer to a need. The same response reserves once. */
export function reserveOffer(offer: OfferRecord, input: ReserveInput): ReserveResult {
  if (offer.status !== 'open' && offer.status !== 'reserved') return { ok: false, offer, reason: 'closed' };
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= EPS) return { ok: false, offer, reason: 'invalid_quantity' };
  const existing = (offer.reservations ?? []).find(
    (r) => r.responseId === input.responseId && !r.releasedAt,
  );
  if (existing) return { ok: false, offer, reservation: existing, reason: 'duplicate' };
  if (quantity > remainingSupply(offer) + EPS) return { ok: false, offer, reason: 'insufficient' };
  const now = input.now ?? Date.now();
  const reservation: OfferReservation = {
    id: input.id ?? `resv-${now}-${Math.random().toString(36).slice(2, 8)}`,
    needId: input.needId,
    needHolonId: input.needHolonId,
    responseId: input.responseId,
    quantity,
    createdAt: new Date(now).toISOString(),
  };
  return {
    ok: true,
    reservation,
    offer: { ...offer, status: 'reserved', reservations: [...(offer.reservations ?? []), reservation] },
  };
}

export interface ReservationResult {
  ok: boolean;
  offer: OfferRecord;
  reason?: 'no_such_reservation' | 'already_settled' | 'already_released';
}

/** The need fell through: give the units back to the market. */
export function releaseReservation(offer: OfferRecord, reservationId: string, now: number = Date.now()): ReservationResult {
  const r = (offer.reservations ?? []).find((x) => x.id === reservationId);
  if (!r) return { ok: false, offer, reason: 'no_such_reservation' };
  if (r.settledAt) return { ok: false, offer, reason: 'already_settled' };
  if (r.releasedAt) return { ok: false, offer, reason: 'already_released' };
  const reservations = offer.reservations.map((x) =>
    x.id === reservationId ? { ...x, releasedAt: new Date(now).toISOString() } : x,
  );
  const next: OfferRecord = { ...offer, reservations };
  if (offer.status === 'reserved' && !reservations.some(isLiveReservation)) next.status = 'open';
  return { ok: true, offer: next };
}

/**
 * The handoff completed: the units left. The offer closes as fulfilled once
 * nothing remains and no other reservation is live; otherwise it stays on
 * the market with what is left.
 */
export function fulfillReservation(offer: OfferRecord, reservationId: string, now: number = Date.now()): ReservationResult {
  const r = (offer.reservations ?? []).find((x) => x.id === reservationId);
  if (!r) return { ok: false, offer, reason: 'no_such_reservation' };
  if (r.releasedAt) return { ok: false, offer, reason: 'already_released' };
  if (r.settledAt) return { ok: true, offer };
  const stamp = new Date(now).toISOString();
  const reservations = offer.reservations.map((x) => (x.id === reservationId ? { ...x, settledAt: stamp } : x));
  const next: OfferRecord = { ...offer, reservations };
  const live = reservations.some(isLiveReservation);
  if (remainingSupply(next) <= EPS && !live) {
    next.status = 'fulfilled';
    next.fulfilledAt = stamp;
  } else {
    next.status = live ? 'reserved' : 'open';
  }
  return { ok: true, offer: next };
}

export interface WithdrawResult {
  ok: boolean;
  offer: OfferRecord;
  reason?: 'already_closed' | 'has_live_reservations';
}

/** Take the offer off the market. Refused while someone is counting on it. */
export function withdrawOffer(offer: OfferRecord, now: number = Date.now()): WithdrawResult {
  if (offer.status === 'withdrawn' || offer.status === 'fulfilled') return { ok: false, offer, reason: 'already_closed' };
  if ((offer.reservations ?? []).some(isLiveReservation)) return { ok: false, offer, reason: 'has_live_reservations' };
  return { ok: true, offer: { ...offer, status: 'withdrawn', withdrawnAt: new Date(now).toISOString() } };
}

export type OfferPatch = Partial<
  Pick<OfferRecord, 'title' | 'description' | 'category' | 'supply' | 'mode' | 'price' | 'currency' | 'expires_at' | 'tags'>
>;

export interface EditResult {
  ok: boolean;
  offer: OfferRecord;
  reason?: 'closed' | 'below_reserved';
}

/** Change the offer's terms. Supply can never drop below what is promised. */
export function editOffer(offer: OfferRecord, patch: OfferPatch): EditResult {
  if (offer.status !== 'open' && offer.status !== 'reserved') return { ok: false, offer, reason: 'closed' };
  const next: OfferRecord = { ...offer };
  if (patch.title != null) next.title = String(patch.title).trim();
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.category !== undefined) next.category = patch.category || undefined;
  if (patch.mode) next.mode = patch.mode;
  if (patch.price !== undefined) next.price = patch.price;
  if (patch.currency !== undefined) next.currency = patch.currency;
  if (patch.expires_at !== undefined) next.expires_at = patch.expires_at;
  if (patch.tags !== undefined) next.tags = patch.tags;
  if (patch.supply) {
    const held = (offer.reservations ?? []).reduce((sum, r) => (r.releasedAt ? sum : sum + r.quantity), 0);
    if (patch.supply.quantity + EPS < held) return { ok: false, offer, reason: 'below_reserved' };
    next.supply = { ...offer.supply, ...patch.supply };
  }
  return { ok: true, offer: next };
}

/** Offers whose expiry has passed, flipped to expired. Only the changed ones come back. */
export function expireOffers(offers: OfferRecord[], now: number = Date.now()): OfferRecord[] {
  const out: OfferRecord[] = [];
  for (const o of offers ?? []) {
    if (o.status !== 'open' && o.status !== 'reserved') continue;
    if (typeof o.expires_at !== 'number' || o.expires_at > now) continue;
    if ((o.reservations ?? []).some(isLiveReservation)) continue;
    out.push({ ...o, status: 'expired' });
  }
  return out;
}

/** The viewer's side of an offer: its provider, or nobody. */
export function offerPartyOf(offer: OfferRecord, userId: string | number | null | undefined): 'provider' | null {
  if (userId == null) return null;
  const init = offer.initiator as { id?: unknown } | undefined;
  return init?.id != null && String(init.id) === String(userId) ? 'provider' : null;
}
