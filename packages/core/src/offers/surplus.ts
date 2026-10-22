// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A surplus is an invitation. Whatever a shelf holds beyond what the holon
 * keeps back is a standing offer, kept in step with the shelf: one offer per
 * item (`offer-stock-<itemId>`), its free quantity equal to the surplus,
 * withdrawn when the surplus is gone and nobody is counting on it.
 *
 * Keep-back is the item's `min` (`keepBack` in `inventory/scarcity`, the
 * same floor the shelf's surplus badge uses; the restock `target` is not a
 * hold): stock the holon keeps for itself is never offered. Reservations
 * already made stay whatever the shelf does — they are promises — so a held
 * offer shrinks to its promises rather than vanishing.
 *
 * Decided 2026-09-08: this is automatic (a per-holon switch turns it off,
 * `settings.stock.autoOffer`), the one place the system publishes outward
 * without a tap. Everything else in the federation stays opt-in.
 */

import type { HoloSphere } from 'holosphere';
import { foldStock } from '../inventory/fold.js';
import { demandsOf, keepBack, reserve } from '../inventory/scarcity.js';
import { readStockItemSpecs } from '../inventory/specs.js';
import { STOCK_LENS, type StockItemSpec, type StockLevel } from '../inventory/types.js';
import type { QuestInitiator } from '../tasks/types.js';
import { OFFER_RECORD_LENS } from './types.js';
import { holonOf } from './supply.js';
import { editOffer, withdrawOffer } from './lifecycle.js';
import { publishOfferNearby, refreshPublishedOffer, withdrawPublishedOffer, type PublishOfferOptions } from './publish.js';
import { isLiveReservation, normalizeOffer, offerFromStockSurplus, stockOfferId } from './transform.js';
import type { OfferRecord } from './types.js';

const EPS = 1e-9;
const round = (v: number) => Math.round(v * 1000) / 1000;

export interface SurplusInput {
  holonId: string;
  /** Levels after `reserve()`, so local needs are already netted out. */
  levels: StockLevel[];
  specs: StockItemSpec[];
  /** The holon's own offers (raw quests are fine; non-offers are skipped). */
  offers: unknown[];
  initiator: QuestInitiator;
  now?: number;
}

export interface SurplusPlan {
  create: OfferRecord[];
  update: OfferRecord[];
  /** Auto offers to take off the market (as they stand now; the publisher flips them). */
  withdraw: OfferRecord[];
  /** Auto offers already in step with the shelf. */
  keep: OfferRecord[];
}

/** What each item keeps back — the shelf's own rule (`inventory/scarcity`), re-exported for callers here. */
export { keepBack };

/** Units the shelf can spare for an item: on hand, minus reservations and keep-back. */
export function itemSurplus(level: StockLevel, spec: StockItemSpec): number {
  return round(Math.max(0, level.onhand - Math.max(0, level.reserved) - keepBack(spec)));
}

/**
 * The writes that bring the holon's auto offers in step with its shelf.
 * Pure: nothing is persisted. `enabled: false` plans withdrawals only.
 */
export function surplusOffers(input: SurplusInput, enabled = true): SurplusPlan {
  const now = input.now ?? Date.now();
  const plan: SurplusPlan = { create: [], update: [], withdraw: [], keep: [] };
  const existing = new Map<string, OfferRecord>();
  for (const raw of input.offers ?? []) {
    const o = normalizeOffer(raw, now);
    if (o && o.source?.kind === 'stock' && String(o.id) === stockOfferId(o.source.itemId)) existing.set(o.source.itemId, o);
  }
  const levelOf = new Map((input.levels ?? []).map((l) => [l.itemId, l]));

  for (const spec of input.specs ?? []) {
    const level = levelOf.get(spec.id);
    const surplus = enabled && level ? itemSurplus(level, spec) : 0;
    const current = existing.get(spec.id);
    existing.delete(spec.id);
    const open = current && (current.status === 'open' || current.status === 'reserved');
    const live = current ? (current.reservations ?? []).some(isLiveReservation) : false;
    // Units promised or delivered from this offer: they stay on the record.
    const held = current ? (current.reservations ?? []).reduce((s, r) => (r.releasedAt ? s : s + r.quantity), 0) : 0;

    if (surplus > EPS) {
      const wanted = round(surplus + held);
      if (!current || !open) {
        plan.create.push(
          offerFromStockSurplus(spec, wanted, { holonId: input.holonId, initiator: input.initiator, now, mode: 'give' }),
        );
      } else if (Math.abs(current.supply.quantity - wanted) > EPS || current.supply.unit !== spec.unit || current.category !== spec.category) {
        const edited = editOffer(current, {
          supply: { itemId: spec.id, quantity: wanted, unit: spec.unit },
          category: spec.category,
          title: spec.name,
        });
        if (edited.ok) plan.update.push(edited.offer);
      } else {
        plan.keep.push(current);
      }
      continue;
    }

    // No surplus: withdraw a free auto offer; a held one shrinks to its promises.
    if (current && open) {
      if (!live) {
        if (withdrawOffer(current, now).ok) plan.withdraw.push(current);
      } else if (current.supply.quantity - held > EPS) {
        const edited = editOffer(current, { supply: { ...current.supply, quantity: round(held) } });
        if (edited.ok) plan.update.push(edited.offer);
      } else {
        plan.keep.push(current);
      }
    }
  }

  // Auto offers whose item left the shelf (spec deleted).
  for (const orphan of existing.values()) {
    if (orphan.status !== 'open' && orphan.status !== 'reserved') continue;
    if ((orphan.reservations ?? []).some(isLiveReservation)) continue;
    if (withdrawOffer(orphan, now).ok) plan.withdraw.push(orphan);
  }
  return plan;
}

