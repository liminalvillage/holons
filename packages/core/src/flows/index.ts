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
 * A recipient can be a holon with a split of its own — a member's id is their
 * personal holon's id — and `cascade.ts` follows a share down through those
 * splits, rail-agnostic: the same resolver mirrors what nested Bundles pay
 * on-chain and sizes the rights held downstream off-chain. `cascade-load.ts`
 * reads the splits it runs through off the settings lens.
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
  DEFAULT_CASCADE_DEPTH,
  DEFAULT_CASCADE_NODES,
  cascadeRights,
  resolveCascade,
  summarizeCascade,
  type CascadeInputs,
  type CascadeLeaf,
  type CascadeLeafReason,
  type CascadeNode,
  type CascadeResult,
  type CascadeSummary,
  type ResolveChild,
} from './cascade.js';

export {
  DEFAULT_CASCADE_CONCURRENCY,
  DEFAULT_CASCADE_HOLONS,
  childResolver,
  loadCascadeChildren,
  type LoadCascadeOptions,
  type LoadedCascade,
} from './cascade-load.js';

export {
  PASSED_SEGMENT,
  RETAINED_ID,
  UNATTRIBUTED_ID,
  USAGE_SEGMENT_KINDS,
  allocationToGraph,
  cascadeToGraph,
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
  inboundTotal,
  lifetimeOf,
  lifetimeTotals,
  mergeInboundUsage,
  movedOf,
  rightsTotal,
  usageOf,
  usageTotals,
  usageUnits,
  type BuildFundUsageInput,
  type FundAccount,
  type FundAccountOtherUse,
  type FundMoved,
  type FundUsage,
  type FundPayee,
  type FundUsageParty,
  type FundUse,
  type InboundRight,
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
  POT_KEY,
  addPotToken,
  loadPotRecord,
  normalizePotRecord,
  normalizePotToken,
  normalizeTreasury,
  readPotRecord,
  readPotTokens,
  removePotToken,
  savePotRecord,
  savePotTreasury,
  withPotToken,
  withoutPotToken,
  type PotRecord,
  type PotToken,
  type TreasuryRecord,
} from './pot-record.js';

export { ERC20_META_ABI, formatHolding, fromBaseUnits, nativeUnit, treasuryLines, type TreasuryLine } from './holdings.js';

export {
  ALLOCATION_KEY,
  COLLECTIVE_KEY,
  hasAllocationConfig,
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
  buildTransfer,
  buildClaimVerdict,
  foldClaims,
  claimTotalsOf,
  isClaim,
  isPayout,
  isTransfer,
  type BuildClaimInput,
  type BuildTransferInput,
  type Claim,
  type ClaimBody,
  type ClaimStatus,
  type ClaimTotals,
  type FoldClaimsInput,
  type FoldedClaims,
  type Payout,
  type PayoutBody,
  type RightsLookup,
  type Transfer,
  type TransferBody,
  type TransferStatus,
} from './claims.js';
export { foldClaimsFromLenses, type ClaimsContext, type ClaimsFromLensesInput } from './claims.js';

export { KNOWN_CHAINS, describeChain, explorerAddressUrl, requiredChainId, safeAppUrl, type ChainInfo } from './chain.js';

export {
  FLOW_MINTS_LENS,
  buildMint,
  foldMints,
  foldMintsFromLenses,
  isMint,
  mintedTotal,
  mintedUnits,
  type BuildMintInput,
  type FoldMintsInput,
  type FoldedMints,
  type Mint,
  type MintBody,
  type MintStatus,
  type MintsContext,
  type MintsFromLensesInput,
} from './mints.js';
export { loadMints } from './mints-load.js';

export {
  DEFAULT_INBOUND_HOLONS,
  DEFAULT_INBOUND_HOPS,
  inboundRightFrom,
  loadInboundRights,
  type InboundRightInput,
  type LoadInboundOptions,
  type LoadedInbound,
  type UpstreamPot,
} from './inbound.js';

export { claimableInbound, defaultPotUnit, hasPot, heldInPot, mintedIn, potBalance, potTotal, potUnits, type PotSources } from './pot.js';
export { scoreAllocationMembers } from './score-load.js';

export {
  ceilingOf,
  claimCeilings,
  claimHeadroom,
  fitsHeadroom,
  partyShares,
  type ClaimCeilingInput,
  type ClaimCeilings,
} from './ceiling.js';
export {
  DEFAULT_CEILING_HOLONS,
  loadClaimCeilings,
  type LoadClaimCeilingsOptions,
  type LoadedClaimCeilings,
} from './ceiling-load.js';
export { loadAllocationInputs, onwardParties, type AllocationInputs } from './cascade-load.js';
export { defaultUpstreams } from './inbound.js';

// ── The Pot: value held, rights committed once per lunation ───────────────

export {
  ZERO_ADDRESS,
  advanceRights,
  collectable,
  divideExactly,
  normalizeAddress,
  rightsRegression,
  rightsRow,
  type AdvanceRightsInput,
  type RightsRow,
  type RightsTable,
} from './rights.js';
export {
  EMPTY_RIGHTS_ROOT,
  encodeRow,
  partyKey,
  rightsProof,
  rightsRoot,
  rowLeaf,
  verifyRightsProof,
} from './rights-tree.js';
export {
  FLOW_RIGHTS_LENS,
  buildRightsEntry,
  buildRightsSignature,
  isRightsSignature,
  rootSignatures,
  foldRights,
  foldRightsFromLenses,
  isRights,
  latestRights,
  rightsByRef,
  tableOf,
  type FoldRightsInput,
  type FoldedRights,
  type PublishedRights,
  type RightsBody,
  type RightsSignature,
  type RightsStatus,
  type RightsFromLensesInput,
} from './rights-log.js';
export { DEFAULT_RIGHTS_HOLONS, cutRights, type CutRights, type CutRightsOptions } from './rights-cut.js';
export { loadRights, type RightsContext } from './rights-load.js';
export {
  POT_ABI,
  POT_ETH,
  POT_ROOT_TYPES,
  orderSignatures,
  potClaimArgList,
  potClaimArgs,
  potCommitment,
  potDomain,
  potPostRootArgs,
  type PotClaimArgs,
  type PotCommitment,
} from './pot-contract.js';
export {
  DEFAULT_POT_CHALLENGE_SECONDS,
  POT_BYTECODE,
  POT_CONSTRUCTOR_ABI,
  potConstructorArgList,
  potConstructorArgs,
  type PotConstructorArgs,
} from './pot-artifact.js';
export {
  DEFAULT_PAYOUT_CONCURRENCY,
  PAYOUT_KEY,
  loadPayoutAddresses,
  payoutAddressOf,
  readPayoutAddress,
  savePayoutAddress,
  type PayoutRecord,
} from './payout.js';
