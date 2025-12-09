<script lang="ts">
	// @ts-nocheck -- Disabling TypeScript checking for this file due to Svelte 5 JSX compatibility issues
	import { onMount, onDestroy, getContext, createEventDispatcher} from "svelte";
	// @ts-ignore - Fix for app/environment module error
	import { browser } from "$app/environment";
	import mapboxgl from "mapbox-gl";
	import "mapbox-gl/dist/mapbox-gl.css";
	// @ts-ignore - Fix for h3-js module error
	import * as h3 from "h3-js";
	import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder";
	import "@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css";
	import { ID } from "../dashboard/store";
	import type { HoloSphere } from "holosphere";
	import MapSidebar from './MapSidebar.svelte';
	import type { LensType, LensOption } from '../types/Map';

	let holosphere = getContext('holosphere') as HoloSphere;

	let mapContainer: HTMLElement;
	let map: mapboxgl.Map;
	let hexId: string;
	let hexIdSetByUser = false; // Track if hexId was set by user clicking on map
	let lastSyncedIdFromStore: string | undefined; // Track last ID synced from store to prevent loops
	export let selectedLens: LensType = 'quests';
	export let isVisible: boolean = true;
	let holoSubscriptions = new Map();
	let showSidebar = false;
	let sidebarPosition = { x: 0, y: 0 };
	let isDragging = false;
	let dragOffset = { x: 0, y: 0 };
	let lastSidebarPosition: { x: number, y: number } | null = null;
	let showLensInfo = false;
	let geocoderContainer: HTMLElement;
	let geolocateControl: mapboxgl.GeolocateControl;
	let lensData: Record<LensType, Set<string>> = {
		quests: new Set<string>(),
		needs: new Set<string>(),
		offers: new Set<string>(),
		communities: new Set<string>(),
		organizations: new Set<string>(),
		projects: new Set<string>(),
		currencies: new Set<string>(),
		people: new Set<string>(),
		holons: new Set<string>()
	};

	const lensOptions: LensOption[] = [
		{ value: 'quests', label: 'Tasks' },
		{ value: 'needs', label: 'Local Needs' },
		{ value: 'offers', label: 'Offers' },
		{ value: 'communities', label: 'Communities' },
		{ value: 'organizations', label: 'Organizations' },
		{ value: 'projects', label: 'Projects' },
		{ value: 'currencies', label: 'Currencies' },
		{ value: 'people', label: 'People' },
		{ value: 'holons', label: 'Holons' }
	];

	const dispatch = createEventDispatcher();

	// Keep just the retry counter to prevent infinite loops
	let fetchRetryCount = 0;
	const MAX_FETCH_RETRIES = 2;

	// Keep track of movement state
	let moveTimeout: number;
	let isMoving = false;
	
	// Keep track of last fetch time to implement throttling
	let lastFetchTime = 0;
	const THROTTLE_INTERVAL = 2000; // 2 seconds minimum between fetches
	
	// Clear any existing timeout
	function clearMoveTimeout() {
		if (moveTimeout) {
			window.clearTimeout(moveTimeout);
			moveTimeout = 0;
		}
	}

	function getResolution(zoom: number): number {
		const zoomToRes = [
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
			[19.5, 12],
			[21.1, 13],
			[21.9, 14],
		];

		for (let [z, res] of zoomToRes) {
			if (zoom <= z) return res;
		}
		return 15;
	}

	function getZoomFromResolution(resolution: number): number {
		const resToZoom = [
			[0, 3.0],
			[1, 4.4],
			[2, 5.7],
			[3, 7.1],
			[4, 8.4],
			[5, 9.8],
			[6, 11.4],
			[7, 12.7],
			[8, 14.1],
			[9, 15.5],
			[10, 16.8],
			[11, 18.2],
			[12, 19.5],
			[13, 21.1],
			[14, 21.9],
			[15, 22.0],
		];

		for (let [res, zoom] of resToZoom) {
			if (resolution === res) return zoom;
		}
		return 22.0; // Default to maximum zoom if resolution is higher than expected
	}

	function renderHexes(map: mapboxgl.Map, lens: string) {
		const bounds = map.getBounds();
		if (!bounds) return;
		
		let west = bounds.getWest();
		let east = bounds.getEast();
		const south = bounds.getSouth();
		const north = bounds.getNorth();

		const currentZoom = map.getZoom();
		const currentResolution = getResolution(currentZoom);

		// Get highlighted hexes based on lens
		let highlightedHexes = new Set<string>();
		let highlightColor = '#088';

		switch (lens) {
			case 'quests':
				highlightedHexes = lensData.quests;
				highlightColor = '#f44336';
				break;
			case 'needs':
				highlightedHexes = lensData.needs;
				highlightColor = '#2196f3';
				break;
			case 'offers':
				highlightedHexes = lensData.offers;
				highlightColor = '#4caf50';
				break;
			case 'communities':
				highlightedHexes = lensData.communities;
				highlightColor = '#ff9800';
				break;
			case 'organizations':
				highlightedHexes = lensData.organizations;
				highlightColor = '#9c27b0';
				break;
			case 'projects':
				highlightedHexes = lensData.projects;
				highlightColor = '#3f51b5';
				break;
			case 'currencies':
				highlightedHexes = lensData.currencies;
				highlightColor = '#e91e63';
				break;
			case 'people':
				highlightedHexes = lensData.people;
				highlightColor = '#607d8b';
				break;
			case 'holons':
				highlightedHexes = lensData.holons;
				highlightColor = '#ff5722';
				break;
		}

		// Filter highlighted hexes based on resolution
		const visibleHighlightedHexes = new Set(
			Array.from(highlightedHexes).filter(hex => {
				const hexResolution = h3.getResolution(hex);
				return currentResolution <= hexResolution;
			})
		);

		// Update the highlighted hexagons - always update to either show highlights or clear them
		const highlightedSource = map.getSource("highlighted-hexagons");
		if (highlightedSource) {
			if (visibleHighlightedHexes.size > 0) {
				highlightedSource.setData(
					highlightHexagons(visibleHighlightedHexes, highlightColor)
				);
			} else {
				// Clear highlights when no hexes have content
				highlightedSource.setData({
					type: "FeatureCollection",
					features: []
				});
			}
		}

		const h3res = getResolution(currentZoom);
		const h3resLower = Math.max(0, h3res + 1);

		function generateHexagons(resolution: number) {
			let hexagons = new Set<string>();
			for (let lat = south; lat <= north; lat += (north - south) / 20) {
				for (let lng = west; lng <= east; lng += (east - west) / 20) {
					hexagons.add(h3.latLngToCell(lat, lng, resolution));
				}
			}
			return hexagons;
		}

		function hexagonsToFeatures(hexagons: Set<string>) {
			return Array.from(hexagons)
				.flatMap((hexagon) => {
					const boundary = h3.cellToBoundary(hexagon, true);
					const [lat, lng] = h3.cellToLatLng(hexagon);
					const [vertexLat, vertexLng] = boundary[0];
					const centerLng = lng; // Use center longitude for reference

					// Check if the hexagon crosses the antimeridian by looking for large jumps
					let needsNormalization = false;
					for (let i = 0; i < boundary.length; i++) {
						const j = (i + 1) % boundary.length;
						const lngDiff = Math.abs(boundary[i][0] - boundary[j][0]);
						if (lngDiff > 180) {
							needsNormalization = true;
							break;
						}
					}

					// If we need to normalize, shift coordinates based on center longitude
					let normalizedBoundary = boundary;
					if (needsNormalization) {
						normalizedBoundary = boundary.map(([vertLng, vertLat]: [number, number]) => {
							if (centerLng < 0 && vertLng > 90) { // Hex center is west, vertex is far east -> shift vertex west
								return [vertLng - 360, vertLat];
							}
							if (centerLng > 0 && vertLng < -90) { // Hex center is east, vertex is far west -> shift vertex east
								return [vertLng + 360, vertLat];
							}
							return [vertLng, vertLat];
						});
					}

					return [
						{
							type: "Feature" as const,
							properties: { 
								id: hexagon
							},
							geometry: {
								type: "Polygon" as const,
								coordinates: [normalizedBoundary]
							}
						},
						{
							type: "Feature" as const,
							properties: { 
								id: hexagon,
								center_lat: lat,
								center_lng: lng,
								vertex_lat: vertexLat,
								vertex_lng: vertexLng
							},
							geometry: {
								type: "Point" as const,
								coordinates: [lng, lat]
							}
						}
					];
				});
		}

		function hexagonsToCenterFeatures(hexagons: Set<string>) {
			return Array.from(hexagons)
				.map((hexagon) => {
					const [lat, lng] = h3.cellToLatLng(hexagon);
					const boundary = h3.cellToBoundary(hexagon, true);
					// Take the first vertex for radius calculation
					const [vertexLat, vertexLng] = boundary[0];
					
					return {
						type: "Feature" as const,
						properties: { 
							id: hexagon,
							center_lat: lat,
							center_lng: lng,
							vertex_lat: vertexLat,
							vertex_lng: vertexLng
						},
						geometry: {
							type: "Point" as const,
							coordinates: [lng, lat]
						}
					};
				});
		}

		function highlightHexagons(hexagons: Set<string>, color: string) {
			const features = Array.from(hexagons).flatMap((hexagon) => {
				const boundary = h3.cellToBoundary(hexagon, true);
				const [lat, lng] = h3.cellToLatLng(hexagon);
				const hexSize = h3.getHexagonEdgeLengthAvg(h3.getResolution(hexagon), 'km') * 1000;
				const centerLng = lng; // Use center longitude for reference

				// Check for antimeridian crossing
				let needsNormalization = false;
				for (let i = 0; i < boundary.length; i++) {
					const j = (i + 1) % boundary.length;
					const lngDiff = Math.abs(boundary[i][0] - boundary[j][0]);
					if (lngDiff > 180) {
						needsNormalization = true;
						break;
					}
				}

				// Normalize if needed based on center longitude
				let normalizedBoundary = boundary;
				if (needsNormalization) {
					normalizedBoundary = boundary.map(([vertLng, vertLat]: [number, number]) => {
						if (centerLng < 0 && vertLng > 90) { // Hex center is west, vertex is far east -> shift vertex west
							return [vertLng - 360, vertLat];
						}
						if (centerLng > 0 && vertLng < -90) { // Hex center is east, vertex is far west -> shift vertex east
							return [vertLng + 360, vertLat];
						}
						return [vertLng, vertLat];
					});
				}

				// Return both polygon and point features
				return [
					{
						type: "Feature" as const,
						properties: { 
							id: hexagon,
							color: color
						},
						geometry: {
							type: "Polygon" as const,
							coordinates: [normalizedBoundary],
						}
					},
					{
						type: "Feature" as const,
						properties: { 
							id: hexagon,
							color: color,
							radius: hexSize
						},
						geometry: {
							type: "Point" as const,
							coordinates: [lng, lat]
						}
					}
				];
			});

			return {
				type: "FeatureCollection" as const,
				features: features
			};
		}

		const hexagons = generateHexagons(h3res);
		const hexagonsLower = generateHexagons(h3resLower);

		// Add safety checks to ensure sources exist before updating them
		const hexagonGridSource = map.getSource("hexagon-grid");
		const hexagonGridLowerSource = map.getSource("hexagon-grid-lower");
		
		if (hexagonGridSource) {
			hexagonGridSource.setData({
				type: "FeatureCollection",
				features: hexagonsToFeatures(hexagons)
			});
		} else {
			console.warn('[Map] hexagon-grid source not ready yet');
		}

		if (hexagonGridLowerSource) {
			hexagonGridLowerSource.setData({
				type: "FeatureCollection",
				features: hexagonsToFeatures(hexagonsLower)
			});
		} else {
			console.warn('[Map] hexagon-grid-lower source not ready yet');
		}
	}

	function goToHex(hex: string) {
		if (!isH3Cell(hex)) return;
		
		const [lat, lng] = h3.cellToLatLng(hex);
		const resolution = h3.getResolution(hex);
		const zoom = getZoomFromResolution(resolution);
		
		// First zoom to the location
		map.flyTo({
			center: [lng, lat],
			zoom: zoom,
		});

		// After zooming, update the selected hexagon visualization
		map.once('moveend', () => {
			map.getSource("selected-hexagon")?.setData({
				type: "Feature",
				properties: {},
				geometry: {
					type: "Polygon",
					coordinates: [h3.cellToBoundary(hex, true)],
				},
			});
		});
	}

	function updateSelectedHexagon(hexId: string) {
		const boundary = h3.cellToBoundary(hexId, true);
		const [lat, lng] = h3.cellToLatLng(hexId);
		const hexSize = h3.getHexagonEdgeLengthAvg(h3.getResolution(hexId), 'km') * 1000;

		// Create both polygon and point features for the selected hexagon
		const features = {
			type: "FeatureCollection" as const,
			features: [
				{
					type: "Feature",
					properties: {},
					geometry: {
						type: "Polygon",
						coordinates: [boundary]
					}
				},
				{
					type: "Feature",
					properties: {
						radius: hexSize
					},
					geometry: {
						type: "Point",
						coordinates: [lng, lat]
					}
				}
			]
		};

		map.getSource("selected-hexagon")?.setData(features);

		dispatch('holonChange', { id: hexId });

		// Don't update the global ID store - that should only reflect the current dashboard holon
		// The hexId prop will be used by MapSidebar to show the selected hexagon's data
		goToHex(hexId);

		// Show sidebar when hexagon is selected
		showSidebar = true;

		// If we have a saved position, use it, otherwise calculate a new position
		if (lastSidebarPosition) {
			sidebarPosition = lastSidebarPosition;
		}
		// else position will be calculated in the click handler
	}

	// Function to ensure loading state is properly cleared
	function ensureLoadingReset() {
		// No need to implement this function as the isLoading variable is no longer used
	}

	// Update the lens selection to use fetch instead of subscribe
	$: if (map && selectedLens) {

		// Clear only the highlighted hexagons visually
		map.getSource("highlighted-hexagons")?.setData({
			type: "FeatureCollection",
			features: []
		});
		
		// Cancel any existing fetch timeout
		clearMoveTimeout();
		
		// Schedule a fetch after a short delay
		moveTimeout = window.setTimeout(() => {
			// Clear only the previous lens data before fetching new data
			lensData[selectedLens] = new Set<string>();
			fetchLensData(selectedLens);
		}, 500);
		
		// Don't render hexes immediately since we just cleared the visual data
		// The fetchLensData call will trigger a render when it has new data
	}

	function fetchLensData(lens: string) {
		// Implement throttling
		const now = Date.now();
		if (now - lastFetchTime < THROTTLE_INTERVAL) {
			return;
		}
		
		// Update last fetch time
		lastFetchTime = now;

		// Cancel any pending fetch operations
		clearMoveTimeout();

		// Get the current map bounds
		const bounds = map.getBounds();
		if (!bounds) {
			return;
		}
		
		// Capture the current lens in a closure to ensure we're still working with the same lens
		// even if it changes during the async operations
		const currentLens = lens;
		
		const west = bounds.getWest();
		const east = bounds.getEast();
		const south = bounds.getSouth();
		const north = bounds.getNorth();
		
		// Get current zoom and resolution
		const currentZoom = map.getZoom();
		const h3res = getResolution(currentZoom);
		
		// Generate hexagons for the visible area - limit the number for better performance
		const hexagons = new Set<string>();
		const latStep = (north - south) / 8; // Further reduced sample points
		const lngStep = (east - west) / 8;
		
		for (let lat = south; lat <= north; lat += latStep) {
			for (let lng = west; lng <= east; lng += lngStep) {
				hexagons.add(h3.latLngToCell(lat, lng, h3res));
			}
		}

		// Create a map to track which hexagons have content
		const hexagonsWithContent = new Set<string>();
		
		// Make non-blocking fetch calls for each hexagon
		let fetchesInProgress = 0;
		let fetchesCompleted = 0;
		
		// When all fetches are done, update the display
		const checkAllFetchesComplete = () => {
			fetchesCompleted++;
			if (fetchesCompleted === fetchesInProgress) {
				// Make sure we're still working with the current lens
				if (currentLens === selectedLens) {
					// Update lens data with hexagons that have content
					lensData[currentLens as LensType] = hexagonsWithContent;

					// Render the updated hexes
					renderHexes(map, currentLens);
				}
			}
		};
		
		// Process each hexagon
		let hasStartedFetches = false;
		for (const hex of hexagons) {
			fetchesInProgress++;
			hasStartedFetches = true;

			// Non-blocking call without await
			holosphere.getAll(hex, lens)
				.then(items => {
					// Add to set if content exists
					if (items && items.length > 0) {
						hexagonsWithContent.add(hex);
					}
					checkAllFetchesComplete();
				})
				.catch(error => {
					console.error(`[Map] Error fetching ${lens} data for ${hex}:`, error);
					checkAllFetchesComplete();
				});
		}
		
		// If no fetches started, just update the UI
		if (!hasStartedFetches) {
			renderHexes(map, lens);
		}
	}

	let lastResolution: number;

	function clearHexagons() {
		// Clear selected hexagon
		map.getSource("selected-hexagon")?.setData({
			type: "Feature",
			properties: {},
			geometry: {
				type: "Point",
				coordinates: [0, 0]
			}
		});

		// Clear highlighted hexagons
		map.getSource("highlighted-hexagons")?.setData({
			type: "FeatureCollection",
			features: []
		});
	}

	function handleMapMove() {
		// Just update visuals during movement, no data fetching
		const currentZoom = map.getZoom();
		const currentResolution = getResolution(currentZoom);

		// Check if we've crossed a resolution boundary
		if (lastResolution !== undefined && lastResolution !== currentResolution) {
			clearHexagons();
			
			// If we have a selected hexagon, check if we should reapply it
			if (hexId) {
				const hexResolution = h3.getResolution(hexId);
				if (currentResolution <= hexResolution) {
					const boundary = h3.cellToBoundary(hexId, true);
					map.getSource("selected-hexagon")?.setData({
						type: "Feature",
						properties: {},
						geometry: {
							type: "Polygon",
							coordinates: [boundary],
						},
					});
				}
			}
		}
		lastResolution = currentResolution;

		// Always render hexes immediately for visual feedback
		if (selectedLens) renderHexes(map, selectedLens);
		
		// Mark that we're in a moving state
		isMoving = true;
	}

	let mapInitialized = false;

	function initializeMap() {
		if (mapInitialized || !browser) return;

		// Guard: ensure container exists before initializing
		if (!mapContainer) {
			setTimeout(initializeMap, 100);
			return;
		}

		// Validate Mapbox access token
		const accessToken = "pk.eyJ1IjoicnZhbGVudGkiLCJhIjoiY2tncnMxeG81MDNjaTJybWpxOWhrOWpmZiJ9.v2W_bicM22r4YX4pCyRvHQ";
		if (!accessToken || accessToken.length < 50) {
			console.error('[Map] Invalid Mapbox access token');
			return;
		}
		
		mapboxgl.accessToken = accessToken;

		map = new mapboxgl.Map({
			container: mapContainer,
			style: "mapbox://styles/mapbox/satellite-streets-v12",
			center: [13.7364963,42.8917537],
			zoom: 5,
			projection: "globe",
			renderWorldCopies: false,
		});

		// Initialize geolocate control (will be triggered by button in control bar)
		try {
			geolocateControl = new mapboxgl.GeolocateControl({
				positionOptions: {
					enableHighAccuracy: true,
				},
				trackUserLocation: true,
				showUserHeading: true,
			});

			// Add it to the map invisibly so it can be triggered
			map.addControl(geolocateControl, "bottom-right");
		} catch (error) {
			console.error('[Map] Error adding geolocate control:', error);
		}

		map.on("style.load", () => {
			map.setFog({
				color: "rgb(255, 255, 255)",       // Lower atmosphere white
				"high-color": "rgb(255, 255, 255)", // Upper atmosphere white
				"horizon-blend": 0.03,          // Slightly increase blend for thickness
				"space-color": "rgb(17, 24, 39)", // Keep space dark
				"star-intensity": 0.6
			});
			
			// Check if sources already exist and remove them
			try {
				// Define all sources and their associated layers
				const sourceLayerMap = {
					"hexagon-grid": ["hexagon-grid-outline-layer", "hexagon-grid-circle-layer"],
					"hexagon-grid-lower": ["hexagon-grid-lower-outline-layer", "hexagon-grid-lower-circle-layer"],
					"highlighted-hexagons": ["highlighted-hexagons-fill-layer", "highlighted-hexagons-outline-layer", "highlighted-hexagons-circle-layer"],
					"selected-hexagon": ["selected-hexagon-fill-layer", "selected-hexagon-outline-layer", "selected-hexagon-circle-layer"]
				};
				
				// Remove all existing layers and sources systematically
				for (const [sourceId, layerIds] of Object.entries(sourceLayerMap)) {
					// Remove layers first (they depend on sources)
					for (const layerId of layerIds) {
						if (map.getLayer(layerId)) {
							console.log(`[Map] Removing existing layer: ${layerId}`);
							map.removeLayer(layerId);
						}
					}
					
					// Then remove the source
					if (map.getSource(sourceId)) {
						console.log(`[Map] Removing existing source: ${sourceId}`);
						map.removeSource(sourceId);
					}
				}
				
				// Base hexagon grid layers
				map.addSource("hexagon-grid", {
					type: "geojson",
					data: { type: "FeatureCollection", features: [] }
				});

				map.addLayer({
					id: "hexagon-grid-outline-layer",
					type: "line",
					source: "hexagon-grid",
					paint: {
						"line-color": "#fff",
						"line-width": 1,
						"line-opacity": 0.6
					}
				});

				// Base hexagon grid circle layer
				map.addLayer({
					id: "hexagon-grid-circle-layer",
					type: "circle",
					source: "hexagon-grid",
					paint: {
						"circle-color": "#fff",
						"circle-opacity": 0.6,
						"circle-stroke-width": 1,
						"circle-stroke-color": "#fff",
						"circle-stroke-opacity": 0.6,
						"circle-radius": [
							"interpolate",
							["exponential", 2],
							["zoom"],
							0, 2,
							22, 100
						]
					}
				});

				// Lower resolution grid layers
				map.addSource("hexagon-grid-lower", {
					type: "geojson",
					data: { type: "FeatureCollection", features: [] }
				});

				map.addLayer({
					id: "hexagon-grid-lower-outline-layer",
					type: "line",
					source: "hexagon-grid-lower",
					paint: {
						"line-color": "#aaa",
						"line-width": 0.5,
						"line-opacity": 0.4
					}
				});

				// Lower resolution grid circle layer
				map.addLayer({
					id: "hexagon-grid-lower-circle-layer",
					type: "circle",
					source: "hexagon-grid-lower",
					paint: {
						"circle-color": "#aaa",
						"circle-opacity": 0.4,
						"circle-stroke-width": 0.5,
						"circle-stroke-color": "#aaa",
						"circle-stroke-opacity": 0.4,
						"circle-radius": [
							"interpolate",
							["exponential", 2],
							["zoom"],
							0, 1,
							22, 50
						]
					}
				});

				// Highlighted hexagons layers
				map.addSource("highlighted-hexagons", {
					type: "geojson",
					data: {
						type: "FeatureCollection",
						features: []
					}
				});

				// Add highlighted hexagon fill FIRST
				map.addLayer({
					id: "highlighted-hexagons-fill-layer",
					type: "fill",
					source: "highlighted-hexagons",
					paint: {
						"fill-color": ["get", "color"],
						"fill-opacity": 0.6
					}
				});

				// Then add the outline
				map.addLayer({
					id: "highlighted-hexagons-outline-layer",
					type: "line",
					source: "highlighted-hexagons",
					paint: {
						"line-color": ["get", "color"],
						"line-width": 2,
						"line-opacity": 0.8
					}
				});

				// Highlighted hexagons circle layer
				map.addLayer({
					id: "highlighted-hexagons-circle-layer",
					type: "circle",
					source: "highlighted-hexagons",
					paint: {
						"circle-color": ["get", "color"],
						"circle-opacity": 0.6,
						"circle-stroke-width": 2,
						"circle-stroke-color": ["get", "color"],
						"circle-stroke-opacity": 0.8,
						"circle-radius": [
							"interpolate",
							["exponential", 2],
							["zoom"],
							0, 2,
							22, 100
						]
					}
				});

				// Selected hexagon layers
				map.addSource("selected-hexagon", {
					type: "geojson",
					data: {
						type: "Feature",
						properties: {},
						geometry: { type: "Polygon", coordinates: [[]] }
					}
				});

				// Add selected hexagon fill FIRST
				map.addLayer({
					id: "selected-hexagon-fill-layer",
					type: "fill",
					source: "selected-hexagon",
					paint: {
						"fill-color": "#088",
						"fill-opacity": 0.6
					}
				});

				// Then add the outline
				map.addLayer({
					id: "selected-hexagon-outline-layer",
					type: "line",
					source: "selected-hexagon",
					paint: {
						"line-color": "#088",
						"line-width": 2,
						"line-opacity": 0.8
					}
				});

				// Selected hexagon circle layer
				map.addLayer({
					id: "selected-hexagon-circle-layer",
					type: "circle",
					source: "selected-hexagon",
					paint: {
						"circle-color": "#088",
						"circle-opacity": 0.6,
						"circle-stroke-width": 2,
						"circle-stroke-color": "#088",
						"circle-stroke-opacity": 0.8,
						"circle-radius": [
							"interpolate",
							["exponential", 2],
							["zoom"],
							0, 2,
							22, 100
						]
					}
				});
				
				// Now that sources are ready, render initial hexes
				if (selectedLens) {
					renderHexes(map, selectedLens);
				}
			} catch (e) {
				console.error('[Map] Error cleaning up existing sources/layers:', e);
			}
		});

		map.on("load", () => {
			// Initial data fetch after map is fully loaded
			clearMoveTimeout();
			moveTimeout = window.setTimeout(() => {
				if (selectedLens) {
					fetchLensData(selectedLens);
				}
			}, 500);

			// Add geocoder to custom container after map is loaded
			try {
				const geocoder = new MapboxGeocoder({
					accessToken: mapboxgl.accessToken,
					mapboxgl: mapboxgl,
					marker: false,
					placeholder: "Search location...",
					types: "poi,address,place,locality,neighborhood,region,country,postcode",
				});

				// Add the geocoder to our custom container
				if (geocoderContainer) {
					// Clear any existing content first
					geocoderContainer.innerHTML = '';
					const geocoderElement = geocoder.onAdd(map);
					console.log('[Map] Adding geocoder element:', geocoderElement);
					geocoderContainer.appendChild(geocoderElement);
					console.log('[Map] Geocoder container children:', geocoderContainer.children.length);
				} else {
					console.warn('[Map] geocoderContainer not found');
				}
			} catch (error) {
				console.error('[Map] Error adding geocoder:', error);
			}

			mapInitialized = true;
		});

		// Update the movement handlers
		map.on("movestart", () => {
			// Just mark that we're starting to move
			isMoving = true;
			// Cancel any pending fetch operations
			clearMoveTimeout();
		});

		map.on("move", handleMapMove);
		map.on("zoom", handleMapMove);
		
		map.on("moveend", () => {
			// Movement has ended
			isMoving = false;

			// Clear any previous timeout
			clearMoveTimeout();

			// Schedule data fetch after movement with a delay
			moveTimeout = window.setTimeout(() => {
				if (selectedLens) {
					fetchLensData(selectedLens);
				}
			}, 1000); // 1 second delay
			
			// Always render hexes with existing data for immediate feedback
			renderHexes(map, selectedLens);
		});

		map.on("click", (e: mapboxgl.MapMouseEvent) => {
			const { lng, lat } = e.lngLat;
			const zoom = map.getZoom();
			const resolution = getResolution(zoom);
			const newHexId = h3.latLngToCell(lat, lng, resolution);

			// Only update sidebar position if it's not already shown
			// This preserves the user's chosen position when switching hexagons
			if (!showSidebar) {
				updateSidebarPosition();
			}

			// Only update if it's a valid H3 cell
			if (isH3Cell(newHexId)) {
				hexIdSetByUser = true; // Mark that this was a user action
				hexId = newHexId;
				updateSelectedHexagon(newHexId);
			}
		});
	}

	// Update the sidebar position calculation
	function updateSidebarPosition() {
		if (mapContainer) {
			const mapRect = mapContainer.getBoundingClientRect();
			const geolocateControl = mapContainer.querySelector('.mapboxgl-ctrl-geolocate');
			
			if (geolocateControl) {
				const geoRect = geolocateControl.getBoundingClientRect();
				sidebarPosition = {
					x: mapRect.width - 420, // 400px width + 20px margin
					y: geoRect.bottom + 20 // Position below geolocate with some margin
				};
				lastSidebarPosition = { ...sidebarPosition };
			}
		}
	}

	// Function to make sure the sidebar position is within map bounds
	function adjustSidebarPosition() {
		// Only proceed if we have a position and the map is initialized
		if (lastSidebarPosition && map && mapContainer) {
			const mapRect = mapContainer.getBoundingClientRect();
			const sidebarElements = document.querySelectorAll('.sidebar-overlay');
			
			if (sidebarElements.length > 0) {
				const sidebarRect = sidebarElements[0].getBoundingClientRect();
				const sidebarWidth = sidebarRect.width;
				const sidebarHeight = sidebarRect.height;
				
				// Check if current position would place the sidebar outside map boundaries
				const currentX = lastSidebarPosition.x;
				const currentY = lastSidebarPosition.y;
				
				// Adjust if needed to keep within map boundaries
				const adjustedX = Math.max(0, Math.min(mapRect.width - sidebarWidth, currentX));
				const adjustedY = Math.max(0, Math.min(mapRect.height - sidebarHeight, currentY));
				
				// Update position if adjustments were needed
				if (adjustedX !== currentX || adjustedY !== currentY) {
					sidebarPosition = { x: adjustedX, y: adjustedY };
					lastSidebarPosition = { ...sidebarPosition };
				}
			}
		}
	}
	
	// Set up resize handler when component is mounted
	onMount(() => {
		if (browser) {
			// Add global mouse move and up listeners (only when in browser)
			window.addEventListener('mousemove', handleDrag);
			window.addEventListener('mouseup', handleDragEnd);
			
			// Add resize listener to ensure sidebar stays visible
			window.addEventListener('resize', adjustSidebarPosition);
			
			// Add a small delay to ensure container is properly sized
			setTimeout(initializeMap, 100);
		}
		
		return () => {
			// Clean up event listeners
			window.removeEventListener('mousemove', handleDrag);
			window.removeEventListener('mouseup', handleDragEnd);
			window.removeEventListener('resize', adjustSidebarPosition);
		};
	});

	// Add cleanup function for map
	function cleanupMap() {
		if (!map) return;

		try {
			// Remove event listeners first
			map.off('movestart');
			map.off('move', handleMapMove);
			map.off('zoom', handleMapMove);
			map.off('moveend');
			map.off('click');
			
			// Try to clean up layers and sources to prevent ID conflicts
			try {
				// Define all sources and their associated layers
				const sourceLayerMap = {
					"hexagon-grid": ["hexagon-grid-outline-layer", "hexagon-grid-circle-layer"],
					"hexagon-grid-lower": ["hexagon-grid-lower-outline-layer", "hexagon-grid-lower-circle-layer"],
					"highlighted-hexagons": ["highlighted-hexagons-fill-layer", "highlighted-hexagons-outline-layer", "highlighted-hexagons-circle-layer"],
					"selected-hexagon": ["selected-hexagon-fill-layer", "selected-hexagon-outline-layer", "selected-hexagon-circle-layer"]
				};
				
				// Remove all existing layers and sources systematically
				for (const [sourceId, layerIds] of Object.entries(sourceLayerMap)) {
					// Remove layers first (they depend on sources)
					for (const layerId of layerIds) {
						if (map.getLayer(layerId)) {
							map.removeLayer(layerId);
						}
					}

					// Then remove the source
					if (map.getSource(sourceId)) {
						console.log(`[Map] Removing source: ${sourceId}`);
						map.removeSource(sourceId);
					}
				}
			} catch (e) {
				console.warn('[Map] Error cleaning up layers/sources:', e);
			}
			
			// Finally remove the map
			map.remove();
			map = null;
			mapInitialized = false;
		} catch (error) {
			console.error('[Map] Error cleaning up map:', error);
			// Force reset of variables
			map = null;
			mapInitialized = false;
		}
	}

	// Add function to detect holon type
	function isH3Cell(id: string): boolean {
		try {
			return h3.isValidCell(id);
		} catch {
			return false;
		}
	}

	// Update ID store subscription - only sync from dashboard navigation, not from map clicks
	// Use lastSyncedIdFromStore to break cyclical dependency
	$: {
		if ($ID && isH3Cell($ID) && $ID !== lastSyncedIdFromStore) {
			if (!hexIdSetByUser) {
				// Dashboard navigated to a new hexagon
				lastSyncedIdFromStore = $ID;
				hexId = $ID;
				dispatch('holonChange', { id: $ID });

				// If map is ready and visible, navigate immediately
				if (map && isVisible && mapInitialized) {
					updateSelectedHexagon($ID);
				} else if (isVisible && !mapInitialized && browser) {
					// If map isn't ready yet but we're visible, initialize it and then navigate
					window.setTimeout(() => {
						if (map && mapInitialized) {
							updateSelectedHexagon($ID);
						}
					}, 200);
				}
			} else if ($ID !== hexId) {
				// Dashboard navigated away from the user-selected hexagon, reset flag
				hexIdSetByUser = false;
				lastSyncedIdFromStore = $ID;
			}
		}
	}

	// Handle navigation when map becomes ready and there's already a hexagon ID
	$: if (map && mapInitialized && isVisible && hexId && isH3Cell(hexId)) {
		// Check if we need to navigate to the current hexagon
		const currentCenter = map.getCenter();
		const [hexLat, hexLng] = h3.cellToLatLng(hexId);
		const distance = Math.sqrt(
			Math.pow(currentCenter.lat - hexLat, 2) + 
			Math.pow(currentCenter.lng - hexLng, 2)
		);
		
		// If we're not already at the hexagon (within a small threshold), navigate to it
		if (distance > 0.01) { // About 1km threshold
			updateSelectedHexagon(hexId);
		}
	}

	// Watch for visibility changes
	$: if (isVisible) {
		// Initialize or re-initialize map when becoming visible
		if (!mapInitialized && browser) {
			// Add a small delay to ensure container is properly sized
			window.setTimeout(initializeMap, 100);
		}
	} else if (mapInitialized) {
		// Clean up map when becoming invisible
		performFinalCleanup();
	}

	// Comprehensive cleanup function
	function performFinalCleanup() {
		// Make sure all timeouts are cleared
		if (moveTimeout) {
			clearTimeout(moveTimeout);
			moveTimeout = 0;
		}
		
	// Reset movement state
	isMoving = false;
	
	// Reset fetch retry counter
	fetchRetryCount = 0;
	
	// Create a fresh map to ensure no references remain
	holoSubscriptions = new Map();
	
	// Clear all lens data to free memory
	for (const key of Object.keys(lensData)) {
		lensData[key as LensType] = new Set<string>();
	}
	
	// Clean up map resources
	cleanupMap();
	}

	// Update onDestroy to reset all state
	onDestroy(() => {
		performFinalCleanup();
	});

	// Also ensure cleanup on hide/unmount via the isVisible property
	$: if (!isVisible && mapInitialized) {
		performFinalCleanup();
	}

	// Function to close the sidebar
	function closeSidebar() {
		showSidebar = false;
		// Keep lastSidebarPosition so it's remembered for next time
	}

	// Drag handling functions
	function handleDragStart(event: MouseEvent) {
		// If the target is an input, button, select, or anchor, or has such an ancestor, don't start drag
		const targetElement = event.target as HTMLElement;
		if (targetElement.tagName === 'INPUT' ||
			targetElement.tagName === 'BUTTON' ||
			targetElement.tagName === 'SELECT' ||
			targetElement.tagName === 'A' ||
			targetElement.closest('button, input, select, a')) {
			isDragging = false; // Ensure not in dragging state
			return;
		}

		isDragging = true;
		const sidebarElement = event.currentTarget as HTMLElement;
		const rect = sidebarElement.getBoundingClientRect();
		
		// Calculate the offset from the mouse position to the top-left corner of the sidebar
		dragOffset = {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top
		};
		
		// Prevent text selection during drag only if drag actually starts
		event.preventDefault();
	}
	
	function handleDrag(event: MouseEvent) {
		if (!isDragging) return;
		
		// Calculate new position based on mouse position and drag offset
		sidebarPosition = {
			x: event.clientX - dragOffset.x,
			y: event.clientY - dragOffset.y
		};
		
		// Get the actual map container boundaries rather than using static values
		const mapRect = mapContainer.getBoundingClientRect();
		
		// Get the sidebar element to determine its actual dimensions
		const sidebarElements = document.querySelectorAll('.sidebar-overlay');
		if (sidebarElements.length > 0) {
			const sidebarRect = sidebarElements[0].getBoundingClientRect();
			const sidebarWidth = sidebarRect.width;
			const sidebarHeight = sidebarRect.height;
			
			// Use the relative position within the map container
			// We need to account for the map's position on the page
			const relativeX = event.clientX - mapRect.left - dragOffset.x;
			const relativeY = event.clientY - mapRect.top - dragOffset.y;
			
			// Keep sidebar within map boundaries
			sidebarPosition.x = Math.max(0, Math.min(mapRect.width - sidebarWidth, relativeX));
			sidebarPosition.y = Math.max(0, Math.min(mapRect.height - sidebarHeight, relativeY));
		}
	}
	
	function handleDragEnd() {
		isDragging = false;
		
		// Save the current position when dragging ends
		lastSidebarPosition = {...sidebarPosition};
	}

	// Make sure to adjust position when sidebar is shown
	$: if (showSidebar && lastSidebarPosition) {
		adjustSidebarPosition();
	}
