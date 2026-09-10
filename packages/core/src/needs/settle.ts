// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settlement: both handoff sides confirmed, make the exchange real.
 *
 * One call, on whichever client finalizes:
 *   - close the need `fulfilled` and re-publish it,
 *   - record the REA completion events (initiated / completed / hours) on the
 *     owner holon via the shared completion planner,
 *   - move the hours requester → provider as an `hour` expense (stable id, so
 *     a double finalize upserts instead of stacking),
 *   - check the originating shopping-list item off,
 *   - MIRROR the provider's side of the settlement into the provider's
 *     own holon: their hour expense, their REA events, and a hologram of the
 *     fulfilled quest. Without the mirror a provider who answered a
 *     federated need earns hours and karma only on someone else's holon —
 *     invisible in their own wallet, score, and record,
 *   - and settle the offer the winning response drew on: every response
 *     carries one (`@holons/core/offers` answerNeed raises it when nothing
 *     stood), so its reservation closes and the movement lands on both
 *     ledgers. The fulfilled offer on the provider's holon IS the proof of
 *     capability (docs/needs-offers-network.md §6); nothing extra is minted.
 */

import type { HoloSphere } from 'holosphere';
import { planTaskCompletion, executeCompletionPlan, type ExecuteOutcome } from '../tasks/index.js';
import { DEFAULT_EQUATION, type ScoreEquation } from '../scoring/index.js';
import { REAEventStore, REAEventFactory } from '../rea/index.js';
import { createExpense } from '../expenses/index.js';
import { publishToFederation } from '../federation/publish.js';
import {
  normalizeChecklist,
  toggleItem as toggleShoppingItem,
  CHECKLISTS_COLLECTION,
  SHOPPING_KEY,
} from '../shopping/index.js';
import { TREASURY_ID, splitHours } from '../governance/treasury.js';
import { acceptedResponse, closeNeed } from './responses.js';
import { refreshPublishedNeed } from './publish.js';
import { NEED_RECORD_LENS, type PublishedNeed } from './types.js';
import { normalizeOffer } from '../offers/transform.js';
import { settleOfferReservation } from '../offers/settle.js';

/** Stable id of the requester → provider hour transfer for a need. */
export function handoffExpenseId(needId: string | number): string {
  return `wq-${needId}-handoff`;
}

/** Stable id of the treasury's withheld share of a settlement. */
export function handoffFeeExpenseId(needId: string | number): string {
  return `wq-${needId}-handoff-fee`;
}

/** Identity-attributed store surface (holosphere, or a putAs wrapper). */
export interface SettleStoreLike {
  put(holonId: string, lens: string, value: unknown): Promise<unknown>;
  get(holonId: string, lens: string, key?: string | number): Promise<unknown>;
  getAll(holonId: string, lens: string): Promise<unknown[]>;
}

export interface SettleDeps {
  /** Used for re-publish + the provider-holon hologram mirror. */
  holosphere: HoloSphere;
  /** Writes go through this (e.g. an actingAs wrapper). Defaults to `holosphere`. */
  db?: SettleStoreLike;
}

export interface SettleNeedOptions {
  equation?: ScoreEquation;
  now?: number;
  /**
   * Mirror the provider's settlement facts (hour expense, REA events, a
   * fulfilled-quest hologram) into `responder.holonId`. Default true.
   */
  mirrorToProvider?: boolean;
  /** Check the originating shopping-list item off. Default true. */
  checkOffShoppingItem?: boolean;
  /**
   * Settle the standing offer the winning response drew on (its reservation
   * closes and the movement is recorded as an REA event on both holons —
   * `@holons/core/offers`). Default true.
   */
  settleOffer?: boolean;
  /**
   * Fraction of the moved hours withheld into the coop's treasury (the
   * `treasury` account on the OWNER holon's expenses lens) — the
   * democratically voted rate from `@holons/core/governance`. Default 0:
   * no fee until the coop votes one in. Karma is unaffected; the provider's
   * time logged stays the full hours.
   */
  treasuryRate?: number;
}

