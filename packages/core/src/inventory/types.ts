// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * @holons/core/inventory — fungible stock, folded from the REA event stream.
 *
 * The library tracks one-of-a-kind things with bookings; this domain tracks
 * quantities: kilos of flour, boxes of screws, litres of oil. A level is
 * never stored — it is the sum of every stock event's on-hand effect, which
 * is what makes it reconcile the same way everything else in Holosphere does.
 *
 * Stock is a vector, one quantity per item per holon, and is compared
 * component-wise. Nothing here collapses a holon's stock into one number.
 *
 * Visibility: a holon's stock is PUBLIC to its federation by default (decided
 * 2026-09-08). A surplus is an invitation — that is the point of sharing it.
 */

/** The lens stock levels and item specs are published under. */
export const STOCK_LENS = 'stock';

/** Who can read a holon's stock levels. */
export type StockVisibility = 'federation' | 'private';

/** Stock is shared with federation partners unless the holon opts out. */
export const DEFAULT_STOCK_VISIBILITY: StockVisibility = 'federation';

/** What a holon keeps, and how much of it it wants to keep. */
export interface StockItemSpec {
  id: string;
  name: string;
  /** Free-form grouping, shared with needs and shopping so they can meet. */
  category: string;
  /** Unit the quantities are in: 'kg', 'l', 'unit'. */
  unit: string;
  /** Level the holon restocks up to. Absent means the holon never reorders it. */
  target?: number;
  /**
   * Level the holon keeps for itself. Only stock above it counts as surplus
   * the federation may draw on. Defaults to 0.
   */
  min?: number;
}

/**
 * One item's level in one holon.
 *
 * `confirmed` counts only settled events; `pending` counts every event seen,
 * settled or not. While a transfer is still in flight the truth lies between
 * the two, and UIs should show the interval rather than a number that jumps.
 */
export interface StockLevel {
  itemId: string;
  holonId: string;
  unit: string;
  /** What the holon can count on. Equals `confirmed`. */
  onhand: number;
  /** Sum of on-hand effects over settled events only. */
  confirmed: number;
  /** Sum of on-hand effects over every event, pending ones included. */
  pending: number;
  /** Set aside for claimed needs. Not part of the fold; see `reserve`. */
  reserved: number;
  /** On its way: transfers this holon receives that are still pending. */
  incoming: number;
  /** `onhand − reserved`. What can actually be given out today. */
  available: number;
  /** When the last stock event landed, in ms; 0 with no events. */
  updatedAt: number;
}

/** Demand for a category at a place, read off open needs. */
export interface StockDemand {
  holonId: string;
  category: string;
  /** Stock item, when the need names one. */
  itemId?: string;
  quantity: number;
}

/** A holon's standing in one category: what it can give, or what it lacks. */
export interface StockPosition {
  holonId: string;
  category: string;
  /** Stock above local demand and the keep-back floor. */
  surplus: number;
  /** Local demand the holon cannot cover itself. */
  deficit: number;
}

/** One move the transport plan proposes. */
export interface StockTransfer {
  from: string;
  to: string;
  category: string;
  quantity: number;
  /** Cost the plan paid for this leg, in whatever unit the cost function uses. */
  cost: number;
}
