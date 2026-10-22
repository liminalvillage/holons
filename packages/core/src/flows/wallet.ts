// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The wallet — one party's balances, every unit at once.
 *
 * A holon can hold euros in the bank, litres from the harvest, a token in
 * its Pot and a mutual-credit ledger in three currencies. Each is its own
 * unit and none converts into another, so a person's position is not one
 * number but a short list: per unit, what the fund opens to them (their
 * access, `fundAccount`) and what the group's mutual credit says between
 * them and everyone else (`computeMutualCredit`). This module builds that
 * list, in one order, so the kiosk, the web, the bot and the MCP print the
 * same lines.
 *
 * One rule, read per unit: the split is a rule about shares, so the same
 * `AllocationResult` is priced in each unit's pot (`withPot`) and read for
 * the party. The usage already keys every unit it saw (`lifetime`, `moved`),
 * so one usage serves every line.
 *
 * A unit held in the holon's Pot is listed — it is still the party's — but
 * flagged `held`: it is collected from the Pot by its rights table, never
 * claimed in the log, and `claimable` is zero there.
 *
 * Pure: shapes in, lines out.
 */

import { normalizeCurrency, type MutualCredit } from '../expenses/index.js';
import { withPot, type AllocationResult } from './allocation.js';
import { claimHeadroom } from './ceiling.js';
import type { FoldedClaims, RightsLookup } from './claims.js';
import { potBalance, potTotal, potUnits, type PotSources } from './pot.js';
import { fundAccount, inboundTotal, type FundAccount, type FundUsage } from './usage.js';

/** Where a unit's value comes from, for a line's caption. */
export type WalletSource = 'collective' | 'pot' | 'mint' | 'inbound' | 'credit';

/** The party's mutual-credit position in one unit. */
export interface WalletCredit {
  /** Net position: positive is owed to the party, negative the party owes. */
  net: number;
  /** What others owe the party, by the open pairs. */
  owedToYou: number;
  /** What the party owes others, by the open pairs. */
  youOwe: number;
}

/** One unit of a party's wallet. */
export interface WalletLine {
  /** Normalized, lower-case, as the diagrams key units. */
  unit: string;
  /** The party's statement over the fund in this unit; null with no seat and nothing received. */
  account: FundAccount | null;
  /** The party's mutual-credit position; null when nothing is open or recorded for them. */
  credit: WalletCredit | null;
  /** What the fund still opens to the party: `account.available`, 0 without an account. */
  available: number;
  /**
   * What the next claim or give may be (`claimHeadroom`): access less what
   * the log already holds, pending included. Null when no ceilings were
   * given — the form then takes any amount, as the fold would.
   */
  claimable: number | null;
  /** The pot in this unit, what there is to divide. 0 for a credit-only line. */
  pot: number;
  /** Where the unit comes from. */
  sources: WalletSource[];
  /** Held in the holon's Pot: collected by its table, not claimed in the log. */
  held: boolean;
}

export interface BuildWalletInput {
  partyId: string;
  /** Who holds what share: `cascadeRights(cascade)` or the root `allocate(...)`. Percentages are read. */
  shares: AllocationResult;
  /** What feeds the pot, per unit. */
  sources: PotSources;
  /** The fund's usage (judged fold); one serves every unit. */
  usage: FundUsage | null | undefined;
  /** The group's mutual credit, one per currency, when the surface computed it. */
  credit?: readonly MutualCredit[] | null;
  /** Units held in the holon's Pot. */
  held?: readonly string[] | null;
  /** The ceilings the fold judges under, with the fold, for `claimable`. */
  ceilings?: RightsLookup | null;
  claims?: FoldedClaims | null;
}

const DUST = 0.005;
const round = (v: number) => Math.round(v * 100) / 100;

