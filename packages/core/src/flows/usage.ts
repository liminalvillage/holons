// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fund usage — how much of each allocation right has already been taken.
 *
 * An allocation gives every member and partner a RIGHT over the fund: the
 * share of it they may direct. This module answers the question that right
 * raises next — how much of it is gone. Two ledgers know:
 *
 *   the expenses lens — mutual credit with the holon itself as a party. A
 *     member who pays for something and splits it with the holon has CLAIMED
 *     that share from the fund; the holon settling up (or paying anything at
 *     all, an expense or a settlement) is the fund being SPENT, attributed to
 *     whoever it was shared with.
 *
 *   OpenCollective — the expense queue. A PAID expense is money its payee has
 *     taken out; an open one (pending, approved, scheduled …) is money they
 *     have claimed and are still waiting on. Payees are matched to
 *     rights-holders by name or slug; whatever matches nobody is reported as
 *     unattributed rather than dropped, so the fund still adds up.
 *
 * Both are read; neither is reconciled against the other. A claim recorded on
 * the lens AND submitted to the collective counts twice until the lens one is
 * settled — two ledgers are two ledgers, and inventing a link between their
 * rows would be a guess dressed as a number.
 *
 * Units never mix. Usage is kept per currency: the pot's currency is what the
 * diagram draws, and anything else a party claimed or was paid rides along
 * per unit for the detail views to print as text. Nothing here sums across
 * units.
 *
 * Spending is windowed like the movement board; claims are not. A payout
 * belongs to the period it happened in, but an open claim is owed today
 * whenever it was raised.
 *
 * Everything is pure: callers hand in plain arrays.
 */

import { expenseSharers, isSettlement, type Expense } from '../expenses/index.js';
import { expenseCurrency, normalizeCurrency } from '../expenses/index.js';
import { foldForSearch } from './ledger.js';
import type { OpenCollectiveSnapshot } from './opencollective.js';
import type { AllocationResult, AllocationSlice } from './allocation.js';
import { resolveWindow, type FlowsWindow } from './window.js';

/** Someone with a right over the fund: a scored member or a placed partner. */
export interface FundUsageParty {
  id: string;
  name: string;
  /** Other names the payee could carry on the platform: username, full name. */
  aliases?: string[];
}

/** How much of a right is gone, in one currency. Both always >= 0. */
export interface FundUse {
  /** Paid out already. */
  spent: number;
  /** Claimed and still owed. */
  claimed: number;
}

/** A collective payee matched to no rights-holder, and what they got. */
export interface FundPayee {
  name: string;
  /** Normalized unit the amounts are in. */
  unit: string;
  spent: number;
  claimed: number;
}

/** Usage across every party and currency, in one read. */
export interface FundUsage {
  /** The pot's currency, normalized — what the diagram draws. */
  unit: string;
  /** Party id → normalized unit → use. Only units with something in them. */
  parties: Record<string, Record<string, FundUse>>;
  /**
   * The same use, cumulative: every payout ever, whatever window is drawn.
   *
   * Rights are accounted against THIS, never against `parties`. A payout that
   * has aged out of the window is still money the party took, and forgetting
   * it would hand them their whole right a second time — and would shrink the
   * pot under everyone else, moving rights that nobody claimed against.
   * `parties` answers "what moved in this period"; this answers "what is gone".
   */
  lifetime: Record<string, Record<string, FundUse>>;
  /** Normalized unit → use, for collective payees matched to no party. */
  unattributed: Record<string, FundUse>;
  /** The unmatched payees with their amounts, largest first, so a reader can see who was missed. */
  unattributedPayees: FundPayee[];
}

export interface BuildFundUsageInput {
  /** The holon whose fund this is — the party mutual credit treats as the fund. */
  holonId: string;
  /** The pot's currency. */
  unit: string;
  parties: FundUsageParty[];
  expenses: Expense[];
  /**
   * Everyone in the holon: who an expense with no split is shared by. Defaults
   * to the parties, so a fund payment nobody was named on is spent by all of them.
   */
  members?: readonly string[];
  collective?: OpenCollectiveSnapshot | null;
  now?: number;
  /** `null` means all time. Defaults like the ledger. */
  windowDays?: number | null;
  /** Absolute bounds; wins over `windowDays` (see `resolveWindow`). */
  window?: FlowsWindow | null;
}

