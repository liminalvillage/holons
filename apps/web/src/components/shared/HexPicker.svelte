<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import mapboxgl from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';
	// @ts-ignore — h3-js has no published types in this repo's tsconfig
	import * as h3 from 'h3-js';
	import PlacesSearch from './PlacesSearch.svelte';
	import { Check, X, Crosshair } from 'svelte-feathers';

	const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

	export let value: string = '';
	export let resolution: number = 5;
	export let height: string = '360px';

	const dispatch = createEventDispatcher<{
		select: { hex: string };
		cancel: void;
	}>();

	let mapContainer: HTMLElement;
	let map: mapboxgl.Map | null = null;
	let selectedHex: string = value || '';
	let mapReady = false;
	let resizeObserver: ResizeObserver | null = null;

	// Fallback center if no initial value: roughly central Europe (matches Map.svelte default).
	const DEFAULT_CENTER: [number, number] = [13.7364963, 42.8917537];

	function safeCellToLatLng(cell: string): [number, number] | null {
		try {
			const [lat, lng] = h3.cellToLatLng(cell);
			return [lng, lat];
		} catch {
			return null;
		}
	}

	function isValidHex(cell: string): boolean {
		try {
			return !!cell && h3.isValidCell(cell);
		} catch {
			return false;
		}
	}

	// Map h3 resolution → reasonable zoom so the initial centering matches the
	// incoming `value`'s cell size. Mirrors Map.svelte's bands roughly inverted.
	function resolutionToZoom(res: number): number {
		const map: Record<number, number> = {
			0: 2.5,
			1: 4,
			2: 5.2,
			3: 6.5,
			4: 7.8,
			5: 9,
			6: 10.5,
			7: 12,
			8: 13.5,
			9: 15,
			10: 16,
			11: 17,
			12: 18
		};
		return map[res] ?? 5;
	}

	// Inverse of resolutionToZoom: derive the h3 resolution we should use from
	// the map's current zoom. Mirrors Map.svelte's getResolution so the grid
	// the picker draws lines up cell-for-cell with the main map.
	function zoomToResolution(zoom: number): number {
		const bands: Array<[number, number]> = [
			[3.0, 0],
			[4.4, 1],
			[5.7, 2],
			[7.1, 3],
			[8.4, 4],
			[9.8, 5],
			[11.4, 6],
			[12.7, 7],
			[14.1, 8],
			[15.5, 9],
			[16.8, 10],
			[18.2, 11],
			[19.5, 12]
		];
		for (const [z, r] of bands) {
			if (zoom <= z) return r;
		}
		return 12;
	}

	// Pull `resolution` from the live map zoom. Called from the zoom listener
	// after every user-driven zoom so the grid + selection follow the viewport
	// instead of needing an explicit slider.
	function syncResolutionToZoom() {
		if (!map) return;
		const newRes = zoomToResolution(map.getZoom());
		if (newRes === resolution) return;
		resolution = newRes;
		// Re-derive the selected cell at the new resolution so the highlight
		// matches the grid the user can now see, matching the previous
		// slider behaviour.
		if (selectedHex && isValidHex(selectedHex)) {
			try {
				const [lat, lng] = h3.cellToLatLng(selectedHex);
				selectedHex = h3.latLngToCell(lat, lng, resolution);
			} catch {}
		}
	}

	function rebuildHighlight() {
		if (!map || !mapReady) return;

		const src = map.getSource('hexpicker-selected') as mapboxgl.GeoJSONSource | undefined;
		if (!src) return;

		if (!selectedHex || !isValidHex(selectedHex)) {
			src.setData({ type: 'FeatureCollection', features: [] });
			return;
		}

		const boundary = h3.cellToBoundary(selectedHex, true) as Array<[number, number]>;
		const ring = boundary.map(([lng, lat]) => [lng, lat]);
		ring.push(ring[0]);
		src.setData({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: { type: 'Polygon', coordinates: [ring] }
				}
			]
		});
	}

	function rebuildGrid() {
		if (!map || !mapReady) return;
		const src = map.getSource('hexpicker-grid') as mapboxgl.GeoJSONSource | undefined;
		if (!src) return;

		// Pull hexes for the current viewport so the grid stays cheap on globe
		// view and dense on close zooms.
		const bounds = map.getBounds();
		if (!bounds) return;

		const sw = bounds.getSouthWest();
		const ne = bounds.getNorthEast();
		// h3.polygonToCells expects [lat, lng] tuples.
		const polygon = [
			[
				[ne.lat, sw.lng],
				[ne.lat, ne.lng],
				[sw.lat, ne.lng],
				[sw.lat, sw.lng],
				[ne.lat, sw.lng]
			]
		];

		let cells: string[] = [];
		try {
			cells = h3.polygonToCells(polygon[0], resolution);
		} catch {
			cells = [];
		}

		// Hard cap so a wide-angle viewport at high resolution doesn't lock the UI.
		if (cells.length > 4000) {
			src.setData({ type: 'FeatureCollection', features: [] });
			return;
		}

		const features = cells.map((c) => {
			const boundary = h3.cellToBoundary(c, true) as Array<[number, number]>;
			const ring = boundary.map(([lng, lat]) => [lng, lat]);
			ring.push(ring[0]);
			return {
				type: 'Feature' as const,
				properties: {},
				geometry: { type: 'Polygon' as const, coordinates: [ring] }
			};
		});

		src.setData({ type: 'FeatureCollection', features });
	}

	function handleMapClick(e: mapboxgl.MapMouseEvent) {
		const { lat, lng } = e.lngLat;
		try {
			selectedHex = h3.latLngToCell(lat, lng, resolution);
			rebuildHighlight();
		} catch (err) {
			console.warn('[HexPicker] Could not compute h3 cell for click', err);
		}
	}

	onMount(() => {
		if (typeof window === 'undefined') return;

		if (!MAPBOX_TOKEN) {
			console.error('[HexPicker] VITE_MAPBOX_TOKEN is not set');
			return;
		}
		mapboxgl.accessToken = MAPBOX_TOKEN;

		// If we have a starting hex, center on it AND adopt its resolution so
		// the user sees the same cell size their address lives in.
		let center: [number, number] = DEFAULT_CENTER;
		let zoom = resolutionToZoom(resolution);
		if (value && isValidHex(value)) {
			const c = safeCellToLatLng(value);
			if (c) center = c;
			try {
				resolution = h3.getResolution(value);
				zoom = resolutionToZoom(resolution);
			} catch {}
		}

		map = new mapboxgl.Map({
			container: mapContainer,
			style: 'mapbox://styles/mapbox/satellite-streets-v12',
			center,
			zoom,
			projection: 'globe',
			renderWorldCopies: false,
			attributionControl: false
		});

		map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
		map.addControl(
			new mapboxgl.GeolocateControl({
				positionOptions: { enableHighAccuracy: true },
				trackUserLocation: false
			}),
			'top-right'
		);

		// Search box is the <PlacesSearch> component below — its `result`
		// event flies the map and (re)derives the selected cell. Nothing to
		// initialize here.

		map.on('load', () => {
			if (!map) return;

			map.addSource('hexpicker-grid', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] }
			});
			map.addLayer({
				id: 'hexpicker-grid-line',
				type: 'line',
				source: 'hexpicker-grid',
				paint: {
					'line-color': '#ffffff',
					'line-width': 1,
					'line-opacity': 0.45
				}
			});

			map.addSource('hexpicker-selected', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] }
			});
			map.addLayer({
				id: 'hexpicker-selected-fill',
				type: 'fill',
				source: 'hexpicker-selected',
				paint: { 'fill-color': '#6366f1', 'fill-opacity': 0.45 }
			});
			map.addLayer({
				id: 'hexpicker-selected-line',
				type: 'line',
				source: 'hexpicker-selected',
				paint: { 'line-color': '#a5b4fc', 'line-width': 2 }
			});

			mapReady = true;
			rebuildGrid();
			rebuildHighlight();
		});

		map.on('moveend', rebuildGrid);
		map.on('zoomend', () => {
			// Zoom drives resolution: every settled zoom updates `resolution`,
			// pulls the selected cell to the new level, then rebuilds the
			// grid + highlight so the picker stays consistent without an
			// explicit slider.
			syncResolutionToZoom();
			rebuildGrid();
			rebuildHighlight();
		});
		map.on('click', handleMapClick);

		// The modal hosting this picker is portal'd to <body> AFTER the
		// component mounts, so Mapbox can latch onto a container whose layout
		// (and parent containing-block chain) is still being settled. A
		// ResizeObserver keeps mapboxgl's internal viewport in sync with the
		// real on-screen size of the container, so the canvas always paints
		// at the correct dimensions — instead of inheriting a stale 0×0 from
		// the pre-portal measurement and showing a blank area.
		if (typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(() => {
				try { map?.resize(); } catch {}
			});
			resizeObserver.observe(mapContainer);
		}
		// Also do an immediate resize on the next frame, for browsers / cases
		// where the observer doesn't fire on the first frame.
		requestAnimationFrame(() => {
			try { map?.resize(); } catch {}
		});
	});

	onDestroy(() => {
		try {
			resizeObserver?.disconnect();
		} catch {}
		resizeObserver = null;
		try {
			map?.remove();
		} catch {}
		map = null;
	});

	// Place picked in the search box (Google Places). Fly there and snap the
	// selected cell to the chosen location at the current resolution so the
	// user sees their pick immediately framed by an H3 cell.
	function handlePlaceResult(event: CustomEvent<{ lng: number; lat: number; label: string }>) {
		const { lng, lat } = event.detail;
		if (typeof lng !== 'number' || typeof lat !== 'number') return;
		try {
			selectedHex = h3.latLngToCell(lat, lng, resolution);
		} catch {}
		if (map) {
			map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), resolutionToZoom(resolution)), essential: true });
		}
		rebuildHighlight();
	}

	function clearSelection() {
		selectedHex = '';
		rebuildHighlight();
	}

	function confirm() {
		if (!selectedHex) return;
		dispatch('select', { hex: selectedHex });
	}

	function cancel() {
		dispatch('cancel');
	}
