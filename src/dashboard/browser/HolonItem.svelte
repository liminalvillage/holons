<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { slide } from 'svelte/transition';
	import { Star, Copy, Check, MoreVertical, Key, LogOut, Home, ChevronDown, X } from 'svelte-feathers';
	import { nostrStore, nostrPublicKey, nostrPrivateKey } from '$lib/stores/nostr';

	export let id: string;
	export let name: string;
	export let isActive: boolean = false;
	export let isPinned: boolean = false;
	export let isStarred: boolean = false;
	export let isHome: boolean = false;
	export let showPinButton: boolean = false;
	export let showStarButton: boolean = false;
	export let showRemoveButton: boolean = false;

	const dispatch = createEventDispatcher();

	// State
	let showMenu: boolean = false;
	let showKeyMenu: boolean = false;
	let copied: boolean = false;
	let showPrivateKey: boolean = false;

	// Check if using public/holosphere key
	const HOLOSPHERE_PRIVATE_KEY = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;

	function getHolospherePublicKey(): string | null {
		if (!HOLOSPHERE_PRIVATE_KEY) return null;
		try {
			const { schnorr } = require('@noble/curves/secp256k1');
			const { bytesToHex } = require('@noble/hashes/utils');
			const pubKeyBytes = schnorr.getPublicKey(HOLOSPHERE_PRIVATE_KEY);
			return bytesToHex(pubKeyBytes);
		} catch {
			return null;
		}
	}

	$: holospherePublicKey = getHolospherePublicKey();
	$: isPublicMode = isHome && ($nostrPublicKey === holospherePublicKey || !$nostrPrivateKey);

	function handleSelect() {
		dispatch('select', { id });
	}

	function handlePin(event: MouseEvent) {
		event.stopPropagation();
		dispatch('pin', { id });
	}

	function handleStar(event: MouseEvent) {
		event.stopPropagation();
		dispatch('star', { id });
	}

	function handleRemove(event: MouseEvent) {
		event.stopPropagation();
		dispatch('remove', { id });
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleSelect();
		}
	}

	async function copyId(event: MouseEvent) {
		event.stopPropagation();
		await navigator.clipboard.writeText(id);
		copied = true;
		setTimeout(() => copied = false, 2000);
		showMenu = false;
	}

	function toggleMenu(event: MouseEvent) {
		event.stopPropagation();
		showMenu = !showMenu;
		if (showMenu) showKeyMenu = false;
	}

	function toggleKeyMenu(event: MouseEvent) {
		event.stopPropagation();
		showKeyMenu = !showKeyMenu;
		if (showKeyMenu) showMenu = false;
	}

	function closeMenus() {
		showMenu = false;
		showKeyMenu = false;
	}

	async function generateNewKey(event: MouseEvent) {
		event.stopPropagation();
		try {
			await nostrStore.generateKey();
			window.location.reload();
		} catch (error) {
			console.error('Error generating key:', error);
		}
	}

	function exitToPublic(event: MouseEvent) {
		event.stopPropagation();
		localStorage.setItem('enter_public_mode', 'true');
		nostrStore.clearKey();
		window.location.reload();
	}

	// Generate avatar initials from name
	function getInitials(name: string): string {
		if (!name) return '?';
		const words = name.trim().split(/\s+/);
		if (words.length >= 2) {
			return (words[0][0] + words[1][0]).toUpperCase();
		}
		return name.slice(0, 2).toUpperCase();
	}

	// Generate a deterministic color based on ID
	function getAvatarColor(id: string): string {
		const colors = [
			'#ef4444', '#f97316', '#eab308', '#22c55e',
			'#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
		];
		let hash = 0;
		for (let i = 0; i < id.length; i++) {
			hash = id.charCodeAt(i) + ((hash << 5) - hash);
		}
		return colors[Math.abs(hash) % colors.length];
	}

	$: initials = isHome ? '' : getInitials(name);
	$: avatarColor = getAvatarColor(id);
	$: shortId = `${id.slice(0, 6)}...${id.slice(-4)}`;
</script>

<svelte:window on:click={closeMenus} />

<div
	class="holon-item"
	class:holon-item--active={isActive}
	class:holon-item--home={isHome}
	role="button"
	tabindex="0"
	on:click={handleSelect}
	on:keydown={handleKeydown}
