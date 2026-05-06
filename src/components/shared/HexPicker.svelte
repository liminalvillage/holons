<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import mapboxgl from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';
	// @ts-ignore — h3-js has no published types in this repo's tsconfig
	import * as h3 from 'h3-js';
	import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
	import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';
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
	let geocoderContainer: HTMLElement;
	let map: mapboxgl.Map | null = null;
	let geocoder: any = null;
	let selectedHex: string = value || '';
	let mapReady = false;

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

	// Map h3 resolution → reasonable zoom so the grid looks good when the
	// resolution slider changes. Mirrors Map.svelte's bands roughly inverted.
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

		// Search box. Geocoder writes its own DOM into the container we provide.
		try {
			geocoder = new MapboxGeocoder({
				accessToken: MAPBOX_TOKEN,
				mapboxgl: mapboxgl as any,
				marker: false,
				placeholder: 'Search a place…',
				flyTo: { speed: 1.4 }
			});
			geocoder.addTo(geocoderContainer);
			geocoder.on('result', (ev: any) => {
				const coords = ev?.result?.center as [number, number] | undefined;
				if (!coords) return;
				try {
					selectedHex = h3.latLngToCell(coords[1], coords[0], resolution);
					rebuildHighlight();
				} catch {}
			});
		} catch (err) {
			console.warn('[HexPicker] Geocoder unavailable', err);
		}

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
		map.on('zoomend', rebuildGrid);
		map.on('click', handleMapClick);
	});

	onDestroy(() => {
		try {
			geocoder?.onRemove?.();
		} catch {}
		try {
			map?.remove();
		} catch {}
		map = null;
		geocoder = null;
	});

	function changeResolution(r: number) {
		resolution = Math.max(0, Math.min(12, r));
		// Re-derive the selected cell at the new resolution so the highlight
		// matches the grid the user can now see.
		if (selectedHex && isValidHex(selectedHex)) {
			try {
				const [lat, lng] = h3.cellToLatLng(selectedHex);
				selectedHex = h3.latLngToCell(lat, lng, resolution);
			} catch {}
		}
		if (map) {
			map.easeTo({ zoom: resolutionToZoom(resolution), duration: 250 });
		}
		rebuildGrid();
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
	<div class="hex-picker__search" bind:this={geocoderContainer}></div>

	<div class="hex-picker__map" style="height: {height};" bind:this={mapContainer}></div>

	<div class="hex-picker__controls">
		<label class="hex-picker__res">
			<span class="hex-picker__res-label">Resolution</span>
			<input
				type="range"
				min="1"
				max="12"
				step="1"
				value={resolution}
				on:input={(e) => changeResolution(Number((e.target as HTMLInputElement).value))}
			/>
			<span class="hex-picker__res-value">{resolution}</span>
		</label>

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

	/* Tame the geocoder so it sits on a single row above the map. */
	.hex-picker__search :global(.mapboxgl-ctrl-geocoder) {
		max-width: 100%;
		width: 100%;
		min-width: 0;
		box-shadow: none;
		background: var(--color-bg-primary, #111827);
		border: 1px solid var(--color-border, #374151);
		border-radius: 0.5rem;
		color: var(--color-text-primary, #fff);
	}

	.hex-picker__search :global(.mapboxgl-ctrl-geocoder--input) {
		color: var(--color-text-primary, #fff);
		height: 2.25rem;
	}

	.hex-picker__search :global(.suggestions) {
		background: var(--color-bg-secondary, #1f2937);
		color: var(--color-text-primary, #fff);
	}

	.hex-picker__map {
		width: 100%;
		border-radius: 0.75rem;
		overflow: hidden;
		border: 1px solid var(--color-border, #374151);
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
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary, #d1d5db);
	}

	.hex-picker__res input[type='range'] {
		accent-color: var(--color-accent, #6366f1);
		width: 9rem;
	}

	.hex-picker__res-value {
		min-width: 1.25rem;
		text-align: right;
		color: var(--color-text-primary, #fff);
		font-variant-numeric: tabular-nums;
	}

	.hex-picker__selection {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		background: var(--color-bg-primary, #111827);
		border: 1px solid var(--color-border, #374151);
		border-radius: 0.5rem;
		color: var(--color-text-secondary, #d1d5db);
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
		color: var(--color-text-muted, #9ca3af);
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
		color: var(--color-text-muted, #9ca3af);
		cursor: pointer;
	}

	.hex-picker__clear:hover {
		background: var(--color-bg-tertiary, #374151);
		color: var(--color-text-primary, #fff);
	}

	.hex-picker__actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
