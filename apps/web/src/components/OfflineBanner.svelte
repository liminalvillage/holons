<script lang="ts">
	import { online } from '$lib/stores/online';
</script>

{#if !$online}
	<div class="offline-banner" role="status" aria-live="polite">
		<span class="offline-banner__dot" aria-hidden="true"></span>
		<span>Offline — changes save locally and will sync when reconnected.</span>
	</div>
{/if}

<style>
	.offline-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem;
		background: #b45309; /* amber-700 */
		color: #fff7ed; /* orange-50 */
		font-size: 0.8125rem;
		line-height: 1.2;
		border-bottom: 1px solid #92400e; /* amber-800 */
	}

	.offline-banner__dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		background: #fbbf24; /* amber-400 */
		box-shadow: 0 0 0 0.2rem rgba(251, 191, 36, 0.25);
	}
</style>
