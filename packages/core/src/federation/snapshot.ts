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
}

export interface FederationSnapshot {
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
	const fedInfo: any = await (holosphere as any).getFederation(sourceId);

	const lensConfig: Record<string, FederationLensDirections> = {};
	const rawConfig = fedInfo?.lensConfig ?? {};
	for (const [partnerId, cfg] of Object.entries(rawConfig)) {
		lensConfig[partnerId] = {
			inbound: Array.isArray((cfg as any)?.inbound) ? (cfg as any).inbound : [],
			outbound: Array.isArray((cfg as any)?.outbound) ? (cfg as any).outbound : []
		};
	}

	return {
		federated: Array.isArray(fedInfo?.federated) ? fedInfo.federated : [],
		lensConfig,
		partnerNames: fedInfo?.partnerNames ?? {}
	};
}

// NOTE: `partnersReceivingLens` (read-side per-lens inbound partner filter) was
// removed — HoloSphere's `getFederated`/`subscribeFederated` now do that inbound
// filtering internally, and no surface enumerated partners for reads anymore.
// Federation config for PUBLISHING still flows through `getFederationSnapshot`.
