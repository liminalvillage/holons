// SPDX-License-Identifier: AGPL-3.0-or-later
//
// @holons/core/clipboard — portable copy/paste of cards (quests and library
// things) as human-readable text with an embedded machine marker.

export {
  CARD_MARKER,
  CARD_FORMAT,
  cardFromQuest,
  cardFromLibraryItem,
  encodeCardText,
  parseCardText,
  questFromCard,
  libraryAddFromCard
} from './card-clipboard.js';
export type {
  CardPayload,
  QuestCardData,
  ThingCardData,
  QuestFromCardInput
} from './card-clipboard.js';
