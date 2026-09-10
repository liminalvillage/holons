// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * @holons/core/offers — resources on the table, matched to needs.
 *
 * An offer is a `type:'offer'` quest with a lifecycle and a quantity; the
 * transport plan (`@holons/core/inventory`) matches offers to needs within a
 * holon, across partners, and across hex scales; accepting a match rides the
 * need lifecycle; settling it records the movement as ValueFlows events.
 */
export {
  OFFER_RECORD_LENS,
  OFFERS_LENS,
  OFFER_STATUSES,
  OPEN_OFFER_STATUSES,
  isOfferRecord,
} from './types.js';
export type { OfferMode, OfferRecord, OfferReservation, OfferSource, OfferStatus, OfferSupply } from './types.js';
export {
  createOffer,
  isLiveReservation,
  modeOf,
  normalizeOffer,
  offerFromStockSurplus,
  remainingSupply,
  stockOfferId,
} from './transform.js';
export type { CreateOfferInput } from './transform.js';
export {
  editOffer,
  expireOffers,
  fulfillReservation,
  offerPartyOf,
  releaseReservation,
  reserveOffer,
  withdrawOffer,
} from './lifecycle.js';
export type { EditResult, OfferPatch, ReservationResult, ReserveInput, ReserveResult, WithdrawResult } from './lifecycle.js';
export { OFFER_SUPPLY_STATUSES, holonOf, ownerRef, suppliesOf, supplyOf } from './supply.js';
export type { StockSupply } from './supply.js';
export { defaultHexDistance, matchCost } from './distance.js';
export type { MatchCostInput } from './distance.js';
export { UNMET_COST, WANTS_PENALTY, dedupeMarket, matchOffersToNeeds, matchesFor, toMarketNeeds, toMarketOffers } from './match.js';
export type { CategoryContention, MarketNeed, MarketOffer, MatchLeg, MatchOptions, MatchPlan } from './match.js';
export { publishOfferNearby, refreshPublishedOffer, withdrawPublishedOffer } from './publish.js';
export type { PublishOfferOptions, PublishOfferOutcome, WithdrawOfferOutcome } from './publish.js';
export { cellLabel, readCellMarket, scaleChain } from './cell.js';
export type { CellMarket, ReadCellMarketOptions } from './cell.js';
export { acceptMatch } from './accept.js';
export type { AcceptDeps, AcceptMatchInput, AcceptMatchOutcome } from './accept.js';
export { answerNeed, offerForNeed, releaseNeedReservations } from './answer.js';
export type { AnswerNeedInput, AnswerNeedOutcome, OfferForNeedInput, ReleaseNeedOptions, ReleaseNeedOutcome } from './answer.js';
export { checkRequestOffer, needFromOffer, requestOffer } from './request.js';
export type { NeedFromOfferInput, RequestOfferCheck, RequestOfferInput, RequestOfferOutcome, RequestOfferReason } from './request.js';
export { buildOfferDelivery, offerDeliveryEventId, settleOfferReservation } from './settle.js';
export type { BuildOfferDeliveryInput, SettleOfferDeps, SettleOfferOptions, SettleOfferOutcome } from './settle.js';
export { itemSurplus, keepBack, readAutoOfferSetting, surplusOffers, syncSurplusFromShelf, syncSurplusOffers } from './surplus.js';
export type { SurplusInput, SurplusPlan, SyncShelfOptions, SyncSurplusOptions, SyncSurplusOutcome } from './surplus.js';
