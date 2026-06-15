<script lang="ts">
	import { CheckCircle, AlertTriangle } from 'svelte-feathers';

	/**
	 * Signing-provenance indicator. Renders nothing unless the item carries a
	 * provenance tag, so callers can drop it in unconditionally:
	 *   - `_verified === true`  → green "signed & verified" check (the item was
	 *     cryptographically signed by an authorized key).
	 *   - `_unverified === true` → amber "Unsigned" badge (legacy/unsigned data
	 *     surfaced for inspection only — never trust it for auth).
	 *
	 * Items only carry these tags under enforce mode (or a dual-source read),
	 * so this is a no-op in signing off/shadow modes.
	 */
	interface Props {
		item: { _verified?: boolean; _unverified?: boolean } | null | undefined;
	}

	let { item }: Props = $props();

	const signed = $derived(item?._verified === true);
	const unsigned = $derived(item?._unverified === true);
</script>

{#if signed}
	<span
		class="verify-badge verify-badge--signed"
		title="Signed and verified — cryptographically signed by an authorized key"
		aria-label="Signed and verified"
	>
		<CheckCircle size="11" />
	</span>
{:else if unsigned}
	<span
		class="verify-badge verify-badge--unsigned"
		title="Unsigned / legacy data — shown for inspection only, not cryptographically verified. Don't trust it."
		aria-label="Unsigned data"
	>
		<AlertTriangle size="11" />
		<span class="verify-badge__label">Unsigned</span>
	</span>
{/if}

<style>
	.verify-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.125rem 0.375rem;
		font-size: 0.65rem;
		font-weight: 500;
		line-height: 1.2;
		border-radius: 9999px;
		flex-shrink: 0;
		vertical-align: middle;
	}

	.verify-badge--signed {
		background: rgba(34, 197, 94, 0.18);
		color: #22c55e;
	}

	.verify-badge--unsigned {
		background: rgba(245, 158, 11, 0.18);
		color: #f59e0b;
	}

	.verify-badge__label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
