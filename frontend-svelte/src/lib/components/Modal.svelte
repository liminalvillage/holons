<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import type { Snippet } from 'svelte';

	interface Props {
		header?: string;
		onClose: () => void;
		children?: {
			header?: Snippet;
			body?: Snippet;
			footer?: Snippet;
		};
	}

	let { header, onClose, children }: Props = $props();
</script>

<div class="modal-mask" transition:fade={{ duration: 300 }}>
	<div class="modal-wrapper">
		<div class="modal-container relative" transition:scale={{ duration: 300 }}>
			<button
				class="absolute top-0 right-0 text-blue-600 m-2"
				onclick={onClose}
				aria-label="Close modal"
			>
				✖
			</button>

			<div class="modal-header">
				{#if header}
					<h3 class="font-bold text-xl mb-2">{header}</h3>
				{/if}
				{#if children?.header}
					{@render children.header()}
				{/if}
			</div>

			<div class="modal-body">
				{#if children?.body}
					{@render children.body()}
				{/if}
			</div>

			<div class="modal-footer text-right">
				<button
					class="bg-gray-300 hover:bg-gray-400 rounded-full px-3 py-1 text-sm font-semibold m-2"
					onclick={onClose}
				>
					cancel
				</button>
				{#if children?.footer}
					{@render children.footer()}
				{/if}
			</div>
		</div>
	</div>
</div>
