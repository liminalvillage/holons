// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/tags — Holosphere persistence helpers.

import { TAGS_LENS, addTagEntry, tagEntries } from './operations.js';
import type { TagEntry, TagObject, TagsDB } from './types.js';

/** Fetch a tag object by keyword, or null. */
export async function getTag(
  db: TagsDB,
  holonId: string | number,
  tagName: string
): Promise<TagObject | null> {
  return ((await db.get(String(holonId), TAGS_LENS, tagName)) as TagObject) ?? null;
}

/** Persist a tag object (keyed by its `id`). */
export async function saveTag(
  db: TagsDB,
  holonId: string | number,
  tag: TagObject
): Promise<void> {
  await db.put(String(holonId), TAGS_LENS, tag);
}

/** Tag a reference under a keyword, persisting the merged tag object. */
export async function tagMessage(
  db: TagsDB,
  holonId: string | number,
  tagName: string,
  entry: TagEntry
): Promise<TagObject> {
  const existing = await getTag(db, holonId, tagName);
  const updated = addTagEntry(existing, tagName, entry);
  await saveTag(db, holonId, updated);
  return updated;
}

/** List the entries stored under a tag keyword. */
export async function getTagEntries(
  db: TagsDB,
  holonId: string | number,
  tagName: string
): Promise<TagEntry[]> {
  return tagEntries(await getTag(db, holonId, tagName));
}