</script>

<div class="hex-picker">
	<div class="hex-picker__search">
		<PlacesSearch placeholder="Search a place…" on:result={handlePlaceResult} />
	</div>

	<div class="hex-picker__map" style="height: {height};" bind:this={mapContainer}></div>

	<div class="hex-picker__controls">
		<span class="hex-picker__res" title="Hex resolution follows the map zoom">
			<span class="hex-picker__res-label">Resolution</span>
			<span class="hex-picker__res-value">{resolution}</span>
		</span>

		<div class="hex-picker__selection">
			<Crosshair size="14" />
			{#if selectedHex}
				<code title={selectedHex}>{selectedHex}</code>
				<button type="button" class="hex-picker__clear" on:click={clearSelection} title="Clear">
					<X size="12" />
				</button>
			{:else}
				<span class="hex-picker__placeholder">Click a hex on the map to select</span>
			{/if}
		</div>
	</div>

	<div class="hex-picker__actions">
		<button type="button" class="btn btn--ghost" on:click={cancel}>Cancel</button>
		<button type="button" class="btn btn--primary" on:click={confirm} disabled={!selectedHex}>
			<Check size="14" /> Use this hex
		</button>
	</div>
</div>

<style>
	.hex-picker {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	/* Children of the modal's flex column would shrink to nothing without an
	   explicit shrink:0 — that's the "just see a line" bug where the 360px
	   map collapsed because the picker was taller than the modal body. */
	.hex-picker__search,
	.hex-picker__controls,
	.hex-picker__actions {
		flex-shrink: 0;
	}

	.hex-picker__map {
		width: 100%;
		flex-shrink: 0;
		border-radius: 0.75rem;
		overflow: hidden;
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
	}

	.hex-picker__controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		align-items: center;
		justify-content: space-between;
	}

	.hex-picker__res {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary, var(--color-text-secondary));
		padding: 0.25rem 0.5rem;
		background: var(--color-bg-primary, var(--color-bg-primary));
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
		border-radius: 0.375rem;
	}

	.hex-picker__res-value {
		min-width: 1.25rem;
		text-align: right;
		color: var(--color-text-primary, #fff);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.hex-picker__selection {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		background: var(--color-bg-primary, var(--color-bg-primary));
		border: 1px solid var(--color-border, var(--color-bg-tertiary));
		border-radius: 0.5rem;
		color: var(--color-text-secondary, var(--color-text-secondary));
		font-size: 0.8125rem;
		min-width: 0;
		max-width: 100%;
	}

	.hex-picker__selection code {
		color: var(--color-text-primary, #fff);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		max-width: 14rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hex-picker__placeholder {
		color: var(--color-text-muted, var(--color-text-muted));
	}

	.hex-picker__clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 9999px;
		background: transparent;
		border: none;
		color: var(--color-text-muted, var(--color-text-muted));
		cursor: pointer;
	}

	.hex-picker__clear:hover {
		background: var(--color-bg-tertiary, var(--color-bg-tertiary));
		color: var(--color-text-primary, #fff);
	}

	.hex-picker__actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
