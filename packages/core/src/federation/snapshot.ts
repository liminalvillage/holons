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

/**
 * Partner ids this holon receives `lens` FROM — partners whose inbound lens
 * list (from our perspective) includes `lens`. Receivers opt in per lens, so a
 * partner present in `federated` but without `lens` inbound is excluded. This
 * is the read-side mirror of the receiver-inbound allowlist enforced on the
 * announcements publish path.
 */
export function partnersReceivingLens(snapshot: FederationSnapshot, lens: string): string[] {
	return snapshot.federated.filter((id) => snapshot.lensConfig[id]?.inbound?.includes(lens));
}