</script>

<div class="w-full h-full relative" class:hidden={!isVisible}>
	<div 
		bind:this={mapContainer} 
		class="map w-full h-full"
	>
		{#if hexId}
			<div class="hex-info">Selected Hexagon: {hexId}</div>
		{/if}
	</div>

	<!-- Embedded Map Control Bar -->
	<div class="map-control-bar">
		<div class="control-bar-inner">
			<!-- Lens Selector -->
			<div class="lens-selector-embedded">
				<div class="lens-icon">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
						<circle cx="11" cy="11" r="8"/>
						<path d="m21 21-4.35-4.35"/>
					</svg>
				</div>
				<div class="lens-select-wrapper">
					<select
						id="lens-select"
						bind:value={selectedLens}
						class="lens-select-embedded"
						aria-label="Select lens type"
					>
						{#each lensOptions as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</div>
				<button
					class="info-button-embedded"
					aria-label="Lens information"
					on:mouseenter={() => showLensInfo = true}
					on:mouseleave={() => showLensInfo = false}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="icon-svg-small">
						<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd" />
					</svg>
				</button>
			</div>

			<!-- Divider -->
			<div class="control-divider"></div>

			<!-- Geocoder Search -->
			<div bind:this={geocoderContainer} class="geocoder-container-embedded"></div>

			<!-- Divider -->
			<div class="control-divider"></div>

			<!-- Geolocate Button -->
			<button
				class="location-button-embedded"
				title="Go to my location"
				on:click={() => geolocateControl && geolocateControl.trigger()}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
					<circle cx="12" cy="12" r="10"/>
					<circle cx="12" cy="12" r="3"/>
					<line x1="12" y1="2" x2="12" y2="6"/>
					<line x1="12" y1="18" x2="12" y2="22"/>
					<line x1="2" y1="12" x2="6" y2="12"/>
					<line x1="18" y1="12" x2="22" y2="12"/>
				</svg>
			</button>

		</div>

		<!-- Info Tooltip -->
		{#if showLensInfo}
			<div class="info-tooltip-embedded">
				<div class="tooltip-header">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
						<circle cx="11" cy="11" r="8"/>
						<path d="m21 21-4.35-4.35"/>
					</svg>
					<h3>Lens Filters</h3>
				</div>
				<p class="tooltip-description">Filter the map to show different types of data:</p>
				<div class="lens-options-grid">
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #f44336;"></span>
						<div>
							<strong>Tasks</strong>
							<span class="lens-desc">Active tasks and quests</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #2196f3;"></span>
						<div>
							<strong>Local Needs</strong>
							<span class="lens-desc">Community requests</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #4caf50;"></span>
						<div>
							<strong>Offers</strong>
							<span class="lens-desc">Resources & services</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #ff9800;"></span>
						<div>
							<strong>Communities</strong>
							<span class="lens-desc">Local groups</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #9c27b0;"></span>
						<div>
							<strong>Organizations</strong>
							<span class="lens-desc">Registered orgs</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #3f51b5;"></span>
						<div>
							<strong>Projects</strong>
							<span class="lens-desc">Ongoing initiatives</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #e91e63;"></span>
						<div>
							<strong>Currencies</strong>
							<span class="lens-desc">Exchange systems</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #607d8b;"></span>
						<div>
							<strong>People</strong>
							<span class="lens-desc">Community members</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #ff5722;"></span>
						<div>
							<strong>Holons</strong>
							<span class="lens-desc">Organizational units</span>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Overlay sidebar when hexagon is selected -->
	{#if showSidebar && hexId}
		<div 
			class="sidebar-overlay"
			style="left: {sidebarPosition.x}px; top: {sidebarPosition.y}px;"
			on:mousedown={handleDragStart}
			role="dialog" 
			aria-modal="true"
			aria-labelledby="sidebar-header-title"
			tabindex="0" 
			on:keydown={(e) => { if (e.key === 'Escape') closeSidebar(); }}
		>
			<div class="sidebar-header">
				<div class="flex items-center">
					<span id="sidebar-header-title" class="text-white font-medium">Hexagon {hexId}</span>
				</div>
				<button 
					class="text-gray-300 hover:text-white" 
					on:click={closeSidebar}
				>×</button>
			</div>
			<div class="sidebar-content">
				<MapSidebar
					{selectedLens}
					{hexId}
					isOverlay={true}
				/>
			</div>
		</div>
	{/if}
</div>

<style>
	.map {
		width: 100%;
		height: 100%;
		position: relative;
		background-color: #111;
	}

	.hex-info {
		position: absolute;
		bottom: 10px;
		left: 10px;
		background-color: rgba(31, 41, 55, 0.8);
		color: white;
		padding: 5px 10px;
		border-radius: 9999px;
		font-size: 14px;
		z-index: 1;
	}
	


	/* Sidebar overlay styles */
	.sidebar-overlay {
		position: absolute;
		width: 400px;
		max-height: calc(90vh - 120px); /* Account for top controls */
		background-color: #1f2937;
		border-radius: 0.75rem;
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
		overflow: hidden;
		z-index: 20;
		display: flex;
		flex-direction: column;
		cursor: move; /* Add cursor style */
	}

	.sidebar-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		background-color: #111827;
		border-bottom: 1px solid #374151;
	}

	.sidebar-header button {
		font-size: 1.5rem;
		line-height: 1;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0 0.5rem;
	}

	.sidebar-content {
		overflow-y: auto;
		flex: 1;
		max-height: 70vh;
	}

	/* Embedded Map Control Bar - Dark Style */
	.map-control-bar {
		position: absolute;
		top: 20px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		width: calc(100% - 40px);
		max-width: 800px;
		pointer-events: none;
	}

	.control-bar-inner {
		display: flex;
		align-items: center;
		gap: 12px;
		background: linear-gradient(135deg, rgba(17, 24, 39, 0.95) 0%, rgba(31, 41, 55, 0.92) 100%);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		padding: 12px 16px;
		border-radius: 20px;
		box-shadow:
			0 10px 40px rgba(0, 0, 0, 0.4),
			0 4px 12px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.1);
		pointer-events: auto;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.control-bar-inner:hover {
		box-shadow:
			0 12px 50px rgba(0, 0, 0, 0.5),
			0 6px 16px rgba(0, 0, 0, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.15);
	}

	.lens-selector-embedded {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-shrink: 0;
	}

	.lens-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: #60a5fa;
		flex-shrink: 0;
	}

	.icon-svg {
		width: 20px;
		height: 20px;
	}

	.icon-svg-small {
		width: 16px;
		height: 16px;
	}

	.lens-select-wrapper {
		position: relative;
		flex-shrink: 0;
	}

	.lens-select-embedded {
		appearance: none;
		background: rgba(55, 65, 81, 0.5);
		color: #f9fafb;
		border: 1px solid rgba(255, 255, 255, 0.1);
		padding: 8px 32px 8px 12px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		border-radius: 12px;
		outline: none;
		min-width: 140px;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2360a5fa' d='M6 9L1 4h10z'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 10px center;
		transition: all 0.2s ease;
	}

	.lens-select-embedded:hover {
		background: rgba(55, 65, 81, 0.7);
		border-color: rgba(96, 165, 250, 0.3);
	}

	.lens-select-embedded:focus {
		outline: 2px solid rgba(96, 165, 250, 0.4);
		outline-offset: 2px;
		border-color: rgba(96, 165, 250, 0.5);
	}

	.info-button-embedded {
		background: rgba(96, 165, 250, 0.15);
		border: none;
		padding: 8px;
		color: #60a5fa;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		flex-shrink: 0;
	}

	.info-button-embedded:hover {
		background: rgba(96, 165, 250, 0.25);
		transform: scale(1.05);
	}

	.info-button-embedded:active {
		transform: scale(0.95);
	}

	.control-divider {
		width: 1px;
		height: 24px;
		background: linear-gradient(
			to bottom,
			rgba(255, 255, 255, 0),
			rgba(255, 255, 255, 0.15),
			rgba(255, 255, 255, 0)
		);
		flex-shrink: 0;
	}

	.search-placeholder {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		padding: 8px 12px;
		background: rgba(55, 65, 81, 0.4);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 12px;
		color: #9ca3af;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.search-placeholder:hover {
		background: rgba(55, 65, 81, 0.6);
		border-color: rgba(96, 165, 250, 0.3);
	}

	.search-text {
		font-size: 14px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.location-button-embedded {
		background: rgba(96, 165, 250, 0.15);
		border: 1px solid rgba(96, 165, 250, 0.2);
		padding: 10px;
		color: #60a5fa;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 12px;
		flex-shrink: 0;
	}

	.location-button-embedded:hover {
		background: rgba(96, 165, 250, 0.25);
		border-color: rgba(96, 165, 250, 0.4);
		transform: scale(1.05);
	}

	.location-button-embedded:active {
		transform: scale(0.95);
	}

	.info-tooltip-embedded {
		position: absolute;
		top: calc(100% + 12px);
		left: 0;
		right: 0;
		background: linear-gradient(135deg, rgba(17, 24, 39, 0.98) 0%, rgba(31, 41, 55, 0.96) 100%);
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
		border-radius: 20px;
		box-shadow:
			0 20px 60px rgba(0, 0, 0, 0.6),
			0 10px 30px rgba(0, 0, 0, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.1);
		padding: 20px;
		font-size: 13px;
		color: #f9fafb;
		z-index: 15;
		animation: tooltipFadeIn 0.25s ease-out;
		pointer-events: auto;
	}

	@keyframes tooltipFadeIn {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.info-tooltip-embedded::before {
		content: '';
		position: absolute;
		top: -6px;
		left: 32px;
		width: 12px;
		height: 12px;
		background: linear-gradient(135deg, rgba(17, 24, 39, 0.98) 0%, rgba(31, 41, 55, 0.96) 100%);
		border-left: 1px solid rgba(255, 255, 255, 0.1);
		border-top: 1px solid rgba(255, 255, 255, 0.1);
		transform: rotate(45deg);
	}

	.tooltip-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
		padding-bottom: 12px;
		border-bottom: 2px solid rgba(96, 165, 250, 0.2);
	}

	.tooltip-header svg {
		color: #60a5fa;
	}

	.tooltip-header h3 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
		color: #f9fafb;
	}

	.tooltip-description {
		margin: 0 0 16px 0;
		color: #9ca3af;
		font-size: 13px;
		line-height: 1.5;
	}

	.lens-options-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 10px;
	}

	.lens-option-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px;
		background: rgba(55, 65, 81, 0.4);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 12px;
		transition: all 0.2s ease;
	}

	.lens-option-item:hover {
		background: rgba(55, 65, 81, 0.6);
		border-color: rgba(96, 165, 250, 0.2);
		transform: translateX(4px);
	}

	.lens-dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	.lens-option-item div {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: 1;
	}

	.lens-option-item strong {
		color: #f9fafb;
		font-size: 13px;
		font-weight: 600;
	}

	.lens-desc {
		color: #9ca3af;
		font-size: 11px;
		line-height: 1.3;
	}

	/* Responsive Design */
	@media (max-width: 768px) {
		.map-control-bar {
			width: calc(100% - 20px);
			max-width: none;
		}

		.control-bar-inner {
			padding: 10px 12px;
			gap: 8px;
			flex-wrap: wrap;
		}

		.lens-selector-embedded {
			order: 1;
			flex: 1;
			min-width: 0;
		}

		.lens-select-embedded {
			min-width: 120px;
			font-size: 13px;
			padding: 6px 28px 6px 10px;
		}

		.control-divider {
			display: none;
		}

		.search-placeholder {
			order: 3;
			flex: 1 1 100%;
			min-width: 0;
		}

		.location-button-embedded {
			order: 2;
		}

		.search-text {
			font-size: 13px;
		}

		.lens-options-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 480px) {
		.map-control-bar {
			top: 10px;
		}

		.control-bar-inner {
			padding: 8px 10px;
			border-radius: 16px;
		}

		.lens-select-embedded {
			min-width: 100px;
			font-size: 12px;
		}

		.search-text {
			font-size: 12px;
		}

		.icon-svg {
			width: 18px;
			height: 18px;
		}
	}

	:global(.mapboxgl-ctrl.mapboxgl-ctrl-group) {
		position: relative;
		background: #fff;
		border-radius: 4px;
	}

	select:focus {
		outline: none;
	}

	/* Hide standalone Mapbox controls - we embed them in our control bar */
	:global(.mapboxgl-ctrl-top-right) {
		display: none !important;
	}

	/* Hide the geolocate control visual but keep it functional */
	:global(.mapboxgl-ctrl-bottom-right .mapboxgl-ctrl-geolocate) {
		display: none !important;
	}

	:global(.mapboxgl-ctrl-bottom-right) {
		pointer-events: none !important;
	}

	/* Style for geocoder embedded in control bar */
	.geocoder-container-embedded {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
	}

	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder) {
		width: 100% !important;
		max-width: none !important;
		min-width: 0 !important;
		box-shadow: none !important;
		background: transparent !important;
		border: none !important;
	}

	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder input) {
		pointer-events: auto !important;
		background: rgba(55, 65, 81, 0.5) !important;
		border: 1px solid rgba(255, 255, 255, 0.1) !important;
		border-radius: 12px !important;
		color: #f9fafb !important;
		font-size: 14px !important;
		font-weight: 500 !important;
		padding: 8px 12px 8px 36px !important;
		transition: all 0.2s ease !important;
		width: 100% !important;
	}

	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder input:focus) {
		border-color: rgba(96, 165, 250, 0.4) !important;
		background: rgba(55, 65, 81, 0.7) !important;
		outline: 2px solid rgba(96, 165, 250, 0.4) !important;
		outline-offset: 2px !important;
	}

	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder input::placeholder) {
		color: #9ca3af !important;
	}

	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder .suggestions) {
		background: rgba(17, 24, 39, 0.98) !important;
		border: 1px solid rgba(255, 255, 255, 0.1) !important;
		border-radius: 12px !important;
		margin-top: 8px !important;
		backdrop-filter: blur(24px) !important;
		-webkit-backdrop-filter: blur(24px) !important;
		z-index: 25 !important;
		position: absolute !important;
	}

	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder .suggestions > li > a) {
		color: #f9fafb !important;
		padding: 10px 14px !important;
		transition: all 0.15s ease !important;
	}

	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder .suggestions > .active > a),
	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder .suggestions > li > a:hover) {
		background-color: rgba(96, 165, 250, 0.2) !important;
		color: #60a5fa !important;
	}

	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder--icon-search) {
		fill: #9ca3af !important;
		left: 12px !important;
	}

	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder--icon-close) {
		fill: #f9fafb !important;
	}

	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder--button) {
		background: transparent !important;
	}

	.geocoder-container-embedded :global(.mapboxgl-ctrl-geocoder--icon-loading) {
		fill: #60a5fa !important;
	}

	/* Keep zoom controls visible with dark theme */
	:global(.mapboxgl-ctrl-zoom-in),
	:global(.mapboxgl-ctrl-zoom-out) {
		background: linear-gradient(135deg, rgba(17, 24, 39, 0.95) 0%, rgba(31, 41, 55, 0.92) 100%) !important;
		backdrop-filter: blur(20px) !important;
		-webkit-backdrop-filter: blur(20px) !important;
		border: 1px solid rgba(255, 255, 255, 0.1) !important;
		color: #f9fafb !important;
		transition: all 0.2s ease !important;
	}

	:global(.mapboxgl-ctrl-zoom-in:hover),
	:global(.mapboxgl-ctrl-zoom-out:hover) {
		background: linear-gradient(135deg, rgba(31, 41, 55, 0.98) 0%, rgba(55, 65, 81, 0.95) 100%) !important;
		border-color: rgba(96, 165, 250, 0.3) !important;
	}

	:global(.mapboxgl-ctrl-bottom-right) {
		margin: 0 10px 10px 0 !important;
	}

	:global(.mapboxgl-ctrl-group) {
		background: transparent !important;
		box-shadow: none !important;
		border-radius: 12px !important;
		overflow: hidden !important;
	}

	:global(.mapboxgl-ctrl-group > button) {
		background: linear-gradient(135deg, rgba(17, 24, 39, 0.95) 0%, rgba(31, 41, 55, 0.92) 100%) !important;
		backdrop-filter: blur(20px) !important;
		-webkit-backdrop-filter: blur(20px) !important;
		border: 1px solid rgba(255, 255, 255, 0.1) !important;
		border-radius: 0 !important;
		transition: all 0.2s ease !important;
	}

	:global(.mapboxgl-ctrl-group > button:first-child) {
		border-radius: 12px 12px 0 0 !important;
	}

	:global(.mapboxgl-ctrl-group > button:last-child) {
		border-radius: 0 0 12px 12px !important;
	}

	:global(.mapboxgl-ctrl-group > button:hover) {
		background: linear-gradient(135deg, rgba(31, 41, 55, 0.98) 0%, rgba(55, 65, 81, 0.95) 100%) !important;
		border-color: rgba(96, 165, 250, 0.3) !important;
	}

	:global(.mapboxgl-ctrl-icon) {
		filter: brightness(0) invert(1) !important;
	}
</style>









