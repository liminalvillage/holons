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

/**
 * The handoff code for a need — deterministic from the id so both parties'
 * devices derive the same three characters without coordination.
 */
export function handoffCode(needId: string | number): string {
  const clean = String(needId).replace(/[^a-z0-9]/gi, '');
  return (clean.slice(-3) || 'WQ0').toUpperCase();
}

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

export interface ClaimResult {
  ok: boolean;
  need: PublishedNeed;
  reason?: 'not_offered' | 'no_such_response';
}

/**
 * The requester accepts one provider's response: the need moves
 * `offered → claimed` and records which response won. The handoff then
 * settles out-of-band; `closeNeed('fulfilled')` completes the loop.
 */
export function claimNeed(
  need: PublishedNeed,
  responseId: string,
  now: number = Date.now()
): ClaimResult {
  if (need.status !== 'offered') {
    return { ok: false, need, reason: 'not_offered' };
  }
  const response = (need.responses ?? []).find((r) => r.id === responseId);
  if (!response) {
    return { ok: false, need, reason: 'no_such_response' };
  }
  return {
    ok: true,
    need: {
      ...need,
      status: 'claimed',
      claimedResponseId: responseId,
      claimedAt: new Date(now).toISOString(),
      handoff: { code: handoffCode(need.id ?? '') },
    },
  };
}

export type HandoffParty = 'requester' | 'provider';

export interface HandoffConfirmResult {
  ok: boolean;
  need: PublishedNeed;
  /** True once both sides have confirmed — time to move the hours. */
  both: boolean;
  reason?: 'not_claimed' | 'bad_code' | 'already_confirmed';
}

/**
 * One side confirms the handoff. The requester confirms from the screen that
 * shows the code; the provider must type that code in (`code` is required and
 * checked for the provider side). Idempotent per side; `both` flips true on
 * the second confirmation.
 */
export function recordHandoffConfirmation(
  need: PublishedNeed,
  party: HandoffParty,
  opts: { code?: string; now?: number } = {}
): HandoffConfirmResult {
  const both = (n: PublishedNeed) => Boolean(n.handoff?.requesterAt && n.handoff?.providerAt);
  if (need.status !== 'claimed' || !need.handoff) {
    return { ok: false, need, both: both(need), reason: 'not_claimed' };
  }
  if (party === 'provider') {
    const typed = String(opts.code ?? '').trim().toUpperCase();
    if (typed !== need.handoff.code) {
      return { ok: false, need, both: both(need), reason: 'bad_code' };
    }
  }
  const key = party === 'requester' ? 'requesterAt' : 'providerAt';
  if (need.handoff[key]) {
    return { ok: true, need, both: both(need), reason: 'already_confirmed' };
  }
  const updated: PublishedNeed = {
    ...need,
    handoff: { ...need.handoff, [key]: new Date(opts.now ?? Date.now()).toISOString() },
  };
  return { ok: true, need: updated, both: both(updated) };
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
