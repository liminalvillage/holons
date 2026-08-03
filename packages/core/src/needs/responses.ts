// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Provider responses and lifecycle transitions for published needs.
 *
 * Pure operations (data in, data out); persistence — including routing a
 * foreign write through `sourceRef` so it lands on the owner holon — is the
 * caller's responsibility, exactly like the library domain's bookings.
 */

import {
  OPEN_NEED_STATUSES,
  type NeedResponse,
  type PublishedNeed,
} from './types.js';

export interface RespondInput {
  responder: NeedResponse['responder'];
  message?: string;
  price?: number;
  currency?: string;
  /** Override the generated response id. Mostly for tests. */
  id?: string;
  /** Override the timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

export interface RespondResult {
  ok: boolean;
  /** Updated need on success; the untouched input need on failure. */
  need: PublishedNeed;
  response?: NeedResponse;
  reason?: 'closed' | 'invalid_responder';
}

/**
 * Append a provider response and mark the need `offered`. Allowed while the
 * need is open (`requested` or `offered` — several providers may respond);
 * rejected once claimed, fulfilled, or cancelled.
 */
export function respondToNeed(need: PublishedNeed, input: RespondInput): RespondResult {
  if (!input?.responder || input.responder.id == null) {
    return { ok: false, need, reason: 'invalid_responder' };
  }
  if (!OPEN_NEED_STATUSES.includes(need.status)) {
    return { ok: false, need, reason: 'closed' };
  }

  const now = input.now ?? Date.now();
  const response: NeedResponse = {
    id: input.id ?? `resp-${now}-${Math.random().toString(36).slice(2, 8)}`,
    responder: { ...input.responder },
    createdAt: new Date(now).toISOString(),
    ...(input.message ? { message: input.message } : {}),
    ...(typeof input.price === 'number' && !Number.isNaN(input.price)
      ? { price: input.price }
      : {}),
    ...(input.currency ? { currency: input.currency } : {}),
  };

  const updated: PublishedNeed = {
    ...need,
    status: 'offered',
    responses: [...(need.responses ?? []), response],
  };
  return { ok: true, need: updated, response };
}

export type CloseOutcome = 'fulfilled' | 'cancelled';

export interface CloseResult {
  ok: boolean;
  need: PublishedNeed;
  reason?: 'already_closed';
}

/**
 * Close a need: `fulfilled` when the underlying shopping item was checked off,
 * `cancelled` when it was removed or retracted. Idempotent on the same
 * outcome; rejects reopening an already-closed need with a different one.
 */
export function closeNeed(
  need: PublishedNeed,
  outcome: CloseOutcome,
  now: number = Date.now()
): CloseResult {
  if (need.status === outcome) return { ok: true, need };
  if (need.status === 'fulfilled' || need.status === 'cancelled') {
    return { ok: false, need, reason: 'already_closed' };
  }
  return {
    ok: true,
    need: { ...need, status: outcome, closedAt: new Date(now).toISOString() },
  };
}
