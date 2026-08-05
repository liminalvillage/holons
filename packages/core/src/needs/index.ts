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
  handoffCode,
  recordHandoffConfirmation,
  type ClaimResult,
  type CloseOutcome,
  type CloseResult,
  type HandoffConfirmResult,
  type HandoffParty,
  type RespondInput,
  type RespondResult,
} from './responses.js';

export {
  publishNeedNearby,
  refreshPublishedNeed,
  type PublishNeedOptions,
  type PublishNeedOutcome,
} from './publish.js';
