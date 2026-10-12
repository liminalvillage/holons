/**
 * Federation snapshot helpers.
 *
 * Read-only views of a holon's federation configuration. UI-agnostic;
 * accepts an explicit federation source id (caller resolves nostr key etc.).
 */

import type { HoloSphere } from 'holosphere';

/** Per-partner lens directions, from this holon's perspective. */
export interface FederationLensDirections {
	/** Lenses this holon receives FROM the partner. */
	inbound: string[];
	/** Lenses this holon sends TO the partner. */
	outbound: string[];
	/**
	 * Scalespace reach when the partner is an H3 cell — how many parent levels
	 * above it an outbound write climbs. Absent for ordinary partners.
	 */
	hops?: number;
}

export interface FederationSnapshot {
	/**
	 * Is this the record an admin of the holon signed? The federation record
	 * is an admin's word (see `may(standing, 'federation')`): under enforced
	 * reads a record nobody with that role signed does not count, and the
	 * snapshot is empty. `false` also for a holon nobody speaks for, where
	 * the plain record shows.
	 */
	endorsed: boolean;
	/** Canonical list of all partners (any direction, including no lens flow yet). */
	federated: string[];
	/** Per-partner directional lens config, keyed by partner id. */
	lensConfig: Record<string, FederationLensDirections>;
	partnerNames: Record<string, string>;
}

/**
 * Read federation list + partner names + directional lens config for the given
 * home holon.
 *
 * `federationSourceId` defaults to `holonId`; UIs that key federation off a
 * nostr public key (or other identity) should pass it explicitly.
 */
export async function getFederationSnapshot(
	holosphere: HoloSphere,
	holonId: string,
	federationSourceId?: string
): Promise<FederationSnapshot> {
	const sourceId = federationSourceId ?? holonId;
	const hs = holosphere as any;
	let fedInfo: any = null;
	let endorsed = false;
	if (typeof hs.getFederationStanding === 'function') {
		const standing = await hs.getFederationStanding(sourceId);
		fedInfo = standing?.record ?? null;
		endorsed = !!standing?.endorsed;
	} else {
		fedInfo = await hs.getFederation(sourceId);
	}

	const lensConfig: Record<string, FederationLensDirections> = {};
	const rawConfig = fedInfo?.lensConfig ?? {};
	for (const [partnerId, cfg] of Object.entries(rawConfig)) {
		const hops = Number((cfg as any)?.hops);
		lensConfig[partnerId] = {
			inbound: Array.isArray((cfg as any)?.inbound) ? (cfg as any).inbound : [],
			outbound: Array.isArray((cfg as any)?.outbound) ? (cfg as any).outbound : [],
			...(Number.isFinite(hops) && hops > 0 ? { hops } : {})
		};
	}

	return {
		endorsed,
		federated: Array.isArray(fedInfo?.federated) ? fedInfo.federated : [],
		lensConfig,
		partnerNames: fedInfo?.partnerNames ?? {}
	};
}

// NOTE: `partnersReceivingLens` (read-side per-lens inbound partner filter) was
// removed — HoloSphere's `getFederated`/`subscribeFederated` now do that inbound
// filtering internally, and no surface enumerated partners for reads anymore.
// Federation config for PUBLISHING still flows through `getFederationSnapshot`.
