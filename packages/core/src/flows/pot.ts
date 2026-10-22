// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pot — what a holon has to divide, in one unit.
 *
 * Four things feed it and none of them converts into another:
 *
 *   the collective   — OpenCollective money, in the collective's currency
 *   the mints        — what attesters issued (`mints.ts`), per unit
 *   the inbound      — rights held over upstream funds (`inbound.ts`), per unit
 *   the Pot          — what the holon's own Pot received on-chain, per token
 *                      unit; for that unit it IS the pot, and a mint in the
 *                      same unit is the same lot said twice (not added)
 *
 * An inbound right the upstream holds in a Pot (`heldAt`) is shown but not
 * divided here: it is collected from that Pot, by its table. Counting it
 * would let the same value be claimed in two logs.
 *
 * A holon with euros in the bank and litres from the harvest has two pots and
 * draws two diagrams. This module says which units there are and, for one of
 * them, how much: the same `rightsTotal` rule as before, with mints standing
 * where the bank balance stood and inbound added on top. One place, so the
 * kiosk, the web and the MCP agree on what a unit pill offers and what the
 * pot bar reads.
 */

import { normalizeCurrency } from '../expenses/index.js';
import { mintedTotal, type FoldedMints } from './mints.js';
import { inboundTotal, rightsTotal, type FundUsage, type InboundRight } from './usage.js';

export interface PotSources {
  collective?: { currency: string; balance: number } | null;
  mints?: FoldedMints | null;
  inbound?: readonly InboundRight[] | null;
  /** Unit → what the holon's Pot received in it, all time, in that unit. */
  chain?: Record<string, number> | null;
}

/** The inbound rights that feed THIS pot: those not held in an upstream Pot. */
export function claimableInbound(inbound: readonly InboundRight[] | null | undefined): InboundRight[] {
  return (inbound ?? []).filter((r) => !r.heldAt);
}

/** Whether `unit` is held in the holon's Pot — then collected by its table, never claimed in the log. */
export function heldInPot(unit: string, sources: PotSources): boolean {
  const want = normalizeCurrency(unit);
  return Object.keys(sources.chain ?? {}).some((u) => normalizeCurrency(u) === want);
}

/** What the Pot received in `unit`, or 0. */
function chainReceived(unit: string, sources: PotSources): number {
  const want = normalizeCurrency(unit);
  let total = 0;
  for (const [u, v] of Object.entries(sources.chain ?? {})) if (normalizeCurrency(u) === want && Number.isFinite(v) && v > 0) total += v;
  return total;
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Every unit the holon holds something in, normalized as the diagrams key
 * them: the collective's currency first (the pot it always drew), then
 * minted units by size, then units only reached from upstream.
 */
export function potUnits(sources: PotSources): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (unit: unknown) => {
    const u = normalizeCurrency(String(unit ?? ''));
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  if (sources.collective?.currency) add(sources.collective.currency);
  for (const [unit] of Object.entries(sources.chain ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) add(unit);
  const minted = Object.entries(sources.mints?.byUnit ?? {})
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [unit] of minted) add(unit);
  const inbound = new Map<string, number>();
  for (const r of sources.inbound ?? []) {
    const u = normalizeCurrency(r.unit);
    if (r.right > 0) inbound.set(u, (inbound.get(u) ?? 0) + r.right);
  }
  for (const [unit] of [...inbound.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) add(unit);
  return out;
}

/** The unit a board opens on: the first `potUnits` gives, or '' when the holon holds nothing. */
export function defaultPotUnit(sources: PotSources): string {
  return potUnits(sources)[0] ?? '';
}

/**
 * What the holon itself holds in `unit`, before rights are accounted: the
 * collective's balance when it is in that currency, plus what was minted in
 * it — or, for a unit its Pot holds, what the Pot received (a mint in that
 * unit is the same lot). Inbound is not held here — `rightsTotal` adds it as such.
 */
export function potBalance(unit: string, sources: PotSources): number {
  const want = normalizeCurrency(unit);
  let balance = 0;
  const c = sources.collective;
  if (c && normalizeCurrency(c.currency) === want && Number.isFinite(c.balance)) balance += c.balance;
  if (heldInPot(unit, sources)) return round(balance + chainReceived(unit, sources));
  for (const [u, total] of Object.entries(sources.mints?.byUnit ?? {})) {
    if (normalizeCurrency(u) === want && total > 0) balance += total;
  }
  return round(balance);
}

/** Whether anything at all feeds the pot in `unit`. */
export function hasPot(unit: string, sources: PotSources): boolean {
  return potBalance(unit, sources) > 0 || inboundTotal(claimableInbound(sources.inbound), unit) > 0;
}

/**
 * The pot to divide in `unit`. Zero when nothing feeds it.
 *
 * Two kinds of source, two readings. A BANK BALANCE is net of what was paid
 * out: a payout made it smaller, so `rightsTotal` adds the lifetime spend
 * back (a right that was spent still was one) and subtracts outsiders'
 * claims. A MINT or an INBOUND right is GROSS: 200 L minted stay 200 L
 * minted however many jugs were handed over, and a right cut upstream never
 * shrinks with a payout here — adding the spend back on top of those would
 * count every payout twice (the fund read 112 L after 12 L of a 100 L right
 * were paid; it holds 100).
 */
export function potTotal(unit: string, sources: PotSources, usage: FundUsage | null | undefined): number {
  if (!hasPot(unit, sources)) return 0;
  const want = normalizeCurrency(unit);
  const c = sources.collective;
  const bank =
    c && normalizeCurrency(c.currency) === want && Number.isFinite(c.balance)
      ? rightsTotal(c.balance, usage, 0, want)
      : 0;
  const gross = (heldInPot(unit, sources) ? chainReceived(unit, sources) : mintedTotal(sources.mints, unit)) + inboundTotal(claimableInbound(sources.inbound), unit);
  return round(bank + gross);
}

/** What was minted in `unit`, for a bar's own label. */
export function mintedIn(unit: string, sources: PotSources): number {
  return mintedTotal(sources.mints, unit);
}
