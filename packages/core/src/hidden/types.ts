// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/hidden — type definitions.
//
// A holon's mute list for records it does NOT own. Federation aggregates
// partner records into a holon's views by reference — there is no local node
// to delete, so "removing" one used to route a tombstone to the OWNER holon,
// deleting the record for everyone. A hide-entry is the viewer-side answer:
// an annotation stored in the viewing holon's own `hidden` lens, signed and
// synced like any other record, that views filter against. The original is
// never touched, and un-hiding is always possible because nothing was
// destroyed.

/** The address a foreign record actually lives at — its owner's graph. */
export interface HiddenRef {
	holon: string;
	lens: string;
	key: string;
}

/** One hide-entry, stored in the *viewing* holon's `hidden` lens. */
export interface HiddenEntry extends HiddenRef {
	/** Canonical id derived from the ref — see `hiddenId`. */
	id: string;
	/** ISO timestamp of when it was hidden. */
	created: string;
	/** Actor who hid it, when known. */
	by?: string | number;
}

/** Minimal Holosphere surface used by the hidden persistence helpers. */
export interface HiddenDB {
	getAll(holonId: string, lens: string): Promise<unknown>;
	put(holonId: string, lens: string, value: unknown): Promise<unknown>;
	delete(holonId: string, lens: string, key: string): Promise<unknown>;
}
