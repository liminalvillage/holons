<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let isHologram: boolean = false;
	export let sourceHolon: string = '';
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
</script>

<div
	class="item-card"
	class:item-card--completed={completed}
	class:item-card--hologram={isHologram}
>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="item-card__inner"
		role={clickable ? 'button' : undefined}
		tabindex={clickable ? 0 : undefined}
		on:click={handleClick}
		on:keydown={handleKey}
	>
		{#if isHologram && sourceHolon}
			<span class="item-card__hologram-badge" title="Held by {sourceHolon}">
				⟐ {sourceHolon}
			</span>
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

	.item-card__hologram-badge {
		position: absolute;
		top: 0.375rem;
		right: 0.5rem;
		font-size: 0.625rem;
		font-weight: 500;
		color: #00BFFF;
		background: rgba(0, 191, 255, 0.1);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		pointer-events: none;
		white-space: nowrap;
		max-width: 40%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
