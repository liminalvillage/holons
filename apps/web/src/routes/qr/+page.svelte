<script lang="ts">
	import { QRActionService, type QRActionResult, type TelegramUser } from '../../utils/qr-action-service';
	import { onMount, getContext } from 'svelte';
	import type { HoloSphere } from "holosphere";
	import { goto } from '$app/navigation';
	import { getHolonIdForDeck } from '$lib/deck-registry';
	import { telegramStore, telegramUser } from '$lib/stores/telegram';

	export let data: any;

	$: ({ action, title, desc, holonID, deckId, cardId, itemId, hasValidParams, needsHolonLookup } = data);

	let holosphere: HoloSphere;
	let qrActionService: QRActionService;
	let isProcessingAction = false;
	let errorMessage = '';
	let actionResult: QRActionResult | null = null;
	let actionComplete = false;
	let resolvedHolonID: string | null = null;

	let isLoggedIn = false;

	// The signed-in user's own holon is namespaced by their Telegram id
	// (see +layout.svelte), so use that for "my dashboard" links.
	$: myHolonId = $telegramUser ? String($telegramUser.id) : null;

	onMount(async () => {
		// Get holosphere context (always available — layout requires Splash auth first)
		holosphere = getContext('holosphere');
		if (holosphere) {
			qrActionService = new QRActionService(holosphere);
		}

		// Identify the acting user by their Telegram identity — the canonical
		// actor in a Telegram holon. The derived Nostr key still signs the write.
		let tgUser = telegramStore.getState().user;
		if (!tgUser) {
			await telegramStore.init();
			tgUser = telegramStore.getState().user;
		}
		isLoggedIn = !!tgUser?.id;

		// If logged in and we have valid QR params, auto-process the action
		if (isLoggedIn && hasValidParams && qrActionService && tgUser) {
			console.log(`[QR Page] Telegram user ${tgUser.id} logged in, processing QR action`);

			processQRAction({
				id: tgUser.id,
				first_name: tgUser.first_name,
				last_name: tgUser.last_name,
				username: tgUser.username,
				photo_url: tgUser.photo_url,
				auth_date: Math.floor(Date.now() / 1000),
				hash: ''
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
				itemId,
				needsHolonLookup
			});

			const finalParams = {
				action,
				title,
				desc,
				holonID: finalHolonID,
				deckId,
				cardId,
				itemId
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
		{#if hasValidParams}

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

						{#if resolvedHolonID}
							<button
								on:click={() => goto(actionResult?.redirectUrl || `/${resolvedHolonID}/dashboard`)}
								class="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-2.5 rounded-xl transition-colors"
							>
								Go to Holon
							</button>
						{:else if myHolonId}
							<button
								on:click={() => goto(`/${myHolonId}/dashboard`)}
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
						{#if myHolonId}
							<button
								on:click={() => goto(`/${myHolonId}/dashboard`)}
								class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1 rounded transition-colors"
							>
								Go to My Dashboard
							</button>
						{/if}
					</div>
				</div>
			{/if}
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