// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The five stock events a UI can record, built the way every other REA
 * event is so `REAEventStore.put` accepts them and `foldStock` reads them.
 *
 *  - produced / consumed: the holon made or used some of an item.
 *  - raised / lowered:    a count correction after someone looked at the shelf.
 *  - transferred:         some of an item went from one holon to another.
 *
 * Produce, consume, raise and lower are scoped to the holon and carry the
 * member who recorded them as the other agent. A transfer names both holons
 * as agents so it folds correctly from either holon's stream, and both
 * holons should store the same event (same id) so the ledgers agree.
 */
import { REAEventFactory } from '../rea/event-factory.js';
import { normalizeReaEvent, type EconomicEvent } from '../rea/valueflows.js';

export type StockEventKind =
  | 'stock:produced'
  | 'stock:consumed'
  | 'stock:raised'
  | 'stock:lowered'
  | 'stock:transferred';

export const STOCK_EVENT_KINDS: readonly StockEventKind[] = [
  'stock:produced',
  'stock:consumed',
  'stock:raised',
  'stock:lowered',
  'stock:transferred',
];

export interface StockActorLike {
  id: string | number;
  username?: string;
  first_name?: string;
}

export interface BuildStockEventInput {
  holonId: string | number;
  /** Which of the four in-holon movements this is. */
  kind: Exclude<StockEventKind, 'stock:transferred'>;
  itemId: string;
  /** Always > 0; the kind says which way it goes. */
  quantity: number;
  unit: string;
  /** The member recording it. */
  actor: StockActorLike;
  note?: string | null;
  now?: number;
}

export interface BuildStockTransferInput {
  fromHolonId: string | number;
  toHolonId: string | number;
  itemId: string;
  quantity: number;
  unit: string;
  actor: StockActorLike;
  note?: string | null;
  /** `pending` until the receiving holon confirms; defaults to confirmed. */
  status?: 'confirmed' | 'pending';
  now?: number;
}

const positive = (quantity: number) => {
  if (!(typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0)) {
    throw new Error('stock quantity must be a positive number');
  }
  return quantity;
};

/** A count correction: the sign of `delta` picks raised or lowered. */
export function correctionKind(delta: number): 'stock:raised' | 'stock:lowered' {
  return delta >= 0 ? 'stock:raised' : 'stock:lowered';
}

/** One in-holon stock movement, ready for `REAEventStore.put`. */
export function buildStockEvent(input: BuildStockEventInput): EconomicEvent {
  const holonId = String(input.holonId);
  const quantity = positive(input.quantity);
  const holon = REAEventFactory.createHolonAgent(holonId);
  const member = REAEventFactory.createUserAgent(input.actor);
  const adds = input.kind === 'stock:produced' || input.kind === 'stock:raised';
  return normalizeReaEvent({
    id: REAEventFactory.generateId(holonId),
    timestamp: input.now ?? Date.now(),
    eventType: input.kind,
    resource: { type: 'item', quantity, unit: input.unit, resourceId: input.itemId },
    // Set explicitly: the item kind would otherwise read the unit as a count.
    resourceQuantity: { hasNumericalValue: quantity, hasUnit: input.unit },
    resourceInventoriedAs: input.itemId,
    // Something coming in is provided by the member to the holon; going out,
    // the holon provides it to the member. Either way the holon is in scope.
    provider: adds ? member : holon,
    receiver: adds ? holon : member,
    inScopeOf: holonId,
    context: { holonId, itemId: input.itemId, note: input.note ?? null },
    status: 'confirmed',
  }) as EconomicEvent;
}

/** A transfer between holons. Store it on BOTH holons under the same id. */
export function buildStockTransfer(input: BuildStockTransferInput): EconomicEvent {
  const from = String(input.fromHolonId);
  const to = String(input.toHolonId);
  if (from === to) throw new Error('a stock transfer needs two different holons');
  const quantity = positive(input.quantity);
  return normalizeReaEvent({
    id: REAEventFactory.generateId(from),
    timestamp: input.now ?? Date.now(),
    eventType: 'stock:transferred',
    resource: { type: 'item', quantity, unit: input.unit, resourceId: input.itemId },
    resourceQuantity: { hasNumericalValue: quantity, hasUnit: input.unit },
    resourceInventoriedAs: input.itemId,
    provider: REAEventFactory.createHolonAgent(from),
    receiver: REAEventFactory.createHolonAgent(to),
    context: {
      holonId: from,
      itemId: input.itemId,
      note: input.note ?? null,
      recordedBy: String(input.actor.id),
      toHolonId: to,
    },
    status: input.status ?? 'confirmed',
  }) as EconomicEvent;
}
