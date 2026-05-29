<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { X } from 'svelte-feathers';

	export let open: boolean = false;
	export let title: string = '';
	export let size: 'sm' | 'md' | 'lg' = 'md';
	export let closeOnBackdrop: boolean = true;

	const dispatch = createEventDispatcher<{ close: void }>();

	function close() {
		open = false;
		dispatch('close');
	}

	function handleBackdrop(event: MouseEvent) {
		// Only close when clicking the backdrop itself, not content.
		if (closeOnBackdrop && event.target === event.currentTarget) close();
	}

	function handleKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.stopPropagation();
			close();
		}
	}

	// Lock body scroll while open.
	let prevOverflow: string | null = null;
	$: if (typeof document !== 'undefined') {
		if (open && prevOverflow === null) {
			prevOverflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
		} else if (!open && prevOverflow !== null) {
			document.body.style.overflow = prevOverflow;
			prevOverflow = null;
		}
	}

	onDestroy(() => {
		if (typeof document !== 'undefined' && prevOverflow !== null) {
			document.body.style.overflow = prevOverflow;
		}
	});

	/**
	 * Move the rendered backdrop to `document.body` so it escapes any ancestor
	 * that establishes a containing block for `position: fixed` (transform,
	 * filter, container-type, will-change, contain, …). Without this, a modal
	 * opened from inside a TaskCard / dndzone / flipped row gets clipped to
	 * that ancestor's box instead of filling the viewport — and you see only
	 * a sliver of the modal exactly where the trigger was.
	 */
	function portalToBody(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode === document.body) {
					document.body.removeChild(node);
				}
			}
		};
	}
</script>

<svelte:window on:keydown={handleKey} />

{#if open}
	<div
		class="modal-backdrop"
		use:portalToBody
		transition:fade={{ duration: 150 }}
		on:click={handleBackdrop}
		on:keydown|stopPropagation
		role="presentation"
	>
		<div
			class="modal modal--{size}"
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? 'modal-title' : undefined}
			transition:scale={{ duration: 180, start: 0.96 }}
		>
			{#if title || $$slots.header}
				<header class="modal__header">
					<slot name="header">
						<h2 id="modal-title" class="modal__title">{title}</h2>
					</slot>
					<button
						type="button"
						class="modal__close"
						aria-label="Close"
						on:click={close}
					>
						<svelte:component this={X} size="18" />
					</button>
				</header>
			{/if}

			<div class="modal__body">
				<slot />
			</div>

			{#if $$slots.footer}
				<footer class="modal__footer">
					<slot name="footer" />
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: rgba(0, 0, 0, 0.65);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.modal {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-bg-tertiary);
		border-radius: 0.75rem;
		box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.5);
		width: 100%;
		max-height: calc(100vh - 2rem);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.modal--sm { max-width: 24rem; }
	.modal--md { max-width: 32rem; }
	.modal--lg { max-width: 48rem; }

	.modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-bottom: 1px solid var(--color-bg-tertiary);
		flex-shrink: 0;
	}

	.modal__title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.modal__close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--color-text-muted);
		border: none;
		cursor: pointer;
		transition: background 150ms ease, color 150ms ease;
	}

	.modal__close:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.modal__body {
		padding: 1rem;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}

	.modal__footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--color-bg-tertiary);
		flex-shrink: 0;
	}
</style>
