<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { ID } from '../dashboard/store';

	/**
	 * TelegramAuth Component
	 * 
	 * Handles Telegram authentication and stays on the current page after successful auth.
	 * 
	 * Props:
	 * - holonID: The ID of the holon for context
	 * - onAuthSuccess: Callback function when authentication succeeds
	 * - redirectAfterAuth: Whether to perform post-auth actions like closing modals (default: true)
	 * 
	 * Events:
	 * - authSuccess: Dispatched when authentication succeeds
	 * - closeModal: Dispatched when closing a modal
	 * - modalClose: Alternative event for modal closing
	 * - logout: Dispatched when user logs out
	 */

	// Component props
	export const holonID: string = '';
	export let onAuthSuccess: (userData: TelegramUser) => void = () => {};
	export let redirectAfterAuth: boolean = true; // Whether to perform post-auth actions like closing modals

	interface TelegramUser {
		id: number;
		first_name: string;
		last_name?: string;
		username?: string;
		photo_url?: string;
		auth_date: number;
		hash: string;
	}

	const dispatch = createEventDispatcher();
	
	let isAuthenticated = false;
	let currentUser: TelegramUser | null = null;
	let errorMessage = '';
	let widgetContainer: HTMLDivElement;
	let widgetLoaded = false;


	onMount(() => {
		// Check if user is already authenticated via localStorage
		checkStoredAuth();
		
		// Only initialize Telegram Login Widget if not authenticated
		if (!isAuthenticated) {
			// Add a small delay to ensure the component is fully mounted
			setTimeout(() => {
				if (!isAuthenticated) {
					initTelegramWidget();
				}
			}, 100);
		}
		
		// Also check for URL parameters that might indicate successful auth
		const urlParams = new URLSearchParams(window.location.search);
		const telegramAuth = urlParams.get('telegram_auth');
		if (telegramAuth && !isAuthenticated) {
			try {
				const authData = JSON.parse(decodeURIComponent(telegramAuth));
				if (authData.id && authData.first_name) {
					handleAuthSuccess(authData);
					// Clean up URL parameter
					urlParams.delete('telegram_auth');
					const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
					window.history.replaceState({}, '', newUrl);
				}
			} catch (error) {
				console.warn('Could not parse Telegram auth data from URL:', error);
			}
		}
	});

	onDestroy(() => {
		// Clean up global callback function to prevent memory leaks
		if ((window as any).onTelegramAuth) {
			delete (window as any).onTelegramAuth;
		}
	});

	function checkStoredAuth() {
		try {
			const storedUser = localStorage.getItem('telegramUser');
			const storedAuthDate = localStorage.getItem('telegramAuthDate');
			
			if (storedUser && storedAuthDate) {
				const userData = JSON.parse(storedUser);
				const authDate = parseInt(storedAuthDate);
				const currentTime = Math.floor(Date.now() / 1000);
				
				// Check if auth is still valid (24 hours)
				if (currentTime - authDate < 24 * 60 * 60) {
					handleAuthSuccess(userData);
				} else {
					// Auth expired, clear storage
					localStorage.removeItem('telegramUser');
					localStorage.removeItem('telegramAuthDate');
					// Initialize widget since user is no longer authenticated
					initTelegramWidget();
				}
			}
		} catch (error) {
			console.error('Error checking stored authentication:', error);
			// Clear corrupted data and reinitialize
			localStorage.removeItem('telegramUser');
			localStorage.removeItem('telegramAuthDate');
			initTelegramWidget();
		}
	}

	function initTelegramWidget() {
		// Only initialize if not already authenticated
		if (isAuthenticated) return;
		
		try {
			// Create script element for Telegram Login Widget
			const script = document.createElement('script');
			script.src = 'https://telegram.org/js/telegram-widget.js?22';
			script.setAttribute('data-telegram-login', import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'HolonsBot');
			script.setAttribute('data-size', 'large');
			script.setAttribute('data-onauth', 'onTelegramAuth(user)');
			script.setAttribute('data-request-access', 'write');
			script.onload = () => {
				widgetLoaded = true;
			};
			script.onerror = () => {
				errorMessage = 'Failed to load Telegram Login Widget. This is likely due to an invalid domain configuration. Please configure your domain in BotFather using /setdomain.';
				widgetLoaded = false;
			};
			
			// Add to widget container if it exists, otherwise to body
			if (widgetContainer) {
				widgetContainer.appendChild(script);
			} else {
				document.body.appendChild(script);
			}
			
			// Define the callback function globally so Telegram can call it
			(window as any).onTelegramAuth = (user: any) => {
				try {
					console.log('Telegram auth successful:', user);
					handleAuthSuccess({
						id: user.id,
						first_name: user.first_name,
						last_name: user.last_name,
						username: user.username,
						photo_url: user.photo_url,
						auth_date: user.auth_date,
						hash: user.hash
					});
				} catch (error) {
					console.error('Error handling Telegram auth success:', error);
					errorMessage = 'Authentication succeeded but there was an error processing the user data.';
				}
			};
		} catch (error) {
			console.error('Error initializing Telegram widget:', error);
			errorMessage = 'Failed to initialize Telegram Login Widget. Please try refreshing the page.';
			widgetLoaded = false;
		}
	}

	function handleAuthSuccess(userData: TelegramUser) {
		isAuthenticated = true;
		currentUser = userData;
		errorMessage = '';
		
		// Only call the parent callback if it's actually provided and is a function
		if (typeof onAuthSuccess === 'function') {
			try {
				onAuthSuccess(userData);
			} catch (error) {
				console.warn('Error in onAuthSuccess callback:', error);
				// Continue with authentication success even if callback fails
			}
		}
		
		// Dispatch event for other components
		dispatch('authSuccess', { user: userData });
		
		// Store user data in localStorage for persistence
		localStorage.setItem('telegramUser', JSON.stringify(userData));
		localStorage.setItem('telegramAuthDate', userData.auth_date.toString());

		// Handle post-authentication actions
		if (redirectAfterAuth) {
			// Just close any modals and let the user continue with their intended action
			setTimeout(() => {
				performRedirect();
			}, 500); // Quick action to close modals if present
		}
	}

	function performRedirect() {
		try {
			// Get the current URL and its parameters
			const currentUrl = window.location.href;
			const urlParams = new URLSearchParams(window.location.search);
			
			// Check if we're in a modal or overlay context
			const modalElements = document.querySelectorAll('.modal, .overlay, [data-modal], .popup, .dialog');
			let modalFound = false;
			
			if (modalElements.length > 0) {
				modalElements.forEach(modal => {
					const htmlModal = modal as HTMLElement;
					if (modal.classList.contains('show') || 
						modal.classList.contains('active') ||
						modal.classList.contains('open') ||
						htmlModal.style.display !== 'none' && htmlModal.style.display !== '') {
						
						modalFound = true;
						// Try to close the modal
						modal.classList.remove('show', 'active', 'open');
						htmlModal.style.display = 'none';
						
						// Also try to trigger any close events
						modal.dispatchEvent(new CustomEvent('close'));
						modal.dispatchEvent(new CustomEvent('modalClose'));
					}
				});
				
				if (modalFound) {
					// Dispatch close event for parent components
					dispatch('closeModal');
					dispatch('modalClose');
					return; // Don't navigate if we closed a modal
				}
			}
			
			// If we're not in a modal, stay on the current page
			// The user should now be able to perform the action they were trying to do
			// No need to redirect - just let them continue with their intended action
			console.log('Authentication successful - user can now perform their intended action');
			
		} catch (error) {
			console.error('Error during redirect:', error);
			// No fallback redirect needed - stay on current page
		}
	}

	function handleTelegramLogin() {
		// Remove the fallback login logic - just retry the widget
		errorMessage = '';
		initTelegramWidget();
	}

	function pollForAuthentication() {
		// Remove polling logic since we're not using fallback login
		console.log('Fallback authentication removed');
	}

	function logout() {
		isAuthenticated = false;
		currentUser = null;
		localStorage.removeItem('telegramUser');
		localStorage.removeItem('telegramAuthDate');
		
		// Re-initialize the widget after logout
		initTelegramWidget();
		
		dispatch('logout');
	}
