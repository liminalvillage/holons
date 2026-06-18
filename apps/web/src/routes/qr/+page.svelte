<script lang="ts">
	import { QRActionService, type QRActionResult, type TelegramUser } from '../../utils/qr-action-service';
	import { onMount, getContext } from 'svelte';
	import type { HoloSphere } from "holosphere";
	import { goto } from '$app/navigation';
	import { getHolonIdForDeck } from '$lib/deck-registry';
	import { nostrPublicKey } from '$lib/stores/nostr';
	import { awaitName } from '$lib/stores/nameResolver';

	export let data: any;

	$: ({ action, title, desc, holonID, deckId, cardId, itemId, hasValidParams, needsHolonLookup, capability, capabilityStatus, capabilityExpiration } = data);

	let holosphere: HoloSphere;
	let qrActionService: QRActionService;
	let isProcessingAction = false;
	let errorMessage = '';
	let actionResult: QRActionResult | null = null;
	let actionComplete = false;
	let resolvedHolonID: string | null = null;

	let isLoggedIn = false;

	onMount(async () => {
		// Get holosphere context (always available — layout requires Splash auth first)
		holosphere = getContext('holosphere');
		if (holosphere) {
			qrActionService = new QRActionService(holosphere);
		}

		const clientPubKey = (holosphere as any)?.client?.publicKey;
		isLoggedIn = !!clientPubKey;

		// If logged in and we have valid QR params with valid capability, auto-process
		if (isLoggedIn && hasValidParams && capabilityStatus === 'valid' && qrActionService) {
			console.log(`[QR Page] User logged in (${clientPubKey.slice(0, 12)}...), processing QR action`);

			// Resolve the user's holon name so tasks/roles show a readable name
			let userName = clientPubKey.slice(0, 8);
			try {
				const resolved = await awaitName(clientPubKey);
				if (resolved && resolved.length > 8) {
					userName = resolved;
				}
			} catch (err) {
				console.warn('[QR Page] Could not resolve holon name, using pubkey fallback');
			}

			processQRAction({
				id: clientPubKey,
				first_name: userName,
				username: userName,
				auth_date: Math.floor(Date.now() / 1000),
				hash: clientPubKey
			});
		}
	});

	async function processQRAction(userData: TelegramUser) {
		if (!qrActionService || !hasValidParams) {
			return;
		}

		isProcessingAction = true;
		errorMessage = '';

		try {
			// Look up holonID from deckId if not provided directly
			let finalHolonID = holonID;
			if (!finalHolonID && deckId && holosphere) {
				console.log(`[QR Page] Looking up holonID for deckId: ${deckId}`);
				finalHolonID = await getHolonIdForDeck(holosphere, deckId);
				if (!finalHolonID) {
					errorMessage = 'Could not find holon for this deck. The deck may not be registered.';
					isProcessingAction = false;
					return;
				}
				console.log(`[QR Page] Found holonID: ${finalHolonID} for deckId: ${deckId}`);
			}

			console.log(`[QR Page] Processing QR action for user ${userData.id}:`, {
				action,
				title,
				desc,
				holonID: finalHolonID,
				deckId,
				cardId,
				needsHolonLookup,
				hasCapability: !!capability,
				capabilityStatus
			});

			const finalParams = {
				action,
				title,
				desc,
				holonID: finalHolonID,
				deckId,
				cardId,
				itemId,
				capability
			};

			// Validate parameters
			const validation = qrActionService.validateQRParams(finalParams);
			if (!validation.isValid) {
				errorMessage = `Invalid QR parameters: ${validation.errors.join(', ')}`;
				return;
			}

			// Process the action
			console.log(`[QR Page] Calling QRActionService.processQRAction with params:`, finalParams);
			const result = await qrActionService.processQRAction(finalParams, userData);
			console.log(`[QR Page] Action result:`, result);

			resolvedHolonID = finalHolonID;

			if (result.success) {
				actionResult = result;
				actionComplete = true;
				console.log(`[QR Page] Action successful, showing confirmation`);
			} else {
				// If failed, show error
				errorMessage = result.message || 'Action failed';
			}
		} catch (error) {
			console.error('[QR Page] Error processing QR action:', error);
			errorMessage = 'An unexpected error occurred while processing the action. Please try again.';
		} finally {
			isProcessingAction = false;
		}
	}
</script>

<svelte:head>
	<title>QR Action - {title || 'Login'}</title>
	<meta name="description" content="Login to execute QR code action" />
</svelte:head>

