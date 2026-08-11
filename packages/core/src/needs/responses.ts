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
 * LEGACY handoff code — deterministic from the need's public id. Kept only so
 * needs claimed before codes were minted at claim time can still complete
 * their in-flight handoff; everything new uses {@link generateHandoffCode}.
 *
 * @deprecated derive nothing from this: the id is public, so the code was
 * guessable by anyone who could see the record.
 */
export function handoffCode(needId: string | number): string {
  const clean = String(needId).replace(/[^a-z0-9]/gi, '');
  return (clean.slice(-3) || 'WQ0').toUpperCase();
}

// No 0/O, 1/I/L — the code is read off one screen and typed into another.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface HandoffCodeOptions {
  /** Code length. Default 4. */
  length?: number;
  /** Uniform [0,1) source — inject for deterministic tests. */
  random?: () => number;
}

/**
 * A random handoff code, minted at claim time. It travels only on the
 * canonical record (and its projections), not derivably from the public id.
 */
export function generateHandoffCode(opts: HandoffCodeOptions = {}): string {
  const length = Math.max(1, opts.length ?? 4);
  const out: string[] = [];
  if (!opts.random && typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
  } else {
    const rnd = opts.random ?? Math.random;
    for (let i = 0; i < length; i++) {
      out.push(CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length) % CODE_ALPHABET.length]);
    }
  }
  return out.join('');
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
  reason?: 'closed' | 'invalid_responder' | 'own_need';
}

/**
 * Append a provider response and mark the need `offered`. Allowed while the
 * need is open (`requested` or `offered` — several providers may respond);
 * rejected once claimed, fulfilled, or cancelled — and rejected for the
 * initiator, who would otherwise answer their own need when they reach it
 * through the public map (where it looks foreign).
 */
export function respondToNeed(need: PublishedNeed, input: RespondInput): RespondResult {
  if (!input?.responder || input.responder.id == null) {
    return { ok: false, need, reason: 'invalid_responder' };
  }
  if (need.initiator?.id != null && String(need.initiator.id) === String(input.responder.id)) {
    return { ok: false, need, reason: 'own_need' };
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

export interface ClaimOptions {
  now?: number;
  /** Override the minted handoff code. Mostly for tests. */
  code?: string;
}

/**
 * The requester accepts one provider's response: the need moves
 * `offered → claimed`, records which response won, and mints a random
 * handoff code. The handoff then settles out-of-band;
 * `closeNeed('fulfilled')` completes the loop.
 */
export function claimNeed(
  need: PublishedNeed,
  responseId: string,
  opts: ClaimOptions | number = {}
): ClaimResult {
  // Third param was a bare `now` timestamp before ClaimOptions existed.
  const { now = Date.now(), code } = typeof opts === 'number' ? { now: opts } : opts;
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
      handoff: { code: code ?? generateHandoffCode() },
    },
  };
}

export type HandoffParty = 'requester' | 'provider';

/** The response the requester accepted, if any (the claim's winner). */
export function acceptedResponse(need: PublishedNeed): NeedResponse | undefined {
  return (need.responses ?? []).find((r) => r.id === need.claimedResponseId);
}

/**
 * Which side of a need's exchange a user is: the initiator is the requester,
 * the claimed response's responder is the provider, anyone else is no party
 * at all. The single source of "who may act as whom" for handoff and rating.
 */
export function needPartyOf(
  need: PublishedNeed,
  userId: string | number | null | undefined
): HandoffParty | null {
  if (userId == null || userId === '') return null;
  const id = String(userId);
  if (need.initiator?.id != null && String(need.initiator.id) === id) return 'requester';
  const responder = acceptedResponse(need)?.responder;
  if (responder?.id != null && String(responder.id) === id) return 'provider';
  return null;
}

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
