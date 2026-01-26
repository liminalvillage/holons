<script lang="ts">
	import { writeNotifications, dismissNotification } from '$lib/stores/writeNotifications';
	import { fly } from 'svelte/transition';
	import { AlertTriangle, X } from 'svelte-feathers';
</script>

{#if $writeNotifications.length > 0}
	<div class="toast-container" role="alert" aria-live="polite">
		{#each $writeNotifications as notification (notification.id)}
			<div
				transition:fly={{ y: -20, duration: 200 }}
				class="toast"
			>
				<AlertTriangle size={20} class="toast-icon" />
				<span class="toast-message">{notification.message}</span>
				<button
					on:click={() => dismissNotification(notification.id)}
					class="toast-dismiss"
					aria-label="Dismiss"
				>
					<X size={16} />
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		top: 1rem;
		right: 1rem;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: #fef3c7;
		border: 1px solid #fcd34d;
		color: #92400e;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
		max-width: 24rem;
	}

	.toast-icon {
		color: #d97706;
		flex-shrink: 0;
	}

	.toast-message {
		flex: 1;
		font-size: 0.875rem;
	}

	.toast-dismiss {
		color: #d97706;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.25rem;
		transition: color 0.15s ease;
	}

	.toast-dismiss:hover {
		color: #92400e;
	}

	/* Dark mode support */
	@media (prefers-color-scheme: dark) {
		.toast {
			background: #451a03;
			border-color: #92400e;
			color: #fcd34d;
		}

		.toast-icon {
			color: #fbbf24;
		}

		.toast-dismiss {
			color: #fbbf24;
		}

		.toast-dismiss:hover {
			color: #fef3c7;
		}
	}
</style>