export interface SyncSurplusOptions extends Pick<PublishOfferOptions, 'federationSourceId' | 'onWriteDenied' | 'upcastLevels' | 'now'> {
  /** The per-holon switch. Default true. */
  enabled?: boolean;
  /**
   * Catch-up mode, for a sync that runs from a read rather than a write:
   * only lists surplus that is missing or has grown, never withdraws or
   * shrinks. A cold local cache can read an empty ledger, and that must not
   * take live offers off the market — the next shelf write squares them.
   */
  growOnly?: boolean;
  /** Where new auto offers go. Both default true. */
  toPartners?: boolean;
  toHex?: boolean;
}

export interface SyncSurplusOutcome {
  created: OfferRecord[];
  updated: OfferRecord[];
  withdrawn: OfferRecord[];
  errors: string[];
}

/** Apply `surplusOffers` through the publisher. Idempotent: a second run writes nothing. */
export async function syncSurplusOffers(
  holosphere: HoloSphere,
  input: SurplusInput,
  opts: SyncSurplusOptions = {},
): Promise<SyncSurplusOutcome> {
  const plan = surplusOffers(input, opts.enabled !== false);
  if (opts.growOnly) {
    plan.withdraw = [];
    const before = new Map<string, number>();
    for (const raw of input.offers ?? []) {
      const o = normalizeOffer(raw, opts.now ?? input.now);
      if (o) before.set(String(o.id), o.supply.quantity);
    }
    plan.update = plan.update.filter((o) => o.supply.quantity > (before.get(String(o.id)) ?? 0) + EPS);
  }
  const out: SyncSurplusOutcome = { created: [], updated: [], withdrawn: [], errors: [] };
  const common = { federationSourceId: opts.federationSourceId, onWriteDenied: opts.onWriteDenied };
  for (const offer of plan.create) {
    try {
      const r = await publishOfferNearby(holosphere, input.holonId, offer, {
        ...common,
        toPartners: opts.toPartners !== false,
        toHex: opts.toHex !== false,
        upcastLevels: opts.upcastLevels,
        now: opts.now,
      });
      out.created.push(r.offer);
      out.errors.push(...r.errors);
    } catch (err) {
      out.errors.push(`create ${offer.id}: ${(err as Error).message ?? String(err)}`);
    }
  }
  for (const offer of plan.update) {
    try {
      const r = await refreshPublishedOffer(holosphere, input.holonId, offer, common);
      out.updated.push(r.offer);
      out.errors.push(...r.errors);
    } catch (err) {
      out.errors.push(`update ${offer.id}: ${(err as Error).message ?? String(err)}`);
    }
  }
  for (const offer of plan.withdraw) {
    try {
      const r = await withdrawPublishedOffer(holosphere, input.holonId, offer, { ...common, now: opts.now });
      if (r.ok) out.withdrawn.push(r.offer);
      out.errors.push(...r.errors);
    } catch (err) {
      out.errors.push(`withdraw ${offer.id}: ${(err as Error).message ?? String(err)}`);
    }
  }
  return out;
}

/** The per-holon switch, `settings.stock.autoOffer`; true unless set to false. */
export async function readAutoOfferSetting(holosphere: HoloSphere, holonId: string): Promise<boolean> {
  try {
    const settings = (await (holosphere as any).get(holonId, 'settings', holonId)) as
      | { stock?: { autoOffer?: unknown } }
      | null;
    return settings?.stock?.autoOffer !== false;
  } catch {
    return true;
  }
}

export interface SyncShelfOptions extends SyncSurplusOptions {
  initiator: QuestInitiator;
  /** Skip the settings read and force the switch. */
  enabled?: boolean;
}

/**
 * The hook every stock board calls after a write: read the shelf (specs,
 * ledger, open needs), honour the per-holon switch, and bring the auto
 * offers in step. Never throws — a board must not fail on its side effect.
 */
export async function syncSurplusFromShelf(
  holosphere: HoloSphere,
  holonId: string,
  opts: SyncShelfOptions,
): Promise<SyncSurplusOutcome> {
  try {
    const hs = holosphere as any;
    const read = async (lens: string): Promise<unknown[]> => {
      try {
        const all = await hs.getAll(holonId, lens);
        return Array.isArray(all) ? all : [];
      } catch {
        return [];
      }
    };
    const enabled = opts.enabled ?? (await readAutoOfferSetting(holosphere, holonId));
    const [rawSpecs, events, quests] = await Promise.all([read(STOCK_LENS), read('rea_events'), read(OFFER_RECORD_LENS)]);
    const specs = readStockItemSpecs(rawSpecs);
    // Own records only: a partner's copy may arrive without its envelope,
    // so the record's own `holonId` counts as provenance too.
    const own = quests.filter((q) => holonOf(q, holonId) === holonId);
    const needs = own.filter((q) => (q as { type?: unknown })?.type === 'need') as never[];
    const levels = reserve(foldStock(events as never[], holonId), demandsOf(needs, holonId));
    return await syncSurplusOffers(
      holosphere,
      { holonId, levels, specs, offers: own, initiator: opts.initiator, now: opts.now },
      { ...opts, enabled },
    );
  } catch (err) {
    return { created: [], updated: [], withdrawn: [], errors: [`sync: ${(err as Error).message ?? String(err)}`] };
  }
}
