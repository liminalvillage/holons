<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The dock's MAP view: the same closed boards, but placed where they live.
  // Each docked holon that has claimed a cell (`settings.hex`, the field the
  // HexPicker writes) appears as its H3 hexagon on the Mapbox basemap, with a
  // tappable hexagon badge at its centre. The badge carries the same
  // `data-dock-circle` handle the deck's orbs do, so tapping it opens the
  // board through the exact same morph — and closing a board irises back
  // down onto its hexagon. Boards with no claimed cell simply aren't here;
  // the deck view always shows everything.
  import { onDestroy, onMount } from "svelte";
  import {
    cellToBoundary,
    cellToLatLng,
    cellToParent,
    getResolution,
    polygonToCells,
  } from "h3-js";
  import { readSettingsHex } from "@holons/core/federation";
  import { getHolosphere } from "$lib/holosphere";
  import { setGeo } from "$lib/config";
  import { showNotice } from "$lib/stores";
  import { dockEntries, hueFor, requestOpen, type DockEntry } from "$lib/dock";
  import { t, tr } from "$lib/i18n";

  const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

  // The dashboard map's zoom ↔ resolution bands, so "go to a cell" lands at
  // the zoom where that cell reads naturally.
  const RES_ZOOM: Record<number, number> = {
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
  // How much coarser a board's PARENT hexagon is drawn than its exact cell:
  // a res-9 "block" gets a res-4 neighbourhood — the two-layer display the
  // dashboard map uses, so a board is findable even from country zoom.
  const PARENT_COARSER = 5;

  // Zoom → grid resolution bands, mirroring the HexPicker / dashboard so the
  // grid lines up cell-for-cell across every surface.
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

  let mapContainer: HTMLDivElement | null = null;
  let map: any = null;
  let mapboxglMod: any = null;
  let markers: any[] = [];
  let alive = true;
  let loadingHexes = true;
  let located: Array<DockEntry & { hex: string }> = [];

  // A board's claimed cell rarely changes — cache across mounts so flipping
  // deck ⇄ map (and the close morph that needs the badge in place) is instant
  // after the first look-up. `null` = looked up, none claimed.
  const hexCache: Map<string, string | null> = ((
    globalThis as any
  ).__kioskDockHexes ??= new Map());

  async function loadHexes(entries: DockEntry[]) {
    const missing = entries.filter((e) => !hexCache.has(e.id));
    if (missing.length) {
      try {
        const hs = await getHolosphere();
        await Promise.all(
          missing.map(async (e) => {
            hexCache.set(e.id, await readSettingsHex(hs, e.id));
          }),
        );
      } catch {
        /* unreachable — those boards stay off the map this time */
      }
    }
    if (!alive) return;
    located = entries.flatMap((e) => {
      const hex = hexCache.get(e.id);
      return hex ? [{ ...e, hex }] : [];
    });
    loadingHexes = false;
    placeBoards();
  }

  function ring(cell: string): number[][] {
    let r = cellToBoundary(cell, true) as Array<[number, number]>;
    // The dashboard map's antimeridian hack: a cell straddling ±180° comes
    // back with a huge longitude jump and would paint as a line across the
    // whole world — shift the positive side by -360 so the polygon stays
    // local.
    if (r.some(([lng]) => lng < -128))
      r = r.map(([lng, lat]) => (lng > 0 ? [lng - 360, lat] : [lng, lat]));
    const out: number[][] = r.map(([lng, lat]) => [lng, lat]);
    out.push(out[0]);
    return out;
  }

  async function initMap() {
    try {
      const [{ default: mapboxgl }] = await Promise.all([
        import("mapbox-gl"),
        import("mapbox-gl/dist/mapbox-gl.css"),
      ]);
      if (!alive || !mapContainer) return;
      mapboxglMod = mapboxgl;
      mapboxgl.accessToken = MAPBOX_TOKEN;
      map = new mapboxgl.Map({
        container: mapContainer,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [11.3426, 44.4949], // Bologna fallback until boards place it
        zoom: 4,
        attributionControl: false,
      });
      // Dev/test hook, like window.__kiosk: lets a headless run assert the
      // goto-fly and zoom without reaching into Mapbox internals. DEV only.
      if (import.meta.env.DEV) (window as any).__dockMap = map;
      map.on("load", () => {
        if (!map) return;
        // The zoom-following H3 grid, in the dashboard map's two layers: the
        // current resolution plus the next finer one, fainter, inside it.
        map.addSource("dock-grid", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "dock-grid-fine-line",
          type: "line",
          source: "dock-grid",
          filter: ["==", ["get", "kind"], "fine"],
          paint: {
            "line-color": "#ffffff",
            "line-width": 1.2,
            "line-opacity": 0.18,
          },
        });
        map.addLayer({
          id: "dock-grid-line",
          type: "line",
          source: "dock-grid",
          filter: ["==", ["get", "kind"], "grid"],
          paint: {
            "line-color": "#ffffff",
            "line-width": 2,
            "line-opacity": 0.45,
          },
        });
        map.on("moveend", rebuildGrid);
        map.on("zoomend", rebuildGrid);
        // Two hexagon layers, like the dashboard map's upper/lower grids:
        // the faint PARENT neighbourhood underneath, the exact cell on top.
        map.addSource("dock-parents", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "dock-parents-fill",
          type: "fill",
          source: "dock-parents",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 },
        });
        map.addLayer({
          id: "dock-parents-line",
          type: "line",
          source: "dock-parents",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 2.5,
            "line-opacity": 0.6,
            "line-dasharray": [2, 2],
          },
        });
        map.addSource("dock-cells", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "dock-cells-fill",
          type: "fill",
          source: "dock-cells",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.35 },
        });
        map.addLayer({
          id: "dock-cells-line",
          type: "line",
          source: "dock-cells",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 3.5,
            "line-opacity": 0.9,
          },
        });
        // Tapping a parent hexagon GOES TO its board's exact cell (the
        // dashboard's goToHex move) — the badge there is what opens the board.
        map.on("click", "dock-parents-fill", (e: any) => {
          const hex = e.features?.[0]?.properties?.hex;
          if (typeof hex === "string" && hex) flyToCell(hex);
        });
        rebuildGrid();
        placeBoards();
      });
    } catch (err) {
      console.warn("[kiosk] dock map unavailable", err);
    }
  }

  /**
   * Refill the viewport grid at the zoom-matched resolution (plus the next
   * finer one). Both layers live in one source, told apart by `kind`; a cap
   * keeps a pathological viewport from ever exploding the cell count.
   */
  function rebuildGrid() {
    if (!map) return;
    const src = map.getSource("dock-grid");
    const bounds = map.getBounds();
    if (!src || !bounds) return;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const view: Array<[number, number]> = [
      [ne.lat, sw.lng],
      [ne.lat, ne.lng],
      [sw.lat, ne.lng],
      [sw.lat, sw.lng],
      [ne.lat, sw.lng],
    ];
    const res = zoomToResolution(map.getZoom());
    const features: any[] = [];
    for (const [kind, r, cap] of [
      ["grid", res, 3000],
      ["fine", res + 1, 6000],
    ] as const) {
      let cells: string[] = [];
      try {
        cells = polygonToCells(view, r);
      } catch {
        cells = [];
      }
      if (cells.length > cap) continue;
      for (const c of cells)
        features.push({
          type: "Feature",
          properties: { kind },
          geometry: { type: "Polygon", coordinates: [ring(c)] },
        });
    }
    src.setData({ type: "FeatureCollection", features });
  }

  /** Fly to a cell at the zoom its resolution reads best (goToHex-style). */
  function flyToCell(hex: string) {
    if (!map) return;
    const [lat, lng] = cellToLatLng(hex);
    map.flyTo({
      center: [lng, lat],
      zoom: RES_ZOOM[getResolution(hex)] ?? 15,
      essential: true,
    });
  }

  /** Draw every located board: parent + cell polygons, and the hex badge. */
  function placeBoards() {
    if (!map || !mapboxglMod) return;
    const src = map.getSource("dock-cells");
    if (src)
      src.setData({
        type: "FeatureCollection",
        features: located.map((e) => ({
          type: "Feature",
          properties: { color: `hsl(${hueFor(e.id)} 60% 50%)` },
          geometry: { type: "Polygon", coordinates: [ring(e.hex)] },
        })),
      });
    const parents = map.getSource("dock-parents");
    if (parents)
      parents.setData({
        type: "FeatureCollection",
        features: located.map((e) => {
          const res = Math.max(getResolution(e.hex) - PARENT_COARSER, 0);
          return {
            type: "Feature",
            properties: {
              color: `hsl(${hueFor(e.id)} 60% 50%)`,
              hex: e.hex, // the tap-to-go-to target, not the parent itself
            },
            geometry: {
              type: "Polygon",
              coordinates: [ring(cellToParent(e.hex, res))],
            },
          };
        }),
      });

    for (const m of markers) m.remove();
    markers = [];
    for (const e of located) {
      const [lat, lng] = cellToLatLng(e.hex);
      const el = document.createElement("button");
      el.className = "hexmark";
      el.style.setProperty("--h", String(hueFor(e.id)));
      el.setAttribute("data-dock-circle", e.id);
      el.setAttribute("aria-label", e.name);
      const glyph = /[\p{L}\p{N}]/u.exec(e.name)?.[0]?.toUpperCase() ?? "·";
      el.innerHTML =
        `<span class="hexmark__face">${glyph}</span>` +
        `<span class="hexmark__name"></span>`;
      // Name via textContent — entry names are data, never markup.
      el.querySelector(".hexmark__name")!.textContent = e.name;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        requestOpen(e.id);
      });
      markers.push(
        new mapboxglMod.Marker({ element: el, anchor: "center" })
          .setLngLat([lng, lat])
          .addTo(map),
      );
    }

    if (located.length === 1) {
      const [lat, lng] = cellToLatLng(located[0].hex);
      const res = getResolution(located[0].hex);
      map.jumpTo({ center: [lng, lat], zoom: Math.max(3, res + 3) });
    } else if (located.length > 1) {
      const bounds = new mapboxglMod.LngLatBounds();
      for (const e of located) {
        const [lat, lng] = cellToLatLng(e.hex);
        bounds.extend([lng, lat]);
      }
      map.fitBounds(bounds, { padding: 120, maxZoom: 12, duration: 0 });
    }
  }

  $: if (alive) void loadHexes($dockEntries);

  // ── Location search (Mapbox Geocoding, same token as the basemap) ───────--
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
    map?.flyTo({
      center: [hit.lng, hit.lat],
      zoom: Math.max(map.getZoom(), 12),
      essential: true,
    });
  }

  // The ONLY place this view asks for coordinates — an explicit tap on the
  // My-location button. The fix is cached (setGeo) so the sunset theme can
  // track the real horizon without ever prompting on its own.
  let locating = false;
  function locate() {
    if (!navigator.geolocation) {
      showNotice(tr("hex.noGeo"));
      return;
    }
    locating = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locating = false;
        const { latitude: lat, longitude: lng } = pos.coords;
        setGeo({ lat, lng });
        map?.flyTo({ center: [lng, lat], zoom: 13, essential: true });
      },
      () => {
        locating = false;
        showNotice(tr("hex.denied"));
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  onMount(() => {
    if (MAPBOX_TOKEN) void initMap();
  });
  onDestroy(() => {
    alive = false;
    clearTimeout(searchTimer);
    for (const m of markers) m.remove();
    markers = [];
    try {
      map?.remove();
    } catch {}
    map = null;
  });
</script>

<div class="mapwrap">
  {#if MAPBOX_TOKEN}
    <div class="map" bind:this={mapContainer}></div>
    <!-- Find a place: floats below the hovering Deck/Map switch. -->
    <div class="search">
      <input
        type="text"
        bind:value={searchQuery}
        on:input={onSearchInput}
        placeholder={$t("hex.searchPlaceholder")}
        aria-label={$t("hex.searchPlaceholder")}
      />
      {#if searching}
        <span class="searching">{$t("hex.searching")}</span>
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
    <button
      type="button"
      class="locate"
      on:click={locate}
      disabled={locating}
      aria-label={$t("hex.myLocation")}
      title={$t("hex.myLocation")}
    >
      ◎
    </button>
    {#if !loadingHexes && located.length === 0}
      <p class="empty">{$t("dock.mapEmpty")}</p>
    {/if}
  {:else}
    <p class="empty">{$t("dock.mapEmpty")}</p>
  {/if}
</div>

<style>
  .mapwrap {
    position: relative;
    flex: 1;
    min-height: 0;
    margin: 0.4rem 1.2rem 0;
  }
  .map {
    position: absolute;
    inset: 0;
    /* The wequest-style edge fade: the basemap dissolves into the space
       around it instead of ending at a hard frame. */
    -webkit-mask-image: radial-gradient(
      130% 130% at 50% 50%,
      #000 60%,
      transparent 99%
    );
    mask-image: radial-gradient(
      130% 130% at 50% 50%,
      #000 60%,
      transparent 99%
    );
  }

  .search {
    position: absolute;
    top: 3.6rem; /* clears the hovering Deck/Map switch */
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
    width: min(24rem, calc(100% - 2rem));
  }
  .search input {
    width: 100%;
    height: 2.6rem;
    padding: 0 1rem;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: color-mix(in srgb, var(--card) 88%, transparent);
    color: var(--ink);
    font-size: 0.92rem;
    font-family: inherit;
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(6px);
  }
  .search input:focus {
    outline: none;
    border-color: var(--teal);
  }
  .searching {
    position: absolute;
    right: 1rem;
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

  .locate {
    position: absolute;
    right: 0.9rem;
    bottom: 0.9rem;
    z-index: 3;
    width: 2.9rem;
    height: 2.9rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.35rem;
    background: var(--card);
    border: 1.5px solid var(--line);
    color: var(--ink-soft);
    box-shadow: var(--shadow-soft);
  }
  .locate:active {
    transform: scale(0.92);
  }
  .locate:disabled {
    opacity: 0.6;
  }
  .empty {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 2;
    margin: 0;
    max-width: 26rem;
    padding: 0.8rem 1.2rem;
    border-radius: 14px;
    background: var(--card);
    border: 1.5px solid var(--line);
    color: var(--muted);
    font-size: 0.9rem;
    font-weight: 600;
    text-align: center;
    box-shadow: var(--shadow-soft);
  }

  /* The tappable board badge on its cell: a hexagon in the board's hue,
     translucent fill + firm rim like the deck's orbs, name beneath. Global —
     the elements are created imperatively as Mapbox markers. */
  :global(.hexmark) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: inherit;
  }
  :global(.hexmark .hexmark__face) {
    width: 3.4rem;
    height: 3.4rem;
    display: grid;
    place-items: center;
    clip-path: polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0% 50%);
    background: hsl(var(--h, 200) 60% 50% / 0.55);
    /* clip-path eats a real border — fake the rim with an inset shadow. */
    box-shadow: inset 0 0 0 3px hsl(var(--h, 200) 65% 62%);
    color: #fff;
    font-size: 1.3rem;
    font-weight: 800;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  }
  :global(.hexmark:active .hexmark__face) {
    transform: scale(0.93);
  }
  :global(.hexmark .hexmark__name) {
    max-width: 8.5rem;
    padding: 0.12rem 0.5rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 0.74rem;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
