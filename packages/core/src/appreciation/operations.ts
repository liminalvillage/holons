// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/appreciation — pure operations (no I/O).

import type {
  Appreciation,
  AppreciationActor,
  AppreciationCountUser,
} from './types.js';

/** Build an appreciation record. `amount` is clamped to a positive integer. */
export function createAppreciation(input: {
  id: string;
  from: AppreciationActor;
  to: AppreciationActor;
  amount?: number;
  reason?: string;
  date: number;
  holonId: string;
}): Appreciation {
  const amount = Math.max(1, Math.floor(input.amount ?? 1));
  return {
    id: input.id,
    from: input.from,
    to: input.to,
    amount,
    reason: input.reason?.trim() || 'General appreciation',
    date: input.date,
    holonId: String(input.holonId),
  };
}

/** Tally received appreciation onto the recipient (pure copy). */
export function applyReceived(
  user: AppreciationCountUser,
  amount: number
): AppreciationCountUser {
  return {
    ...user,
    appreciationReceived: (user.appreciationReceived ?? 0) + amount,
  };
}

/** Tally given appreciation onto the sender (pure copy). */
export function applyGiven(
  user: AppreciationCountUser,
  amount: number
): AppreciationCountUser {
  return {
    ...user,
    appreciationGiven: (user.appreciationGiven ?? 0) + amount,
  };
}
