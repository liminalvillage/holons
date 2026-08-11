<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Claim-your-cell overlay on the real map, ported from wequest's HexPicker.
  // Mapbox basemap (shared root-.env VITE_MAPBOX_TOKEN), H3 grid overlay that
  // follows the zoom, tap to pick the cell — persisted as the holon's
  // `settings.hex`, the exact field the dashboard and wequest pickers write.
  // mapbox-gl (~1.9 MB) loads lazily only when the picker opens.
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import {
    isValidCell,
    latLngToCell,
    cellToLatLng,
    cellToBoundary,
    getResolution,
    polygonToCells,
  } from "h3-js";
  import { showNotice } from "$lib/stores";
  import { getHolosphere, getWriter } from "$lib/holosphere";

  /** The holon whose `settings.hex` is being claimed. */
  export let holonId: string;
  /** The currently claimed cell, if any (picker opens centred on it). */
  export let current: string | null = null;

  const dispatch = createEventDispatcher<{ close: void; saved: string }>();

  const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? "";
  const DEFAULT_RES = 9; // ~350 m across — "your block"

  let mapContainer: HTMLDivElement | null = null;
  let map: any = null;
  let mapReady = false;
  let resolution = DEFAULT_RES;
  let selected: string | null = null;
  let manual = "";
  let saving = false;
  let locating = false;
  let alive = true;
  let resizeObserver: ResizeObserver | null = null;

  // Zoom ↔ resolution bands, mirroring the dashboard picker / wequest so the
  // grid lines up cell-for-cell across every surface.
  function resolutionToZoom(res: number): number {
    const zooms: Record<number, number> = {
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
      12: 18,
    };
    return zooms[res] ?? 15;
  }
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
      [19.5, 12],
    ];
    for (const [z, r] of bands) if (zoom <= z) return r;
    return 12;
  }

  onMount(() => {
    selected = current && isValidCell(current) ? current : null;
    if (selected) resolution = getResolution(selected);
    else locate();
    if (MAPBOX_TOKEN) void initMap();
  });

  async function initMap() {
    try {
      const [{ default: mapboxgl }] = await Promise.all([
        import("mapbox-gl"),
        import("mapbox-gl/dist/mapbox-gl.css"),
      ]);
      if (!alive || !mapContainer) return;
      mapboxgl.accessToken = MAPBOX_TOKEN;

      let center: [number, number] = [11.3426, 44.4949]; // Bologna fallback
      if (selected) {
        const [lat, lng] = cellToLatLng(selected);
        center = [lng, lat];
      }

      map = new mapboxgl.Map({
        container: mapContainer,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center,
        zoom: resolutionToZoom(resolution),
        attributionControl: false,
      });
      map.addControl(
        new mapboxgl.NavigationControl({ showCompass: false }),
        "top-right",
      );

      map.on("load", () => {
        if (!map) return;
        map.addSource("kiosk-grid", { type: "geojson", data: emptyFC() });
        map.addLayer({
          id: "kiosk-grid-line",
          type: "line",
          source: "kiosk-grid",
          paint: {
            "line-color": "#ffffff",
            "line-width": 1,
            "line-opacity": 0.45,
          },
        });
        map.addSource("kiosk-selected", { type: "geojson", data: emptyFC() });
        map.addLayer({
          id: "kiosk-selected-fill",
          type: "fill",
          source: "kiosk-selected",
          paint: { "fill-color": "#0e6b66", "fill-opacity": 0.45 },
        });
        map.addLayer({
          id: "kiosk-selected-line",
          type: "line",
          source: "kiosk-selected",
          paint: { "line-color": "#ffffff", "line-width": 2 },
        });
        mapReady = true;
        rebuildGrid();
        rebuildHighlight();
      });

      map.on("moveend", rebuildGrid);
      map.on("zoomend", () => {
        const newRes = zoomToResolution(map.getZoom());
        if (newRes !== resolution) {
          resolution = newRes;
          if (selected) {
            const [lat, lng] = cellToLatLng(selected);
            selected = latLngToCell(lat, lng, resolution);
          }
        }
        rebuildGrid();
        rebuildHighlight();
      });
      map.on("click", (e: any) => {
        selected = latLngToCell(e.lngLat.lat, e.lngLat.lng, resolution);
        rebuildHighlight();
      });

      // The overlay animates in; keep the canvas sized to the real container.
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          try {
            map?.resize();
          } catch {}
        });
        resizeObserver.observe(mapContainer);
      }
      requestAnimationFrame(() => {
        try {
          map?.resize();
        } catch {}
      });
    } catch (err) {
      console.warn(
        "[HexPicker] mapbox unavailable, falling back to manual entry",
        err,
      );
    }
  }

  function emptyFC(): any {
    return { type: "FeatureCollection", features: [] };
  }

  function cellRing(cell: string): number[][] {
    const ring = (cellToBoundary(cell, true) as Array<[number, number]>).map(
      ([lng, lat]) => [lng, lat],
    );
    ring.push(ring[0]);
    return ring;
  }

  function rebuildHighlight() {
    if (!map || !mapReady) return;
    const src = map.getSource("kiosk-selected");
    if (!src) return;
    src.setData(
      selected
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "Polygon",
                  coordinates: [cellRing(selected)],
                },
              },
            ],
          }
        : emptyFC(),
    );
  }

  function rebuildGrid() {
    if (!map || !mapReady) return;
    const src = map.getSource("kiosk-grid");
    const bounds = map.getBounds();
    if (!src || !bounds) return;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    let cells: string[] = [];
    try {
      cells = polygonToCells(
        [
          [ne.lat, sw.lng],
          [ne.lat, ne.lng],
          [sw.lat, ne.lng],
          [sw.lat, sw.lng],
          [ne.lat, sw.lng],
        ],
        resolution,
      );
    } catch {
      cells = [];
    }
    if (cells.length > 3000) {
      src.setData(emptyFC());
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: cells.map((c) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [cellRing(c)] },
      })),
    });
  }

  // ── address search (Mapbox Geocoding API, same token as the basemap) ──
  interface PlaceHit {
    label: string;
    lat: number;
    lng: number;
  }
  let searchQuery = "";
  let searchHits: PlaceHit[] = [];
  let searching = false;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  function onSearchInput() {
    clearTimeout(searchTimer);
    const q = searchQuery.trim();
    if (q.length < 3) {
      searchHits = [];
      return;
    }
    searchTimer = setTimeout(() => void searchPlaces(q), 300);
  }

  async function searchPlaces(q: string) {
    if (!MAPBOX_TOKEN) return;
    searching = true;
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=5&types=address,poi,place,locality,neighborhood`,
      );
      const data = await res.json();
      if (searchQuery.trim() !== q) return; // stale response
      searchHits = (data?.features ?? []).map((f: any) => ({
        label: f.place_name as string,
        lng: f.center?.[0],
        lat: f.center?.[1],
      }));
    } catch {
      searchHits = [];
    } finally {
      searching = false;
    }
  }

  function pickPlace(hit: PlaceHit) {
    searchHits = [];
    searchQuery = hit.label;
    selected = latLngToCell(hit.lat, hit.lng, resolution);
    if (map) {
      map.flyTo({
        center: [hit.lng, hit.lat],
        zoom: Math.max(map.getZoom(), resolutionToZoom(resolution)),
        essential: true,
      });
    }
    rebuildHighlight();
  }

  function locate() {
    if (!navigator.geolocation) {
      showNotice(
        "No geolocation on this device — tap the map or paste a cell id.",
      );
      return;
    }
    locating = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locating = false;
        const { latitude: lat, longitude: lng } = pos.coords;
        selected = latLngToCell(lat, lng, resolution);
        if (map) {
          map.flyTo({
            center: [lng, lat],
            zoom: resolutionToZoom(resolution),
            essential: true,
          });
        }
        rebuildHighlight();
      },
      () => {
        locating = false;
        showNotice("Location denied — tap the map or paste a cell id.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function useManual() {
    const cell = manual.trim().toLowerCase();
    if (!isValidCell(cell)) {
      showNotice("That's not a valid H3 cell id.");
      return;
    }
    selected = cell;
    resolution = getResolution(cell);
    if (map) {
      const [lat, lng] = cellToLatLng(cell);
      map.flyTo({
        center: [lng, lat],
        zoom: resolutionToZoom(resolution),
        essential: true,
      });
    }
    rebuildHighlight();
  }

  /**
   * Persist the pick as `settings.hex` — merged over the existing settings doc
   * so name/federation/etc. survive — through the identity-aware writer (the
   * logged-in Telegram user is recorded as the actor, denials surface nicely).
   */
  async function confirm() {
    if (!selected || saving || !holonId) return;
    saving = true;
    try {
      const hs = await getHolosphere();
      let existing: any = {};
      try {
        const raw = await (hs as any).get(holonId, "settings", holonId);
        if (raw && typeof raw === "object" && !Array.isArray(raw))
          existing = raw;
      } catch {
        /* fresh settings */
      }
      const writer = await getWriter(holonId, (msg) => showNotice(msg));
      const ok = await writer.put("settings", {
        ...existing,
        id: holonId,
        hex: selected,
      });
      if (ok) {
        showNotice("Location claimed — this holon is on the map.");
        dispatch("saved", selected);
        dispatch("close");
      }
    } catch (err) {
      console.error("[HexPicker] failed to save hex", err);
      showNotice("Could not save the location — try again.");
    } finally {
      saving = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") dispatch("close");
  }

  onDestroy(() => {
    alive = false;
    try {
      resizeObserver?.disconnect();
    } catch {}
    resizeObserver = null;
    try {
      map?.remove();
    } catch {}
    map = null;
    mapReady = false;
    clearTimeout(searchTimer);
  });
</script>

<svelte:window on:keydown={onKey} />

<div
  class="picker"
  role="dialog"
  aria-modal="true"
  aria-label="Pick a location"
>
  <header>
    <div class="titles">
      <div class="kicker">Claim your cell</div>
      <h3>Where does this holon stand?</h3>
    </div>
    <button class="x" on:click={() => dispatch("close")} aria-label="Close">
      ✕
    </button>
  </header>
  <p class="hint">
    Tap the hex your holon lives in — zoom out for a wider, more private cell.
  </p>

  {#if MAPBOX_TOKEN}
    <div class="search">
      <input
        type="text"
        bind:value={searchQuery}
        on:input={onSearchInput}
        placeholder="Search an address or place…"
      />
      {#if searching}
        <span class="searching">searching…</span>
      {/if}
      {#if searchHits.length}
        <div class="hits">
          {#each searchHits as hit (hit.label)}
            <button type="button" on:click={() => pickPlace(hit)}>
              {hit.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="map" bind:this={mapContainer}></div>
  {:else}
    <div class="map placeholder">
      No VITE_MAPBOX_TOKEN in the root .env — use your location or paste a cell
      id below.
    </div>
  {/if}

  <div class="row">
    <button type="button" class="chip" on:click={locate} disabled={locating}>
      {locating ? "Locating…" : "◎ My location"}
    </button>
    <div class="readout">
      {selected ? `${selected} · res ${resolution}` : "nothing selected yet"}
    </div>
  </div>

  <div class="row">
    <input
      type="text"
      class="manual"
      bind:value={manual}
      placeholder="…or paste an H3 cell id"
      on:keydown={(e) => e.key === "Enter" && useManual()}
    />
    <button type="button" class="chip" on:click={useManual}>Check</button>
  </div>

  <button
    type="button"
    class="confirm"
    on:click={confirm}
    disabled={!selected || saving}
  >
    {saving ? "Claiming…" : "This is home"}
  </button>
</div>

<style>
  .picker {
    position: fixed;
    inset: 0;
    z-index: 60; /* above the settings Modal (50) */
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1.1rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom, 0px));
    background: var(--paper);
    animation: kiosk-fade 0.2s ease both;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
  }
  .titles {
    flex: 1;
  }
  .kicker {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--teal);
  }
  h3 {
    margin: 0.2rem 0 0;
    font-size: 1.25rem;
    color: var(--ink);
  }
  .x {
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--card);
    border: 1.5px solid var(--line);
    color: var(--ink-soft);
    font-size: 1rem;
  }
  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
    text-wrap: pretty;
  }

  .search {
    position: relative;
  }
  .search input {
    width: 100%;
    padding: 0.7rem 0.9rem;
    font-size: 0.95rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
  }
  .search input:focus {
    outline: none;
    border-color: var(--teal);
  }
  .searching {
    position: absolute;
    right: 0.9rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.72rem;
    color: var(--muted);
  }
  .hits {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    z-index: 5;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow-soft);
    overflow: hidden;
  }
  .hits button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.65rem 0.9rem;
    font-size: 0.85rem;
    color: var(--ink);
    border-bottom: 1px solid var(--line);
  }
  .hits button:last-child {
    border-bottom: none;
  }

  .map {
    flex: 1;
    min-height: 200px;
    border-radius: 16px;
    overflow: hidden;
    background: var(--paper-deep);
  }
  .map.placeholder {
    display: grid;
    place-items: center;
    padding: 1.4rem;
    text-align: center;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .chip {
    flex: 0 0 auto;
    padding: 0.6rem 0.9rem;
    border-radius: 999px;
    background: var(--card);
    border: 1.5px solid var(--line);
    color: var(--ink);
    font-size: 0.85rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .chip:active {
    transform: scale(0.95);
  }
  .chip:disabled {
    opacity: 0.6;
  }
  .readout {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 0.72rem;
    color: var(--muted);
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .manual {
    flex: 1;
    min-width: 0;
    padding: 0.6rem 0.9rem;
    font-size: 0.85rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 999px;
  }
  .manual:focus {
    outline: none;
    border-color: var(--teal);
  }

  .confirm {
    min-height: 52px;
    border-radius: 14px;
    background: var(--teal);
    color: #fff;
    font-size: 1rem;
    font-weight: 700;
    box-shadow: var(--shadow-soft);
    transition: transform 0.1s ease;
  }
  .confirm:active {
    transform: scale(0.97);
  }
  .confirm:disabled {
    opacity: 0.55;
  }
</style>
