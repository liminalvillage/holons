<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { slide } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { Star, Copy, Check, MoreVertical, Key, LogOut, Home, ChevronDown, X, Settings, ArrowDown, ArrowUp } from 'svelte-feathers';
	import { nostrStore, nostrPublicKey, nostrPrivateKey } from '$lib/stores/nostr';
	import { nostrUtils } from 'holosphere';

	const { hexToNsec } = nostrUtils;

	type FederationStatus = 'none' | 'pending_outgoing' | 'pending_incoming' | 'accepted';

	export let id: string;
	export let name: string;
	export let isActive: boolean = false;
	export let isPinned: boolean = false;
	export let isStarred: boolean = false;
	export let isHome: boolean = false;
	export let showPinButton: boolean = false;
	export let showStarButton: boolean = false;
	export let showRemoveButton: boolean = false;
	export let federationStatus: FederationStatus = 'none';
	export let sharedLenses: string[] = [];
	// Per-direction lens config (preferred). Falls back to sharedLenses when
	// the parent only knows the union — keeps backwards compat with callers
	// that haven't been wired through yet.
	export let inboundLenses: string[] = [];
	export let outboundLenses: string[] = [];
	export let accessLevel: 'none' | 'read' | 'write' | 'member' = 'none';

	const dispatch = createEventDispatcher();

	// State
	let showMenu: boolean = false;
	let showKeyMenu: boolean = false;
	let showLensConfig: boolean = false;
	let copied: boolean = false;
	let showPrivateKey: boolean = false;

	// Derive nsec for display
	$: displayNsec = $nostrPrivateKey ? hexToNsec($nostrPrivateKey) : '';

	// Pending lens config changes (tracked locally before sending). Per-direction
	// to mirror Federation.svelte and the BrowserPanel add modal.
	let pendingLensConfig: { inbound: string[]; outbound: string[] } | null = null;

	$: hasPendingChanges = pendingLensConfig !== null;

	// Effective in/out lists for the inline config — show pending edits if any,
	// else the props the parent passed. Falls back to `sharedLenses` for callers
	// that haven't been wired through with per-direction info yet.
	$: hasPerDirProps = inboundLenses.length > 0 || outboundLenses.length > 0;
	$: effectiveInbound = pendingLensConfig
		? pendingLensConfig.inbound
		: (hasPerDirProps ? inboundLenses : sharedLenses);
	$: effectiveOutbound = pendingLensConfig
		? pendingLensConfig.outbound
		: (hasPerDirProps ? outboundLenses : sharedLenses);


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

	// Reference to component root element
	let componentElement: HTMLDivElement;

	function closeMenus(event?: MouseEvent) {
		// Only close if click is outside this component
		if (event && componentElement && componentElement.contains(event.target as Node)) {
			return;
		}
		showMenu = false;
		showKeyMenu = false;
		showLensConfig = false;
	}

	function toggleLensConfig(event: MouseEvent) {
		event.stopPropagation();
		showLensConfig = !showLensConfig;
		if (showLensConfig) {
			showMenu = false;
			showKeyMenu = false;
		}
	}

	function openSettings(event: MouseEvent) {
		event.stopPropagation();
		goto(`/${id}/settings`);
	}

	function logout(event: MouseEvent) {
		event.stopPropagation();
		sessionStorage.setItem('just_logged_out', 'true');
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

	// Available lenses for federation (same as Federation component)
	const AVAILABLE_LENSES = ['quests', 'offers', 'tags', 'expenses', 'announcements', 'users', 'shopping', 'recurring', 'library', 'roles', 'checklists'];

	function getLensIcon(lens: string): string {
		const icons: Record<string, string> = {
			'quests': '🎯',
			'offers': '🤝',
			'tags': '🏷️',
			'expenses': '💰',
			'announcements': '📢',
			'users': '👥',
			'shopping': '🛒',
			'recurring': '🔄',
			'library': '📚',
			'roles': '🎭',
			'checklists': '✅'
		};
		return icons[lens] || '📦';
	}

	function ensurePending(): { inbound: string[]; outbound: string[] } {
		if (!pendingLensConfig) {
			// Seed from props. If only sharedLenses is populated (legacy caller),
			// assume it represents the union and seed both directions to it.
			const hasPerDir = inboundLenses.length > 0 || outboundLenses.length > 0;
			pendingLensConfig = hasPerDir
				? { inbound: [...inboundLenses], outbound: [...outboundLenses] }
				: { inbound: [...sharedLenses], outbound: [...sharedLenses] };
		}
		return pendingLensConfig;
	}

	function toggleInboundLens(lens: string) {
		const cfg = ensurePending();
		cfg.inbound = cfg.inbound.includes(lens)
			? cfg.inbound.filter(l => l !== lens)
			: [...cfg.inbound, lens];
		pendingLensConfig = { ...cfg };
	}

	function toggleOutboundLens(lens: string) {
		const cfg = ensurePending();
		cfg.outbound = cfg.outbound.includes(lens)
			? cfg.outbound.filter(l => l !== lens)
			: [...cfg.outbound, lens];
		pendingLensConfig = { ...cfg };
	}

	function requestLensUpdate() {
		if (!pendingLensConfig) return;

		const { inbound, outbound } = pendingLensConfig;
		dispatch('lensConfigUpdate', {
			holonId: id,
			lensConfig: {
				lenses: [...new Set([...inbound, ...outbound])],
				inbound,
				outbound
			}
		});

		pendingLensConfig = null;
	}

	function cancelPendingChanges() {
		pendingLensConfig = null;
	}

	// Get access badge info
	function getAccessBadge(level: string): { icon: string; color: string; label: string } | null {
		switch (level) {
			case 'member':
				return { icon: '👤', color: '#a855f7', label: 'Member' };
			case 'write':
				return { icon: '✏️', color: '#22c55e', label: 'Read+Write' };
			case 'read':
				return { icon: '👁️', color: '#3b82f6', label: 'Read' };
			default:
				return null;
		}
	}

	$: accessBadge = getAccessBadge(accessLevel);

	$: initials = isHome ? '' : getInitials(name);
	$: avatarColor = getAvatarColor(id);
	$: shortId = `${id.slice(0, 6)}...${id.slice(-4)}`;
	$: isPending = federationStatus === 'pending_outgoing' || federationStatus === 'pending_incoming';
	$: isFederated = federationStatus === 'accepted';
</script>

<svelte:window on:click={(e) => closeMenus(e)} />

<div class="holon-item-wrapper" class:holon-item-wrapper--expanded={showLensConfig} bind:this={componentElement}>
	<div
		class="holon-item"
		class:holon-item--active={isActive}
		class:holon-item--home={isHome}
		class:holon-item--pending={isPending}
		class:holon-item--expanded={showLensConfig}
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
			style="background-color: {isActive ? 'var(--color-accent)' : isHome ? '' : avatarColor}"
		>
			{#if isHome}
				<Home size="16" />
			{:else}
				{initials}
			{/if}
		</div>

		<!-- Content -->
		<div class="holon-item__content">
			<span class="holon-item__name" title={name}>
				{name || `Holon ${id.slice(0, 8)}...`}
				{#if accessBadge && isFederated}
					<span
						class="holon-item__access-badge"
						style="background-color: {accessBadge.color}20; color: {accessBadge.color};"
						title={accessBadge.label}
					>
						{accessBadge.icon}
					</span>
				{/if}
			</span>
			<span class="holon-item__id">
				{shortId}
				{#if isPending}
					<span class="holon-item__status holon-item__status--pending">
						{federationStatus === 'pending_outgoing' ? 'Pending...' : 'Incoming'}
					</span>
				{/if}
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
					<Check size="14" />
				{:else}
					<Copy size="14" />
				{/if}
			</button>

			<!-- Home holon: Settings and Key management -->
			{#if isHome}
				<!-- Settings button -->
				<button
					class="holon-item__action-btn holon-item__action-btn--settings"
					on:click={openSettings}
					title="Holon Settings"
				>
					<Settings size="14" />
				</button>

				<!-- Key management dropdown -->
				<div class="holon-item__dropdown-container">
					<button
						class="holon-item__action-btn holon-item__action-btn--key"
						on:click={toggleKeyMenu}
						title="Identity & Keys"
					>
						<Key size="14" />
						<ChevronDown size="10" />
					</button>

					{#if showKeyMenu}
						<div class="holon-item__dropdown" transition:slide={{ duration: 150 }} on:click|stopPropagation on:keydown|stopPropagation role="presentation">
							<div class="holon-item__dropdown-header">
								<span class="holon-item__dropdown-status">
									Private
								</span>
								<span class="holon-item__dropdown-label">
									Your Identity
								</span>
							</div>

							<button class="holon-item__dropdown-action" on:click={() => showPrivateKey = !showPrivateKey}>
								<i class="fas {showPrivateKey ? 'fa-eye-slash' : 'fa-eye'}"></i>
								<span>{showPrivateKey ? 'Hide Key' : 'Export Key'}</span>
							</button>

							{#if showPrivateKey}
								<div class="holon-item__dropdown-key">
									<code>{displayNsec}</code>
								</div>
							{/if}

							<button class="holon-item__dropdown-action holon-item__dropdown-action--danger" on:click={logout}>
								<LogOut size="14" />
								<span>Logout</span>
							</button>
						</div>
					{/if}
				</div>
			{:else}
				<!-- Regular holons: Settings (for federated), Pin/Star buttons -->
				{#if isFederated}
					<!-- Federated holon: Settings button (toggles inline panel) -->
					<button
						class="holon-item__action-btn holon-item__action-btn--settings"
						class:holon-item__action-btn--active={showLensConfig}
						on:click={toggleLensConfig}
						title="Lens Configuration"
					>
						<Settings size="14" />
					</button>
				{/if}

				{#if showPinButton}
					<button
						class="holon-item__action-btn"
						class:holon-item__action-btn--active={isPinned}
						on:click={handlePin}
						title={isPinned ? 'Unpin' : 'Pin'}
					>
						<Star size="14" fill={isPinned ? 'currentColor' : 'none'} />
					</button>
				{/if}

				{#if showStarButton}
					<button
						class="holon-item__action-btn"
						class:holon-item__action-btn--active={isStarred}
						on:click={handleStar}
						title={isStarred ? 'Remove from My Holons' : 'Add to My Holons'}
					>
						<Star size="14" fill={isStarred ? 'currentColor' : 'none'} />
					</button>
				{/if}

				{#if showRemoveButton}
					<button
						class="holon-item__action-btn holon-item__action-btn--remove"
						on:click={handleRemove}
						title="Remove from list"
					>
						<X size="14" />
					</button>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Inline lens config panel (expands below the holon item). Per-direction
	     toggles mirror Federation.svelte and the BrowserPanel add modal. -->
	{#if showLensConfig && isFederated}
		<div class="holon-item__inline-config" transition:slide={{ duration: 150 }} on:click|stopPropagation on:keydown|stopPropagation role="presentation">
			<div class="holon-item__lens-list">
				<div class="holon-item__lens-head">
					<span>Lens</span>
					<span class="holon-item__lens-col" title="Inbound — receive from this holon">
						<ArrowDown size="12" /> In
					</span>
					<span class="holon-item__lens-col" title="Outbound — send to this holon">
						<ArrowUp size="12" /> Out
					</span>
				</div>
				{#each AVAILABLE_LENSES as lens}
					{@const isIn = effectiveInbound.includes(lens)}
					{@const isOut = effectiveOutbound.includes(lens)}
					<div class="holon-item__lens-row" class:holon-item__lens-row--active={isIn || isOut}>
						<div class="holon-item__lens-info">
							<span class="holon-item__lens-icon">{getLensIcon(lens)}</span>
							<span class="holon-item__lens-name">{lens}</span>
						</div>
						<button
							type="button"
							class="holon-item__toggle"
							class:holon-item__toggle--on={isIn}
							on:click={() => toggleInboundLens(lens)}
							aria-pressed={isIn}
							aria-label="{isIn ? 'Disable' : 'Enable'} inbound {lens}"
							title="{isIn ? 'Disable' : 'Enable'} inbound {lens}"
						>
							<span class="holon-item__toggle-dot"></span>
						</button>
						<button
							type="button"
							class="holon-item__toggle"
							class:holon-item__toggle--on={isOut}
							on:click={() => toggleOutboundLens(lens)}
							aria-pressed={isOut}
							aria-label="{isOut ? 'Disable' : 'Enable'} outbound {lens}"
							title="{isOut ? 'Disable' : 'Enable'} outbound {lens}"
						>
							<span class="holon-item__toggle-dot"></span>
						</button>
					</div>
				{/each}
			</div>

			{#if hasPendingChanges}
				<div class="holon-item__config-actions">
					<button class="holon-item__config-btn holon-item__config-btn--cancel" on:click={cancelPendingChanges}>
						Cancel
					</button>
					<button class="holon-item__config-btn holon-item__config-btn--request" on:click={requestLensUpdate}>
						Request Update
					</button>
				</div>
			{/if}

			<button class="holon-item__config-remove" on:click={handleRemove}>
				<X size="12" />
				Remove Federation
			</button>
		</div>
	{/if}
</div>

<style>
	/* Wrapper for holon item + inline config */
	.holon-item-wrapper {
		margin: 0 var(--spacing-2, 0.5rem);
	}

	.holon-item-wrapper--expanded {
		background: var(--color-bg-secondary, var(--color-bg-secondary));
		border-radius: var(--radius-md, 0.375rem);
		margin-bottom: var(--spacing-1, 0.25rem);
	}

	.holon-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-radius: var(--radius-md, 0.375rem);
		cursor: pointer;
		transition: all 150ms ease;
		position: relative;
	}

	.holon-item--expanded {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}

	.holon-item-wrapper:not(.holon-item-wrapper--expanded) .holon-item:hover {
		background: var(--color-bg-secondary, var(--color-bg-secondary));
	}

	.holon-item--active {
		background: var(--color-accent-subtle, rgba(79, 70, 229, 0.15));
		border-right: none;
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		padding-right: calc(var(--spacing-3, 0.75rem) + var(--spacing-2, 0.5rem));
	}

	.holon-item-wrapper:has(.holon-item--active) {
		margin-right: 0;
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
		background: var(--color-accent, var(--color-accent));
		border-radius: 3px 0 0 3px;
	}

	/* Home holon special styling */
	.holon-item--home {
		margin-top: var(--spacing-1, 0.25rem);
		margin-bottom: var(--spacing-1, 0.25rem);
	}

	/* Pending federation styling */
	.holon-item--pending {
		opacity: 0.6;
		border: 1px dashed var(--color-border, var(--color-bg-tertiary));
	}

	.holon-item--pending:hover {
		opacity: 0.8;
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
		background: var(--color-accent, var(--color-accent));
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
		color: var(--color-text-muted, var(--color-text-muted));
		font-family: var(--font-family-mono, monospace);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.holon-item__status {
		font-size: 9px;
		padding: 1px 4px;
		border-radius: var(--radius-sm, 0.25rem);
		font-family: var(--font-family-sans, sans-serif);
	}

	.holon-item__status--pending {
		background: rgba(245, 158, 11, 0.2);
		color: var(--color-warning, #f59e0b);
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
		color: var(--color-text-muted, var(--color-text-muted));
		cursor: pointer;
		border-radius: var(--radius-sm, 0.25rem);
		transition: all 150ms ease;
	}

	.holon-item__action-btn:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		color: var(--color-text-primary, #ffffff);
	}

	.holon-item__action-btn--active {
		color: var(--color-warning, #f59e0b);
	}

	.holon-item__action-btn--remove:hover {
		background: rgba(239, 68, 68, 0.2);
		color: #ef4444;
	}

	.holon-item__action-btn--settings {
		color: var(--color-text-muted, var(--color-text-muted));
	}

	.holon-item__action-btn--settings:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		color: var(--color-text-primary, #ffffff);
	}

	.holon-item__action-btn--key {
		width: auto;
		padding: 0 6px;
		background: var(--color-accent-subtle, rgba(79, 70, 229, 0.2));
		color: var(--color-accent-light, #818cf8);
	}

	.holon-item__action-btn--key:hover {
		background: var(--color-accent, var(--color-accent));
		color: var(--color-text-primary);
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
		background: var(--color-bg-secondary, var(--color-bg-secondary));
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
		border-radius: var(--radius-md, 0.375rem);
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
		z-index: 100;
		overflow: hidden;
	}

	.holon-item__dropdown-header {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-bottom: 1px solid var(--color-border, var(--color-bg-tertiary));
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
	}

	.holon-item__dropdown-status {
		font-size: 10px;
		padding: 2px 6px;
		border-radius: var(--radius-full, 9999px);
		background: var(--color-accent, var(--color-accent));
		color: var(--color-text-primary);
		font-weight: var(--font-weight-medium, 500);
	}

	.holon-item__dropdown-label {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-secondary, var(--color-text-secondary));
	}

	.holon-item__dropdown-action {
		display: flex;
		align-items: center;
		gap: var(--spacing-2, 0.5rem);
		width: 100%;
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: transparent;
		border: none;
		color: var(--color-text-secondary, var(--color-text-secondary));
		font-size: var(--font-size-sm, 0.875rem);
		cursor: pointer;
		text-align: left;
		transition: background-color 150ms ease;
	}

	.holon-item__dropdown-action:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
	}

	.holon-item__dropdown-action--danger {
		color: #ef4444;
	}

	.holon-item__dropdown-action--danger:hover {
		background: rgba(239, 68, 68, 0.1);
	}

	.holon-item__dropdown-key {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		background: var(--color-bg-primary, var(--color-bg-primary));
	}

	.holon-item__dropdown-key code {
		font-size: 9px;
		font-family: monospace;
		color: var(--color-text-muted, var(--color-text-muted));
		word-break: break-all;
		display: block;
	}

	/* Inline config panel (expands below holon item) */
	.holon-item__inline-config {
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		padding-top: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
		border-top: 1px solid var(--color-border, var(--color-bg-tertiary));
	}

	/* Lens list */
	.holon-item__lens-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.holon-item__lens-head {
		display: grid;
		grid-template-columns: 1fr 36px 36px;
		align-items: center;
		gap: 4px;
		padding: 3px 4px;
		font-size: 10px;
		color: var(--color-text-muted, var(--color-text-muted));
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.holon-item__lens-col {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		justify-content: center;
	}

	.holon-item__lens-row {
		display: grid;
		grid-template-columns: 1fr 36px 36px;
		align-items: center;
		gap: 4px;
		padding: 3px 4px;
		border-radius: var(--radius-sm, 0.25rem);
		transition: background-color 150ms ease;
	}

	.holon-item__lens-row:hover {
		background: var(--color-bg-primary, var(--color-bg-primary));
	}

	.holon-item__lens-row--active {
		background: rgba(79, 70, 229, 0.08);
	}

	.holon-item__lens-info {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.holon-item__lens-icon {
		font-size: 12px;
	}

	.holon-item__lens-name {
		font-size: 11px;
		color: var(--color-text-secondary, var(--color-text-secondary));
		text-transform: capitalize;
	}

	.holon-item__toggle {
		position: relative;
		width: 28px;
		height: 16px;
		justify-self: center;
		border-radius: 9999px;
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		border: 1px solid var(--color-border, var(--color-border-light));
		cursor: pointer;
		transition: background-color 150ms ease, border-color 150ms ease;
		padding: 0;
	}

	.holon-item__toggle--on {
		background: var(--color-accent, var(--color-accent));
		border-color: var(--color-accent, var(--color-accent));
	}

	.holon-item__toggle-dot {
		display: block;
		position: absolute;
		top: 50%;
		left: 1px;
		width: 12px;
		height: 12px;
		border-radius: 9999px;
		background: white;
		transform: translateY(-50%);
		transition: left 150ms ease;
	}

	.holon-item__toggle--on .holon-item__toggle-dot {
		left: 13px;
	}

	/* Access badge */
	.holon-item__access-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 10px;
		padding: 1px 4px;
		border-radius: var(--radius-sm, 0.25rem);
		margin-left: 4px;
		vertical-align: middle;
	}

	.holon-item__config-remove {
		display: flex;
		align-items: center;
		gap: var(--spacing-1, 0.25rem);
		padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm, 0.25rem);
		color: var(--color-error, #ef4444);
		font-size: 11px;
		cursor: pointer;
		transition: all 150ms ease;
		align-self: flex-start;
		margin-top: var(--spacing-1, 0.25rem);
	}

	.holon-item__config-remove:hover {
		background: rgba(239, 68, 68, 0.1);
		border-color: var(--color-error, #ef4444);
	}

	/* Config actions (Request Update / Cancel) */
	.holon-item__config-actions {
		display: flex;
		gap: var(--spacing-2, 0.5rem);
		margin-top: var(--spacing-2, 0.5rem);
		padding-top: var(--spacing-2, 0.5rem);
		border-top: 1px solid var(--color-border, var(--color-bg-tertiary));
	}

	.holon-item__config-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-1, 0.25rem);
		padding: var(--spacing-2, 0.5rem);
		border: none;
		border-radius: var(--radius-sm, 0.25rem);
		font-size: 11px;
		font-weight: var(--font-weight-medium, 500);
		cursor: pointer;
		transition: all 150ms ease;
	}

	.holon-item__config-btn--cancel {
		background: var(--color-bg-primary, var(--color-bg-primary));
		color: var(--color-text-muted, var(--color-text-muted));
	}

	.holon-item__config-btn--cancel:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		color: var(--color-text-primary, #ffffff);
	}

	.holon-item__config-btn--request {
		background: var(--color-accent, var(--color-accent));
		color: var(--color-text-primary);
	}

	.holon-item__config-btn--request:hover {
		background: var(--color-accent-dark, var(--color-accent-hover));
	}
</style>
