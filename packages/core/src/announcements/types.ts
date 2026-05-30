// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/announcements — type definitions.
//
// Extracted from packages/telegram-ui/src/Announcements.js. Core owns the
// announcement shape, federation target selection, and federated-message
// tracking; UIs own message delivery.

/** A published community announcement (`announcements` lens). */
export interface Announcement {
  /** Source message id, or a generated id. */
  id: string | number;
  /** The actor who published it (UI-shaped; optional). */
  user?: unknown;
  /** ISO timestamp. */
  date: string;
  content: string;
  /** Source holon id. */
  chat: string;
  [key: string]: unknown;
}

/** Per-source lens permissions a holon grants to federation partners. */
export interface LensConfigEntry {
  inbound?: string[];
  outbound?: string[];
}

/** Federation metadata for a holon (subset we read). */
export interface FederationInfo {
  outbound?: string[];
  inbound?: string[];
  lensConfig?: Record<string, LensConfigEntry>;
}

/** One delivered copy of an announcement, for later edits. */
export interface FederationMessageEntry {
  holonId: string;
  /** UI-specific message reference (Telegram message id, Discord message id…). */
  ref: string | number;
  [key: string]: unknown;
}

/** Tracking record (`federation_messages` global) for one announcement. */
export interface FederationTracking {
  id: string;
  holonId: string;
  announcementId: string | number;
  messages: FederationMessageEntry[];
}

/** Minimal Holosphere surface used by the persistence helpers. */
export interface AnnouncementsDB {
  get(holonId: string, lens: string, key?: string | number): Promise<unknown>;
  getAll(holonId: string, lens: string): Promise<unknown[]>;
  put(holonId: string, lens: string, value: unknown): Promise<unknown>;
  getGlobal?(lens: string, key: string): Promise<unknown>;
  putGlobal?(lens: string, value: unknown): Promise<unknown>;
  getFederation?(holonId: string): Promise<FederationInfo | null>;
}
