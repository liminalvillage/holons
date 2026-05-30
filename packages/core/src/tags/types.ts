// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/tags — type definitions.
//
// Extracted from packages/telegram-ui/src/Tags.ts. A tag groups references to
// messages/items that were marked with the same keyword, per holon.

/** One tagged reference. `messageId` is UI-shaped (Telegram/Discord message id). */
export interface TagEntry {
  holonId: string;
  messageId: string | number;
  messageContent?: string;
  [key: string]: unknown;
}

/** All references collected under one tag keyword (keyed by `id` = keyword). */
export interface TagObject {
  id: string;
  content: TagEntry[];
}

/** Minimal Holosphere surface used by the tag persistence helpers. */
export interface TagsDB {
  get(holonId: string, lens: string, key?: string | number): Promise<unknown>;
  put(holonId: string, lens: string, value: unknown): Promise<unknown>;
}
