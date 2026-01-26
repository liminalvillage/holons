<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	export let roleName: string = '';
	export let userName: string = '';
	export let autoDismiss: boolean = true;
	export let dismissAfter: number = 5000;

	const dispatch = createEventDispatcher();

	let visible = true;

	onMount(() => {
		if (autoDismiss) {
			const timeout = setTimeout(() => {
				dismiss();
			}, dismissAfter);
			return () => clearTimeout(timeout);
		}
	});

	function dismiss() {
		visible = false;
		setTimeout(() => dispatch('dismiss'), 300);
	}
</script>

{#if visible}
	<div
		class="notification"
		transition:fly={{ y: 50, duration: 300 }}
		role="alert"
	>
		<div class="notification__icon">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="10"></circle>
				<line x1="12" y1="8" x2="12" y2="12"></line>
				<line x1="12" y1="16" x2="12.01" y2="16"></line>
			</svg>
		</div>
		<div class="notification__content">
			<p class="notification__title">Permanent Assignment</p>
			<p class="notification__message">
				{#if roleName && userName}
					<strong>{userName}</strong> has been assigned to <strong>{roleName}</strong> permanently.
				{/if}
				This will override the weekly schedule for all days.
			</p>
		</div>
		<button class="notification__close" on:click={dismiss} aria-label="Dismiss notification">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<line x1="18" y1="6" x2="6" y2="18"></line>
				<line x1="6" y1="6" x2="18" y2="18"></line>
			</svg>
		</button>
	</div>
{/if}

<style>
	.notification {
		position: fixed;
		bottom: 24px;
		right: 24px;
		max-width: 400px;
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 16px;
		background: linear-gradient(135deg, #78350f 0%, #92400e 100%);
		border: 1px solid rgba(251, 191, 36, 0.3);
		border-radius: 12px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
		z-index: 200;
	}

	.notification__icon {
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		color: #fbbf24;
	}

	.notification__icon svg {
		width: 100%;
		height: 100%;
	}

	.notification__content {
		flex: 1;
		min-width: 0;
	}

	.notification__title {
		font-size: 14px;
		font-weight: 600;
		color: #fef3c7;
		margin: 0 0 4px 0;
	}

	.notification__message {
		font-size: 13px;
		color: rgba(254, 243, 199, 0.8);
		margin: 0;
		line-height: 1.4;
	}

	.notification__message strong {
		color: #fef3c7;
		font-weight: 600;
	}

	.notification__close {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		padding: 0;
		background: none;
		border: none;
		color: rgba(254, 243, 199, 0.6);
		cursor: pointer;
		transition: color 0.2s ease;
	}

	.notification__close:hover {
		color: #fef3c7;
	}

	.notification__close svg {
		width: 100%;
		height: 100%;
	}

	@media (max-width: 480px) {
		.notification {
			left: 16px;
			right: 16px;
			bottom: 16px;
			max-width: none;
		}
	}
</style>
