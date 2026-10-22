// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rights table — who may collect what from a holon's Pot, committed once
 * per lunation.
 *
 * A Pot (`Pot.sol`) holds value and never splits it. Who holds a right over
 * the pool is decided here, off-chain, and committed on-chain as the Merkle
 * root of this table: one row per final holder and token, carrying the
 * holder's CUMULATIVE amount and payout address. Between two new moons the
 * table cannot change; at the new moon it ADVANCES:
 *
 *   cumulative(party) at moon e  =  cumulative at moon e−1
 *                                 +  share(party) at moon e  ×  income in lunation e
 *
 * `share` is the party's leaf of the flattened cascade (`CascadeResult.leaves`:
 * root → sub-holon → personal holon → person, in percent of the root pot) as
 * it stands at the new moon. `income` is what the Pot received since the
 * previous table — read off the contract's own `received` counter, so a
 * table never declares more than the Pot has.
 *
 * Invariants, by construction:
 *   - a row's cumulative never decreases, and past lunations are never redone;
 *   - the rows of a token add up to EXACTLY what the Pot received in it
 *     (largest-remainder rounding, in base units, so nothing is lost or made);
 *   - a party with no payout address accrues and collects once they set one —
 *     the address a row carries is the one known at the new moon.
 *
 * Pure: shapes in, table out. The tree and proofs are `rights-tree.ts`, the
 * log entry that publishes a table is `rights-log.ts`.
 */

export const ZERO_ADDRESS = '0x' + '0'.repeat(40);

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A 0x address lower-cased, or null when it is not one. */
export function normalizeAddress(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return ADDRESS.test(s) ? s.toLowerCase() : null;
}

/** One row: what `party` may have collected from the Pot in `token`, all time. */
export interface RightsRow {
  party: string;
  /** The payout address, lower-cased; `ZERO_ADDRESS` when none is set. */
  to: string;
  /** The token, lower-cased; `ZERO_ADDRESS` for the chain's own coin. */
  token: string;
  /** Base units. */
  cumulative: bigint;
}

export interface RightsTable {
  /** The holon's lunation (`lunationAt().index`) the table was cut at. */
  epoch: number;
  /** Sorted by party, then token. */
  rows: RightsRow[];
  /** Token → the sum of its rows: what the table declares to the Pot. */
  totals: Record<string, bigint>;
}

export interface AdvanceRightsInput {
  previous: RightsTable | null | undefined;
  epoch: number;
  /** Party → share of the root pot in percent, as the cascade leaves it. */
  shares: Record<string, number>;
  /** Token → the Pot's cumulative `received` now, in base units. */
  received: Record<string, bigint>;
  /** Party → payout address, or null when none is set yet. */
  addressOf: (party: string) => string | null | undefined;
}

/** Shares as integer weights (parts per billion), only those that count, in a fixed order. */
function weightsOf(shares: Record<string, number>): Array<{ party: string; weight: bigint }> {
  const out: Array<{ party: string; weight: bigint }> = [];
  for (const [party, pct] of Object.entries(shares ?? {})) {
    const n = Number(pct);
    if (!Number.isFinite(n) || n <= 0) continue;
    const weight = BigInt(Math.round(n * 1e7)); // 100 % → 1e9
    if (weight > 0n) out.push({ party: String(party), weight });
  }
  return out.sort((a, b) => (a.party < b.party ? -1 : a.party > b.party ? 1 : 0));
}

/**
 * Divide `income` by weight so the parts add up to exactly `income`: floors,
 * then the largest remainders get the units left over (ties by party id).
 */
export function divideExactly(income: bigint, weights: Array<{ party: string; weight: bigint }>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const total = weights.reduce((s, w) => s + w.weight, 0n);
  if (income <= 0n || total <= 0n) return out;
  let given = 0n;
  const remainders: Array<{ party: string; rem: bigint }> = [];
  for (const { party, weight } of weights) {
    const part = (income * weight) / total;
    out.set(party, part);
    given += part;
    remainders.push({ party, rem: (income * weight) % total });
  }
  remainders.sort((a, b) => (a.rem > b.rem ? -1 : a.rem < b.rem ? 1 : a.party < b.party ? -1 : 1));
  let left = income - given;
  for (const { party } of remainders) {
    if (left <= 0n) break;
    out.set(party, (out.get(party) ?? 0n) + 1n);
    left -= 1n;
  }
  return out;
}

