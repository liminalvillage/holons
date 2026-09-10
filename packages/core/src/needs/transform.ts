// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Building needs: from a shopping-list item, or directly (`createNeed`).
 * Pure transforms; storage is the caller's responsibility (the publish
 * orchestrator persists to the `quests` lens).
 */

import { createMarketItem } from '../tasks/marketplace.js';
import type { Quest, QuestInitiator } from '../tasks/types.js';
import type { ShoppingItem } from '../shopping/types.js';
import {
  NEED_STATUSES,
  type NeedResponse,
  type NeedStatus,
  type PublishedNeed,
} from './types.js';

export interface NeedFromShoppingOptions {
  holonId: string | number;
  initiator: QuestInitiator;
  /** Override the generated id. Mostly for tests and the Telegram bot. */
  id?: string;
  /** H3 cell the need will be published to (stamped for provenance). */
  hex?: string;
  description?: string;
  tags?: string[];
  /** Expiry as ms since epoch. */
  expiresAt?: number;
  /**
   * How much, in what unit, when the requester says so. Otherwise the
   * item's stock reference (if any) speaks, else the matcher counts one.
   */
  demand?: { quantity?: number; unit?: string };
  /** Override the creation timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

/**
 * The stock reference a shopping row may carry: the inventory reorder writes
 * `stock: {itemId, quantity, unit}` on `ShoppingItem`s and `stockItemId` on
 * plain checklist rows. Either becomes the need's `stock`.
 */
export function stockRefOf(
  item: ShoppingItem & { stockItemId?: unknown; stock?: unknown }
): PublishedNeed['stock'] | undefined {
  const ref = item.stock as { itemId?: unknown; quantity?: unknown; unit?: unknown } | undefined;
  const itemId =
    typeof ref?.itemId === 'string' && ref.itemId
      ? ref.itemId
      : typeof item.stockItemId === 'string' && item.stockItemId
        ? item.stockItemId
        : null;
  if (!itemId) return undefined;
  const q = typeof ref?.quantity === 'number' && Number.isFinite(ref.quantity) && ref.quantity > 0 ? ref.quantity : 1;
  return { itemId, quantity: q, ...(typeof ref?.unit === 'string' && ref.unit ? { unit: ref.unit } : {}) };
}

/**
 * Build a fresh need from a shopping-list item. The item's text becomes the
 * title, its category carries over, and a `source` back-link records the
 * originating item so checking it off can close the need.
 */
export function needFromShoppingItem(
  item: ShoppingItem,
  opts: NeedFromShoppingOptions
): PublishedNeed {
  const now = opts.now ?? Date.now();
  const need = createMarketItem({
    holonId: opts.holonId,
    initiator: opts.initiator,
    kind: 'need',
    title: String(item.text ?? '').trim(),
    description: opts.description,
    itemType: 'good',
    tags: opts.tags,
    expiresAt: opts.expiresAt,
    category: typeof item.category === 'string' && item.category ? item.category : undefined,
    now,
  }) as PublishedNeed;

  need.id = opts.id ?? `need-${now}-${Math.random().toString(36).slice(2, 8)}`;
  need.status = 'requested';
  need.source = { kind: 'shopping', itemId: String(item.id) };
  const stock = stockRefOf(item);
  if (stock) need.stock = stock;
  const q = opts.demand?.quantity;
  if (typeof q === 'number' && Number.isFinite(q) && q > 0) {
    const unit = typeof opts.demand?.unit === 'string' && opts.demand.unit.trim() ? opts.demand.unit.trim() : stock?.unit ?? 'one';
    need.demand = { quantity: q, unit };
  }
  need.responses = [];
  if (opts.hex) need.hex = opts.hex;
  return need;
}

export interface CreateNeedInput {
  holonId: string | number;
  initiator: QuestInitiator;
  /** What is asked for, in the requester's words: "learn guitar", "a ladder". */
  title: string;
  /** What kind of thing; matching and contention are per category. */
  category?: string;
  /** How much, in what unit ('one', 'kg', 'hour', …). Default one unit. */
  demand?: { quantity?: number; unit?: string };
  /** A good, or a service measured in time. Default: 'service' when the unit is time, else 'good'. */
  itemType?: 'good' | 'service';
  description?: string;
  tags?: string[];
  /** Expiry as ms since epoch. */
  expiresAt?: number;
  /** H3 cell the need will be published to (stamped for provenance). */
  hex?: string;
  /** Emergency mode: renders with priority and cross-posts to announcements. */
  urgency?: 'urgent';
  /** The standing offer this need asks for, when raised from one. */
  wants?: { offerId: string; holonId: string };
  /** Override the generated id. Mostly for tests and bots. */
  id?: string;
  /** Override the creation timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

const TIME_UNITS: ReadonlySet<string> = new Set(['hour', 'hours', 'h', 'minute', 'minutes', 'min', 'day', 'days']);

/**
 * Build a need directly — the demand-first entry point, for what nobody
 * would put on a shopping list ("learn guitar", "a ride to town on Friday").
 * Same record as a shopping-born need, minus the `source` back-link, plus
 * `demand` so the matcher knows how much and in what unit. Storage is the
 * caller's (`publishNeedNearby`, or a plain put on the `quests` lens).
 */
export function createNeed(input: CreateNeedInput): PublishedNeed {
  const title = String(input.title ?? '').trim();
  if (!title) throw new Error('A need must say what is asked for.');
  const now = input.now ?? Date.now();
  const rawQty = input.demand?.quantity;
  const quantity = typeof rawQty === 'number' && Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
  const unit = typeof input.demand?.unit === 'string' && input.demand.unit.trim() ? input.demand.unit.trim() : 'one';
  const itemType = input.itemType ?? (TIME_UNITS.has(unit.toLowerCase()) ? 'service' : 'good');
  const category = typeof input.category === 'string' && input.category.trim() ? input.category.trim() : undefined;
  const need = createMarketItem({
    holonId: input.holonId,
    initiator: input.initiator,
    kind: 'need',
    title,
    description: input.description,
    itemType,
    tags: input.tags,
    expiresAt: input.expiresAt,
    category,
    now,
  }) as PublishedNeed;

  need.id = input.id ?? `need-${now}-${Math.random().toString(36).slice(2, 8)}`;
  need.status = 'requested';
  need.demand = { quantity, unit };
  need.responses = [];
  if (input.hex) need.hex = input.hex;
  if (input.urgency === 'urgent') need.urgency = 'urgent';
  if (input.wants?.offerId && input.wants.holonId) {
    need.wants = { offerId: String(input.wants.offerId), holonId: String(input.wants.holonId) };
  }
  return need;
}

/**
 * Coerce a raw record (possibly partial / from the wire) into a sane need, or null
 * when it isn't a need or was deleted. Unknown statuses fall back to
 * 'requested' rather than dropping the record.
 */
export function normalizeNeed(raw: unknown): PublishedNeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Quest & Record<string, unknown>;
  if (d._deleted || d.type !== 'need') return null;

  const status: NeedStatus = NEED_STATUSES.includes(d.status as NeedStatus)
    ? (d.status as NeedStatus)
    : 'requested';
  const responses = Array.isArray(d.responses)
    ? (d.responses as NeedResponse[]).filter((r) => r && r.id != null)
    : [];

  return { ...(d as Quest), type: 'need', status, responses } as PublishedNeed;
}