/** A party's position in one currency's mutual credit, or null when they are not in it. */
export function creditPositionOf(credit: MutualCredit | null | undefined, partyId: string): WalletCredit | null {
  if (!credit) return null;
  const id = String(partyId);
  const own = credit.balances.find((b) => String(b.userId) === id);
  if (!own) return null;
  let owedToYou = 0;
  let youOwe = 0;
  for (const p of credit.pairs) {
    if (String(p.to) === id) owedToYou += p.amount;
    else if (String(p.from) === id) youOwe += p.amount;
  }
  const net = round(own.net);
  if (Math.abs(net) < DUST && owedToYou < DUST && youOwe < DUST) return null;
  return { net, owedToYou: round(owedToYou), youOwe: round(youOwe) };
}

function sourcesOf(unit: string, sources: PotSources, held: boolean): WalletSource[] {
  const out: WalletSource[] = [];
  const c = sources.collective;
  if (c && normalizeCurrency(c.currency) === unit) out.push('collective');
  if (held) out.push('pot');
  const minted = Object.entries(sources.mints?.byUnit ?? {}).some(([u, v]) => normalizeCurrency(u) === unit && v > 0);
  if (minted && !held) out.push('mint');
  if (inboundTotal(sources.inbound, unit) > 0) out.push('inbound');
  return out;
}

/**
 * The party's wallet: one line per unit they hold anything in — a seat on
 * the fund, access someone gave them, or an open mutual-credit position.
 * Fund units first in `potUnits` order, then credit-only units largest first.
 * Nothing is summed across lines.
 */
export function buildWallet(input: BuildWalletInput): WalletLine[] {
  const party = String(input.partyId ?? '');
  if (!party) return [];
  const held = new Set((input.held ?? []).map((u) => normalizeCurrency(u)));
  const creditByUnit = new Map<string, MutualCredit>();
  for (const c of input.credit ?? []) {
    const u = normalizeCurrency(c.currency);
    if (u && !creditByUnit.has(u)) creditByUnit.set(u, c);
  }

  const lines: WalletLine[] = [];
  const seen = new Set<string>();
  for (const unit of potUnits(input.sources)) {
    seen.add(unit);
    const pot = potTotal(unit, input.sources, input.usage);
    const priced = withPot(input.shares, pot || null, unit);
    const account = fundAccount(priced, input.usage, party, unit);
    const credit = creditPositionOf(creditByUnit.get(unit), party);
    if (!account && !credit) continue;
    const isHeld = held.has(unit);
    const claimable = isHeld ? 0 : (input.ceilings ? claimHeadroom(input.ceilings, input.claims, party, unit) : null);
    lines.push({
      unit,
      account,
      credit,
      available: account?.available ?? 0,
      claimable,
      pot: round(pot || potBalance(unit, input.sources)),
      sources: sourcesOf(unit, input.sources, isHeld),
      held: isHeld,
    });
  }

  // A unit the fund never held can still be between people: a shared
  // expense in a currency nobody minted or banked.
  const creditOnly: WalletLine[] = [];
  for (const [unit, c] of creditByUnit) {
    if (seen.has(unit)) continue;
    const credit = creditPositionOf(c, party);
    if (!credit) continue;
    // Access someone gave in a unit the fund holds nothing of — a give in
    // a unit with no pot — still shows on the statement.
    const account = fundAccount(withPot(input.shares, null, unit), input.usage, party, unit);
    creditOnly.push({
      unit,
      account: account && (account.received > 0 || account.given > 0) ? account : null,
      credit,
      available: 0,
      claimable: null,
      pot: 0,
      sources: ['credit'],
      held: false,
    });
  }
  creditOnly.sort((a, b) => Math.abs(b.credit!.net) - Math.abs(a.credit!.net) || (a.unit < b.unit ? -1 : 1));
  return [...lines, ...creditOnly];
}

/** The line for `unit`, or null. */
export function walletLine(wallet: readonly WalletLine[] | null | undefined, unit: string): WalletLine | null {
  const want = normalizeCurrency(unit);
  return (wallet ?? []).find((l) => l.unit === want) ?? null;
}
