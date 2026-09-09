// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Public surface for `@holons/core/inventory`.
//
// Fungible stock folded from REA events, the reorder list derived from it,
// scarcity against open needs, and the transport plan that moves surplus
// to deficit across a federation. Pure; callers bring the events, needs and
// partner graph.
export * from './types.js';
export {
  STOCK_CLASSIFICATION,
  STOCK_EVENT_PREFIX,
  foldStock,
  isStockEvent,
  stockEffectOn,
  stockItemIdOf,
  stockQuantityOf,
  stockUnitOf,
} from './fold.js';
export type { StockEventLike } from './fold.js';
export { STOCK_DEMAND_STATUSES, demandOf, demandsOf, positions, reserve, scarcity } from './scarcity.js';
export type { DemandSourceLike, ScarcityEntry } from './scarcity.js';
export {
  SHOPPING_CHECKLIST_ID,
  mergeReorderRows,
  reorderItemId,
  reorderList,
  syncReorderToShopping,
  toChecklistItem,
  toShoppingItems,
} from './reorder.js';
export type { ReorderLine } from './reorder.js';
export { FLAT_COST, federationCost, rebalancePlan, solveTransport, transportPlan } from './transport.js';
export type {
  PartnerGraph,
  SolveTransportOptions,
  TransportCost,
  TransportLeg,
  TransportSink,
  TransportSolution,
  TransportSource,
} from './transport.js';
export { aggregateStock, sumAggregates } from './aggregate.js';
export type { StockAggregate } from './aggregate.js';
export { STOCK_EVENT_KINDS, buildStockEvent, buildStockTransfer, correctionKind } from './events.js';
export type { BuildStockEventInput, BuildStockTransferInput, StockActorLike, StockEventKind } from './events.js';
export {
  createStockItemSpec,
  isStockItemSpec,
  readStockItemSpecs,
  stockItemId,
  updateStockItemSpec,
} from './specs.js';
export type { CreateStockItemInput, StockItemSpecRecord } from './specs.js';
export {
  STOCK_AGGREGATE_LENS,
  buildStockAggregateRecord,
  isStockAggregateRecord,
  publishStockAggregate,
  readCellStock,
  sumCellStock,
} from './publish.js';
export type { CellStock, PublishStockAggregateResult, StockAggregateRecord } from './publish.js';
