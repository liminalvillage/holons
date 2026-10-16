<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Users, Bell } from 'svelte-feathers';
	import HolonItem from './HolonItem.svelte';
	import FederationRequestCard from './FederationRequestCard.svelte';

	type FederationStatus = 'none' | 'pending_outgoing' | 'pending_incoming' | 'accepted';

	interface Holon {
		id: string;
		name: string;
		federationStatus?: FederationStatus;
		lensConfig?: {
			lenses: string[];
			inbound?: string[];
			outbound?: string[];
		};
		accessLevel?: 'none' | 'read' | 'write' | 'member';
	}

	/** A partner's federation request (core), as the card shows it. */
	interface IncomingRequest {
		/** The asking holon. */
		id: string;
		senderPubKey: string;
		senderHolonName: string;
		kind: 'link' | 'unlink';
		/** Lenses they would send us. */
		theySend: string[];
		/** Lenses they ask us to send. */
		theyAsk: string[];
	}

	export let holons: Holon[] = [];
	export let currentHolonId: string | null = null;
	export let isLoading: boolean = false;
	export let showPinButton: boolean = false;
	export let showRemoveButton: boolean = false;
	export let homeHolonId: string | null = null;
	export let homeHolonName: string = '';
	export let showHomeSection: boolean = true;
	export let incomingRequests: IncomingRequest[] = [];
	export let processingRequestId: string | null = null;

	const dispatch = createEventDispatcher();

	function selectHolon(holonId: string) {
		dispatch('select', { holonId });
	}

	function starHolon(holonId: string) {
		dispatch('star', { holonId });
	}

	function removeHolon(holonId: string) {
		dispatch('remove', { holonId });
	}

	function handleAccept(event: CustomEvent<{ id: string; senderPubKey: string }>) {
		const request = incomingRequests.find(r => r.id === event.detail.id);
		if (request) {
			dispatch('acceptRequest', request);
		}
	}

	function handleDecline(event: CustomEvent<{ id: string; senderPubKey: string }>) {
		const request = incomingRequests.find(r => r.id === event.detail.id);
		if (request) {
			dispatch('declineRequest', request);
		}
	}

	// Filter out home holon from the regular list
	$: otherHolons = homeHolonId ? holons.filter(h => h.id !== homeHolonId) : holons;

	// Split into accepted and pending federation holons
	$: acceptedHolons = otherHolons.filter((h) => h.federationStatus === 'accepted');
	$: pendingHolons = otherHolons.filter((h) =>
		h.federationStatus === 'pending_outgoing' || h.federationStatus === 'pending_incoming'
	);

</script>

