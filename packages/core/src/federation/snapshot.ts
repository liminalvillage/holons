/**
 * Federation snapshot helpers.
 *
 * Read-only views of a holon's federation configuration. UI-agnostic;
 * accepts an explicit federation source id (caller resolves nostr key etc.).
 */

import type { HoloSphere } from 'holosphere';

export interface FederationSnapshot {
	federated: string[];
	partnerNames: Record<string, string>;
}

/**
 * Read federation list + partner names for the given home holon.
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
	return {
		federated: Array.isArray(fedInfo?.federated) ? fedInfo.federated : [],
		partnerNames: fedInfo?.partnerNames ?? {}
	};
}
