// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Federation partner management — THE write path for federation links.
 *
 * The native holosphere federation record (`getFederation` / `federateHolon`)
 * is the single store: `subscribeFederated` reads it, `publishToFederation`
 * honors it, and `getFederationSnapshot` is its read view. (The old
 * settings-lens `federation[]`/`lensConfig` mirror is gone — see legacy.ts
 * for the one-shot migration of records written before the unification.)
 *
 * UI-agnostic; name resolution stays with the caller (pass `partnerName`
 * when known).
 */

import type { HoloSphere } from 'holosphere';
import type { FederationLensDirections } from './snapshot.js';

/** How a single lens flows between this holon and a partner. */
export type FederationLensMode = 'off' | 'receive' | 'send' | 'both';

export interface SetFederationPartnerOptions {
	/** Lenses this holon RECEIVES from the partner — full replacement. */
	inbound: string[];
	/** Lenses this holon SENDS to the partner — full replacement. */
	outbound: string[];
	/** Display name recorded in `partnerNames` (best-effort, caller-resolved). */
	partnerName?: string;
}

/** Read the mode of one lens out of a partner's directional config. */
export function lensMode(dirs: FederationLensDirections, lens: string): FederationLensMode {
	const inbound = dirs.inbound.includes(lens);
	const outbound = dirs.outbound.includes(lens);
	if (inbound && outbound) return 'both';
	if (inbound) return 'receive';
	if (outbound) return 'send';
	return 'off';
}

/**
 * Return a new directional config with one lens set to the given mode.
 * Other lenses are untouched; arrays are copied and deduped, never mutated.
 */
export function applyLensMode(
	dirs: FederationLensDirections,
	lens: string,
	mode: FederationLensMode
): FederationLensDirections {
	const without = (arr: string[]) => [...new Set(arr)].filter((l) => l !== lens);
	const inbound = without(dirs.inbound);
	const outbound = without(dirs.outbound);
	if (mode === 'receive' || mode === 'both') inbound.push(lens);
	if (mode === 'send' || mode === 'both') outbound.push(lens);
	return { inbound, outbound };
}

function normalizeId(id: string, label: string): string {
	const trimmed = String(id ?? '').trim();
	if (!trimmed) throw new Error(`${label} is required`);
	return trimmed;
}

/** Keep only non-empty strings, trimmed and deduped. */
export function sanitizeLenses(lenses: string[]): string[] {
	const clean = (Array.isArray(lenses) ? lenses : [])
		.filter((l) => typeof l === 'string' && l.trim().length > 0)
		.map((l) => l.trim());
	return [...new Set(clean)];
}

/**
 * Link (or update) a federation partner with the given lens config.
 *
 * Upserts the partner on `holonId`'s federation record and FULLY REPLACES its
 * per-partner lens config — always pass the complete inbound/outbound arrays.
 * HoloSphere mirrors the link bidirectionally onto the partner's record with
 * inverted directions. Writes config only: no data propagation, no holograms.
 */
export async function setFederationPartner(
	holosphere: HoloSphere,
	holonId: string,
	targetId: string,
	options: SetFederationPartnerOptions
): Promise<boolean> {
	const source = normalizeId(holonId, 'holonId');
	const target = normalizeId(targetId, 'targetId');
	if (source === target) throw new Error('Cannot federate a holon with itself');

	return (holosphere as any).federateHolon(source, target, {
		lensConfig: {
			inbound: sanitizeLenses(options.inbound),
			outbound: sanitizeLenses(options.outbound)
		},
		...(options.partnerName ? { partnerName: options.partnerName } : {})
	});
}

/** Remove a federation partner from `holonId`'s federation record. */
export async function removeFederationPartner(
	holosphere: HoloSphere,
	holonId: string,
	targetId: string
): Promise<boolean> {
	const source = normalizeId(holonId, 'holonId');
	const target = normalizeId(targetId, 'targetId');
	return (holosphere as any).unfederateHolon(source, target);
}