<div class="holon-list">
	{#if isLoading}
		<div class="holon-list__loading">
			<div class="holon-list__spinner"></div>
			<span>Loading...</span>
		</div>
	{:else}
		<!-- Home Holon — pinned at the top after login. Uses HolonItem with key management. -->
		{#if showHomeSection && homeHolonId}
			<div class="holon-list__home">
				<HolonItem
					id={homeHolonId}
					name={homeHolonName || 'My Holon'}
					isActive={currentHolonId === homeHolonId}
					isPinned={false}
					isStarred={false}
					isHome={true}
					showPinButton={false}
					showStarButton={false}
					on:select={() => selectHolon(homeHolonId)}
				/>
			</div>
		{/if}

		<!-- Incoming Federation Requests -->
		{#if incomingRequests.length > 0}
			<div class="holon-list__section holon-list__section--requests">
				<span class="holon-list__section-title holon-list__section-title--notification">
					<Bell size="10" />
					Federation Requests ({incomingRequests.length})
				</span>
				{#each incomingRequests as request (request.id)}
					<FederationRequestCard
						id={request.id}
						senderPubKey={request.senderPubKey}
						senderHolonName={request.senderHolonName}
						kind={request.kind}
						theySend={request.theySend}
						theyAsk={request.theyAsk}
						isProcessing={processingRequestId === request.id}
						on:accept={handleAccept}
						on:decline={handleDecline}
					/>
				{/each}
			</div>
		{/if}

		<!-- Federated holons (accepted) -->
		{#if acceptedHolons.length > 0}
			<div class="holon-list__section">
				<span class="holon-list__section-title">
					<Users size="10" />
					Federated
				</span>

				{#each acceptedHolons as holon (holon.id)}
					<HolonItem
						id={holon.id}
						name={holon.name}
						isActive={holon.id === currentHolonId}
						isPinned={false}
						isStarred={false}
						isHome={false}
						federationStatus={holon.federationStatus || 'none'}
						sharedLenses={holon.lensConfig?.lenses || []}
						inboundLenses={holon.lensConfig?.inbound || []}
						outboundLenses={holon.lensConfig?.outbound || []}
						accessLevel={(holon.lensConfig?.lenses?.length ?? 0) > 0 ? 'read' : 'none'}
						{showPinButton}
						showStarButton={false}
						{showRemoveButton}
						on:select={() => selectHolon(holon.id)}
						on:remove={() => removeHolon(holon.id)}
						on:lensConfigUpdate
					/>
				{/each}
			</div>
		{/if}

		<!-- Pending federation requests -->
		{#if pendingHolons.length > 0}
			<div class="holon-list__section">
				<span class="holon-list__section-title">Pending</span>
				{#each pendingHolons as holon (holon.id)}
					<HolonItem
						id={holon.id}
						name={holon.name}
						isActive={holon.id === currentHolonId}
						isPinned={false}
						isStarred={false}
						isHome={false}
						federationStatus={holon.federationStatus || 'none'}
						sharedLenses={holon.lensConfig?.lenses || []}
						accessLevel="none"
						showPinButton={false}
						showStarButton={false}
						{showRemoveButton}
						on:select={() => selectHolon(holon.id)}
						on:remove={() => removeHolon(holon.id)}
					/>
				{/each}
			</div>
		{/if}

		<!-- Empty state -->
		{#if holons.length === 0 && !homeHolonId}
			<div class="holon-list__empty">
				<p>No federated holons yet</p>
				<p class="holon-list__empty-hint">Add a holon with the + button to federate</p>
			</div>
		{:else if otherHolons.length === 0 && homeHolonId}
			<div class="holon-list__empty holon-list__empty--compact">
				<p class="holon-list__empty-hint">Federate with other holons using the + button</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	.holon-list {
		flex: 1;
		overflow-y: auto;
		padding: var(--spacing-1, 0.25rem) 0;
	}

	.holon-list::-webkit-scrollbar {
		width: 4px;
	}

	.holon-list::-webkit-scrollbar-track {
		background: transparent;
	}

	.holon-list::-webkit-scrollbar-thumb {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		border-radius: var(--radius-full, 9999px);
	}

	.holon-list::-webkit-scrollbar-thumb:hover {
		background: var(--color-border-light, var(--color-border-light));
	}

	/* Home section - with divider */
	.holon-list__home {
		padding-bottom: var(--spacing-2, 0.5rem);
		margin-bottom: var(--spacing-1, 0.25rem);
		border-bottom: 1px solid var(--color-border, var(--color-bg-tertiary));
	}

	.holon-list__section {
		margin-bottom: var(--spacing-2, 0.5rem);
	}

	.holon-list__section-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-1, 0.25rem);
		padding: var(--spacing-1, 0.25rem) var(--spacing-4, 1rem);
		font-size: 10px;
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-muted, var(--color-text-muted));
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.holon-list__loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-8, 2rem);
		gap: var(--spacing-3, 0.75rem);
		color: var(--color-text-muted, var(--color-text-muted));
		font-size: var(--font-size-sm, 0.875rem);
	}

	.holon-list__spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--color-bg-tertiary, var(--color-bg-tertiary));
		border-top-color: var(--color-accent, var(--color-accent));
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.holon-list__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-8, 2rem) var(--spacing-4, 1rem);
		text-align: center;
		color: var(--color-text-muted, var(--color-text-muted));
	}

	.holon-list__empty p {
		margin: 0;
		font-size: var(--font-size-sm, 0.875rem);
	}

	.holon-list__empty-hint {
		font-size: var(--font-size-xs, 0.75rem);
		margin-top: var(--spacing-1, 0.25rem);
	}

	.holon-list__empty--compact {
		padding: var(--spacing-4, 1rem);
	}

	/* Incoming Requests Section */
	.holon-list__section--requests {
		background: rgba(79, 70, 229, 0.05);
		border-bottom: 1px solid var(--color-border, var(--color-bg-tertiary));
		padding-bottom: var(--spacing-2, 0.5rem);
		margin-bottom: var(--spacing-2, 0.5rem);
	}

	.holon-list__section-title--notification {
		color: var(--color-accent, var(--color-accent));
	}

</style>
