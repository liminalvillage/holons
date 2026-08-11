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
 *   - and MINT the flywheel offer (docs/needs-offers-network.md §6): a
 *     fulfilled need is proof of capability, so a standing `type:'offer'`
 *     attributed to the provider lands on THEIR holon's board. Providers
 *     accrue a discoverable catalog by fulfilling, not by listing. Consent
 *     stays theirs: the minted offer never leaves their holon unless they
 *     later share it.
 */

import type { HoloSphere } from 'holosphere';
import {
  planTaskCompletion,
  executeCompletionPlan,
  createMarketItem,
  type ExecuteOutcome,
} from '../tasks/index.js';
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
import { closeNeed } from './responses.js';
import { refreshPublishedNeed } from './publish.js';
import { NEED_RECORD_LENS, type PublishedNeed } from './types.js';

/** Stable id of the requester → provider hour transfer for a need. */
export function handoffExpenseId(needId: string | number): string {
  return `wq-${needId}-handoff`;
}

/** Stable id of the flywheel offer minted from a fulfilled need. */
export function mintedOfferId(needId: string | number): string {
  return `offer-from-${needId}`;
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
   * Mint the flywheel offer — a standing `type:'offer'` attributed to the
   * provider on their own holon (see module doc). Default true.
   */
  mintProviderOffer?: boolean;
}

export interface SettleNeedOutcome {
  /** The fulfilled need as persisted (participants + timeTracking stamped). */
  need: PublishedNeed;
  hours: number;
  providerId: string | null;
  providerHolonId: string | null;
  requesterId: string | null;
  /** Id of the flywheel offer minted for the provider, when one was. */
  mintedOfferId: string | null;
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

  const accepted = (final.responses ?? []).find((r) => r.id === final.claimedResponseId);
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

  const expenseFor = (holonId: string) =>
    createExpense({
      id: handoffExpenseId(String(final.id)),
      holonId,
      amount: hours,
      currency: 'hour',
      description: String(final.title ?? 'handoff'),
      paidBy: providerId ?? 'provider',
      splitWith: requesterId != null ? [requesterId] : [],
      now,
    });

  const ownerExpense = expenseFor(ownerHolonId);
  if (ownerExpense) {
    try {
      await db.put(ownerHolonId, 'expenses', ownerExpense);
    } catch (err) {
      errors.push(`expense: ${(err as Error).message ?? String(err)}`);
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
    const mirrorExpense = expenseFor(providerHolonId);
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

  // The flywheel (§6): mint a standing offer attributed to the provider on
  // THEIR holon's board — proof of capability, earned by delivering. Stable
  // id per need, so a double settle upserts. Never pushed to hex or
  // partners here: sharing further stays the provider's explicit act.
  let minted: string | null = null;
  if (opts.mintProviderOffer !== false && providerId != null) {
    const offerHolon = providerHolonId ?? ownerHolonId;
    const base = createMarketItem({
      holonId: offerHolon,
      initiator: { id: providerId, username: accepted?.responder?.name } as never,
      kind: 'offer',
      title: String(final.title ?? ''),
      ...(final.category ? { category: String(final.category) } : {}),
      itemType: (final as { item_type?: string }).item_type === 'service' ? 'service' : 'good',
      ...(Array.isArray((final as { transaction_type?: string[] }).transaction_type)
        ? { transactionTypes: (final as { transaction_type?: string[] }).transaction_type }
        : {}),
      now,
    });
    const offer = {
      ...base,
      id: mintedOfferId(String(final.id)),
      // Provenance: which fulfilled need earned this offer, and where.
      mintedFrom: {
        needId: String(final.id),
        holonId: ownerHolonId,
        at: new Date(now).toISOString(),
      },
    };
    try {
      await db.put(offerHolon, NEED_RECORD_LENS, offer);
      minted = offer.id;
    } catch (err) {
      errors.push(`mint offer: ${(err as Error).message ?? String(err)}`);
    }
  }

  return {
    need: asTask,
    hours,
    providerId,
    providerHolonId,
    requesterId,
    mintedOfferId: minted,
    completion,
    errors,
  };
}
