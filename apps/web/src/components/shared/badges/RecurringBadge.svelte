<script lang="ts">
	/**
	 * Indicator for tasks that recur. Renders nothing unless the item has a
	 * recurring type or status, so callers can drop it in unconditionally.
	 */
	interface Props {
		item: { type?: string; status?: string; frequency?: string };
		title?: string;
	}

	let { item, title }: Props = $props();
	const isRecurring = $derived(
		item.type === 'recurring' ||
			item.status === 'recurring' ||
			item.status === 'repeating',
	);
</script>

{#if isRecurring}
	<span class="recurring-badge" title={title || item.frequency || 'Recurring'}>
		🔄
	</span>
{/if}

<style>
	.recurring-badge {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		padding: 0.125rem 0.5rem;
		font-size: 0.65rem;
		line-height: 1.2;
		background-color: rgba(168, 85, 247, 0.18);
		color: #7c3aed;
		border-radius: 9999px;
		vertical-align: middle;
	}
</style>
