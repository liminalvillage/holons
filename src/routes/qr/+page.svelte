<script lang="ts">
	import TelegramAuth from '../../components/TelegramAuth.svelte';
	import { QRActionService, type TelegramUser, type QRActionResult } from '../../utils/qr-action-service';
	import { onMount, getContext } from 'svelte';
	import type { HoloSphere } from "holosphere";
	import { goto } from '$app/navigation';
	import { getHolonIdForDeck } from '$lib/deck-registry';

	export let data: any;

	$: ({ action, title, desc, holonID, deckId, cardId, hasValidParams, needsHolonLookup } = data);

	let holosphere: HoloSphere;
	let qrActionService: QRActionService;
	let isProcessingAction = false;
	let errorMessage = '';
	
	// Debug mode detection
	let isDebugMode = false;
	let debugUserID = '235114395';

	onMount(() => {
		// Check if we're in debug mode (localhost) AND we're actually on a QR page with parameters
		const isLocalhost = window.location.hostname === 'localhost' || 
						   window.location.hostname === '127.0.0.1';
		const isDevMode = import.meta.env.VITE_LOCAL_MODE === 'development';
		
		// Only activate debug mode if we're on localhost AND have valid QR parameters
		isDebugMode = (isLocalhost || isDevMode) && hasValidParams;
		
		console.log(`[QR Page] Debug mode check:`, {
			isLocalhost,
			isDevMode,
			hasValidParams,
			isDebugMode,
			url: window.location.href
		});
		
		// Get holosphere context
		holosphere = getContext('holosphere');
		if (holosphere) {
			qrActionService = new QRActionService(holosphere);
		}
		
		// If in debug mode and we have valid params, automatically process the action
		if (isDebugMode && hasValidParams && qrActionService) {
			console.log(`[QR Page] Debug mode active - processing QR action automatically`);
			// Keep original holon ID from QR, but use debug user
			processQRAction(createDebugUser());
		} else if (isLocalhost && !hasValidParams) {
			console.log(`[QR Page] Running on localhost but no valid QR parameters - debug mode inactive`);
		}
		
		// Check if user is already authenticated (for smooth UX)
		if (!isDebugMode && hasValidParams && qrActionService) {
			checkExistingAuth();
		}
	});

	async function checkExistingAuth() {
		try {
			// Check localStorage for existing Telegram authentication
			const storedUser = localStorage.getItem('telegramUser');
			const storedAuthDate = localStorage.getItem('telegramAuthDate');
			
			if (storedUser && storedAuthDate) {
				const userData = JSON.parse(storedUser);
				const authDate = parseInt(storedAuthDate);
				const currentTime = Math.floor(Date.now() / 1000);
				
				// Check if auth is still valid (24 hours)
				if (currentTime - authDate < 24 * 60 * 60) {
					console.log(`[QR Page] Found valid existing authentication for user ${userData.id}, processing action automatically`);
					// User is already authenticated, process action immediately
					await processQRAction(userData);
				}
			}
		} catch (error) {
			console.warn('[QR Page] Error checking existing authentication:', error);
			// Continue with normal flow
		}
	}

	function createDebugUser(): TelegramUser {
		// Create a mock user for debug mode
		return {
			id: parseInt(debugUserID),
			first_name: 'Debug User',
			last_name: 'Localhost',
			username: 'debug_user',
			photo_url: '',
			auth_date: Math.floor(Date.now() / 1000),
			hash: 'debug_hash_' + Date.now()
		};
	}

	function handleAuthSuccess(userData: TelegramUser) {
		console.log('User authenticated:', userData);
		
		// If we have valid QR parameters, automatically process the action
		if (hasValidParams && qrActionService) {
			processQRAction(userData);
		}
	}

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
				isDebugMode,
				needsHolonLookup
			});
			
			const finalParams = {
				action,
				title,
				desc,
				holonID: finalHolonID,
				deckId,
				cardId
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
			
			// If successful and there's a redirect URL, navigate immediately
			if (result.success && result.redirectUrl) {
				console.log(`[QR Page] Action successful, redirecting to: ${result.redirectUrl}`);
				goto(result.redirectUrl);
			} else if (result.success) {
				// If successful but no redirect, go to the holon dashboard
				console.log(`[QR Page] Action successful, redirecting to holon dashboard`);
				goto(`/${finalHolonID}`);
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
				{isDebugMode ? '🔧 Debug Mode - Localhost' : 'Scan a QR code to perform an action'}
			</p>
		</div>

		<!-- Debug Mode Notice -->
		{#if isDebugMode}
			<div class="mb-6 bg-yellow-900 bg-opacity-30 border border-yellow-500 rounded-lg p-4">
				<div class="text-yellow-400 font-semibold mb-2">🔧 Debug Mode Active</div>
				<div class="text-yellow-200 text-sm">
					<p>Running from localhost - Telegram login bypassed</p>
					<p><strong>Debug User ID:</strong> {debugUserID}</p>
					<p><strong>Action:</strong> {action}</p>
					<p><strong>Title:</strong> {title}</p>
					<p><strong>Holon ID:</strong> {holonID} (from QR code)</p>
				</div>
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
		{#if hasValidParams}
			<!-- Authentication Section - Only show if not in debug mode -->
			{#if !isDebugMode}
				<div class="bg-gray-800 rounded-2xl p-6">
					<h2 class="text-xl font-semibold text-white mb-4 text-center">🔐 Login Required</h2>
					<p class="text-gray-400 mb-6 text-center">
						Login with Telegram to automatically perform your action:
						<span class="block mt-2 text-blue-300 font-medium">
							{#if action === 'task' || action === 'action'}
								Create and assign task "{title}"
							{:else if action === 'event'}
								Schedule event "{title}" for 12 hours from now
							{:else if action === 'badge'}
								Award badge "{title}"
							{:else if action === 'role'}
								Assign role "{title}"
							{:else}
								Execute "{title}"
							{/if}
						</span>
					</p>
					
					<TelegramAuth 
						{holonID} 
						onAuthSuccess={handleAuthSuccess}
						redirectAfterAuth={false}
					/>
				</div>
			{/if}

			<!-- Processing State -->
			{#if isProcessingAction}
				<div class="mt-6 bg-blue-900 bg-opacity-30 border border-blue-500 rounded-lg p-6">
					<div class="text-center">
						<div class="flex items-center justify-center gap-3 text-blue-300 mb-4">
							<div class="w-6 h-6 border-2 border-blue-300 border-t-transparent rounded-full animate-spin"></div>
							<span class="text-lg font-medium">Processing {action} action...</span>
						</div>
						<p class="text-sm text-blue-200 mb-4">
							{#if action === 'role'}
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
							You will be redirected automatically when complete.
						</p>
					</div>
				</div>
			{/if}

			<!-- Error Message -->
			{#if errorMessage}
				<div class="mt-6 bg-red-900 bg-opacity-30 border border-red-500 rounded-lg p-4">
					<div class="text-red-400 font-semibold mb-2">Error</div>
					<div class="text-red-200 text-sm">{errorMessage}</div>
					<div class="mt-3">
						<button 
							on:click={() => errorMessage = ''}
							class="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-1 rounded transition-colors"
						>
							Dismiss
						</button>
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
		background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
		padding: 2rem 0;
	}
</style> 