// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/tags — pure operations (no I/O).

import type { TagEntry, TagObject } from './types.js';

export const TAGS_LENS = 'tags';

/** Keyword that collects photographed cards (a transcription plus its picture). */
export const CARDS_TAG = 'cards';

/** A photographed card: the writing read off it and the image it came from. */
export interface CardInput {
  holonId: string | number;
  messageId: string | number;
  text: string;
  picture?: string | null;
}

/** Build the tag entry for a card. The picture is dropped when empty. */
export function cardEntry(card: CardInput): TagEntry {
  const picture = (card.picture ?? '').trim();
  return {
    holonId: String(card.holonId),
    messageId: card.messageId,
    messageContent: card.text.trim(),
    ...(picture ? { picture } : {}),
  };
}

/**
 * Append an entry under a tag keyword, creating the tag object if it doesn't
 * exist yet. Returns a new TagObject. Mirrors Tags.ts.
 */
export function addTagEntry(
  existing: TagObject | null | undefined,
  tagName: string,
  entry: TagEntry
): TagObject {
  if (existing?.content) {
    return { ...existing, content: [...existing.content, entry] };
  }
  return { id: tagName, content: [entry] };
}

/** Read the entries for a tag (empty array when absent). */
export function tagEntries(tag: TagObject | null | undefined): TagEntry[] {
  return tag?.content ?? [];
}
