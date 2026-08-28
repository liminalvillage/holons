// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @holons/core/flows
 *
 * A holon's value picture, in one place: what moved (REA events, shared
 * expenses, OpenCollective) and where its resources are allocated (the
 * interior/exterior split behind Flow Management).
 *
 * Both halves are Sankey diagrams over the same `ValueFlowTrack` shape, so
 * `layoutSankey` renders either and every surface draws identical geometry.
 *
 * The same walk also yields the ledger behind the picture — one dated, named
 * row per thing that happened, searchable via `filterLedger` — so a reader can
 * check the diagram against the entries it was drawn from.
 *
 * Everything here is pure. The OpenCollective query lives here but the fetch
 * does not — apps own that, behind their own `/api/opencollective` route.
 */

export type {
  TrackId,
  ValueFlowGraph,
  ValueFlowLink,
  ValueFlowNode,
  ValueFlowTrack,
} from './types.js';

export {
  DEFAULT_WINDOW_DAYS,
  HUB_ID,
  buildValueFlows,
  type BuildFlowsInput,
} from './build.js';

export {
  DEFAULT_LEDGER_WINDOW_DAYS,
  buildLedger,
  filterLedger,
  foldForSearch,
  ledgerSearchText,
  ledgerTrackKey,
  sortLedger,
  summarizeLedger,
  type LedgerDirection,
  type LedgerEntry,
  type LedgerFilter,
  type LedgerResult,
  type LedgerSource,
  type LedgerTotals,
} from './ledger.js';

export {
  layoutSankey,
  type SankeyLayout,
  type SankeyLayoutLink,
  type SankeyLayoutNode,
  type SankeyOptions,
} from './layout.js';

export {
  DEFAULT_ALLOCATION_CONFIG,
  allocate,
  calculateZonePercentages,
  normalizeAllocationConfig,
  type AllocationConfig,
  type AllocationMember,
  type AllocationPartner,
  type AllocationResult,
  type AllocationSlice,
} from './allocation.js';

export {
  allocationToGraph,
  type AllocationGraphLabels,
} from './allocation-graph.js';

export {
  COLLECTIVE_OVERVIEW_QUERY,
  OPENCOLLECTIVE_API_URL,
  isValidCollectiveSlug,
  normalizeCollectiveSlug,
  parseOpenCollectiveResponse,
  type OpenCollectiveSnapshot,
  type OpenCollectiveTransaction,
} from './opencollective.js';

export {
  BUNDLE_KEY,
  migrateLegacyBundleRecord,
  readBundleRecord,
  saveBundleRecord,
  type BundleMigration,
  type HolonBundleRecord,
} from './bundle.js';

export {
  ALLOCATION_KEY,
  COLLECTIVE_KEY,
  readAllocationConfig,
  readCollectiveSlug,
  readZoneAssignments,
  saveAllocationConfig,
  saveCollectiveSlug,
  toAllocationPartners,
} from './settings.js';
