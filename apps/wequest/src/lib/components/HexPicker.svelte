<script lang="ts">
  // Claim-your-cell overlay on the real map. Mapbox basemap (token from the
  // shared root .env, same VITE_MAPBOX_TOKEN the dashboard uses), H3 grid
  // overlay that follows the zoom, tap to pick the cell — persisted as the
  // holon's `settings.hex`, the exact field the dashboard's HexPicker writes.
  // mapbox-gl (~1.9 MB) loads lazily only when the picker opens.
  import { onDestroy } from "svelte";
  import {
    isValidCell,
    latLngToCell,
    cellToLatLng,
    cellToBoundary,
    getResolution,
    polygonToCells,
  } from "h3-js";
  import { hexPickerOpen, flash } from "$lib/stores";
  import { setHomeHex, settingsHex } from "$lib/live";

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
  let wasOpen = false;
  let resizeObserver: ResizeObserver | null = null;

  $: if ($hexPickerOpen && !wasOpen) {
    wasOpen = true;
    openPicker();
  } else if (!$hexPickerOpen && wasOpen) {
    wasOpen = false;
    teardown();
  }

  // Zoom ↔ resolution bands, mirroring the dashboard picker / Map.svelte so
  // the grid lines up cell-for-cell with the main map.
  function resolutionToZoom(res: number): number {
    const zooms: Record<number, number> = {
      0: 2.5, 1: 4, 2: 5.2, 3: 6.5, 4: 7.8, 5: 9, 6: 10.5,
      7: 12, 8: 13.5, 9: 15, 10: 16, 11: 17, 12: 18,
    };
    return zooms[res] ?? 15;
  }
  function zoomToResolution(zoom: number): number {
    const bands: Array<[number, number]> = [
      [3.0, 0], [4.4, 1], [5.7, 2], [7.1, 3], [8.4, 4], [9.8, 5], [11.4, 6],
      [12.7, 7], [14.1, 8], [15.5, 9], [16.8, 10], [18.2, 11], [19.5, 12],
    ];
    for (const [z, r] of bands) if (zoom <= z) return r;
    return 12;
  }

  function openPicker() {
    selected = $settingsHex && isValidCell($settingsHex) ? $settingsHex : null;
    if (selected) resolution = getResolution(selected);
    else locate();
    if (MAPBOX_TOKEN) void initMap();
  }

  async function initMap() {
    try {
      const [{ default: mapboxgl }] = await Promise.all([
        import("mapbox-gl"),
        import("mapbox-gl/dist/mapbox-gl.css"),
      ]);
      if (!wasOpen || !mapContainer) return;
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
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        if (!map) return;
        map.addSource("wq-grid", { type: "geojson", data: emptyFC() });
        map.addLayer({
          id: "wq-grid-line",
          type: "line",
          source: "wq-grid",
          paint: { "line-color": "#f5ead8", "line-width": 1, "line-opacity": 0.45 },
        });
        map.addSource("wq-selected", { type: "geojson", data: emptyFC() });
        map.addLayer({
          id: "wq-selected-fill",
          type: "fill",
          source: "wq-selected",
          paint: { "fill-color": "#c67139", "fill-opacity": 0.45 },
        });
        map.addLayer({
          id: "wq-selected-line",
          type: "line",
          source: "wq-selected",
          paint: { "line-color": "#f5ead8", "line-width": 2 },
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
      console.warn("[HexPicker] mapbox unavailable, falling back to manual entry", err);
    }
  }

  function emptyFC(): any {
    return { type: "FeatureCollection", features: [] };
  }

  function cellRing(cell: string): number[][] {
    const ring = (cellToBoundary(cell, true) as Array<[number, number]>).map(([lng, lat]) => [
      lng,
      lat,
    ]);
    ring.push(ring[0]);
    return ring;
  }

  function rebuildHighlight() {
    if (!map || !mapReady) return;
    const src = map.getSource("wq-selected");
    if (!src) return;
    src.setData(
      selected
        ? {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [cellRing(selected)] } },
            ],
          }
        : emptyFC(),
    );
  }

  function rebuildGrid() {
    if (!map || !mapReady) return;
    const src = map.getSource("wq-grid");
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
      flash("No geolocation on this device — tap the map or paste a cell id.");
      return;
    }
    locating = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locating = false;
        const { latitude: lat, longitude: lng } = pos.coords;
        selected = latLngToCell(lat, lng, resolution);
        if (map) {
          map.flyTo({ center: [lng, lat], zoom: resolutionToZoom(resolution), essential: true });
        }
        rebuildHighlight();
      },
      () => {
        locating = false;
        flash("Location denied — tap the map or paste a cell id.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function useManual() {
    const cell = manual.trim().toLowerCase();
    if (!isValidCell(cell)) {
      flash("That's not a valid H3 cell id.");
      return;
    }
    selected = cell;
    resolution = getResolution(cell);
    if (map) {
      const [lat, lng] = cellToLatLng(cell);
      map.flyTo({ center: [lng, lat], zoom: resolutionToZoom(resolution), essential: true });
    }
    rebuildHighlight();
  }

  async function confirm() {
    if (!selected || saving) return;
    saving = true;
    await setHomeHex(selected);
    saving = false;
    hexPickerOpen.set(false);
  }

  function teardown() {
    try {
      resizeObserver?.disconnect();
    } catch {}
    resizeObserver = null;
    try {
      map?.remove();
    } catch {}
    map = null;
    mapReady = false;
    selected = null;
    manual = "";
    saving = false;
    searchQuery = "";
    searchHits = [];
    clearTimeout(searchTimer);
  }

  onDestroy(teardown);
</script>

{#if $hexPickerOpen}
  <div
    style="position:absolute;inset:0;background:var(--color-accent-2-800);z-index:40;display:flex;flex-direction:column;padding:52px 18px 24px"
  >
    <div style="display:flex;align-items:baseline;gap:10px">
      <div style="flex:1">
        <div
          style="font-family:var(--font-heading);font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--color-accent-300)"
        >
          Claim your cell
        </div>
        <div
          style="font-family:var(--font-heading);font-size:24px;line-height:1.08;color:var(--color-neutral-100);margin-top:6px;text-wrap:pretty"
        >
          Where does this holon stand?
        </div>
      </div>
      <button
        class="tapp"
        on:click={() => hexPickerOpen.set(false)}
        aria-label="Close"
        style="width:40px;height:40px;border-radius:999px;border:1.5px solid rgba(245,234,216,.3);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-size:16px;flex:none"
      >
        ✕
      </button>
    </div>
    <div style="font-size:12.5px;color:var(--color-accent-2-300);margin-top:6px;text-wrap:pretty">
      Tap the hex your holon lives in — zoom out for a wider, more private cell. Needs publish to
      this hexagon on the shared map.
    </div>

    {#if MAPBOX_TOKEN}
      <div style="position:relative;margin-top:12px">
        <input
          bind:value={searchQuery}
          on:input={onSearchInput}
          placeholder="Search an address or place…"
          style="width:100%;height:44px;border-radius:999px;border:none;padding:0 16px;font:inherit;font-size:13.5px;background:#f5ead8;color:var(--color-text)"
        />
        {#if searching}
          <div
            style="position:absolute;right:14px;top:0;height:44px;display:flex;align-items:center;font-size:11px;color:var(--color-neutral-600)"
          >
            searching…
          </div>
        {/if}
        {#if searchHits.length}
          <div
            style="position:absolute;left:0;right:0;top:48px;z-index:50;background:var(--color-bg);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);overflow:hidden"
          >
            {#each searchHits as hit (hit.label)}
              <button
                class="tapp"
                on:click={() => pickPlace(hit)}
                style="display:block;width:100%;text-align:left;padding:11px 14px;font-size:13px;color:var(--color-text);border-bottom:1px solid var(--color-divider)"
              >
                {hit.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if MAPBOX_TOKEN}
      <div
        bind:this={mapContainer}
        style="flex:1;min-height:280px;margin-top:14px;border-radius:var(--radius-lg);overflow:hidden;background:var(--color-accent-2-900)"
      ></div>
    {:else}
      <div
        style="flex:1;min-height:280px;margin-top:14px;border-radius:var(--radius-lg);background:var(--color-accent-2-900);display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:var(--color-accent-2-300);font-size:13px"
      >
        No VITE_MAPBOX_TOKEN in the root .env — use your location or paste a cell id below.
      </div>
    {/if}

    <div style="display:flex;align-items:center;gap:8px;margin-top:12px">
      <button
        class="tapp chip"
        on:click={locate}
        disabled={locating}
        style="background:rgba(245,234,216,.15);color:var(--color-neutral-100);padding:9px 14px;font-size:12.5px"
      >
        {locating ? "Locating…" : "◎ My location"}
      </button>
      <div
        style="flex:1;font-size:11px;color:var(--color-accent-2-300);font-family:ui-monospace,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right"
      >
        {selected ? `${selected} · res ${resolution}` : "nothing selected yet"}
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-top:10px">
      <input
        bind:value={manual}
        placeholder="…or paste an H3 cell id"
        style="flex:1;height:42px;border-radius:999px;border:none;padding:0 16px;font:inherit;font-size:13px;background:rgba(245,234,216,.12);color:var(--color-neutral-100)"
      />
      <button
        class="tapp"
        on:click={useManual}
        style="height:42px;padding:0 16px;border-radius:999px;background:rgba(245,234,216,.2);color:var(--color-neutral-100);font-weight:700;font-size:13px"
      >
        Check
      </button>
    </div>

    <button
      class="tapp"
      on:click={confirm}
      disabled={!selected || saving}
      style="margin-top:12px;height:54px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:16.5px;opacity:{selected
        ? 1
        : 0.5}"
    >
      {saving ? "Claiming…" : "This is home"}
    </button>
  </div>
{/if}
