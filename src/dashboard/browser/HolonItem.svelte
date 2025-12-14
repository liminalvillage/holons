<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Star, Home } from 'svelte-feathers';

	export let id: string;
	export let name: string;
	export let isActive: boolean = false;
	export let isPinned: boolean = false;
	export let isStarred: boolean = false;
	export let isHome: boolean = false;
	export let showPinButton: boolean = false;
	export let showStarButton: boolean = false;

	const dispatch = createEventDispatcher();

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

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleSelect();
		}
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
			'#ef4444', // red
			'#f97316', // orange
			'#eab308', // yellow
			'#22c55e', // green
			'#14b8a6', // teal
			'#3b82f6', // blue
			'#8b5cf6', // violet
			'#ec4899', // pink
		];
		let hash = 0;
		for (let i = 0; i < id.length; i++) {
			hash = id.charCodeAt(i) + ((hash << 5) - hash);
		}
		return colors[Math.abs(hash) % colors.length];
	}

	$: initials = getInitials(name);
	$: avatarColor = getAvatarColor(id);
	$: shortId = `${id.slice(0, 6)}...${id.slice(-4)}`;
</script>

<div
	class="holon-item"
	class:holon-item--active={isActive}
	role="button"
	tabindex="0"
	on:click={handleSelect}
	on:keydown={handleKeydown}
>
	<div class="holon-item__avatar" style="background-color: {isActive ? 'var(--color-accent)' : avatarColor}">
		{initials}
	</div>

	<div class="holon-item__content">
		<span class="holon-item__name">
			{name}
			{#if isHome}
				<span class="holon-item__home-badge" title="Your home holon">
					<Home size={12} />
				</span>
			{/if}
		</span>
		<span class="holon-item__id">{shortId}</span>
	</div>

	{#if showPinButton}
		<button
			class="holon-item__pin"
			class:holon-item__pin--active={isPinned}
			on:click={handlePin}
			aria-label={isPinned ? 'Unpin holon' : 'Pin holon'}
		>
			<Star size={14} fill={isPinned ? 'currentColor' : 'none'} />
		</button>
	{/if}

	{#if showStarButton}
		<button
			class="holon-item__star"
			class:holon-item__star--active={isStarred}
			on:click={handleStar}
			aria-label={isStarred ? 'Remove from My Holons' : 'Add to My Holons'}
		>
			<Star size={14} fill={isStarred ? 'currentColor' : 'none'} />
		</button>
	{/if}
</div>

<style>
	.holon-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-3, 0.75rem);
		padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
		border-radius: var(--radius-md, 0.375rem);
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.holon-item:hover {
		background: var(--color-bg-secondary, #1f2937);
	}

	.holon-item--active {
		background: var(--color-accent-subtle, rgba(79, 70, 229, 0.1));
	}

	.holon-item--active:hover {
		background: var(--color-accent-subtle, rgba(79, 70, 229, 0.15));
	}

	.holon-item__avatar {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md, 0.375rem);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-primary, #ffffff);
		font-weight: var(--font-weight-semibold, 600);
		font-size: var(--font-size-sm, 0.875rem);
		flex-shrink: 0;
		transition: background-color 150ms ease;
	}

	.holon-item__content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-1, 0.25rem);
	}

	.holon-item__name {
		display: flex;
		align-items: center;
		gap: var(--spacing-1, 0.25rem);
		font-size: var(--font-size-sm, 0.875rem);
		font-weight: var(--font-weight-medium, 500);
		color: var(--color-text-primary, #ffffff);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.holon-item__home-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-accent-light, #818cf8);
		flex-shrink: 0;
	}

	.holon-item__id {
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-muted, #6b7280);
		font-family: var(--font-family-mono, monospace);
	}

	.holon-item__pin {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		border-radius: var(--radius-sm, 0.25rem);
		opacity: 0;
		transition: opacity 150ms ease, color 150ms ease, background-color 150ms ease;
	}

	.holon-item:hover .holon-item__pin {
		opacity: 1;
	}

	.holon-item__pin:hover {
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-primary, #ffffff);
	}

	.holon-item__pin--active {
		opacity: 1;
		color: var(--color-warning, #f59e0b);
	}

	.holon-item__pin--active:hover {
		color: var(--color-warning, #f59e0b);
	}

	.holon-item__star {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		border-radius: var(--radius-sm, 0.25rem);
		opacity: 0;
		transition: opacity 150ms ease, color 150ms ease, background-color 150ms ease;
	}

	.holon-item:hover .holon-item__star {
		opacity: 1;
	}

	.holon-item__star:hover {
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-primary, #ffffff);
	}

	.holon-item__star--active {
		opacity: 1;
		color: var(--color-warning, #f59e0b);
	}

	.holon-item__star--active:hover {
		color: var(--color-warning, #f59e0b);
	}
</style>
