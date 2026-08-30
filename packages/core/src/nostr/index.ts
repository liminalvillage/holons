// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/nostr — standard-kind projections of HoloSphere lenses
// (NIP-52 / NIP-99 / kind 0 / NIP-51) published next to the canonical
// kind-30078 record. Subpath import:
//   import { buildProjections, parseProjectionList } from '@holons/core/nostr'

export * from './types.js';
export * from './tags.js';
export * from './projections.js';
export { calendarCodec, CALENDAR_TIME_KIND, CALENDAR_DATE_KIND, CALENDAR_RSVP_KIND, type CalendarRecord } from './codecs/calendar.js';
export { classifiedCodec, classifiedStatus, CLASSIFIED_KIND, type ClassifiedRecord } from './codecs/classified.js';
export { profileCodec, profileContent, PROFILE_KIND, type UserRecord } from './codecs/profile.js';
export { setCodec, SET_KIND, type SetRecord } from './codecs/sets.js';
export { badgeCodec, BADGE_DEFINITION_KIND, BADGE_AWARD_KIND, type RoleRecord } from './codecs/badges.js';
export { REACTION_KIND, reactionCompanions, parseReaction } from './codecs/reactions.js';
export * from './groups.js';
export * from './dm.js';
export { groupCodec, type SettingsRecord } from './codecs/group.js';
