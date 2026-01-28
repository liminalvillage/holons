import { decodeCapabilityFromUrl, isCapabilityValid, formatCapabilityExpiration } from '$lib/capabilities/qrCapability';
import type { QRCapabilityToken } from '$lib/capabilities/qrCapability';

export const load = async ({ url }: any) => {
	// Get parameters - support both old and new formats
	// Card-generator uses 'type' instead of 'action', so accept both
	const action = url.searchParams.get('action') || url.searchParams.get('type');
	const title = url.searchParams.get('title');
	const desc = url.searchParams.get('desc');
	const holonID = url.searchParams.get('holonID'); // may be null for card-generator QRs
	const deckId = url.searchParams.get('deckId');
	const cardId = url.searchParams.get('cardId');

	// Try to decode capability token from URL
	const capParam = url.searchParams.get('cap');
	let capability: QRCapabilityToken | null = null;
	let capabilityStatus: 'valid' | 'expired' | 'invalid' | 'none' = 'none';
	let capabilityExpiration: string | null = null;

	if (capParam) {
		capability = decodeCapabilityFromUrl(capParam);
		if (capability) {
			if (isCapabilityValid(capability)) {
				capabilityStatus = 'valid';
				capabilityExpiration = formatCapabilityExpiration(capability.expiresAt);
			} else if (capability.expiresAt <= Date.now()) {
				capabilityStatus = 'expired';
			} else {
				capabilityStatus = 'invalid';
			}
		} else {
			capabilityStatus = 'invalid';
		}
	}

	// Valid if we have action + title + (holonID OR deckId for lookup)
	const hasValidParams = !!(action && title && (holonID || deckId));

	return {
		action,
		title,
		desc,
		holonID,
		deckId,
		cardId,
		hasValidParams,
		needsHolonLookup: !holonID && !!deckId,  // flag for runtime lookup
		capability,
		capabilityStatus,
		capabilityExpiration
	};
}; 