export const DEFAULT_USAGE_WINDOW_DAYS = 90;

const round = (value: number) => Math.round(value * 100) / 100;

const EMPTY_USE: FundUse = { spent: 0, claimed: 0 };

/** A party's use in one unit; zeros when it never touched the fund in it. */
export function usageOf(usage: FundUsage | null | undefined, partyId: string, unit?: string): FundUse {
  if (!usage) return { ...EMPTY_USE };
  const want = normalizeCurrency(unit ?? usage.unit);
  return { ...(usage.parties[partyId]?.[want] ?? EMPTY_USE) };
}

/**
 * A party's CUMULATIVE use in one unit — what their right is accounted
 * against. Unlike `usageOf`, no window narrows it: a payout from two years
 * ago is still a payout.
 */
export function lifetimeOf(
  usage: FundUsage | null | undefined,
  partyId: string,
  unit?: string,
): FundUse {
  if (!usage) return { ...EMPTY_USE };
  const want = normalizeCurrency(unit ?? usage.unit);
  // Tolerate a usage object built before this field existed (a hand-made
  // fixture, a stale build across the package boundary) rather than throwing.
  return { ...(usage.lifetime?.[partyId]?.[want] ?? EMPTY_USE) };
}

/** Cumulative totals across every rights-holder in one unit. */
export function lifetimeTotals(usage: FundUsage | null | undefined, unit?: string): FundUse {
  if (!usage) return { ...EMPTY_USE };
  const want = normalizeCurrency(unit ?? usage.unit);
  const out = { ...EMPTY_USE };
  for (const perUnit of Object.values(usage.lifetime ?? {})) {
    const use = perUnit[want];
    if (!use) continue;
    out.spent += use.spent;
    out.claimed += use.claimed;
  }
  return { spent: round(out.spent), claimed: round(out.claimed) };
}

/** Every unit a party has any use in, the pot's first. */
export function usageUnits(usage: FundUsage | null | undefined, partyId?: string): string[] {
  if (!usage) return [];
  const units = new Set<string>();
  if (partyId) {
    for (const unit of Object.keys(usage.parties[partyId] ?? {})) units.add(unit);
  } else {
    for (const perUnit of Object.values(usage.parties)) {
      for (const unit of Object.keys(perUnit)) units.add(unit);
    }
    for (const unit of Object.keys(usage.unattributed)) units.add(unit);
  }
  const list = [...units].filter((u) => u !== usage.unit).sort();
  return units.has(usage.unit) ? [usage.unit, ...list] : list;
}

/** Totals in one unit — the attributed parties plus the unattributed remainder. */
export function usageTotals(
  usage: FundUsage | null | undefined,
  unit?: string,
): FundUse & { attributed: FundUse; unattributed: FundUse } {
  const empty = () => ({ ...EMPTY_USE });
  if (!usage) return { ...empty(), attributed: empty(), unattributed: empty() };
  const want = normalizeCurrency(unit ?? usage.unit);
  const attributed = empty();
  for (const perUnit of Object.values(usage.parties)) {
    const use = perUnit[want];
    if (!use) continue;
    attributed.spent += use.spent;
    attributed.claimed += use.claimed;
  }
  const unattributed = { ...(usage.unattributed[want] ?? EMPTY_USE) };
  return {
    spent: round(attributed.spent + unattributed.spent),
    claimed: round(attributed.claimed + unattributed.claimed),
    attributed: { spent: round(attributed.spent), claimed: round(attributed.claimed) },
    unattributed,
  };
}

