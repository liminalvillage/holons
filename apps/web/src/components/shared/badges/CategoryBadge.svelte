<script lang="ts">
	/**
	 * Small pill rendered inside a task card showing the task's category. One
	 * visual treatment shared across list / kanban / canvas — only the
	 * `compact` flag tweaks paddings to suit dense list rows.
	 */
	interface Props {
		category?: string | null;
		compact?: boolean;
	}

	let { category, compact = false }: Props = $props();
</script>

{#if category}
	<span class="category-badge" class:is-compact={compact} title={category}>
		{category}
	</span>
{/if}

<style>
	.category-badge {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		padding: 0.125rem 0.5rem;
		font-size: 0.65rem;
		font-weight: 500;
		line-height: 1.2;
		background-color: rgba(0, 0, 0, 0.1);
		color: #374151;
		border-radius: 9999px;
		max-width: 12rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		vertical-align: middle;
	}

	.category-badge.is-compact {
		padding: 0.1rem 0.375rem;
		font-size: 0.6rem;
	}
</style>
