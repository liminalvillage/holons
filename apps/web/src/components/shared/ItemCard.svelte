<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { goto } from '$app/navigation';

	export let isHologram: boolean = false;
	export let sourceHolon: string = '';
	export let sourceHref: string = '';
	export let isFederated: boolean = false;
	export let completed: boolean = false;
	export let clickable: boolean = false;

	const dispatch = createEventDispatcher<{ click: void }>();

	function handleClick() {
		if (clickable) dispatch('click');
	}

	function handleKey(event: KeyboardEvent) {
		if (clickable && (event.key === 'Enter' || event.key === ' ')) {
			event.preventDefault();
			dispatch('click');
		}
	}

	function handleBadgeClick(event: MouseEvent | KeyboardEvent) {
		event.stopPropagation();
		if (sourceHref) goto(sourceHref);
	}

	function handleBadgeKey(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			handleBadgeClick(event);
		}
	}
</script>

<div
	class="item-card"
	class:item-card--completed={completed}
	class:item-card--hologram={isHologram}
	class:item-card--federated={isFederated && !isHologram}
>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="item-card__inner"
		role={clickable ? 'button' : undefined}
		tabindex={clickable ? 0 : undefined}
		on:click={handleClick}
		on:keydown={handleKey}
	>
		{#if (isHologram || isFederated) && sourceHolon}
			{#if sourceHref}
				<button
					type="button"
					class="item-card__source-badge"
					class:item-card__source-badge--federated={isFederated && !isHologram}
					title="Navigate to {sourceHolon}"
					on:click={handleBadgeClick}
					on:keydown={handleBadgeKey}
					aria-label="Navigate to {sourceHolon}"
				>
					⟐ {sourceHolon}
				</button>
			{:else}
				<span
					class="item-card__source-badge item-card__source-badge--static"
					class:item-card__source-badge--federated={isFederated && !isHologram}
					title="Held by {sourceHolon}"
				>
					⟐ {sourceHolon}
				</span>
			{/if}
		{/if}

		<div class="item-card__content">
			<slot />
		</div>

		{#if $$slots.actions}
			<div class="item-card__actions">
				<slot name="actions" />
			</div>
		{/if}
	</div>
</div>

<style>
	.item-card__inner {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.item-card__content {
		flex: 1;
		min-width: 0;
	}

	.item-card__actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.item-card__source-badge {
		position: absolute;
		top: 0.375rem;
		right: 0.5rem;
		font-size: 0.625rem;
		font-weight: 500;
		color: #00BFFF;
		background: rgba(0, 191, 255, 0.1);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		white-space: nowrap;
		max-width: 40%;
		overflow: hidden;
		text-overflow: ellipsis;
		border: none;
		cursor: pointer;
		transition: background-color 150ms ease;
	}
	.item-card__source-badge:hover {
		background: rgba(0, 191, 255, 0.2);
	}
	.item-card__source-badge--static {
		pointer-events: none;
		cursor: default;
	}
	.item-card__source-badge--federated {
		color: #c084fc;
		background: rgba(168, 85, 247, 0.15);
	}
	.item-card__source-badge--federated:hover {
		background: rgba(168, 85, 247, 0.25);
	}
</style>
