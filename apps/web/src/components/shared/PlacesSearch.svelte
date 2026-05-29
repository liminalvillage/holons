<script lang="ts">
	// @ts-nocheck — @mapbox/search-js-web ships its own types but they
	// collide with Svelte's HTMLAttributes; we lean on the runtime API.
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	// Side-effect import: registers <mapbox-search-box> as a custom element.
	import { MapboxSearchBox } from '@mapbox/search-js-web';

	export let placeholder: string = 'Search a place…';
	export let initialValue: string = '';

	const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

	const dispatch = createEventDispatcher<{
		result: { lng: number; lat: number; label: string; placeId: string };
	}>();

	let mountEl: HTMLDivElement | null = null;
	let searchBox: any = null;
	let unavailable: boolean = !MAPBOX_TOKEN;
	let unavailableReason: string = unavailable
		? 'Place search unavailable — VITE_MAPBOX_TOKEN is not set.'
		: '';

	function handleRetrieve(ev: any) {
		// Mapbox Search Box emits `retrieve` with a FeatureCollection. Pull
		// the first feature's coordinates + a human label and forward it in
		// the shape Map.svelte / HexPicker expects.
		const feature = ev?.detail?.features?.[0];
		if (!feature) return;
		const coords = feature.geometry?.coordinates as [number, number] | undefined;
		if (!coords || coords.length < 2) return;
		const props = feature.properties ?? {};
		dispatch('result', {
			lng: coords[0],
			lat: coords[1],
			label: props.full_address || props.place_formatted || props.name || '',
			placeId: props.mapbox_id || ''
		});
	}

	onMount(() => {
		if (unavailable || !mountEl) return;
		try {
			// Use the class API rather than the bare <mapbox-search-box> tag
			// so we can set the access token + theme programmatically before
			// the element starts firing requests.
			searchBox = new MapboxSearchBox();
			searchBox.accessToken = MAPBOX_TOKEN;
			searchBox.options = {
				language: 'en',
				// `poi,address,place,neighborhood,…` keeps the suggestion
				// list useful for both city-scale and street-scale queries.
				types: 'poi,address,place,locality,neighborhood,region,country,postcode'
			};
			searchBox.placeholder = placeholder;
			searchBox.theme = {
				variables: {
					unit: '14px',
					padding: '0.5em',
					borderRadius: '12px',
					boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
					colorBackground: 'rgba(55, 65, 81, 0.5)',
					colorBackgroundHover: 'rgba(96, 165, 250, 0.2)',
					colorBackgroundActive: 'rgba(96, 165, 250, 0.3)',
					colorText: '#ffffff',
					colorTextSecondary: '#e5e7eb',
					colorPlaceholder: '#cbd5e1',
					colorPrimary: '#60a5fa',
					colorSecondary: '#cbd5e1',
					border: '1px solid rgba(255, 255, 255, 0.1)',
					fontFamily: 'inherit'
				},
				cssText: `
					input,
					.Input,
					.SuggestionName,
					.SuggestionDescription {
						color: #ffffff !important;
					}
					input::placeholder {
						color: #cbd5e1 !important;
					}
				`
			};
			if (initialValue) {
				try {
					searchBox.value = initialValue;
				} catch {}
			}
			searchBox.addEventListener('retrieve', handleRetrieve);
			mountEl.appendChild(searchBox);
		} catch (err) {
			console.error('[PlacesSearch] Failed to initialize Mapbox Search Box', err);
			unavailable = true;
			unavailableReason = (err as Error)?.message || 'Place search unavailable';
		}
	});

	onDestroy(() => {
		try {
			searchBox?.removeEventListener('retrieve', handleRetrieve);
			searchBox?.remove?.();
		} catch {}
		searchBox = null;
	});
</script>

<div class="places-search" bind:this={mountEl} title={unavailable ? unavailableReason : ''}>
	{#if unavailable}
		<input
			type="text"
			class="places-search__fallback"
			{placeholder}
			disabled
			title={unavailableReason}
		/>
	{/if}
</div>

<style>
	.places-search {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
		width: 100%;
	}

	/* The <mapbox-search-box> custom element ships with its own shadow DOM;
	   theming happens via the `theme` prop set in onMount. Make sure it
	   stretches to fill the slot we give it in the control bar / picker. */
	.places-search :global(mapbox-search-box) {
		width: 100%;
		min-width: 0;
		display: block;
	}

	.places-search__fallback {
		width: 100%;
		min-width: 0;
		padding: 8px 12px;
		font-size: 14px;
		color: #f9fafb;
		background: rgba(55, 65, 81, 0.5);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		opacity: 0.6;
		cursor: not-allowed;
	}

	.places-search__fallback::placeholder {
		color: var(--color-text-muted);
	}
</style>