export interface SettleNeedOutcome {
  /** The fulfilled need as persisted (participants + timeTracking stamped). */
  need: PublishedNeed;
  hours: number;
  providerId: string | null;
  providerHolonId: string | null;
  requesterId: string | null;
  /** Hours withheld into the owner coop's treasury (0 without a voted rate). */
  treasuryFee: number;
  /** The standing offer settled against, when the response drew on one. */
  offerSettled: { offerId: string; offerHolonId: string; eventId: string | null; wroteBoth: boolean } | null;
  completion: ExecuteOutcome;
  errors: string[];
}

/**
 * Settle a handed-off need on its owner holon. Idempotent where it matters:
 * the expense id and the REA event ids are stable per (need, user), so a
 * double finalize upserts rather than stacking.
 */
export async function settleNeedHandoff(
  deps: SettleDeps,
  ownerHolonId: string,
  need: PublishedNeed,
  opts: SettleNeedOptions = {}
): Promise<SettleNeedOutcome> {
  const holosphere = deps.holosphere;
  const db: SettleStoreLike = deps.db ?? (holosphere as unknown as SettleStoreLike);
  const errors: string[] = [];
  const now = opts.now ?? Date.now();

  const closed = closeNeed(need, 'fulfilled', now);
  const final = closed.ok ? closed.need : need;

  const accepted = acceptedResponse(final);
  const providerId = accepted?.responder?.id != null ? String(accepted.responder.id) : null;
  const providerHolonId =
    accepted?.responder?.holonId != null ? String(accepted.responder.holonId) : null;
  const requesterId = final.initiator?.id != null ? String(final.initiator.id) : null;
  const hours =
    accepted && typeof accepted.price === 'number' && accepted.price > 0 ? accepted.price : 1;

  // The fulfilled need, treated as a completed quest: the provider joins the
  // participants and logs the hours, so the shared completion planner emits
  // the same REA events the bot and web record.
  const participants = [...(final.participants ?? [])];
  if (providerId != null && !participants.some((p) => String(p?.id) === providerId)) {
    participants.push({ id: providerId, username: accepted?.responder?.name } as never);
  }
  const asTask = {
    ...final,
    participants,
    timeTracking: providerId != null ? { [providerId]: hours } : {},
  } as PublishedNeed;

  const eventStore = new REAEventStore(db as never);
  const plan = planTaskCompletion(asTask as never, opts.equation ?? DEFAULT_EQUATION, {
    now,
    holonId: ownerHolonId,
  });
  // The plan's own expense models "the holon reimburses hours" — a handoff
  // moves them requester → provider instead, so that one is written below.
  const completion = await executeCompletionPlan(db as never, eventStore, ownerHolonId, plan, {
    recordExpenses: false,
  });
  for (const e of completion.errors) errors.push(`${e.kind}: ${e.message}`);

  try {
    const refreshed = await refreshPublishedNeed(holosphere, ownerHolonId, asTask);
    errors.push(...refreshed.errors);
  } catch (err) {
    errors.push(`republish: ${(err as Error).message ?? String(err)}`);
  }

  // The requester pays the full hours; the coop withholds its voted share
  // (governance/treasury) and the provider is credited the rest.
  const { toProvider, toTreasury } = splitHours(hours, opts.treasuryRate ?? 0);

  // The same record lands in both holons (owner, and the provider's mirror).
  const expenseFor = () =>
    createExpense({
      id: handoffExpenseId(String(final.id)),
      amount: toProvider,
      currency: 'hour',
      description: String(final.title ?? 'handoff'),
      paidBy: providerId ?? 'provider',
      splitWith: requesterId != null ? [requesterId] : [],
      now,
    });

  const ownerExpense = expenseFor();
  if (ownerExpense) {
    try {
      await db.put(ownerHolonId, 'expenses', ownerExpense);
    } catch (err) {
      errors.push(`expense: ${(err as Error).message ?? String(err)}`);
    }
  }

  // The fee is the owner coop's — it never mirrors to the provider holon.
  if (toTreasury > 0) {
    const feeExpense = createExpense({
      id: handoffFeeExpenseId(String(final.id)),
      amount: toTreasury,
      currency: 'hour',
      description: `coop share — ${String(final.title ?? 'handoff')}`,
      paidBy: TREASURY_ID,
      splitWith: requesterId != null ? [requesterId] : [],
      now,
    });
    if (feeExpense) {
      try {
        await db.put(ownerHolonId, 'expenses', feeExpense);
      } catch (err) {
        errors.push(`fee expense: ${(err as Error).message ?? String(err)}`);
      }
    }
  }

  // Close the loop: the originating shopping-list item gets checked off.
  if (opts.checkOffShoppingItem !== false && final.source?.itemId) {
    try {
      const raw = await db.get(ownerHolonId, CHECKLISTS_COLLECTION, SHOPPING_KEY);
      const list = normalizeChecklist(raw);
      const entry = list?.items.find((i) => String(i.id) === String(final.source!.itemId));
      if (list && entry && !entry.checked) {
        const updated = toggleShoppingItem(list, entry.id);
        if (updated) await db.put(ownerHolonId, CHECKLISTS_COLLECTION, updated);
      }
    } catch {
      /* list write is best-effort */
    }
  }

  // Provider-holon mirror — the provider's wallet, karma, and record live on
  // THEIR holon; a settlement recorded only on the owner's is invisible to
  // them. Expense + events are copies (settlement facts, stable ids); the
  // quest itself mirrors as a hologram, the same intentional opt-in as
  // reflectJoin's personal-holon mirror.
  if (
    opts.mirrorToProvider !== false &&
    providerHolonId != null &&
    providerHolonId !== ownerHolonId
  ) {
    const mirrorExpense = expenseFor();
    if (mirrorExpense) {
      try {
        await db.put(providerHolonId, 'expenses', mirrorExpense);
      } catch (err) {
        errors.push(`mirror expense: ${(err as Error).message ?? String(err)}`);
      }
    }
    if (providerId != null) {
      const providerUser = { id: providerId, username: accepted?.responder?.name } as never;
      const quest = { id: String(final.id), title: String(final.title ?? '') };
      try {
        await eventStore.put(
          providerHolonId,
          REAEventFactory.questCompleted(providerHolonId, providerUser, quest)
        );
        await eventStore.put(
          providerHolonId,
          REAEventFactory.timeLogged(providerHolonId, providerUser, hours, quest.id, quest.title)
        );
      } catch (err) {
        errors.push(`mirror events: ${(err as Error).message ?? String(err)}`);
      }
    }
    try {
      await publishToFederation(
        {
          holosphere,
          holonId: ownerHolonId,
          lens: NEED_RECORD_LENS,
          item: { ...(asTask as object), id: String(final.id) },
        },
        { kind: 'partner', holonId: providerHolonId },
        { useHolograms: true }
      );
    } catch (err) {
      errors.push(`mirror quest: ${(err as Error).message ?? String(err)}`);
    }
  }

  // A response that drew on a standing offer settles that offer's
  // reservation: the offer shrinks (or closes) and the movement is recorded
  // on both ledgers — a stock-sourced offer as `stock:transferred`, so the
  // provider's shelf drops by what was delivered.
  let offerSettled: SettleNeedOutcome['offerSettled'] = null;
  const drewOnOffer = !!accepted?.offerId;
  if (drewOnOffer && opts.settleOffer !== false) {
    const offerHolon = String(accepted!.offerHolonId ?? providerHolonId ?? ownerHolonId);
    const offerId = String(accepted!.offerId);
    try {
      const raw = await db.get(offerHolon, NEED_RECORD_LENS, offerId);
      const offer = normalizeOffer(raw, now);
      const reservationId =
        accepted!.reservationId ??
        offer?.reservations.find((r) => r.responseId === accepted!.id && !r.releasedAt)?.id;
      if (!offer || !reservationId) {
        errors.push(`settle offer ${offerId}: ${offer ? 'no reservation for this response' : 'offer not found'}`);
      } else {
        const out = await settleOfferReservation({ holosphere, db: db as never }, offerHolon, offer, reservationId, {
          needHolonId: ownerHolonId,
          actor: { id: providerId ?? requesterId ?? ownerHolonId, name: accepted?.responder?.name },
          now,
        });
        errors.push(...out.errors.map((e) => `settle offer: ${e}`));
        offerSettled = { offerId, offerHolonId: offerHolon, eventId: out.event?.id ?? null, wroteBoth: out.wroteBoth };
      }
    } catch (err) {
      errors.push(`settle offer ${offerId}: ${(err as Error).message ?? String(err)}`);
    }
  }

  return {
    need: asTask,
    hours,
    providerId,
    providerHolonId,
    requesterId,
    treasuryFee: toTreasury,
    offerSettled,
    completion,
    errors,
  };
}