<div class="qr-page">
	<div class="max-w-md mx-auto p-4">
		<!-- Header -->
		<div class="text-center mb-6">
			<h1 class="text-2xl font-bold text-white mb-2">QR Code Action</h1>
			<p class="text-gray-400">
				Scan a QR code to perform an action
			</p>
		</div>

		<!-- Capability Status -->
		{#if capabilityStatus === 'valid'}
			<div class="mb-6 bg-green-900 bg-opacity-30 border border-green-500 rounded-lg p-4">
				<div class="flex items-center gap-2 text-green-400 font-semibold mb-1">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
					</svg>
					Verified Capability
				</div>
				<p class="text-green-200 text-sm">
					This QR code is authorized by the holon owner.
				</p>
			</div>
		{:else if capabilityStatus === 'expired'}
			<div class="mb-6 bg-orange-900 bg-opacity-30 border border-orange-500 rounded-lg p-4">
				<div class="flex items-center gap-2 text-orange-400 font-semibold mb-1">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					Capability Expired
				</div>
				<p class="text-orange-200 text-sm">
					This QR code has expired and can no longer be used.
				</p>
			</div>
		{:else if capabilityStatus === 'invalid'}
			<div class="mb-6 bg-red-900 bg-opacity-30 border border-red-500 rounded-lg p-4">
				<div class="flex items-center gap-2 text-red-400 font-semibold mb-1">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
					</svg>
					Invalid Capability
				</div>
				<p class="text-red-200 text-sm">
					This QR code has an invalid or tampered capability token.
				</p>
			</div>
		{:else if capabilityStatus === 'none' && hasValidParams}
			<div class="mb-6 bg-red-900 bg-opacity-30 border border-red-500 rounded-lg p-4">
				<div class="flex items-center gap-2 text-red-400 font-semibold mb-1">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
					</svg>
					Unauthorized QR Code
				</div>
				<p class="text-red-200 text-sm">
					This QR code is not authorized. It requires a valid capability token signed by the holon owner.
				</p>
			</div>
		{/if}

		<!-- Parameter Validation -->
		{#if !hasValidParams}
			<div class="bg-red-900 bg-opacity-30 border border-red-500 rounded-lg p-4 mb-6">
				<div class="text-red-400 font-semibold mb-2">Invalid QR Code</div>
				<p class="text-red-200 text-sm">
					Invalid QR code parameters
				</p>
			</div>
		{/if}

		<!-- Main Content -->
		{#if hasValidParams && capabilityStatus === 'valid'}

			<!-- Processing State -->
			{#if isProcessingAction}
				<div class="mt-6 bg-blue-900 bg-opacity-30 border border-blue-500 rounded-lg p-6">
					<div class="text-center">
						<div class="flex items-center justify-center gap-3 text-blue-300 mb-4">
							<div class="w-6 h-6 border-2 border-blue-300 border-t-transparent rounded-full animate-spin"></div>
							<span class="text-lg font-medium">Processing {action} action...</span>
						</div>
						<p class="text-sm text-blue-200 mb-4">
							{#if itemId && (action === 'role' || action === 'event' || action === 'task' || action === 'action')}
								Adding you to {title}...
							{:else if action === 'role'}
								Creating role and assigning it to you...
							{:else if action === 'event'}
								Creating and scheduling event for 12 hours from now...
							{:else if action === 'task' || action === 'action'}
								Creating task and adding you as participant...
							{:else if action === 'badge'}
								Creating and awarding badge to you...
							{:else if action === 'invite'}
								Processing invitation...
							{:else}
								Processing action...
							{/if}
						</p>
						<p class="text-xs text-blue-300">
							Please wait...
						</p>
					</div>
				</div>
			{/if}

			<!-- Action Complete Confirmation -->
			{#if actionComplete && actionResult}
				<div class="mt-6 bg-green-900 bg-opacity-30 border border-green-500 rounded-lg p-6">
					<div class="text-center">
						<div class="w-16 h-16 mx-auto mb-4 bg-green-600/20 rounded-full flex items-center justify-center">
							<svg class="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
							</svg>
						</div>
						<h3 class="text-lg font-semibold text-white mb-2">Action Completed</h3>
						<p class="text-green-200 text-sm mb-4">{actionResult.message}</p>

						{#if $nostrPublicKey && resolvedHolonID && $nostrPublicKey === resolvedHolonID}
							<button
								on:click={() => goto(actionResult?.redirectUrl || `/${resolvedHolonID}/dashboard`)}
								class="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-2.5 rounded-xl transition-colors"
							>
								Go to Holon
							</button>
						{:else if $nostrPublicKey}
							<button
								on:click={() => goto(`/${$nostrPublicKey}/dashboard`)}
								class="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-2.5 rounded-xl transition-colors"
							>
								Go to My Dashboard
							</button>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Error Message -->
			{#if errorMessage}
				<div class="mt-6 bg-red-900 bg-opacity-30 border border-red-500 rounded-lg p-4">
					<div class="text-red-400 font-semibold mb-2">Error</div>
					<div class="text-red-200 text-sm">{errorMessage}</div>
					<div class="mt-3 flex gap-2">
						<button
							on:click={() => errorMessage = ''}
							class="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-1 rounded transition-colors"
						>
							Dismiss
						</button>
						{#if $nostrPublicKey}
							<button
								on:click={() => goto(`/${$nostrPublicKey}/dashboard`)}
								class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1 rounded transition-colors"
							>
								Go to My Dashboard
							</button>
						{/if}
					</div>
				</div>
			{/if}
		{:else if hasValidParams && capabilityStatus !== 'valid'}
			<!-- Has params but capability is not valid - message already shown above -->
			<div class="bg-gray-800 rounded-2xl p-6 text-center">
				<div class="text-gray-400 mb-4">
					<svg class="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
					</svg>
				</div>
				<h3 class="text-lg font-semibold text-white mb-2">Cannot Execute Action</h3>
				<p class="text-gray-400 text-sm">
					{#if capabilityStatus === 'expired'}
						This QR code has expired. Please request a new one from the holon owner.
					{:else if capabilityStatus === 'invalid'}
						This QR code has been tampered with or is corrupted.
					{:else}
						This QR code requires authorization. Please use a QR code with a valid capability token.
					{/if}
				</p>
			</div>
		{:else}
			<!-- Invalid Parameters -->
			<div class="bg-gray-800 rounded-2xl p-6 text-center">
				<div class="text-gray-400 mb-4">
					<svg class="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
					</svg>
				</div>
				<h3 class="text-lg font-semibold text-white mb-2">Invalid QR Code</h3>
				<p class="text-gray-400 text-sm">
					This QR code doesn't contain valid action parameters.
				</p>
			</div>
		{/if}
	</div>
</div>

<style lang="scss">
	.qr-page {
		min-height: 100vh;
		background: linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-bg-primary) 100%);
		padding: 2rem 0;
	}
</style> 