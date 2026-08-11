// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Retraction — the missing half of federated copies.
 *
 * `publishToFederation` (default, no holograms) writes STANDALONE copies to
 * partner holons: the receiver owns its record, so deleting or withdrawing
 * the source never touched them and partner boards kept stale cards forever.
 * `retractFromFederation` walks the federation targets and tombstones the
 * copy on each (`holosphere.delete` — a real deletion, so live subscriptions
 * emit the removal). Hologram forwards don't need this: they resolve live
 * from the source, and `deleteTaskWithCascade` already prunes them.
 *
 * Best-effort by design — a partner may deny the write; failures are
 * collected, never thrown.
 */

import type { HoloSphere } from 'holosphere';
import { getFederationSnapshot } from './snapshot.js';

export interface RetractOutcome {
	/** Partners whose copy was tombstoned. */
	retractedFrom: number;
	destinations: string[];
	errors: string[];
}

export interface RetractOptions {
	/** Explicit target holons; defaults to the holon's federation partners. */
	targets?: string[];
}

export async function retractFromFederation(
	holosphere: HoloSphere,
	holonId: string,
	lens: string,
	itemId: string | number,
	opts: RetractOptions = {}
): Promise<RetractOutcome> {
	const id = String(itemId ?? '').trim();
	const outcome: RetractOutcome = { retractedFrom: 0, destinations: [], errors: [] };
	if (!id) {
		outcome.errors.push('retractFromFederation: itemId is required');
		return outcome;
	}

	let targets = opts.targets;
	if (!targets) {
		try {
			targets = (await getFederationSnapshot(holosphere, holonId)).federated;
		} catch (err) {
			outcome.errors.push(`snapshot: ${(err as Error).message ?? String(err)}`);
			return outcome;
		}
	}

	for (const target of targets) {
		const t = String(target ?? '').trim();
		if (!t || t === holonId) continue;
		try {
			await (holosphere as any).delete(t, lens, id);
			outcome.retractedFrom++;
			outcome.destinations.push(t);
		} catch (err) {
			outcome.errors.push(`${t}: ${(err as Error).message ?? String(err)}`);
		}
	}
	return outcome;
}
