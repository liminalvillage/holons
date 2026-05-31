// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/announcements — pure operations (no I/O).

import type {
  Announcement,
  FederationInfo,
  FederationMessageEntry,
  FederationTracking,
} from './types.js';

/** The lens federated announcements travel on. */
export const ANNOUNCEMENTS_LENS = 'announcements';

/** Build an announcement record. */
export function createAnnouncement(input: {
  id: string | number;
  content: string;
  chat: string;
  user?: unknown;
}): Announcement {
  return {
    id: input.id,
    user: input.user,
    created: new Date().toISOString(),
    content: input.content,
    chat: String(input.chat),
  };
}

/** Tracking key for an announcement's federated copies. */
export function federationKey(
  chat: string,
  announcementId: string | number
): string {
  return `${chat}_${announcementId}_fedannouncements`;
}

/** A fresh, empty tracking record. */
export function emptyTracking(
  chat: string,
  announcementId: string | number
): FederationTracking {
  return {
    id: federationKey(chat, announcementId),
    holonId: chat,
    announcementId,
    messages: [],
  };
}

/**
 * Which holons to fan an announcement out to: the source's `outbound` partners,
 * excluding the source itself. Mirrors Announcements.js.
 */
export function selectFederationTargets(
  fedInfo: FederationInfo | null | undefined,
  sourceHolonId: string
): string[] {
  const source = String(sourceHolonId);
  return (fedInfo?.outbound ?? []).filter(id => String(id) !== source);
}

/**
 * Whether a target holon accepts a given lens FROM the source — i.e. the lens
 * is in the target's inbound list for the source (`lensConfig[source].inbound`).
 * Receivers opt in to what they accept from each partner.
 */
export function targetAcceptsLens(
  targetFedInfo: FederationInfo | null | undefined,
  sourceHolonId: string,
  lens: string = ANNOUNCEMENTS_LENS
): boolean {
  const entry = targetFedInfo?.lensConfig?.[String(sourceHolonId)];
  return Boolean(entry?.inbound?.includes(lens));
}

/**
 * Record (or replace) a delivered copy in the tracking record, keyed by holon,
 * so re-announcing can update the prior message rather than duplicate it.
 */
export function recordFederatedMessage(
  tracking: FederationTracking,
  entry: FederationMessageEntry
): FederationTracking {
  const messages = tracking.messages.filter(m => m.holonId !== entry.holonId);
  messages.push(entry);
  return { ...tracking, messages };
}
