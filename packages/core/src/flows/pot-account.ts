// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a party's seat is worth in a Pot, in one unit — read off the chain's
 * own counters and the table the Pot is paying from.
 *
 *   collected   — what the Pot has released to the party
 *   collectable — what the active table owes them beyond that
 *   accruing    — their share of what arrived since the last commitment: not
 *                 owed yet, and theirs at the next new moon if the split holds
 *
 * Pure: counters in, amounts out, in the unit's own decimals.
 */

import { fromBaseUnits } from './holdings.js';
import type { ValueFlowSegment } from './types.js';

export interface PotAccount {
  collected: number;
  collectable: number;
  accruing: number;
  /** Everything above: what the seat has brought and is bringing. */
  total: number;
}

export function potAccount(input: {
  /** The party's share of the Pot's income, 0..100. */
  sharePct: number;
  decimals: number;
  /** The Pot's `received(token)` and `declared(token)`. */
  received: bigint;
  declared: bigint;
  /** The party's row in the active table (`rightsRow(...).cumulative`), null with no row. */
  cumulative: bigint | null;
  /** `released(partyKey, token)`, null when it was not read. */
  released: bigint | null;
}): PotAccount {
  const released = input.released != null && input.released > 0n ? input.released : 0n;
  const cumulative = input.cumulative ?? 0n;
  const owed = cumulative > released ? cumulative - released : 0n;
  const fresh = input.received > input.declared ? input.received - input.declared : 0n;
  const share = Math.max(0, Math.min(100, Number(input.sharePct) || 0));

  const collected = fromBaseUnits(released, input.decimals);
  const collectable = fromBaseUnits(owed, input.decimals);
  const accruing = fromBaseUnits(fresh, input.decimals) * (share / 100);
  return { collected, collectable, accruing, total: collected + collectable + accruing };
}

/** The account as the slices of a stacked bar, top to bottom, empty slices left out. */
export function potAccountSegments(
  account: PotAccount,
  labels: { collected: string; collectable: string; accruing: string },
): ValueFlowSegment[] {
  const slices: ValueFlowSegment[] = [
    { kind: 'spent', label: labels.collected, value: account.collected },
    { kind: 'claimed', label: labels.collectable, value: account.collectable },
    { kind: 'available', label: labels.accruing, value: account.accruing },
  ];
  return slices.filter((s) => s.value > 0);
}
