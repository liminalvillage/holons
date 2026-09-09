// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One tap on a match: the provider answers the need from their standing
 * offer. This rides the need lifecycle — the answer IS a need response
 * (`respondToNeed`), so the requester's claim, the handoff code and the
 * settlement work unchanged — and reserves the offered units so the LP
 * stops proposing them to anyone else.
 *
 * Order matters: the need write first (it is the commitment the requester
 * sees), the reservation second. If the need cannot be written, nothing is
 * reserved.
 */

import type { HoloSphere } from 'holosphere';
import { NEED_RECORD_LENS, type PublishedNeed } from '../needs/types.js';
import { respondToNeed, type RespondResult } from '../needs/responses.js';
import { reserveOffer } from './lifecycle.js';
import { refreshPublishedOffer, type PublishOfferOptions } from './publish.js';
import type { OfferRecord } from './types.js';

export interface AcceptStoreLike {
  put(holonId: string, lens: string, value: unknown): Promise<unknown>;
}

export interface AcceptDeps {
  holosphere: HoloSphere;
  /** Writes go through this (e.g. an actingAs wrapper). Defaults to `holosphere`. */
  db?: AcceptStoreLike;
}

export interface AcceptMatchInput {
  offer: OfferRecord;
  offerHolonId: string;
  need: PublishedNeed;
  /** The holon the need lives on (its owner, via `sourceRef` when federated). */
  needHolonId: string;
  /** The key the need sits under on its owner, when it differs from the id. */
  needKey?: string;
  quantity: number;
  actor: { id: string | number; name?: string };
  message?: string;
  now?: number;
  federationSourceId?: PublishOfferOptions['federationSourceId'];
  onWriteDenied?: PublishOfferOptions['onWriteDenied'];
  /** Override the generated ids. Mostly for tests. */
  responseId?: string;
  reservationId?: string;
}

export interface AcceptMatchOutcome {
  ok: boolean;
  need: PublishedNeed;
  offer: OfferRecord;
  responseId?: string;
  reservationId?: string;
  reason?: RespondResult['reason'] | 'insufficient' | 'closed' | 'duplicate' | 'invalid_quantity' | 'write_failed';
  errors: string[];
}

export async function acceptMatch(deps: AcceptDeps, input: AcceptMatchInput): Promise<AcceptMatchOutcome> {
  const db: AcceptStoreLike = deps.db ?? (deps.holosphere as unknown as AcceptStoreLike);
  const errors: string[] = [];
  const now = input.now ?? Date.now();

  // Dry-run the reservation so a need is never answered from an offer that
  // cannot back it.
  const probe = reserveOffer(input.offer, {
    needId: String(input.need.id),
    needHolonId: input.needHolonId,
    responseId: input.responseId ?? 'probe',
    quantity: input.quantity,
    now,
  });
  if (!probe.ok) return { ok: false, need: input.need, offer: input.offer, reason: probe.reason, errors };

  const reservationId = input.reservationId ?? `resv-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const responded = respondToNeed(input.need, {
    responder: { id: input.actor.id, ...(input.actor.name ? { name: input.actor.name } : {}), holonId: input.offerHolonId },
    ...(input.message ? { message: input.message } : {}),
    ...(typeof input.offer.price === 'number' ? { price: input.offer.price } : {}),
    ...(input.offer.currency ? { currency: input.offer.currency } : {}),
    offerId: String(input.offer.id),
    offerHolonId: input.offerHolonId,
    reservationId,
    ...(input.responseId ? { id: input.responseId } : {}),
    now,
  });
  if (!responded.ok || !responded.response) {
    return { ok: false, need: input.need, offer: input.offer, reason: responded.reason, errors };
  }

  // The need lives on its owner; a federated copy is written back through
  // its source key. Strip the envelopes so the owner's record stays clean.
  const { _hologram: _h, _federation: _f, key: _k, ...clean } = responded.need as PublishedNeed & {
    _hologram?: unknown;
    _federation?: unknown;
    key?: unknown;
  };
  const needRecord = input.needKey ? { ...clean, id: input.needKey } : clean;
  try {
    await db.put(input.needHolonId, NEED_RECORD_LENS, needRecord);
  } catch (err) {
    errors.push(`respond: ${(err as Error).message ?? String(err)}`);
    return { ok: false, need: input.need, offer: input.offer, reason: 'write_failed', errors };
  }

  const reserved = reserveOffer(input.offer, {
    needId: String(input.need.id),
    needHolonId: input.needHolonId,
    responseId: responded.response.id,
    quantity: input.quantity,
    id: reservationId,
    now,
  });
  let offer = input.offer;
  if (reserved.ok) {
    try {
      const out = await refreshPublishedOffer(deps.holosphere, input.offerHolonId, reserved.offer, {
        federationSourceId: input.federationSourceId,
        onWriteDenied: input.onWriteDenied,
      });
      offer = out.offer;
      errors.push(...out.errors);
    } catch (err) {
      errors.push(`reserve: ${(err as Error).message ?? String(err)}`);
    }
  } else {
    errors.push(`reserve: ${reserved.reason}`);
  }

  return {
    ok: true,
    need: responded.need,
    offer,
    responseId: responded.response.id,
    reservationId,
    errors,
  };
}
