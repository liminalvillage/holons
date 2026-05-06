<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		nameMap,
		resolveName,
		extractHolonIdFromSoul,
		buildHologramLink
	} from '$lib/stores/nameResolver';

	/**
	 * Pass the item directly. The badge inspects `item._hologram` and
	 * `item._federation` and renders one badge — hologram takes precedence.
	 * If neither marker is present (or origin === current holon), nothing
	 * renders.
	 */
	export let item: any = null;

	/**
	 * The holon currently being viewed. Used to suppress the badge when an
	 * item's federation origin equals the current holon (i.e., it's local).
	 */
	export let currentHolonId: string | null | undefined = '';

	/**
	 * The route segment the badge should navigate to on the source holon
	 * for the federation case (e.g. 'tasks', 'shopping', 'library'). Defaults
	 * to 'dashboard'. Lens-preserved navigation: same lens on a different holon.
	 */
	export let lensRoute: string = 'dashboard';

	$: hologram = item?._hologram?.isHologram ? item._hologram : null;
	$: federation =
		!hologram && item?._federation?.origin && item._federation.origin !== currentHolonId
			? item._federation
			: null;

	$: sourceHolonId = hologram
		? extractHolonIdFromSoul(hologram.soul) || hologram.sourceHolon || ''
		: federation?.origin || '';

	// Side-effect: kick off async resolution so $nameMap fills in over time.
	$: if (sourceHolonId) resolveName(sourceHolonId);

	/**
	 * Display order of preference for the holon's name:
	 *   1. Name stamped onto the envelope by holosphere (`originName` /
	 *      `sourceHolonName`) — fastest, no client-side lookup.
	 *   2. `$nameMap` entry resolved client-side.
	 *   3. The bare holon id — explicit user preference: never display
	 *      "Unknown" or "Holon abc...". If we don't have a name, show the id.
	 */
	$: stampedName = hologram
		? (hologram.sourceHolonName as string | undefined)
		: (federation?.originName as string | undefined);

	$: displayName = stampedName || (sourceHolonId ? $nameMap[sourceHolonId] : '') || sourceHolonId || '';

	$: href = hologram
		? buildHologramLink(hologram)
		: federation
			? `/${federation.origin}/${lensRoute}`
			: '';

	function handleClick(event: MouseEvent | KeyboardEvent) {
		event.stopPropagation();
		if (href) goto(href);
	}

	function handleKey(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleClick(event);
		}
	}
</script>

{#if (hologram || federation) && displayName}
	<button
		type="button"
		class="source-badge"
		class:source-badge--hologram={!!hologram}
		class:source-badge--federation={!!federation}
		title="Open {displayName}"
		on:click={handleClick}
		on:keydown={handleKey}
		aria-label="Open {displayName}"
	>
		<svg
			class="source-badge__icon"
			viewBox="0 0 24 24"
			fill="currentColor"
			width="10"
			height="10"
			aria-hidden="true"
		>
			<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
		</svg>
		<span class="source-badge__name">{displayName}</span>
	</button>
{/if}

<style>
	.source-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.5rem;
		font-size: 0.65rem;
		font-weight: 500;
		line-height: 1.2;
		border: none;
		border-radius: 9999px;
		cursor: pointer;
		flex-shrink: 0;
		max-width: 12rem;
		transition: background-color 150ms ease;
		vertical-align: middle;
	}

	.source-badge__icon {
		flex-shrink: 0;
	}

	.source-badge__name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.source-badge--hologram {
		background: rgba(0, 191, 255, 0.18);
		color: #00bfff;
	}
	.source-badge--hologram:hover {
		background: rgba(0, 191, 255, 0.32);
	}

	.source-badge--federation {
		background: rgba(168, 85, 247, 0.2);
		color: #a855f7;
	}
	.source-badge--federation:hover {
		background: rgba(168, 85, 247, 0.32);
	}
</style>
