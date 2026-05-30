// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/announcements — Holosphere persistence helpers.

import { ANNOUNCEMENTS_LENS, emptyTracking, federationKey } from './operations.js';
import type {
  Announcement,
  AnnouncementsDB,
  FederationTracking,
} from './types.js';

const FEDERATION_MESSAGES_GLOBAL = 'federation_messages';

/** Persist an announcement under the source holon's `announcements` lens. */
export async function saveAnnouncement(
  db: AnnouncementsDB,
  announcement: Announcement
): Promise<void> {
  await db.put(String(announcement.chat), ANNOUNCEMENTS_LENS, announcement);
}

/** List a holon's announcements, newest first. */
export async function listAnnouncements(
  db: AnnouncementsDB,
  holonId: string | number
): Promise<Announcement[]> {
  const list = ((await db.getAll(String(holonId), ANNOUNCEMENTS_LENS)) ??
    []) as Announcement[];
  return list
    .filter(Boolean)
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}

/** Load the federation tracking record, or a fresh empty one. */
export async function getFederationTracking(
  db: AnnouncementsDB,
  chat: string,
  announcementId: string | number
): Promise<FederationTracking> {
  if (!db.getGlobal) return emptyTracking(chat, announcementId);
  const existing = (await db.getGlobal(
    FEDERATION_MESSAGES_GLOBAL,
    federationKey(chat, announcementId)
  )) as FederationTracking | null;
  return existing ?? emptyTracking(chat, announcementId);
}

/** Persist the federation tracking record (no-op if the db lacks globals). */
export async function saveFederationTracking(
  db: AnnouncementsDB,
  tracking: FederationTracking
): Promise<void> {
  if (!db.putGlobal) return;
  await db.putGlobal(FEDERATION_MESSAGES_GLOBAL, tracking);
}
