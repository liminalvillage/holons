// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Treasury and self-financing — the coop's own pocket.
 *
 * The treasury is a virtual account (`TREASURY_ID`) on the ordinary expenses
 * lens: every settlement withholds `treasuryRate` of the moved hours as a
 * fee expense paid BY the treasury (credited to it), and a passed funding
 * proposal moves hours back out to its beneficiary. The balance is therefore
 * just `computeUserCurrencyBalance` over records every UI already renders —
 * no parallel ledger.
 *
 * The rate itself lives on the holon's settings doc (`treasuryRate`) and is
 * meant to be changed by executing a passed `newTreasuryRate` proposal, not
 * edited by hand — the whitepaper's "democratically agreed upon" fee. It
 * defaults to 0, so a holon pays no fee until its coop votes one in.
 */

import {
  computeUserCurrencyBalance,
  createExpense,
  type Expense,
} from '../expenses/index.js';
import type { ProposalTally } from './tally.js';

/** The coop's own account id on the expenses lens. */
export const TREASURY_ID = 'treasury';

/** Settings-doc field holding the per-settlement fee rate. */
export const TREASURY_RATE_KEY = 'treasuryRate';

const MAX_RATE = 0.5;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A usable rate: finite, never negative, never more than half the exchange. */
export function clampTreasuryRate(rate: unknown): number {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_RATE);
}

/** The holon's fee rate from its settings doc (0 when unset). */
export function readTreasuryRate(settings: unknown): number {
  const doc = settings as Record<string, unknown> | null;
  return clampTreasuryRate(doc?.[TREASURY_RATE_KEY]);
}

/**
 * Split settled hours between the provider and the treasury. Two-decimal
 * money math with the fee rounded first, so the parts re-sum exactly.
 */
export function splitHours(
  hours: number,
  rate: number
): { toProvider: number; toTreasury: number } {
  const toTreasury = round2(hours * clampTreasuryRate(rate));
  return { toProvider: round2(hours - toTreasury), toTreasury };
}

/** Hours the coop currently holds — fees in, funded proposals out. */
export function treasuryBalance(expenses: Expense[]): number {
  return computeUserCurrencyBalance(expenses ?? [], TREASURY_ID, 'hour');
}

/** Stable id of a proposal's funding expense — a double execute upserts. */
export function fundingExpenseId(proposalId: string | number): string {
  return `gov-${proposalId}-funding`;
}

/** A `type:'proposal'` quest with the self-financing fields attached. */
export interface FundableProposal {
  id: string | number;
  type?: string;
  title?: string;
  status?: string;
  initiator?: { id?: string | number; username?: string };
  participants?: Array<{ id?: string | number } | null>;
  /** Hours asked from the treasury when the proposal passes. */
  requestedHours?: number;
  /** Who receives them — the initiator when unset (may be another coop). */
  beneficiary?: { id?: string | number; username?: string };
  /** A fee-rate change instead of (or besides) funding. */
  newTreasuryRate?: number;
  [key: string]: unknown;
}

export interface ExecuteStoreLike {
  put(holonId: string, lens: string, value: unknown): Promise<unknown>;
  get(holonId: string, lens: string, key?: string | number): Promise<unknown>;
}

export interface ExecuteProposalOptions {
  /** The weighted count this execution is justified by (`tallyProposal`). */
  tally: ProposalTally;
  /** Current treasury balance (`treasuryBalance` over the expenses lens). */
  balance: number;
  now?: number;
}

export type ExecuteProposalResult =
  | { ok: true; proposal: FundableProposal; expense?: Expense; rate?: number }
  | {
      ok: false;
      reason:
        | 'not_a_proposal'
        | 'already_executed'
        | 'not_passed'
        | 'no_effect'
        | 'insufficient_treasury';
    };

/**
 * Execute a passed proposal: move the requested hours treasury → beneficiary
 * and/or apply the voted fee rate to the settings doc, then stamp the
 * proposal `executed` with the tally it passed on. Validation-first — an
 * unpassed, empty, exhausted-treasury, or already-executed proposal writes
 * nothing.
 */
export async function executeProposal(
  db: ExecuteStoreLike,
  holonId: string,
  proposal: FundableProposal,
  opts: ExecuteProposalOptions
): Promise<ExecuteProposalResult> {
  if (!proposal || proposal.type !== 'proposal') {
    return { ok: false, reason: 'not_a_proposal' };
  }
  if (proposal.status === 'executed') {
    return { ok: false, reason: 'already_executed' };
  }
  if (!opts.tally?.passed) {
    return { ok: false, reason: 'not_passed' };
  }
  const requested = Number(proposal.requestedHours);
  const funds = Number.isFinite(requested) && requested > 0;
  const newRate =
    proposal.newTreasuryRate != null ? clampTreasuryRate(proposal.newTreasuryRate) : null;
  if (!funds && newRate == null) {
    return { ok: false, reason: 'no_effect' };
  }
  if (funds && requested > opts.balance) {
    return { ok: false, reason: 'insufficient_treasury' };
  }

  const now = opts.now ?? Date.now();
  let expense: Expense | undefined;
  if (funds) {
    const beneficiary = proposal.beneficiary?.id ?? proposal.initiator?.id ?? holonId;
    expense =
      createExpense({
        id: fundingExpenseId(proposal.id),
        holonId,
        amount: requested,
        currency: 'hour',
        description: String(proposal.title ?? 'funded proposal'),
        paidBy: beneficiary,
        splitWith: [TREASURY_ID],
        now,
      }) ?? undefined;
    if (expense) await db.put(holonId, 'expenses', expense);
  }

  if (newRate != null) {
    let settings: Record<string, unknown> = {};
    try {
      const raw = await db.get(holonId, 'settings', holonId);
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        settings = raw as Record<string, unknown>;
      }
    } catch {
      /* fresh settings */
    }
    await db.put(holonId, 'settings', {
      ...settings,
      id: holonId,
      [TREASURY_RATE_KEY]: newRate,
    });
  }

  const executed: FundableProposal = {
    ...proposal,
    status: 'executed',
    executedAt: new Date(now).toISOString(),
    executedTally: { yes: opts.tally.yes, total: opts.tally.total },
  };
  await db.put(holonId, 'quests', executed);

  return { ok: true, proposal: executed, expense, ...(newRate != null ? { rate: newRate } : {}) };
}