>
	<!-- Active indicator that connects to content -->
	{#if isActive}
		<div class="holon-item__active-bar"></div>
	{/if}

	<!-- Avatar -->
	<div
		class="holon-item__avatar"
		class:holon-item__avatar--home={isHome}
		class:holon-item__avatar--public={isHome && isPublicMode}
		style="background-color: {isActive ? 'var(--color-accent)' : isHome ? '' : avatarColor}"
	>
		{#if isHome}
			<Home size={16} />
		{:else}
			{initials}
		{/if}
	</div>

	<!-- Content -->
	<div class="holon-item__content">
		<span class="holon-item__name">
			{name}
		</span>
		<span class="holon-item__id">
			{shortId}
		</span>
	</div>

	<!-- Utility buttons -->
	<div class="holon-item__actions">
		<!-- Copy ID button -->
		<button
			class="holon-item__action-btn"
			on:click={copyId}
			title="Copy ID"
		>
			{#if copied}
				<Check size={14} />
			{:else}
				<Copy size={14} />
			{/if}
		</button>

		<!-- Home holon: Key management dropdown -->
		{#if isHome}
			<div class="holon-item__dropdown-container">
				<button
					class="holon-item__action-btn holon-item__action-btn--key"
					class:holon-item__action-btn--public={isPublicMode}
					on:click={toggleKeyMenu}
					title="Identity & Keys"
				>
					<Key size={14} />
					<ChevronDown size={10} />
				</button>

				{#if showKeyMenu}
					<div class="holon-item__dropdown" transition:slide={{ duration: 150 }} on:click|stopPropagation>
						<div class="holon-item__dropdown-header">
							<span class="holon-item__dropdown-status" class:holon-item__dropdown-status--public={isPublicMode}>
								{isPublicMode ? 'Public' : 'Private'}
							</span>
							<span class="holon-item__dropdown-label">
								{isPublicMode ? 'Guest Mode' : 'Your Identity'}
							</span>
						</div>

						{#if isPublicMode}
							<button class="holon-item__dropdown-action" on:click={generateNewKey}>
								<i class="fas fa-plus"></i>
								<span>Create Identity</span>
							</button>
						{:else}
							<button class="holon-item__dropdown-action" on:click={() => showPrivateKey = !showPrivateKey}>
								<i class="fas {showPrivateKey ? 'fa-eye-slash' : 'fa-eye'}"></i>
								<span>{showPrivateKey ? 'Hide Key' : 'Export Key'}</span>
							</button>

							{#if showPrivateKey}
								<div class="holon-item__dropdown-key">
									<code>{$nostrPrivateKey}</code>
								</div>
							{/if}

							<button class="holon-item__dropdown-action holon-item__dropdown-action--danger" on:click={exitToPublic}>
								<LogOut size={14} />
								<span>Logout</span>
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<!-- Regular holons: Pin/Star buttons -->
			{#if showPinButton}
				<button
					class="holon-item__action-btn"
					class:holon-item__action-btn--active={isPinned}
					on:click={handlePin}
					title={isPinned ? 'Unpin' : 'Pin'}
				>
					<Star size={14} fill={isPinned ? 'currentColor' : 'none'} />
				</button>
			{/if}

			{#if showStarButton}
				<button
					class="holon-item__action-btn"
					class:holon-item__action-btn--active={isStarred}
					on:click={handleStar}
					title={isStarred ? 'Remove from My Holons' : 'Add to My Holons'}
				>
					<Star size={14} fill={isStarred ? 'currentColor' : 'none'} />
				</button>
			{/if}

			{#if showRemoveButton}
				<button
					class="holon-item__action-btn holon-item__action-btn--remove"
					on:click={handleRemove}
					title="Remove from list"
				>
					<X size={14} />
				</button>
			{/if}
		{/if}
	</div>
</div>

<style>
	.holon-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		margin: 0 var(--spacing-2, 0.5rem);
		border-radius: var(--radius-md, 0.375rem);
		cursor: pointer;
		transition: all 150ms ease;
		position: relative;
	}

	.holon-item:hover {
		background: var(--color-bg-secondary, #1f2937);
	}

	.holon-item--active {
		background: var(--color-accent-subtle, rgba(79, 70, 229, 0.15));
		border-right: none;
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		margin-right: 0;
		padding-right: calc(var(--spacing-3, 0.75rem) + var(--spacing-2, 0.5rem));
	}

	.holon-item--active:hover {
		background: var(--color-accent-subtle, rgba(79, 70, 229, 0.2));
	}

	/* Active bar that connects to content */
	.holon-item__active-bar {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: 3px;
		background: var(--color-accent, #4f46e5);
		border-radius: 3px 0 0 3px;
	}

	/* Home holon special styling */
	.holon-item--home {
		margin-top: var(--spacing-1, 0.25rem);
		margin-bottom: var(--spacing-1, 0.25rem);
	}

	.holon-item__avatar {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md, 0.375rem);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-primary, #ffffff);
		font-weight: var(--font-weight-semibold, 600);
		font-size: var(--font-size-xs, 0.75rem);
		flex-shrink: 0;
		transition: all 150ms ease;
	}

	.holon-item__avatar--home {
		background: var(--color-accent, #4f46e5);
	}

	.holon-item__avatar--public {
		background: #10b981;
	}

	.holon-item__content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.holon-item__name {
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-primary, #ffffff);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.holon-item__id {
		font-size: 10px;
		color: var(--color-text-muted, #6b7280);
		font-family: var(--font-family-mono, monospace);
	}

	/* Actions container */
	.holon-item__actions {
		display: flex;
		align-items: center;
		gap: 2px;
		opacity: 0;
		transition: opacity 150ms ease;
	}

	.holon-item:hover .holon-item__actions,
	.holon-item--active .holon-item__actions {
		opacity: 1;
	}

	/* Always show key button on home */
	.holon-item--home .holon-item__actions {
		opacity: 1;
	}

	.holon-item__action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
		width: 26px;
		height: 26px;
		padding: 0;
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		border-radius: var(--radius-sm, 0.25rem);
		transition: all 150ms ease;
	}

	.holon-item__action-btn:hover {
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-primary, #ffffff);
	}

	.holon-item__action-btn--active {
		color: var(--color-warning, #f59e0b);
	}

	.holon-item__action-btn--remove:hover {
		background: rgba(239, 68, 68, 0.2);
		color: #ef4444;
	}

	.holon-item__action-btn--key {
		width: auto;
		padding: 0 6px;
		background: var(--color-accent-subtle, rgba(79, 70, 229, 0.2));
		color: var(--color-accent-light, #818cf8);
	}

	.holon-item__action-btn--key:hover {
		background: var(--color-accent, #4f46e5);
		color: white;
	}

	.holon-item__action-btn--public {
		background: rgba(16, 185, 129, 0.2);
		color: #10b981;
	}

	.holon-item__action-btn--public:hover {
		background: #10b981;
		color: white;
	}

	/* Dropdown container */
	.holon-item__dropdown-container {
		position: relative;
	}

	.holon-item__dropdown {
		position: absolute;
		right: 0;
		top: 100%;
		margin-top: 4px;
		min-width: 180px;
		background: var(--color-bg-secondary, #1f2937);
		border: 1px solid var(--color-border, #374151);
		border-radius: var(--radius-md, 0.375rem);
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
		z-index: 100;
		overflow: hidden;
	}

	.holon-item__dropdown-header {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-bottom: 1px solid var(--color-border, #374151);
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
	}

	.holon-item__dropdown-status {
		font-size: 10px;
		padding: 2px 6px;
		border-radius: var(--radius-full, 9999px);
		background: var(--color-accent, #4f46e5);
		color: white;
		font-weight: var(--font-weight-medium, 500);
	}

	.holon-item__dropdown-status--public {
		background: #10b981;
	}

	.holon-item__dropdown-label {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-secondary, #d1d5db);
	}

	.holon-item__dropdown-action {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		width: 100%;
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: transparent;
		border: none;
		color: var(--color-text-secondary, #d1d5db);
		font-size: var(--font-size-sm, 0.875rem);
		cursor: pointer;
		text-align: left;
		transition: background-color 150ms ease;
	}

	.holon-item__dropdown-action:hover {
		background: var(--color-bg-tertiary, #374151);
	}

	.holon-item__dropdown-action--danger {
		color: #ef4444;
	}

	.holon-item__dropdown-action--danger:hover {
		background: rgba(239, 68, 68, 0.1);
	}

	.holon-item__dropdown-key {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: var(--color-bg-primary, #111827);
	}

	.holon-item__dropdown-key code {
		font-size: 9px;
		font-family: monospace;
		color: var(--color-text-muted, #6b7280);
		word-break: break-all;
		display: block;
	}
</style>