/**
 * The fund the rights are over, given what is in the bank now.
 *
 * A balance is what is LEFT. Rights are shares of what there was to direct,
 * so what has already been paid out to rights-holders is added back — a
 * member who spent their whole share still had one — and what open claims
 * promise to outsiders is taken off, since it will never reach a
 * rights-holder. Unattributed payouts are outside the rights entirely and are
 * drawn as their own branch by `allocationToGraph`.
 *
 * Deliberately window-independent: the add-back reads the cumulative ledger,
 * never the windowed one. A pot that forgot payouts older than the window
 * would shrink whenever the period narrowed, re-cutting the rights of people
 * who had claimed nothing — the window is a lens on movement, not a fact
 * about how much there was to divide.
 */
export function rightsTotal(balance: number, usage: FundUsage | null | undefined): number {
  const drawn = lifetimeTotals(usage);
  const outside = usage ? (usage.unattributed[usage.unit] ?? EMPTY_USE) : EMPTY_USE;
  const total = balance + drawn.spent - outside.claimed;
  return Math.max(0, round(total));
}

/** A slug the way the platform would derive it from a name. */
function slugOf(value: string): string {
  return foldForSearch(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Pair every party with the folded names and slugs a payee could carry.
 *
 * A payee matches on its display name or its slug, against the party's name
 * and every alias. Ties go to the first party listed, and a party whose name
 * is empty matches nothing rather than everything.
 */
function payeeIndex(parties: FundUsageParty[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const party of parties) {
    const candidates = [party.name, ...(party.aliases ?? [])]
      .map((c) => String(c ?? '').trim())
      .filter(Boolean);
    for (const candidate of candidates) {
      const folded = foldForSearch(candidate);
      const slug = slugOf(candidate);
      if (folded && !index.has(`name:${folded}`)) index.set(`name:${folded}`, party.id);
      if (slug && !index.has(`slug:${slug}`)) index.set(`slug:${slug}`, party.id);
    }
  }
  return index;
}

function matchPayee(
  index: Map<string, string>,
  payee: string | undefined,
  payeeSlug: string | undefined,
): string | null {
  const bySlug = payeeSlug ? index.get(`slug:${slugOf(payeeSlug)}`) : undefined;
  if (bySlug) return bySlug;
  const byName = payee ? index.get(`name:${foldForSearch(payee)}`) : undefined;
  if (byName) return byName;
  // A payee display name can itself be slug-shaped ("raj-aryan"); try it as one.
  const byNameAsSlug = payee ? index.get(`slug:${slugOf(payee)}`) : undefined;
  return byNameAsSlug ?? null;
}

/** Read how much of every right has been spent or claimed. */
export function buildFundUsage(input: BuildFundUsageInput): FundUsage {
  const { from, to } = resolveWindow(input, DEFAULT_USAGE_WINDOW_DAYS);
  const inWindow = (ts: number) => Number.isFinite(ts) && ts >= from && ts <= to;

  const holonId = String(input.holonId ?? '');
  const parties = (input.parties ?? []).filter((p) => p && String(p.id ?? ''));
  const partyIds = new Set(parties.map((p) => String(p.id)));
  const members = (input.members ?? [...partyIds]).map((id) => String(id));

  const usage: FundUsage = {
    unit: normalizeCurrency(input.unit),
    parties: {},
    lifetime: {},
    unattributed: {},
    unattributedPayees: [],
  };

  const touch = (partyId: string | null, unit: string): FundUse => {
    if (!unit) return { spent: 0, claimed: 0 }; // a throwaway: no unit, no bucket
    if (partyId == null) {
      return (usage.unattributed[unit] ??= { spent: 0, claimed: 0 });
    }
    const perUnit = (usage.parties[partyId] ??= {});
    return (perUnit[unit] ??= { spent: 0, claimed: 0 });
  };

  /**
   * The cumulative bucket for a rights-holder. Money paid to someone with no
   * right has no right to account against, so it is not tracked here — it
   * stays in `unattributed`, where the pot already treats it as gone.
   */
  const touchLife = (partyId: string, unit: string): FundUse => {
    if (!unit) return { spent: 0, claimed: 0 };
    const perUnit = (usage.lifetime[partyId] ??= {});
    return (perUnit[unit] ??= { spent: 0, claimed: 0 });
  };

  // ── The expenses lens: mutual credit with the holon as the fund ──────────
  // Claims are gross and all-time: what parties fronted for the holon, less
  // what the holon has settled with them. Spending is every holon-paid
  // record in the window, attributed by share to whoever it was split with.
  const claimedGross = new Map<string, number>(); // `${party}|${unit}`
  const settled = new Map<string, number>();
  if (holonId) {
    for (const expense of input.expenses ?? []) {
      if (!expense) continue;
      const amount = Number(expense.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const unit = expenseCurrency(expense);
      if (!unit) continue;
      const payer = String(expense.paidBy ?? '');
      // An expense with no split is for the entire group.
      const splitWith = expenseSharers(expense, members).map((id) => String(id));
      const share = amount / (splitWith.length > 0 ? splitWith.length : 1);
      const created = Date.parse(String(expense.created ?? ''));

      if (payer === holonId) {
        // The fund paid. Each party's share of it is their spending — a
        // settlement included, which is the fund paying a claim back.
        const paidBack = isSettlement(expense);
        for (const id of splitWith) {
          if (id === holonId || !partyIds.has(id)) continue;
          if (paidBack) {
            const key = `${id}|${unit}`;
            settled.set(key, (settled.get(key) ?? 0) + share);
          }
          // Cumulative always; the windowed view only when it belongs to the period.
          touchLife(id, unit).spent += share;
          if (inWindow(created)) touch(id, unit).spent += share;
        }
        continue;
      }

      // A party paid and shared it with the holon: they claimed that share.
      if (partyIds.has(payer) && splitWith.includes(holonId)) {
        const key = `${payer}|${unit}`;
        claimedGross.set(key, (claimedGross.get(key) ?? 0) + share);
      }
    }
  }
  for (const [key, gross] of claimedGross) {
    const [partyId, unit] = key.split('|');
    const open = gross - (settled.get(key) ?? 0);
    if (open > 0.005) {
      touch(partyId, unit).claimed += open;
      touchLife(partyId, unit).claimed += open;
    }
  }

  // ── OpenCollective: the expense queue, by payee ─────────────────────────
  const index = payeeIndex(parties);
  const missed = new Map<string, FundPayee>();
  for (const expense of input.collective?.expenses ?? []) {
    if (!expense || !(expense.amount > 0)) continue;
    const unit = normalizeCurrency(expense.currency || input.collective?.currency || '');
    if (!unit) continue;

    const paid = expense.status === 'paid';
    const partyId = matchPayee(index, expense.payee, expense.payeeSlug);

    // Cumulative first: a payout keeps standing against the right that
    // covered it long after it has left the window.
    if (partyId != null) {
      const life = touchLife(partyId, unit);
      if (paid) life.spent += expense.amount;
      else life.claimed += expense.amount;
    }

    // The windowed view drops old payouts. Open claims are owed today
    // whenever they were raised, so they are never windowed out.
    if (paid && !inWindow(expense.createdAt)) continue;

    const use = touch(partyId, unit);
    if (paid) use.spent += expense.amount;
    else use.claimed += expense.amount;
    if (partyId == null) {
      const who = String(expense.payee || expense.payeeSlug || '').trim();
      if (!who) continue;
      const key = `${who}|${unit}`;
      const payee = missed.get(key) ?? { name: who, unit, spent: 0, claimed: 0 };
      if (expense.status === 'paid') payee.spent += expense.amount;
      else payee.claimed += expense.amount;
      missed.set(key, payee);
    }
  }
  usage.unattributedPayees = [...missed.values()]
    .map((p) => ({ ...p, spent: round(p.spent), claimed: round(p.claimed) }))
    .sort((a, b) => b.spent + b.claimed - (a.spent + a.claimed));

  // Round once, at the end, so shares that split a cent do not drift.
  for (const perUnit of Object.values(usage.parties)) {
    for (const use of Object.values(perUnit)) {
      use.spent = round(use.spent);
      use.claimed = round(use.claimed);
    }
  }
  for (const perUnit of Object.values(usage.lifetime)) {
    for (const use of Object.values(perUnit)) {
      use.spent = round(use.spent);
      use.claimed = round(use.claimed);
    }
  }
  for (const use of Object.values(usage.unattributed)) {
    use.spent = round(use.spent);
    use.claimed = round(use.claimed);
  }

  return usage;
}

// ── One party's account ──────────────────────────────────────────────────
// A right read the way a bank reads a balance: what was granted, what has
// gone out, what is still owed, what is left.

/** A right's use in a unit other than the pot's; text only, never summed. */
export interface FundAccountOtherUse extends FundUse {
  unit: string;
}

/** One rights-holder's statement over the fund. */
export interface FundAccount {
  id: string;
  label: string;
  side: 'interior' | 'exterior';
  /** Exterior only: the ring the right comes from. */
  zone?: number;
  /** Share of the whole pot, 0..100. */
  percentage: number;
  /** The pot's unit, or '' when the allocation is percentage-only. */
  unit: string;
  /** The right in the pot's unit; null when the allocation is percentage-only. */
  right: number | null;
  /** Paid out within the window, in the pot's unit — the period line. */
  spent: number;
  /** Paid out ever, in the pot's unit. What `available` is measured against. */
  lifetimeSpent: number;
  /** Claimed and still owed, in the pot's unit. */
  claimed: number;
  /** right − lifetimeSpent − claimed, floored at zero; null without a right. */
  available: number | null;
  /** How far past the right the party has gone; 0 while within it. */
  over: number;
  /** What the party drew in every other unit, for the statement's footnotes. */
  otherUnits: FundAccountOtherUse[];
}

/**
 * Every seat a party holds: a contributor share, a zone seat, or both when a
 * member is also placed on a ring. Interior first.
 */
function slicesOf(allocation: AllocationResult, partyId: string): AllocationSlice[] {
  const hits: AllocationSlice[] = allocation.interior.filter((m) => m.id === partyId);
  for (const zone of allocation.exterior) {
    for (const p of zone.members ?? []) if (p.id === partyId) hits.push(p);
  }
  return hits;
}

/**
 * One party's statement: their right and what is left of it.
 *
 * Returns null when the party holds no right — a zoned partner not placed
 * on a ring, a member who scored nothing — so the caller can say so instead
 * of printing zeros that look like an empty account. A party seated twice
 * (contributor share AND a zone seat) has one account: the seats add up,
 * and the statement names the contributor side with the zone alongside.
 */
export function fundAccount(
  allocation: AllocationResult,
  usage: FundUsage | null | undefined,
  partyId: string,
): FundAccount | null {
  const id = String(partyId ?? '');
  if (!id) return null;
  const slices = slicesOf(allocation, id);
  if (!slices.length) return null;
  const slice = slices[0];
  const zoned = slices.find((s) => s.zone != null);
  const percentage = slices.reduce((sum, s) => sum + s.percentage, 0);

  const unit = usage?.unit ?? normalizeCurrency(allocation.unit);
  const use = usageOf(usage, id, unit);
  // What is left of a right is measured against everything ever drawn on it,
  // never against the period on screen: narrowing the window must not hand
  // someone their right a second time.
  const drawn = lifetimeOf(usage, id, unit);
  const right =
    slice.amount == null ? null : round(slices.reduce((sum, s) => sum + (s.amount ?? 0), 0));
  const left = right == null ? null : round(right - drawn.spent - drawn.claimed);

  // The footnotes are part of the statement, so they are cumulative too.
  const otherUnits: FundAccountOtherUse[] = Object.keys(usage?.lifetime?.[id] ?? {})
    .filter((u) => u !== unit)
    .sort()
    .map((u) => ({ unit: u, ...lifetimeOf(usage, id, u) }))
    .filter((u) => u.spent > 0 || u.claimed > 0);

  return {
    id,
    label: slice.label,
    side: slice.side,
    ...(zoned?.zone != null ? { zone: zoned.zone } : {}),
    percentage,
    unit,
    right,
    spent: use.spent,
    lifetimeSpent: drawn.spent,
    claimed: drawn.claimed,
    available: left == null ? null : Math.max(0, left),
    over: left == null || left >= 0 ? 0 : -left,
    otherUnits,
  };
}
