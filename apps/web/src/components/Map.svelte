<script lang="ts">
	// @ts-nocheck -- Disabling TypeScript checking for this file due to Svelte 5 JSX compatibility issues
	import { onMount, onDestroy, getContext, createEventDispatcher} from "svelte";
	// @ts-ignore - Fix for app/environment module error
	import { browser } from "$app/environment";
	import mapboxgl from "mapbox-gl";
	import "mapbox-gl/dist/mapbox-gl.css";
	// @ts-ignore - Fix for h3-js module error
	import * as h3 from "h3-js";
	import { ID } from "../dashboard/store";
	import type { HoloSphere } from "holosphere";
	import MapSidebar from './MapSidebar.svelte';
	import MapBrowserWindow from './MapBrowserWindow.svelte';
	import PlacesSearch from './shared/PlacesSearch.svelte';
	import ToggleChip from './shared/ToggleChip.svelte';
	import { Globe, Eye } from 'svelte-feathers';
	import { showFederated, showHolograms } from '$lib/stores/lensFilters';
	import { toEmbeddableUrl } from '$lib/util/richContent';
	import { getEffectiveAppName } from '$lib/stores/appName';
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
	let geolocateControl: mapboxgl.GeolocateControl;

	// Picked from PlacesSearch (Google Places Autocomplete). Flies the map
	// to the chosen location at a reasonable street-level zoom so the user
	// sees the place's H3 cell, not the whole country.
	function handlePlaceResult(event: CustomEvent<{ lng: number; lat: number; label: string }>) {
		if (!map) return;
		const { lng, lat } = event.detail;
		if (typeof lng !== 'number' || typeof lat !== 'number') return;
		map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), essential: true });
	}

	// In-map draggable browser window. Driven by the
	// `open-link-in-map-window` CustomEvent that RichDescription dispatches
	// from inside MapSidebar (and anywhere else under the Map subtree). Set
	// `browserUrl` to a non-empty string to show the window.
	let browserUrl: string | null = null;
	let browserTitle: string = '';

	function handleOpenLinkInMapWindow(event: Event) {
		const ce = event as CustomEvent<{ url?: string; title?: string }>;
		const url = ce.detail?.url;
		if (!url) return;
		// Tell the dispatching anchor we're taking over so it skips the
		// native target="_blank" navigation (see RichDescription's click
		// handler — it preventDefaults the original click when this returns
		// false via the event's cancellation).
		event.preventDefault();
		browserUrl = toEmbeddableUrl(url);
		browserTitle = ce.detail?.title ?? '';
	}
	let lensData: Record<LensType, Set<string>> = {
		quests: new Set<string>(),
		needs: new Set<string>(),
		offers: new Set<string>(),
		communities: new Set<string>(),
		organizations: new Set<string>(),
		projects: new Set<string>(),
		currencies: new Set<string>(),
		people: new Set<string>(),
		holons: new Set<string>(),
		events: new Set<string>(),
		library: new Set<string>(),
		roles: new Set<string>(),
		announcements: new Set<string>(),
		expenses: new Set<string>(),
		checklists: new Set<string>(),
		appreciations: new Set<string>(),
		rea_events: new Set<string>(),
		canvases: new Set<string>()
	};

	// Per-(lens, hex) presence cache. Stops us refetching the same cell on
	// every pan/zoom AND survives page refreshes via localStorage so the user
	// doesn't pay the relay round-trip on cold start. Each entry stores both
	// the answer (`has`) and the timestamp so we can re-validate stale rows
	// after `PRESENCE_CACHE_TTL_MS` while serving the rest instantly.
	type PresenceEntry = { has: boolean; ts: number };
	const PRESENCE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
	let presenceCache: Record<LensType, Map<string, PresenceEntry>> = {
		quests: new Map(),
		needs: new Map(),
		offers: new Map(),
		communities: new Map(),
		organizations: new Map(),
		projects: new Map(),
		currencies: new Map(),
		people: new Map(),
		holons: new Map(),
		events: new Map(),
		library: new Map(),
		roles: new Map(),
		announcements: new Map(),
		expenses: new Map(),
		checklists: new Map(),
		appreciations: new Map(),
		rea_events: new Map(),
		canvases: new Map()
	};

	// Namespace cache by appName so switching between `Holons` and
	// `HolonsDebug` doesn't surface entries from the other graph as fake
	// positives. Uses the shared resolver so the BrowserPanel toggle is
	// honored here too.
	const cacheAppName: string = getEffectiveAppName();
	const presenceCacheKey = (lens: string) => `holons.presence.${cacheAppName}.${lens}`;

	function hydratePresenceCache() {
		if (!browser) return;
		const now = Date.now();
		for (const lens of Object.keys(presenceCache) as LensType[]) {
			try {
				const raw = localStorage.getItem(presenceCacheKey(lens));
				if (!raw) continue;
				const parsed = JSON.parse(raw) as Record<string, [number, 0 | 1]>;
				const map = presenceCache[lens];
				for (const [hex, tuple] of Object.entries(parsed)) {
					if (!Array.isArray(tuple)) continue;
					const [ts, hasNum] = tuple;
					if (typeof ts !== 'number') continue;
					if (now - ts > PRESENCE_CACHE_TTL_MS) continue;
					map.set(hex, { has: hasNum === 1, ts });
				}
			} catch (err) {
				console.warn('[Map] failed to hydrate presence cache for', lens, err);
			}
		}
	}

	// Debounced per-lens persist. Writing the whole blob ~once per fetch batch
	// (rather than per cell) keeps localStorage off the hot path during pan.
	const persistTimers = new Map<LensType, number>();
	function schedulePersistPresence(lens: LensType) {
		if (!browser) return;
		const existing = persistTimers.get(lens);
		if (existing) window.clearTimeout(existing);
		persistTimers.set(
			lens,
			window.setTimeout(() => {
				try {
					const map = presenceCache[lens];
					const out: Record<string, [number, 0 | 1]> = {};
					for (const [hex, entry] of map.entries()) {
						out[hex] = [entry.ts, entry.has ? 1 : 0];
					}
					localStorage.setItem(presenceCacheKey(lens), JSON.stringify(out));
				} catch (err) {
					console.warn('[Map] failed to persist presence cache for', lens, err);
				}
			}, 400)
		);
	}

	// Persist the last-selected lens so a refresh returns to whichever lens
	// the user was on. Scoped by appName so HolonsDebug and Holons keep
	// independent preferences. `lensInitialized` gates the auto-persist
	// reactive block so the very first run (which observes the prop default
	// 'quests' before onMount hydrates) doesn't overwrite the stored value.
	const selectedLensStorageKey = `holons.selectedLens.${cacheAppName}`;
	const VALID_LENSES: ReadonlyArray<LensType> = [
		'quests', 'needs', 'offers', 'communities', 'organizations',
		'projects', 'currencies', 'people', 'holons',
		'events', 'library', 'roles', 'announcements', 'expenses',
		'checklists', 'appreciations', 'rea_events', 'canvases'
	];
	let lensInitialized = false;

	// Lens-filter overlays (driven by the shared Holograms/Federated toggles).
	//
	//  • nativeLensData — cells with NATIVE (non-hologram) content, derived from
	//    live subscriptions. When the Holograms toggle is OFF we render this
	//    instead of lensData so cells lit only by holographic pointers drop out.
	//    (Cold-start caveat: it fills in as live subscriptions confirm cells,
	//    since the persisted presence cache can't tell native from hologram.)
	//  • fedLensData — cells that have content in FEDERATION-LINKED holons,
	//    discovered via getFederated. Folded in only while Federated is ON.
	//  • fedProbed — (lens,hex) pairs already probed federated, so panning
	//    doesn't re-issue the same getFederated call.
	const emptyLensSets = (): Record<LensType, Set<string>> =>
		Object.fromEntries(VALID_LENSES.map((l) => [l, new Set<string>()])) as Record<LensType, Set<string>>;
	let nativeLensData: Record<LensType, Set<string>> = emptyLensSets();
	let fedLensData: Record<LensType, Set<string>> = emptyLensSets();
	const fedProbed: Record<LensType, Set<string>> = emptyLensSets();
	// (lens,hex) pairs we've already revalidated against the DB this session, so
	// panning doesn't re-issue getAll for the same cache-seeded cell repeatedly.
	const revalidated: Record<LensType, Set<string>> = emptyLensSets();

	// Cap per pass so a wide, dense viewport doesn't fire thousands of
	// getFederated round-trips at once. Local presence subscribes to all
	// visible cells, but federated probing is a network read per cell.
	const FED_PROBE_CAP = 512;

	// For each not-yet-probed visible cell, ask whether any federation partner
	// of that cell (as a holon) has content for this lens. A non-empty result
	// lights the cell when the Federated toggle is on.
	async function probeFederatedPresence(lens: LensType, hexes: Set<string>) {
		if (!holosphere || typeof (holosphere as any).getFederated !== 'function') return;
		const probed = fedProbed[lens];
		let issued = 0;
		for (const hex of hexes) {
			if (probed.has(hex)) continue;
			if (issued >= FED_PROBE_CAP) break;
			probed.add(hex);
			issued++;
			try {
				const data = await (holosphere as any).getFederated(hex, lens, {
					includeLocal: false,
					includeFederated: true,
					// Quests need the resolved record to read `status`; other
					// lenses only need a presence count, so skip the resolve cost.
					resolveReferences: lens === 'quests',
					aggregate: false
				});
				// Quests lens: only count federated quests that are open — not
				// completed and not tombstoned — to match the local rule.
				const hasContent = Array.isArray(data) && (
					lens === 'quests'
						? data.some((it: any) => it && it.status !== 'completed' && it._deleted !== true)
						: data.length > 0
				);
				if (hasContent) {
					fedLensData[lens].add(hex);
					if (lens === selectedLens && $showFederated) {
						fedLensData[lens] = fedLensData[lens];
						renderHexes(map, lens);
					}
				}
			} catch {
				// Per-cell federated read failures are non-fatal — just skip.
			}
		}
	}

	// One live `holosphere.subscribe` per visible (lens, hex) cell. The
	// subscription callback fires with `(item, key)` for every existing item
	// AND every future write/delete (item === null), so once a hex is
	// subscribed its presence stays correct without any further `getAll`
	// polling. `itemKeys` tracks the per-hex item set so we know when the
	// hex flips between "empty" and "has content".
	type HexSubscription = {
		unsubscribe: () => void;
		itemKeys: Set<string>;
		// Subset of itemKeys that are NATIVE (locally-authored) items, i.e. not
		// holographic pointers projected in from elsewhere. Lets the "Holograms"
		// toggle hide cells that are lit only by holograms.
		nativeKeys: Set<string>;
	};
	let subscriptions: Record<LensType, Map<string, HexSubscription>> = {
		quests: new Map(),
		needs: new Map(),
		offers: new Map(),
		communities: new Map(),
		organizations: new Map(),
		projects: new Map(),
		currencies: new Map(),
		people: new Map(),
		holons: new Map(),
		events: new Map(),
		library: new Map(),
		roles: new Map(),
		announcements: new Map(),
		expenses: new Map(),
		checklists: new Map(),
		appreciations: new Map(),
		rea_events: new Map(),
		canvases: new Map()
	};

	// Apply one item's contribution to a hex's presence sets, then repaint if
	// the cell's (native) presence flipped. `isOpen=false` removes the key —
	// used for completed quests so a cell un-lights when its last open quest is
	// done. Null emissions (deletes) never reach here (filtered upstream),
	// so non-quest presence stays monotonic; only explicit completion removes.
	function applyPresence(
		lens: LensType,
		hex: string,
		key: string,
		isHologram: boolean,
		isOpen: boolean,
		itemKeys: Set<string>,
		nativeKeys: Set<string>
	) {
		const had = itemKeys.size > 0;
		const hadNative = nativeKeys.size > 0;
		if (isOpen) {
			itemKeys.add(key);
			// A holographic item carries `_hologram.isHologram` — same flag the
			// lens views gate on (see passesLensFilters). Everything else counts
			// as native content authored at this cell.
			if (!isHologram) nativeKeys.add(key);
		} else {
			itemKeys.delete(key);
			nativeKeys.delete(key);
		}
		const has = itemKeys.size > 0;
		const hasNative = nativeKeys.size > 0;

		// Bump the cache timestamp on every emit so the entry stays warm.
		presenceCache[lens].set(hex, { has, ts: Date.now() });
		schedulePersistPresence(lens);

		if (lens === selectedLens && (had !== has || hadNative !== hasNative)) {
			if (has) lensData[lens].add(hex); else lensData[lens].delete(hex);
			if (hasNative) nativeLensData[lens].add(hex); else nativeLensData[lens].delete(hex);
			lensData[lens] = lensData[lens]; // Svelte reactivity poke
			nativeLensData[lens] = nativeLensData[lens];
			renderHexes(map, lens);
		}
	}

	// Sentinel distinguishing a timed-out cold read from a genuine null.
	const QUEST_READ_TIMEOUT = Symbol('quest-read-timeout');

	// Authoritative, sanitized check of a quest's presence at a cell. `get`
	// resolves the upcast hologram pointer to its origin AND filters tombstones
	// by default, so this is the single source of truth for "should this cell
	// be lit for this quest". Wrapped in a timeout because cold relay reads for
	// not-yet-replicated keys never fire.
	//   'hide'    → completed, or gone (deleted / tombstoned origin)
	//   'show'    → confirmed open
	//   'unknown' → couldn't confirm (timed out) → leave as-is
	async function resolveQuestPresence(hex: string, key: string): Promise<'hide' | 'show' | 'unknown'> {
		try {
			const rec: any = await Promise.race([
				// resolveHolograms: follow the upcast pointer to its origin so we
				// read the real status (no-op if get already resolves by default).
				// Tombstones are filtered (includeDeleted defaults false) → null.
				(holosphere as any).get(hex, 'quests', key, null, { resolveHolograms: true }),
				new Promise((res) => window.setTimeout(() => res(QUEST_READ_TIMEOUT), 4000))
			]);
			if (rec === QUEST_READ_TIMEOUT) return 'unknown';
			if (rec == null) return 'hide';
			if (rec.status === 'completed' || rec._deleted === true) return 'hide';
			return 'show';
		} catch {
			return 'unknown';
		}
	}

	// Drop a cell's presence entirely: remove it from the rendered sets and
	// mark the persisted cache not-lit, so a stale positive can't resurrect it.
	// The live subscription's view is reset too, so a genuine future write can
	// still re-light the cell cleanly.
	function purgeHex(lens: LensType, hex: string) {
		const wasLit = lensData[lens].delete(hex);
		nativeLensData[lens].delete(hex);
		presenceCache[lens].set(hex, { has: false, ts: Date.now() });
		schedulePersistPresence(lens);
		const sub = subscriptions[lens].get(hex);
		if (sub) { sub.itemKeys.clear(); sub.nativeKeys.clear(); }
		if (wasLit && lens === selectedLens) {
			lensData[lens] = lensData[lens];
			nativeLensData[lens] = nativeLensData[lens];
			renderHexes(map, lens);
		}
	}

	// Revalidate a cell that is lit ONLY from the persisted cache (no live items
	// observed this session). Direct-DB or remote deletes/completions emit
	// nothing through `subscribe`, so a stale cached positive would otherwise
	// keep the cell lit until the 7-day TTL. We read the authoritative,
	// tombstone-filtered set and purge cells with no ACTIVE content. A false
	// purge (cold read) self-heals: the still-active subscription re-lights the
	// cell when real data finally arrives.
	async function revalidateCachedHex(lens: LensType, hex: string) {
		try {
			const items: any[] = await (holosphere as any).getAll(hex, lens);
			// The subscription may have delivered real items while we read — if
			// so, trust the live channel and don't purge.
			if ((subscriptions[lens].get(hex)?.itemKeys.size ?? 0) > 0) return;

			let active = Array.isArray(items) && items.length > 0;
			if (active && lens === 'quests') {
				// getAll already drops tombstones; also drop completed quests,
				// resolving pointers that carry no inline status.
				const verdicts = await Promise.all(
					items.map((it: any) =>
						typeof it?.status === 'string'
							? Promise.resolve(it.status !== 'completed' && it._deleted !== true)
							: resolveQuestPresence(hex, String(it?.id ?? it?.key ?? '')).then((v) => v !== 'hide')
					)
				);
				active = verdicts.some(Boolean);
			}
			if (!active) purgeHex(lens, hex);
		} catch {
			// leave as-is on read failure
		}
	}

	function subscribeHex(lens: LensType, hex: string) {
		const subs = subscriptions[lens];
		if (subs.has(hex) || !holosphere) return;

		const itemKeys = new Set<string>();
		const nativeKeys = new Set<string>();
		const handle = (holosphere as any).subscribe(hex, lens, (item: any, key?: string) => {
			if (!key || key === '_') return;
			const isHologram = item?._hologram?.isHologram === true;

			if (lens === 'quests') {
				// Quests get sanitized: completed AND deleted/tombstoned must not
				// light a cell. The emitted item can lag the origin (a stale-open
				// upcast pointer over a completed/deleted source) or be a null
				// (a delete), so we never trust it alone.
				if (item != null) {
					// Optimistic: light immediately on inline-open so a freshly
					// published task appears without waiting on a cold read. Hide
					// at once if the record itself says completed/deleted.
					const hideNow = item._deleted === true || item.status === 'completed';
					applyPresence('quests', hex, key, isHologram, !hideNow, itemKeys, nativeKeys);
					if (hideNow) return;
				}
				// Reconcile against the authoritative, tombstone-filtered read.
				// Acts only on a definite verdict, so transient nulls don't
				// cause flicker and a fresh task stays lit until truly resolved.
				void resolveQuestPresence(hex, key).then((verdict) => {
					if (verdict === 'unknown') return;
					if (subscriptions.quests.get(hex)?.itemKeys !== itemKeys) return;
					applyPresence('quests', hex, key, false, verdict === 'show', itemKeys, nativeKeys);
				});
				return;
			}

			// Non-quest lenses: ignore nulls (delete emissions) and
			// count any item — presence here is just "does this cell contain
			// anything for this lens".
			if (item == null) return;
			applyPresence(lens, hex, key, isHologram, true, itemKeys, nativeKeys);
		});

		const unsubscribe =
			handle && typeof handle.unsubscribe === 'function'
				? () => handle.unsubscribe()
				: () => {};

		subs.set(hex, { unsubscribe, itemKeys, nativeKeys });
	}

	function unsubscribeHex(lens: LensType, hex: string) {
		const sub = subscriptions[lens].get(hex);
		if (!sub) return;
		try { sub.unsubscribe(); } catch (e) {
			console.warn('[Map] unsubscribe failed', lens, hex, e);
		}
		subscriptions[lens].delete(hex);
	}

	function unsubscribeAllForLens(lens: LensType) {
		const subs = subscriptions[lens];
		for (const sub of subs.values()) {
			try { sub.unsubscribe(); } catch {}
		}
		subs.clear();
	}

	function unsubscribeAll() {
		for (const lens of Object.keys(subscriptions) as LensType[]) {
			unsubscribeAllForLens(lens);
		}
	}

	const lensOptions: LensOption[] = [
		{ value: 'quests', label: 'Tasks' },
		{ value: 'needs', label: 'Local Needs' },
		{ value: 'offers', label: 'Offers' },
		{ value: 'communities', label: 'Communities' },
		{ value: 'organizations', label: 'Organizations' },
		{ value: 'projects', label: 'Projects' },
		{ value: 'currencies', label: 'Currencies' },
		{ value: 'people', label: 'People' },
		{ value: 'holons', label: 'Holons' },
		{ value: 'events', label: 'Events' },
		{ value: 'library', label: 'Library' },
		{ value: 'roles', label: 'Roles' },
		{ value: 'announcements', label: 'Announcements' },
		{ value: 'expenses', label: 'Expenses' },
		{ value: 'checklists', label: 'Checklists' },
		{ value: 'appreciations', label: 'Appreciations' },
		{ value: 'rea_events', label: 'REA Events' },
		{ value: 'canvases', label: 'Canvases' }
	];

	const dispatch = createEventDispatcher();

	// Movement-state plumbing for the move/zoom debounce.
	let moveTimeout: number;
	let initTimeout: number; // Track initialization timeout to clean up on unmount
	let navigationTimeout: number; // Track navigation timeout for cleanup
	let isMoving = false;
	
	// Clear any existing timeout
	function clearMoveTimeout() {
		if (moveTimeout) {
			window.clearTimeout(moveTimeout);
			moveTimeout = 0;
		}
	}

	// Clear initialization timeout
	function clearInitTimeout() {
		if (initTimeout) {
			window.clearTimeout(initTimeout);
			initTimeout = 0;
		}
	}

	// Clear navigation timeout
	function clearNavigationTimeout() {
		if (navigationTimeout) {
			window.clearTimeout(navigationTimeout);
			navigationTimeout = 0;
		}
	}

	// Schedule initialization with proper cleanup
	function scheduleInitialization() {
		clearInitTimeout();
		initTimeout = window.setTimeout(initializeMap, 100);
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
			case 'events':
				highlightedHexes = lensData.events;
				highlightColor = '#fbc02d';
				break;
			case 'library':
				highlightedHexes = lensData.library;
				highlightColor = '#00bcd4';
				break;
			case 'roles':
				highlightedHexes = lensData.roles;
				highlightColor = '#795548';
				break;
			case 'announcements':
				highlightedHexes = lensData.announcements;
				highlightColor = '#ffc107';
				break;
			case 'expenses':
				highlightedHexes = lensData.expenses;
				highlightColor = '#8bc34a';
				break;
			case 'checklists':
				highlightedHexes = lensData.checklists;
				highlightColor = '#009688';
				break;
			case 'appreciations':
				highlightedHexes = lensData.appreciations;
				highlightColor = '#f06292';
				break;
			case 'rea_events':
				highlightedHexes = lensData.rea_events;
				highlightColor = '#673ab7';
				break;
			case 'canvases':
				highlightedHexes = lensData.canvases;
				highlightColor = '#455a64';
				break;
		}

		// Apply the shared lens-filter toggles. Holograms OFF → only cells with
		// native content (drop hologram-only cells). Federated ON → also light
		// cells that have content in federation-linked holons. The color picked
		// by the switch above is preserved.
		const lensKey = lens as LensType;
		highlightedHexes = new Set($showHolograms ? lensData[lensKey] : nativeLensData[lensKey]);
		if ($showFederated) {
			for (const hex of fedLensData[lensKey]) highlightedHexes.add(hex);
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

	// Persist the lens whenever the user changes it. Gated on
	// `lensInitialized` so the prop's initial default (observed before
	// onMount hydrates from storage) doesn't blow away the saved value.
	$: if (browser && lensInitialized && selectedLens) {
		try {
			localStorage.setItem(selectedLensStorageKey, selectedLens);
		} catch (err) {
			console.warn('[Map] failed to persist selected lens:', err);
		}
	}

	// Lens switch: tear down the previous lens's subscriptions (we don't
	// need real-time updates on lenses the user isn't looking at), seed the
	// new lens from cache for instant visual feedback, then let
	// fetchLensData reconcile new subscriptions on the visible viewport.
	let previousSubscribedLens: LensType | undefined;
	$: if (map && selectedLens) {

		// Clear only the highlighted hexagons visually
		map.getSource("highlighted-hexagons")?.setData({
			type: "FeatureCollection",
			features: []
		});

		// Drop the previous lens's live subscriptions. Cache stays intact so
		// switching back is instant.
		if (previousSubscribedLens && previousSubscribedLens !== selectedLens) {
			unsubscribeAllForLens(previousSubscribedLens);
		}
		previousSubscribedLens = selectedLens;

		// Reconcile subscriptions for the new lens. Small delay so the
		// previous lens's unsubscribe calls flush before we attach the
		// new ones. fetchLensData itself does the cache-seed + render so we
		// don't duplicate that work here.
		clearMoveTimeout();
		moveTimeout = window.setTimeout(() => {
			fetchLensData(selectedLens);
		}, 100);
	}

	// Enumerate the H3 cells covering the visible viewport at the given
	// resolution. Special-cased at res 0 (only 122 cells globally) so we don't
	// pay the cost of polygonToCells for the whole sphere — we just take the
	// res-0 set and keep the ones whose center falls inside the viewport,
	// plus a small ring so partially-visible cells aren't lost.
	function enumerateVisibleHexes(
		bounds: mapboxgl.LngLatBounds,
		resolution: number
	): Set<string> {
		const result = new Set<string>();
		const west = bounds.getWest();
		const east = bounds.getEast();
		const south = bounds.getSouth();
		const north = bounds.getNorth();

		// Globe view: 122 cells globally — cheap to enumerate, then filter.
		if (resolution === 0) {
			for (const cell of h3.getRes0Cells()) {
				const [lat, lng] = h3.cellToLatLng(cell);
				// Wrap lng comparisons across the antimeridian. We accept the
				// occasional "near the edge" cell that doesn't actually touch
				// the viewport — they'll just resolve to empty content and
				// won't render.
				const latIn = lat >= south && lat <= north;
				let lngIn: boolean;
				if (west <= east) {
					lngIn = lng >= west && lng <= east;
				} else {
					// Viewport crosses the antimeridian.
					lngIn = lng >= west || lng <= east;
				}
				if (latIn && lngIn) result.add(cell);
			}
			return result;
		}

		// Higher resolutions: use polygonToCells on the viewport rectangle.
		// h3-js wants [lat, lng] pairs by default (isGeoJson=false). Split the
		// polygon at the antimeridian when the viewport crosses it so each
		// piece is well-formed.
		const polygons: number[][][] = [];
		if (west <= east) {
			polygons.push([
				[south, west],
				[south, east],
				[north, east],
				[north, west],
				[south, west]
			]);
		} else {
			polygons.push([
				[south, west],
				[south, 180],
				[north, 180],
				[north, west],
				[south, west]
			]);
			polygons.push([
				[south, -180],
				[south, east],
				[north, east],
				[north, -180],
				[south, -180]
			]);
		}

		for (const poly of polygons) {
			try {
				const cells = h3.polygonToCells(poly, resolution, false);
				for (const cell of cells) result.add(cell);
			} catch (err) {
				console.warn('[Map] polygonToCells failed at res', resolution, err);
			}
		}

		return result;
	}

	// Reconcile live `holosphere.subscribe` listeners against the current
	// viewport. Newly-visible hexes get a fresh subscription; hexes no longer
	// in view get unsubscribed (their cache entry survives, so panning back
	// paints instantly).
	//
	// `lensData[lens]` is MONOTONIC — once a hex is highlighted it stays in
	// the set across all pan/zoom until the lens changes or the component
	// unmounts. `renderHexes` filters by `currentResolution <= hexResolution`
	// at draw time so out-of-resolution hexes simply aren't painted; they
	// remain in the set so zooming back to their level shows them instantly
	// without waiting for any (re)subscription. Subscriptions then populate
	// new positives as they arrive, but never remove anything from lensData.
	function fetchLensData(lens: string) {
		clearMoveTimeout();

		const bounds = map.getBounds();
		if (!bounds) return;

		const currentLens = lens as LensType;
		const h3res = getResolution(map.getZoom());

		// Enumerate every visible cell at the current resolution. Because
		// auto-propagation writes hologram pointers up the parent chain on
		// each underlying `put`, presence resolves at the visible cell at
		// *any* zoom level — we never need to subscribe to deeper-resolution
		// children to know "this big cell contains something."
		const visible = enumerateVisibleHexes(bounds, h3res);
		const cacheForLens = presenceCache[currentLens];

		// Fold EVERY known positive in this lens's cache into lensData (not
		// just the cells currently in view). Set semantics drop duplicates,
		// renderHexes filters by resolution at draw time, and lensData is
		// monotonic — so a cell discovered in a previous session or at a
		// previous zoom level remains highlighted forever (until lens change
		// or component unmount). New positives can still arrive via the
		// subscribe callback once the store delivers their items.
		let lensDataChanged = false;
		for (const [hex, entry] of cacheForLens.entries()) {
			if (entry.has && !lensData[currentLens].has(hex)) {
				lensData[currentLens].add(hex);
				lensDataChanged = true;
			}
		}
		if (currentLens === selectedLens) {
			if (lensDataChanged) lensData[currentLens] = lensData[currentLens];
			renderHexes(map, currentLens);
		}

		// Subscribe to newly-visible hexes.
		const subs = subscriptions[currentLens];
		for (const hex of visible) {
			if (!subs.has(hex)) subscribeHex(currentLens, hex);
		}

		// Unsubscribe hexes that have scrolled out of view. The cache + the
		// monotonic lensData keep their last-known presence so panning back
		// paints instantly while resubscribe re-establishes the live channel.
		for (const hex of Array.from(subs.keys())) {
			if (!visible.has(hex)) unsubscribeHex(currentLens, hex);
		}

		// Revalidate visible cells lit only from the cache (no live items yet),
		// once per session each. Clears positives left behind by deletes or
		// completions that never emitted to this client (direct-DB / remote).
		const seen = revalidated[currentLens];
		for (const hex of visible) {
			if (!lensData[currentLens].has(hex) || seen.has(hex)) continue;
			if ((subs.get(hex)?.itemKeys.size ?? 0) > 0) continue;
			seen.add(hex);
			void revalidateCachedHex(currentLens, hex);
		}

		// Federated presence overlay: probe the freshly-visible cells for
		// federation-partner content when the toggle is on.
		if ($showFederated) void probeFederatedPresence(currentLens, visible);
	}

	// Re-render (and, for Federated, probe the current viewport) whenever the
	// user flips a lens-filter toggle. Reads both stores so Svelte tracks them
	// as dependencies.
	$: {
		const _holograms = $showHolograms;
		const _federated = $showFederated;
		if (map && selectedLens) {
			if (_federated && typeof map.getBounds === 'function') {
				const b = map.getBounds();
				if (b) {
					void probeFederatedPresence(
						selectedLens,
						enumerateVisibleHexes(b, getResolution(map.getZoom()))
					);
				}
			}
			renderHexes(map, selectedLens);
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
			scheduleInitialization();
			return;
		}

		const accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? '';
		if (!accessToken || accessToken.length < 50) {
			console.error('[Map] VITE_MAPBOX_TOKEN is missing or invalid');
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
				
				// Now that sources are ready, render initial hexes. Seed
				// lensData from the hydrated presence cache so the very first
				// paint already shows last-known highlights before
				// fetchLensData even fires.
				if (selectedLens) {
					const seeded = new Set<string>();
					for (const [hex, entry] of presenceCache[selectedLens].entries()) {
						if (entry.has) seeded.add(hex);
					}
					lensData[selectedLens] = seeded;
					renderHexes(map, selectedLens);
				}
			} catch (e) {
				console.error('[Map] Error cleaning up existing sources/layers:', e);
			}
		});

		map.on("load", () => {
			// Reconcile subscriptions on first paint. Short delay so the map
			// has finalized its bounds, then we subscribe to everything in
			// view at the current resolution.
			clearMoveTimeout();
			moveTimeout = window.setTimeout(() => {
				if (selectedLens) fetchLensData(selectedLens);
			}, 100);

			// Search box is rendered via <PlacesSearch> in the control bar —
			// no Mapbox geocoder to attach here. The Google Places SDK is
			// loaded lazily by that component on first mount.

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
			isMoving = false;

			// Tight debounce — just enough that successive moveends from a
			// single pan gesture coalesce into one reconciliation. Subscribe/unsubscribe
			// is cheap so we don't need the long delay the old getAll path
			// needed.
			clearMoveTimeout();
			moveTimeout = window.setTimeout(() => {
				if (selectedLens) fetchLensData(selectedLens);
			}, 200);

			// Repaint immediately from cached lensData for instant feedback.
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
			// Restore the last-selected lens. Doing this before
			// `hydratePresenceCache` doesn't matter for correctness — both
			// lenses' caches hydrate — but it does mean the very first paint
			// after mount already reflects the user's lens choice.
			try {
				const stored = localStorage.getItem(selectedLensStorageKey);
				if (stored && (VALID_LENSES as readonly string[]).includes(stored)) {
					selectedLens = stored as LensType;
				}
			} catch (err) {
				console.warn('[Map] failed to restore selected lens:', err);
			}
			lensInitialized = true;

			// Pull the persisted (appName, lens, hex) presence rows BEFORE the
			// map starts asking holosphere for content. Hydrating first means
			// the very first `renderHexes` already has positives to draw, so
			// refreshes show the last-known highlights instantly instead of
			// waiting for the relay round-trip.
			hydratePresenceCache();

			// Add global mouse move and up listeners (only when in browser)
			window.addEventListener('mousemove', handleDrag);
			window.addEventListener('mouseup', handleDragEnd);

			// Add resize listener to ensure sidebar stays visible
			window.addEventListener('resize', adjustSidebarPosition);

			// Catch `open-link-in-map-window` events bubbling up from any
			// link rendered under this Map (e.g. RichDescription anchors in
			// MapSidebar) and route them to the in-map browser window.
			window.addEventListener('open-link-in-map-window', handleOpenLinkInMapWindow);

			// Add a small delay to ensure container is properly sized
			scheduleInitialization();
		}

		return () => {
			// Clean up event listeners
			window.removeEventListener('mousemove', handleDrag);
			window.removeEventListener('mouseup', handleDragEnd);
			window.removeEventListener('resize', adjustSidebarPosition);
			window.removeEventListener('open-link-in-map-window', handleOpenLinkInMapWindow);
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
					clearNavigationTimeout();
					navigationTimeout = window.setTimeout(() => {
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
			scheduleInitialization();
		}
	} else if (mapInitialized) {
		// Clean up map when becoming invisible
		performFinalCleanup();
	}

	// Comprehensive cleanup function
	function performFinalCleanup() {
		// Make sure all timeouts are cleared
		clearMoveTimeout();
		clearInitTimeout();
		clearNavigationTimeout();

	// Reset movement state
	isMoving = false;
	
	// Create a fresh map to ensure no references remain
	holoSubscriptions = new Map();

	// Tear down every live `holosphere.subscribe` so we don't leak store
	// listeners when the map hides / unmounts. The persistent
	// presenceCache survives — it's our fast-path for re-mount.
	unsubscribeAll();
	previousSubscribedLens = undefined;

	// Clear render-side state. Keep `presenceCache` populated — it's our
	// fast-path for re-mount (visibility toggle, hot reload) and a wipe
	// here would force every cell to round-trip through the relay again.
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
	></div>

	<!-- hex-info lives as a sibling of the Mapbox container (not a child)
	     because mapboxgl warns when its host element has children. Absolute
	     positioning still pins it to the bottom-left of the wrapper. -->
	{#if hexId}
		<div class="hex-info">Selected Hexagon: {hexId}</div>
	{/if}

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

			<!-- Place search (Google Places Autocomplete) -->
			<div class="geocoder-container-embedded">
				<PlacesSearch placeholder="Search location…" on:result={handlePlaceResult} />
			</div>

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

			<!-- Divider -->
			<div class="control-divider"></div>

			<!-- Lens-filter toggles — same Holograms/Federated model as the lens
			     views. Holograms gates hologram-only cells; Federated lights
			     cells with content in federation-linked holons. -->
			<div class="lens-toggles-embedded">
				<ToggleChip
					checked={$showHolograms}
					label="Holograms"
					icon={Eye}
					tooltip="Holograms: include cells lit only by holographic pointers projected in from elsewhere. Off → show only cells with native content authored here."
					on:change={(e) => showHolograms.set(e.detail)}
				/>
				<ToggleChip
					checked={$showFederated}
					label="Federated"
					icon={Globe}
					tooltip="Federated: also light cells that have content in the holons this map's cells are federated with — not just the local graph. Off by default."
					on:change={(e) => showFederated.set(e.detail)}
				/>
			</div>

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
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #fbc02d;"></span>
						<div>
							<strong>Events</strong>
							<span class="lens-desc">Scheduled gatherings</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #00bcd4;"></span>
						<div>
							<strong>Library</strong>
							<span class="lens-desc">Shared tools & books</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #795548;"></span>
						<div>
							<strong>Roles</strong>
							<span class="lens-desc">Holon responsibilities</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #ffc107;"></span>
						<div>
							<strong>Announcements</strong>
							<span class="lens-desc">Local broadcasts</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #8bc34a;"></span>
						<div>
							<strong>Expenses</strong>
							<span class="lens-desc">Shared costs</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #009688;"></span>
						<div>
							<strong>Checklists</strong>
							<span class="lens-desc">Shared lists</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #f06292;"></span>
						<div>
							<strong>Appreciations</strong>
							<span class="lens-desc">Peer thanks & credit</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #673ab7;"></span>
						<div>
							<strong>REA Events</strong>
							<span class="lens-desc">Resource flows</span>
						</div>
					</div>
					<div class="lens-option-item">
						<span class="lens-dot" style="background-color: #455a64;"></span>
						<div>
							<strong>Canvases</strong>
							<span class="lens-desc">Visual whiteboards</span>
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

	<!-- In-map draggable browser. Visible whenever `browserUrl` is set;
	     RichDescription anchor clicks set it via the
	     `open-link-in-map-window` event handler registered in onMount. -->
	<MapBrowserWindow bind:url={browserUrl} bind:title={browserTitle} />
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
		color: var(--color-text-primary);
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
		background-color: var(--color-bg-secondary);
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
		background-color: var(--color-bg-primary);
		border-bottom: 1px solid var(--color-bg-tertiary);
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

	.lens-toggles-embedded {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
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
		color: var(--color-text-muted);
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
		color: var(--color-text-muted);
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

		.location-button-embedded {
			order: 2;
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

	/* Slot the place-search component into the control bar at flex:1 so it
	   fills the available width between the lens selector and the geolocate
	   button. <PlacesSearch> owns its own input styling. */
	.geocoder-container-embedded {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
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

	/* ==========================================================================
	   Whiteboard skin overrides
	   --------------------------------------------------------------------------
	   The control bar, info tooltip and Mapbox native controls are hardcoded
	   dark glass (gradients + white borders), so they stay dark on the light
	   map. Repaint them as light paper under the whiteboard scope. Accent
	   (blue) icon colours read fine on the light surface and are left as-is.
	   ========================================================================== */
	:global(html[data-skin="whiteboard"]) .control-bar-inner {
		background: linear-gradient(135deg, rgba(251, 248, 240, 0.96) 0%, rgba(243, 239, 228, 0.94) 100%);
		border-color: rgba(32, 48, 47, 0.12);
		box-shadow:
			0 10px 40px rgba(32, 48, 47, 0.15),
			0 4px 12px rgba(32, 48, 47, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.7);
	}
	:global(html[data-skin="whiteboard"]) .control-bar-inner:hover {
		box-shadow:
			0 12px 50px rgba(32, 48, 47, 0.2),
			0 6px 16px rgba(32, 48, 47, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}
	:global(html[data-skin="whiteboard"]) .lens-select-embedded {
		background-color: rgba(236, 231, 216, 0.85);
		color: var(--color-text-primary);
		border-color: rgba(32, 48, 47, 0.15);
	}
	:global(html[data-skin="whiteboard"]) .lens-select-embedded:hover {
		background-color: rgba(236, 231, 216, 1);
	}
	:global(html[data-skin="whiteboard"]) .control-divider {
		background: linear-gradient(to bottom, rgba(32, 48, 47, 0), rgba(32, 48, 47, 0.18), rgba(32, 48, 47, 0));
	}
	:global(html[data-skin="whiteboard"]) .info-tooltip-embedded,
	:global(html[data-skin="whiteboard"]) .info-tooltip-embedded::before {
		background: linear-gradient(135deg, rgba(251, 248, 240, 0.99) 0%, rgba(243, 239, 228, 0.97) 100%);
		border-color: rgba(32, 48, 47, 0.12);
		color: var(--color-text-primary);
	}
	:global(html[data-skin="whiteboard"]) .info-tooltip-embedded {
		box-shadow:
			0 20px 60px rgba(32, 48, 47, 0.2),
			0 10px 30px rgba(32, 48, 47, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.7);
	}
	:global(html[data-skin="whiteboard"]) .tooltip-header h3 {
		color: var(--color-text-primary);
	}
	:global(html[data-skin="whiteboard"]) .lens-option-item {
		background: rgba(236, 231, 216, 0.6);
		border-color: rgba(32, 48, 47, 0.08);
	}

	/* Mapbox native zoom/geolocate group: light glass + dark (un-inverted) icons.
	   The mapbox classes are global, so the whole selector goes inside :global(). */
	:global(html[data-skin="whiteboard"] .mapboxgl-ctrl-group) {
		background: rgba(251, 248, 240, 0.96) !important;
		border-color: rgba(32, 48, 47, 0.12) !important;
	}
	:global(html[data-skin="whiteboard"] .mapboxgl-ctrl-group > button:hover) {
		background: rgba(236, 231, 216, 1) !important;
	}
	:global(html[data-skin="whiteboard"] .mapboxgl-ctrl-icon) {
		filter: none !important;
	}
</style>