</script>

<div class="telegram-auth">
	{#if isAuthenticated && currentUser}
		<!-- Authenticated User Display -->
		<div class="auth-success">
			<div class="success-indicator">✅</div>
			<div class="user-info">
				{#if currentUser.photo_url}
					<img 
						src={currentUser.photo_url} 
						alt="{currentUser.first_name}"
						class="user-avatar"
					/>
				{:else}
					<div class="user-avatar-placeholder">
						{currentUser.first_name[0]}
					</div>
				{/if}
				<div class="user-details">
					<div class="user-name">
						{currentUser.first_name} {currentUser.last_name || ''}
					</div>
					<div class="user-id">ID: {String(currentUser.id)}</div>
					<div class="auth-status">
						Successfully authenticated
					</div>
				</div>
			</div>
			<button 
				on:click={logout}
				class="logout-btn"
				title="Logout"
			>
				🚪
			</button>
		</div>
	{:else}
		<!-- Login Section - Only shown when not authenticated -->
		<div class="login-section">
			<div class="login-header">
				<div class="telegram-icon">📱</div>
				<h3>Login with Telegram</h3>
				<p class="login-description">
					Connect your Telegram account to access this holon and perform your intended action.
				</p>
			</div>
			
			{#if errorMessage}
				<div class="error-message">
					<div class="error-title">⚠️ Authentication Error</div>
					<div class="error-description">{errorMessage}</div>
					<div class="error-actions">
						<button 
							on:click={() => {
								errorMessage = '';
								initTelegramWidget();
							}}
							class="retry-btn"
						>
							🔄 Retry
						</button>
					</div>
				</div>
			{/if}
			
			<div class="login-buttons">
				{#if !widgetLoaded && !errorMessage}
					<div class="widget-loading">
						<div class="loading-spinner"></div>
						<span>Loading Telegram Login Widget...</span>
					</div>
				{/if}
				
				<div bind:this={widgetContainer} class="telegram-widget-container mb-4"></div>
			</div>
			
			<div class="login-info">
				<p class="info-text">
					<strong>Why Telegram?</strong> This ensures secure authentication and allows the system to know which user is performing actions. After login, you'll be able to continue with your intended action.
				</p>
			</div>
		</div>
	{/if}
</div>

<style lang="scss">
	.telegram-auth {
		width: 100%;
		max-width: 400px;
		margin: 0 auto;
	}

	.auth-success,
	.login-section {
		animation: slideIn 0.3s ease-out;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.auth-success {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
		padding: 1rem;
		border-radius: 0.75rem;
		color: var(--color-text-primary);
		box-shadow: 0 4px 15px rgba(34, 197, 94, 0.3);
		position: relative;
	}

	.success-indicator {
		position: absolute;
		top: -0.5rem;
		left: -0.5rem;
		background: #22c55e;
		border: 2px solid white;
		border-radius: 50%;
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	}

	.user-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-left: 1.5rem;
	}

	.user-avatar {
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.3);
		object-fit: cover;
	}

	.user-avatar-placeholder {
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.2);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;
		font-weight: bold;
		border: 2px solid rgba(255, 255, 255, 0.3);
	}

	.user-details {
		.user-name {
			font-weight: 600;
			font-size: 1.125rem;
		}

		.user-id {
			font-size: 0.75rem;
			opacity: 0.8;
			font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
		}

		.auth-status {
			font-size: 0.75rem;
			opacity: 0.8;
			margin-top: 0.25rem;
			font-style: italic;
		}
	}

	.logout-btn {
		background: rgba(255, 255, 255, 0.2);
		border: 1px solid rgba(255, 255, 255, 0.3);
		color: var(--color-text-primary);
		padding: 0.5rem;
		border-radius: 0.5rem;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 1.25rem;

		&:hover {
			background: rgba(255, 255, 255, 0.3);
			transform: translateY(-1px);
		}
	}



	.login-section {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0.75rem;
		padding: 1.5rem;
		text-align: center;
	}

	.login-header {
		margin-bottom: 1.5rem;

		.telegram-icon {
			font-size: 3rem;
			margin-bottom: 1rem;
		}

		h3 {
			font-size: 1.5rem;
			font-weight: 600;
			color: var(--color-text-primary);
			margin-bottom: 0.5rem;
		}

		.login-description {
			color: rgba(255, 255, 255, 0.8);
			font-size: 0.875rem;
			line-height: 1.5;
		}
	}

	.error-message {
		background: rgba(239, 68, 68, 0.15);
		border: 1px solid rgba(239, 68, 68, 0.4);
		color: #fca5a5;
		padding: 1rem;
		border-radius: 0.75rem;
		margin-bottom: 1rem;
		font-size: 0.875rem;
		text-align: left;
	}

	.error-title {
		font-weight: 600;
		font-size: 1rem;
		margin-bottom: 0.5rem;
		color: #fecaca;
	}

	.error-description {
		margin-bottom: 0.75rem;
		line-height: 1.4;
	}

	.error-actions {
		margin-top: 1rem;
	}

	.retry-btn {
		background: linear-gradient(135deg, #0088cc 0%, #0077b3 100%);
		color: var(--color-text-primary);
		border: none;
		padding: 0.625rem 1.25rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		display: inline-block;

		&:hover:not(:disabled) {
			transform: translateY(-1px);
			box-shadow: 0 4px 15px rgba(0, 136, 204, 0.4);
		}

		&:disabled {
			opacity: 0.7;
			cursor: not-allowed;
		}
	}

	.login-buttons {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.widget-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.875rem;
	}

	.loading-spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top: 2px solid white;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}

	.login-info {
		.info-text {
			color: rgba(255, 255, 255, 0.6);
			font-size: 0.75rem;
			line-height: 1.4;
			margin: 0;
		}
	}

	.telegram-widget-container {
		width: 100%;
		text-align: center;
		margin-bottom: 1rem;
	}
</style>
