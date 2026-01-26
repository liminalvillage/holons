export const load = async ({ url }: any) => {
	// Get parameters - support both old and new formats
	// Card-generator uses 'type' instead of 'action', so accept both
	const action = url.searchParams.get('action') || url.searchParams.get('type');
	const title = url.searchParams.get('title');
	const desc = url.searchParams.get('desc');
	const holonID = url.searchParams.get('holonID'); // may be null for card-generator QRs
	const deckId = url.searchParams.get('deckId');
	const cardId = url.searchParams.get('cardId');

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
		needsHolonLookup: !holonID && !!deckId  // flag for runtime lookup
	};
}; 