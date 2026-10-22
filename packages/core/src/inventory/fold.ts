// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stock levels as a fold over REA events.
 *
 *   onhand(item, holon) = Σ effect(action) × quantity
 *
 * where `effect` is the ValueFlows on-hand effect of the event's action:
 * produce / raise add, consume / lower remove, and a transfer removes at the
 * provider and adds at the receiver. Which side of a transfer this holon is
 * on is read off the event's agents, so the same event folds correctly in
 * both holons' streams.
 *
 * Only events marked as stock events take part (`stock:*` kinds, or any
 * event classified `stock`). Library custody events are item events too but
 * move no quantity, and they are not stock events, so they never show up.
 */
import { VF_ACTIONS, mappingForEventKind, type VfAction } from '../rea/valueflows.js';
import type { StockLevel } from './types.js';

/** The loose shape every REA store hands back. */
export interface StockEventLike {
  action?: string;
  eventType?: string;
  provider?: { id?: string | number } | null;
  receiver?: { id?: string | number } | null;
  resourceQuantity?: { hasNumericalValue?: number; hasUnit?: string } | null;
  resourceInventoriedAs?: string;
  resourceClassifiedAs?: string[];
  inScopeOf?: string;
  resource?: { type?: string; quantity?: number; unit?: string; resourceId?: string | number } | null;
  context?: { holonId?: string; itemId?: string | number } | null;
  timestamp?: number;
  hasPointInTime?: string;
  status?: string;
}

export const STOCK_EVENT_PREFIX = 'stock:';
export const STOCK_CLASSIFICATION = 'stock';

export function isStockEvent(event: StockEventLike | null | undefined): boolean {
  if (!event) return false;
  if (typeof event.eventType === 'string' && event.eventType.startsWith(STOCK_EVENT_PREFIX)) return true;
  return Array.isArray(event.resourceClassifiedAs) && event.resourceClassifiedAs.includes(STOCK_CLASSIFICATION);
}

/** The stock item an event is about, or null when it names none. */
export function stockItemIdOf(event: StockEventLike): string | null {
  const id = event.resourceInventoriedAs ?? event.context?.itemId ?? event.resource?.resourceId;
  if (id == null || id === '') return null;
  return String(id);
}

export function stockQuantityOf(event: StockEventLike): number {
  const q = event.resourceQuantity?.hasNumericalValue ?? event.resource?.quantity;
  return typeof q === 'number' && Number.isFinite(q) ? q : 0;
}

export function stockUnitOf(event: StockEventLike): string {
  return event.resourceQuantity?.hasUnit ?? event.resource?.unit ?? 'one';
}

function actionOf(event: StockEventLike): VfAction {
  if (event.action && event.action in VF_ACTIONS) return event.action as VfAction;
  return mappingForEventKind(event.eventType, event.resource?.type).action;
}

function timeOf(event: StockEventLike): number {
  if (typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)) return event.timestamp;
  if (event.hasPointInTime) {
    const t = Date.parse(event.hasPointInTime);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

const agentIs = (agent: { id?: string | number } | null | undefined, holonId: string) =>
  agent?.id != null && String(agent.id) === holonId;

/**
 * Signed on-hand change this event makes to `holonId`'s stock, or 0.
 *
 * Exported so a UI can explain a level line by line.
 */
export function stockEffectOn(event: StockEventLike, holonId: string): number {
  const quantity = stockQuantityOf(event);
  if (quantity === 0) return 0;
  const effect = VF_ACTIONS[actionOf(event)].onhandEffect;
  const scope = event.inScopeOf ?? event.context?.holonId;
  switch (effect) {
    case 'increment':
      return scope == null || scope === holonId ? quantity : 0;
    case 'decrement':
      return scope == null || scope === holonId ? -quantity : 0;
    case 'decrementIncrement':
      if (agentIs(event.receiver, holonId)) return quantity;
      if (agentIs(event.provider, holonId)) return -quantity;
      return 0;
    default:
      return 0;
  }
}

const isPending = (event: StockEventLike) => event.status === 'pending';

/**
 * Fold `events` into one level per stock item, from `holonId`'s point of
 * view. Order does not matter; the fold is a sum.
 *
 * `reserved` is left at 0 here — it comes from open needs, not from events;
 * see `reserve` in scarcity.ts.
 */
export function foldStock(events: StockEventLike[], holonId: string): StockLevel[] {
  const levels = new Map<string, StockLevel>();
  for (const event of events ?? []) {
    if (!isStockEvent(event)) continue;
    const itemId = stockItemIdOf(event);
    if (!itemId) continue;
    const delta = stockEffectOn(event, holonId);
    let level = levels.get(itemId);
    if (!level) {
      level = {
        itemId,
        holonId,
        unit: stockUnitOf(event),
        onhand: 0,
        confirmed: 0,
        pending: 0,
        reserved: 0,
        incoming: 0,
        available: 0,
        updatedAt: 0,
      };
      levels.set(itemId, level);
    }
    level.updatedAt = Math.max(level.updatedAt, timeOf(event));
    if (delta === 0) continue;
    const pending = isPending(event);
    level.pending += delta;
    if (!pending) level.confirmed += delta;
    if (pending && delta > 0) level.incoming += delta;
  }
  const out: StockLevel[] = [];
  for (const level of levels.values()) {
    level.onhand = round(level.confirmed);
    level.confirmed = round(level.confirmed);
    level.pending = round(level.pending);
    level.incoming = round(level.incoming);
    level.available = round(level.onhand - level.reserved);
    out.push(level);
  }
  return out.sort((a, b) => a.itemId.localeCompare(b.itemId));
}

/** Kill float dust so 0.1 + 0.2 worth of flour reads as 0.3. */
export const round = (value: number): number => Math.round(value * 1000) / 1000;
