// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Federation partner management — THE write path for federation links.
 *
 * A link has two halves, one per holon, each its own admins' word. An edit
 * writes this side and either writes the partner's (this key speaks for it
 * too) or asks the partner's admins (./requests.ts).
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
import { writeAcceptance } from '../holosphere/authority.js';
import { may } from '../holosphere/capabilities.js';
import type { FederationLensDirections } from './snapshot.js';
import {
	askFederation,
	cancelFederationRequest,
	counterpartConfig,
	mirrorDirections,
	normalizeDirections,
	removeOwnSide,
	sameDirections,
	writeOwnSide
} from './requests.js';

/** How a single lens flows between this holon and a partner. */
export type FederationLensMode = 'off' | 'receive' | 'send' | 'both';

export interface SetFederationPartnerOptions {
	/** Lenses this holon RECEIVES from the partner — full replacement. */
	inbound: string[];
	/** Lenses this holon SENDS to the partner — full replacement. */
	outbound: string[];
	/** Display name recorded in `partnerNames` (best-effort, caller-resolved). */
	partnerName?: string;
	/**
	 * Scalespace reach, for a partner that is an H3 cell: how many parent
	 * levels above it an outbound write climbs. Absent or 0 means no automatic
	 * placement at all — the partner is written only by an explicit publish,
	 * which is how every non-cell partner behaves. See `./home-hex.ts`.
	 */
	hops?: number;
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

/** What happened on each side of a link edit. */
export interface FederationLinkOutcome {
	/**
	 * `holon`'s own half: written by an admin (`linked`/`removed`), or `held` —
	 * this key does not speak for `holon`, so nothing was written at all.
	 */
	self: 'linked' | 'removed' | 'held';
	/**
	 * The partner's half: written directly because this key speaks for it
	 * too (`linked`/`removed`), its admins ASKED (`requested`), or already as
	 * wanted (`unchanged`). `skipped` when `self` is held.
	 */
	partner: 'linked' | 'removed' | 'requested' | 'unchanged' | 'skipped';
}

export interface LinkSideOptions {
	/**
	 * Ask the partner's admins even when this key could write its half — a
	 * service key that is admin everywhere (the bot) must not decide for a
	 * holon whose people did not ask.
	 */
	askPartner?: boolean;
	/** Name of `holonId` as the partner will see it in a request. */
	holonName?: string;
}

async function speaksFor(holosphere: HoloSphere, holon: string): Promise<boolean> {
	try {
		return may(await writeAcceptance(holosphere, holon), 'federation');
	} catch {
		return false;
	}
}

/**
 * Link (or update) a federation partner with the given lens config.
 *
 * Writes `holonId`'s half — FULLY REPLACING its per-partner lens config, so
 * always pass the complete inbound/outbound arrays. The partner's half is its
 * admins' word: written here only when this key is one of them (and the
 * caller did not ask to ask); otherwise the partner is sent a federation
 * request (see ./requests.ts) unless its half already matches. Writes config
 * only: no data propagation, no holograms.
 */
export async function setFederationPartner(
	holosphere: HoloSphere,
	holonId: string,
	targetId: string,
	options: SetFederationPartnerOptions & LinkSideOptions
): Promise<FederationLinkOutcome> {
	const source = normalizeId(holonId, 'holonId');
	const target = normalizeId(targetId, 'targetId');
	if (source === target) throw new Error('Cannot federate a holon with itself');
	const dirs = normalizeDirections({ inbound: sanitizeLenses(options.inbound), outbound: sanitizeLenses(options.outbound) });
	const hops = options.hops;

	if (!(await speaksFor(holosphere, source))) return { self: 'held', partner: 'skipped' };
	await writeOwnSide(holosphere, source, target, dirs, { partnerName: options.partnerName, hops });

	const asked = mirrorDirections(dirs);
	if (!options.askPartner && (await speaksFor(holosphere, target))) {
		await writeOwnSide(holosphere, target, source, asked, { partnerName: options.holonName, hops });
		await cancelFederationRequest(holosphere, source, target).catch(() => null);
		return { self: 'linked', partner: 'linked' };
	}
	const theirs = await counterpartConfig(holosphere, target, source);
	if (theirs && sameDirections(theirs, asked)) {
		await cancelFederationRequest(holosphere, source, target).catch(() => null);
		return { self: 'linked', partner: 'unchanged' };
	}
	await askFederation(holosphere, source, target, { directions: asked, hops, fromName: options.holonName });
	return { self: 'linked', partner: 'requested' };
}

/**
 * Remove a federation partner: `holonId`'s half always (when this key speaks
 * for it); the partner's half directly when this key speaks for it too,
 * otherwise its admins are asked to drop it — or a request still waiting is
 * withdrawn.
 */
export async function removeFederationPartner(
	holosphere: HoloSphere,
	holonId: string,
	targetId: string,
	options: LinkSideOptions = {}
): Promise<FederationLinkOutcome> {
	const source = normalizeId(holonId, 'holonId');
	const target = normalizeId(targetId, 'targetId');
	if (!(await speaksFor(holosphere, source))) return { self: 'held', partner: 'skipped' };
	await removeOwnSide(holosphere, source, target);

	if (!options.askPartner && (await speaksFor(holosphere, target))) {
		await removeOwnSide(holosphere, target, source);
		await cancelFederationRequest(holosphere, source, target).catch(() => null);
		return { self: 'removed', partner: 'removed' };
	}
	const theirs = await counterpartConfig(holosphere, target, source);
	if (!theirs) {
		await cancelFederationRequest(holosphere, source, target).catch(() => null);
		return { self: 'removed', partner: 'unchanged' };
	}
	await askFederation(holosphere, source, target, { kind: 'unlink', fromName: options.holonName });
	return { self: 'removed', partner: 'requested' };
}
