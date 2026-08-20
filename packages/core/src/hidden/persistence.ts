// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/hidden — Holosphere persistence helpers.

import { HIDDEN_LENS, buildHiddenEntry, hiddenId, hiddenIdSet } from './operations.js';
import type { HiddenDB, HiddenEntry, HiddenRef } from './types.js';

/** Hide a foreign record from `holonId`'s views. Returns the stored entry. */
export async function hideRef(
	db: HiddenDB,
	holonId: string | number,
	ref: HiddenRef,
	opts: { by?: string | number; now?: string } = {}
): Promise<HiddenEntry> {
	const entry = buildHiddenEntry(ref, opts);
	await db.put(String(holonId), HIDDEN_LENS, entry);
	return entry;
}

/** Drop a hide-entry, letting the record surface again. */
export async function unhideRef(
	db: HiddenDB,
	holonId: string | number,
	ref: HiddenRef
): Promise<void> {
	await db.delete(String(holonId), HIDDEN_LENS, hiddenId(ref));
}

/** All live hide-entries of a holon. */
export async function getHiddenEntries(
	db: HiddenDB,
	holonId: string | number
): Promise<HiddenEntry[]> {
	const raw = await db.getAll(String(holonId), HIDDEN_LENS);
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(e): e is HiddenEntry =>
			!!e &&
			typeof (e as HiddenEntry).id === 'string' &&
			(e as { _deleted?: unknown })._deleted !== true
	);
}

/** The holon's hidden-id set, ready for `isRefHidden` view filtering. */
export async function getHiddenIdSet(
	db: HiddenDB,
	holonId: string | number
): Promise<Set<string>> {
	return hiddenIdSet(await db.getAll(String(holonId), HIDDEN_LENS));
}
