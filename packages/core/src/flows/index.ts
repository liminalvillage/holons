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
 * Allocation is a set of RIGHTS over the fund, and `usage.ts` reads how much
 * of each right is already spent or claimed — from the expenses lens as
 * mutual credit with the holon, and from the collective's expense queue — so
 * the allocation Sankey can carry that column too.
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
  ValueFlowSegment,
  ValueFlowTrack,
} from './types.js';

export {
  DEFAULT_WINDOW_DAYS,
  HUB_ID,
  buildValueFlows,
  type BuildFlowsInput,
} from './build.js';

export {
  DAY_MS,
  DEFAULT_WINDOW_PRESET,
  FLOWS_WINDOW_PRESETS,
  formatLocalDate,
  isWindowPreset,
  parseLocalDate,
  resolveWindow,
  windowFromChoice,
  windowSpanDays,
  type FlowsWindow,
  type FlowsWindowChoice,
  type FlowsWindowPreset,
  type WindowedInput,
} from './window.js';

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
  nodeBreakdown,
  rolledUpNodes,
  type BreakdownRow,
  type NodeBreakdown,
  type SankeyLayout,
  type SankeyLayoutLink,
  type SankeyLayoutNode,
  type SankeyOptions,
} from './layout.js';

export {
  CHORD_OTHERS_ID,
  buildPeopleFlows,
  chordBreakdown,
  layoutChord,
  type BuildPeopleFlowsInput,
  type ChordGroup,
  type ChordLayout,
  type ChordOptions,
  type ChordRibbon,
  type PeopleFlowParty,
  type PeopleFlowTrack,
  type PeopleFlowTrackId,
} from './chord.js';

export {
  DEFAULT_ALLOCATION_CONFIG,
  allocate,
  calculateZonePercentages,
  interiorSharePercentages,
  normalizeAllocationConfig,
  normalizeInteriorShares,
  resolveInteriorMembers,
  sharesFromMembers,
  type AllocationConfig,
  type AllocationMember,
  type AllocationPartner,
  type AllocationResult,
  type AllocationSlice,
  type InteriorMode,
  type InteriorShares,
} from './allocation.js';

export {
  combinePeopleTracks,
  combineTracks,
  type CombineOptions,
} from './combine.js';

export {
  UNATTRIBUTED_ID,
  USAGE_SEGMENT_KINDS,
  allocationToGraph,
  partyIdOf,
  partyNodeId,
  segmentTotal,
  type AllocationGraphLabels,
  type UsageSegmentKind,
} from './allocation-graph.js';

export {
  DEFAULT_USAGE_WINDOW_DAYS,
  buildFundUsage,
  fundAccount,
  lifetimeOf,
  lifetimeTotals,
  rightsTotal,
  usageOf,
  usageTotals,
  usageUnits,
  type BuildFundUsageInput,
  type FundAccount,
  type FundAccountOtherUse,
  type FundUsage,
  type FundPayee,
  type FundUsageParty,
  type FundUse,
} from './usage.js';

export { SYNODIC_MONTH_DAYS, lunationAt, type Lunation } from './lunation.js';

export {
  COLLECTIVE_OVERVIEW_QUERY,
  OPENCOLLECTIVE_API_URL,
  OPEN_EXPENSE_STATUSES,
  isValidCollectiveSlug,
  normalizeCollectiveSlug,
  parseOpenCollectiveResponse,
  type OpenCollectiveExpense,
  type OpenCollectiveSnapshot,
  type OpenCollectiveTransaction,
} from './opencollective.js';

export {
  BUNDLE_SYNC_ALL_ABI,
  WAD,
  bundleSyncArgList,
  bundleSyncArgs,
  sharesToBasisPoints,
  steepnessFromContract,
  steepnessToContract,
  type BundleMember,
  type BundlePartner,
  type BundleSyncArgs,
} from './contract.js';

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
  readInteriorShares,
  readZoneAssignments,
  readZonePeople,
  saveAllocationConfig,
  saveCollectiveSlug,
  toAllocationPartners,
} from './settings.js';

export {
  FLOW_CLAIMS_LENS,
  buildClaim,
  buildPayout,
  buildClaimVerdict,
  foldClaims,
  claimTotalsOf,
  isClaim,
  isPayout,
  type BuildClaimInput,
  type Claim,
  type ClaimBody,
  type ClaimStatus,
  type ClaimTotals,
  type FoldClaimsInput,
  type FoldedClaims,
  type Payout,
  type PayoutBody,
  type RightsLookup,
} from './claims.js';
