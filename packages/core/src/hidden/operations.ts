// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/hidden — pure operations.

import type { HiddenEntry, HiddenRef } from './types.js';

/** Lens the hide-entries live in, on the viewing holon. */
export const HIDDEN_LENS = 'hidden';

/**
 * Canonical id for a hide-entry. Colon-joined, NOT slash-joined: the id
 * becomes the entry's Gun key and therefore part of a soul path, where an
 * embedded `/` would corrupt soul parsing.
 */
export function hiddenId(ref: HiddenRef): string {
	return `${ref.holon}:${ref.lens}:${ref.key}`;
}

/** Build a hide-entry for a foreign record's source address. */
export function buildHiddenEntry(
	ref: HiddenRef,
	opts: { by?: string | number; now?: string } = {}
): HiddenEntry {
	const entry: HiddenEntry = {
		id: hiddenId(ref),
		holon: String(ref.holon),
		lens: String(ref.lens),
		key: String(ref.key),
		created: opts.now ?? new Date().toISOString()
	};
	if (opts.by != null) entry.by = opts.by;
	return entry;
}

/**
 * The set of hidden ids from a lens read. Tolerant of nulls, tombstones and
 * malformed records (eventually-consistent reads surface all three).
 */
export function hiddenIdSet(entries: unknown): Set<string> {
	const out = new Set<string>();
	if (!Array.isArray(entries)) return out;
	for (const e of entries) {
		const rec = e as { id?: unknown; _deleted?: unknown } | null;
		if (!rec || rec._deleted === true) continue;
		if (typeof rec.id === 'string' && rec.id) out.add(rec.id);
	}
	return out;
}

/**
 * Whether a record's source address is hidden. `ref` is the record's
 * provenance target (`sourceRef` from `@holons/core/holosphere`, widened
 * with the lens it was read from); `undefined` — the holon's own records —
 * is never hidden: hiding is only ever about records the holon doesn't own.
 */
export function isRefHidden(
	hidden: ReadonlySet<string>,
	ref: HiddenRef | undefined
): boolean {
	return ref != null && hidden.has(hiddenId(ref));
}