const rowKey = (party: string, token: string) => `${party}\u0000${token}`;

/** The next table: last moon's rows carried forward, this lunation's income added by share. */
export function advanceRights(input: AdvanceRightsInput): RightsTable {
  const previous = input.previous ?? null;
  const epoch = Math.floor(Number(input.epoch));
  if (!Number.isFinite(epoch)) throw new Error('An epoch is required');
  if (previous && epoch <= previous.epoch) throw new Error(`Epoch ${epoch} is not after the last table (${previous.epoch})`);

  const weights = weightsOf(input.shares);
  const rows = new Map<string, RightsRow>();
  for (const row of previous?.rows ?? []) {
    rows.set(rowKey(row.party, row.token), { ...row });
  }

  const tokens = new Set<string>([...Object.keys(previous?.totals ?? {}), ...Object.keys(input.received ?? {})]);
  const totals: Record<string, bigint> = {};
  for (const raw of tokens) {
    const token = normalizeAddress(raw);
    if (!token) throw new Error(`Not a token address: ${raw}`);
    const before = previous?.totals[token] ?? 0n;
    const now = input.received[raw] ?? input.received[token] ?? before;
    if (now < before) throw new Error(`The Pot's receipts in ${token} went backwards (${now} < ${before})`);
    const income = now - before;
    if (income > 0n && weights.length === 0) throw new Error('Income with nobody to divide it among');
    for (const [party, part] of divideExactly(income, weights)) {
      if (part <= 0n) continue;
      const key = rowKey(party, token);
      const row = rows.get(key) ?? { party, to: ZERO_ADDRESS, token, cumulative: 0n };
      row.cumulative += part;
      rows.set(key, row);
    }
    totals[token] = now;
  }

  const out: RightsRow[] = [];
  const sums: Record<string, bigint> = {};
  for (const row of rows.values()) {
    row.to = normalizeAddress(input.addressOf(row.party)) ?? ZERO_ADDRESS;
    out.push(row);
    sums[row.token] = (sums[row.token] ?? 0n) + row.cumulative;
  }
  for (const [token, sum] of Object.entries(sums)) {
    if (sum !== (totals[token] ?? 0n)) throw new Error(`Rows in ${token} sum to ${sum}, receipts say ${totals[token] ?? 0n}`);
  }
  out.sort((a, b) => (a.party < b.party ? -1 : a.party > b.party ? 1 : a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
  return { epoch, rows: out, totals };
}

/** The row for `party` in `token`, if the table has one. */
export function rightsRow(table: RightsTable | null | undefined, party: string, token: string): RightsRow | null {
  const t = normalizeAddress(token);
  if (!table || !t) return null;
  const p = String(party);
  return table.rows.find((r) => r.party === p && r.token === t) ?? null;
}

/** What `party` may still collect in `token`: the row's cumulative less what the Pot has released to them. */
export function collectable(table: RightsTable | null | undefined, party: string, token: string, released: bigint): bigint {
  const row = rightsRow(table, party, token);
  if (!row) return 0n;
  return row.cumulative > released ? row.cumulative - released : 0n;
}

/** Every table row is monotone over its predecessor and nothing was dropped — what a reviewer checks before signing. */
export function rightsRegression(previous: RightsTable | null | undefined, next: RightsTable): string[] {
  const problems: string[] = [];
  if (previous && next.epoch <= previous.epoch) problems.push(`epoch ${next.epoch} is not after ${previous.epoch}`);
  for (const row of previous?.rows ?? []) {
    const after = rightsRow(next, row.party, row.token);
    if (!after) problems.push(`${row.party} lost its ${row.token} row`);
    else if (after.cumulative < row.cumulative) problems.push(`${row.party} decreased in ${row.token}`);
  }
  for (const [token, total] of Object.entries(previous?.totals ?? {})) {
    if ((next.totals[token] ?? 0n) < total) problems.push(`total in ${token} decreased`);
  }
  const sums: Record<string, bigint> = {};
  for (const row of next.rows) sums[row.token] = (sums[row.token] ?? 0n) + row.cumulative;
  for (const [token, total] of Object.entries(next.totals)) {
    if ((sums[token] ?? 0n) !== total) problems.push(`rows in ${token} do not add up to the declared total`);
  }
  return problems;
}
