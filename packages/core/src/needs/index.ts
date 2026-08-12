// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @holons/core/needs
 *
 * Geolocated needs: shopping-list items published as marketplace needs on the
 * `quests` lens, optionally projected to the holon's H3 hex cell (`needs`
 * lens) so they light the public map, with provider responses embedded on the
 * record. See docs/needs-offers-network.md for the concept.
 */

export {
  NEED_RECORD_LENS,
  NEEDS_LENS,
  NEED_STATUSES,
  OPEN_NEED_STATUSES,
  isPublishedNeed,
  type HandoffState,
  type NeedResponse,
  type NeedStatus,
  type PublishedNeed,
} from './types.js';

export {
  needFromShoppingItem,
  normalizeNeed,
  type NeedFromShoppingOptions,
} from './transform.js';

export {
  respondToNeed,
  claimNeed,
  closeNeed,
  acceptedResponse,
  needPartyOf,
  handoffCode,
  generateHandoffCode,
  recordHandoffConfirmation,
  type ClaimOptions,
  type ClaimResult,
  type CloseOutcome,
  type CloseResult,
  type HandoffCodeOptions,
  type HandoffConfirmResult,
  type HandoffParty,
  type RespondInput,
  type RespondResult,
} from './responses.js';

export {
  HANDOFF_CONFIRM_TYPE,
  handoffConfirmationId,
  buildHandoffConfirmation,
  isHandoffConfirmation,
  foldHandoffConfirmations,
  withHandoffConfirmations,
  confirmNeedHandoff,
  type ConfirmNeedHandoffOptions,
  type ConfirmNeedHandoffResult,
  type HandoffConfirmationRecord,
  type HandoffConfirmations,
  type HandoffStoreLike,
} from './handoff.js';

export {
  NEED_RATING_TYPE,
  needRatingId,
  buildNeedRating,
  isNeedRating,
  foldNeedRatings,
  reputationByUser,
  reputationOf,
  rateNeedHandoff,
  type BuildNeedRatingOptions,
  type BuildNeedRatingResult,
  type NeedRatingRecord,
  type NeedRatingRejection,
  type NeedRatings,
  type RateNeedOptions,
  type RateNeedResult,
  type ReputationSummary,
} from './reputation.js';

export {
  settleNeedHandoff,
  handoffExpenseId,
  handoffFeeExpenseId,
  mintedOfferId,
  type SettleDeps,
  type SettleNeedOptions,
  type SettleNeedOutcome,
  type SettleStoreLike,
} from './settle.js';

export {
  GROUP_BUY_TAG,
  groupBuyId,
  isGroupBuy,
  clusterKeyOf,
  clusterNeedsByCategory,
  buildGroupBuyQuest,
  upsertGroupBuys,
  type GroupBuyCluster,
  type GroupBuyMember,
  type GroupBuyStoreLike,
  type UpsertGroupBuysOutcome,
} from './groupbuy.js';

export {
  publishNeedNearby,
  refreshPublishedNeed,
  type PublishNeedOptions,
  type PublishNeedOutcome,
} from './publish.js';
