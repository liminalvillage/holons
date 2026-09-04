<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The earth beneath the dock's sky: the Mapbox basemap, filling the same
  // box as the gravity field (DockView), so a point projected by the map IS
  // a point in the field. Each docked holon that has claimed a cell
  // (`settings.hex`, the field the HexPicker writes) shows as its H3 hexagon
  // in the holon's colour; the orb itself stays in the sky above, tethered
  // to the hexagon by its beacon — DockView asks `projectBoards()` every
  // frame for where each place sits on screen. Boards with no claimed cell
  // have no hexagon; their orbs float free. Tapping bare map selects a cell
  // (the dashboard's click-to-select), after the dock has had first say
  // (`onbackdrop`) so a tap can stand edit mode down instead.
  import { onDestroy, onMount } from "svelte";
  import {
    cellToBoundary,
    cellToLatLng,
    cellToParent,
    getResolution,
    isValidCell,
    latLngToCell,
  } from "h3-js";
  import { readSettingsHex } from "@holons/core/federation";
  import type { HoloSphere } from "holosphere";
  import {
    getHolosphere,
    normalizeSub,
    subscribeLensPresence,
    type Subscription,
  } from "$lib/holosphere";
  import { resolveAppName, setGeo } from "$lib/config";
  import { showNotice } from "$lib/stores";
  import { dockEntries, type DockEntry, type Vec } from "$lib/dock";
  import { holonColor, holonColors, resolveCssColor } from "$lib/palette";
  import { activeTheme } from "$lib/theme";
  import {
    countsAsPresent,
    edgeFade,
    isLensId,
    itemDetails,
    itemLabel,
    lensColor,
    LENSES,
    parsePresence,
    resolutionToZoom,
    serializePresence,
    viewportCells,
    zoomToResolution,
    type LensId,
    type PresenceEntry,
    type ViewBox,
  } from "$lib/maplens";
  import { locale, t, tr, type MessageKey } from "$lib/i18n";
  import { en } from "$lib/i18n/en";

  const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

  // How much coarser a board's PARENT hexagon is than its exact cell: a
  // res-9 "block" gets a res-4 neighbourhood. Never drawn — it is the
  // tap target that keeps a board reachable from country zoom.
  const PARENT_COARSER = 5;

  let mapContainer: HTMLDivElement | null = null;
  let map: any = null;
  let mapboxglMod: any = null;
  let alive = true;
  let loadingHexes = true;
  /** The docked boards with a place, each with its cell's centre resolved
   *  once (the per-frame projection must not redo the H3 math). */
  let located: Array<DockEntry & { hex: string; lng: number; lat: number }> =
    [];

  /**
   * A tap on bare map: the dock gets first say — it stands edit/add mode
   * down and returns true to say the tap is spent, so no cell gets selected
   * under a closing ✕.
   */
  export let onbackdrop: () => boolean = () => false;
  /** The view settled or the box changed — the reduced-motion sky relays out. */
  export let onmove: () => void = () => {};
  /**
   * The board a carried orb is about to be dropped on (DockView's drop
   * target): its hexagon lights up so the place reads as the landing zone.
   */
  export let highlight: string | null = null;
  /** The board being carried — a bare cell lights in ITS colour, since a
   *  drop there makes that cell the board's home. */
  export let carrying: string | null = null;
  $: if (map) {
    void carrying;
    paintHighlight(highlight);
  }
  /**
   * Light the cell a drop would claim as the carried board's HOME, in that
   * board's colour.
   *
   * Only ever a bare cell. Dropping on another ORB is what federates, and
   * the sky already says so — the target orb wears a dashed halo — so a
   * board's own hexagon (and the huge neighbourhood around it) is never lit
   * by a drag any more.
   */
  function paintHighlight(id: string | null) {
    const src = map?.getSource("drop-cell");
    if (!src) return;
    const cell = id && isValidCell(id) ? id : null;
    src.setData(
      cell
        ? {
            type: "Feature",
            properties: {
              color: carrying
                ? paint(carrying)
                : resolveCssColor("var(--teal)"),
            },
            geometry: { type: "Polygon", coordinates: [ring(cell)] },
          }
        : { type: "FeatureCollection", features: [] },
    );
  }

  /**
   * The grid cell under this point (container px = field px) at the zoom's
   * own resolution — the hexagon one sees there. Any of them can take a
   * dropped orb: the board then federates with that place. Null before the
   * map exists.
   */
  export function cellAt(x: number, y: number): string | null {
    if (!map) return null;
    try {
      const ll = map.unproject([x, y]);
      return latLngToCell(ll.lat, ll.lng, zoomToResolution(map.getZoom()));
    } catch {
      return null;
    }
  }

  /**
   * Where each placed board's hexagon centre sits on screen, in container
   * px — which, the map filling the same box as the gravity field, is field
   * px. The world copy nearest the middle of the view wins, so a place just
   * across the antimeridian doesn't project a world-width away. Null until
   * there is a map to ask.
   */
  export function projectBoards(): Map<string, Vec> | null {
    if (!map) return null;
    const mid = (map.getContainer() as HTMLElement).clientWidth / 2;
    const out = new Map<string, Vec>();
    for (const e of located) {
      let best: Vec | null = null;
      for (const lng of [e.lng, e.lng - 360, e.lng + 360]) {
        const p = map.project([lng, e.lat]);
        if (!best || Math.abs(p.x - mid) < Math.abs(best.x - mid))
          best = { x: p.x, y: p.y };
      }
      if (best) out.set(e.id, best);
    }
    return out;
  }

  // A board's claimed cell rarely changes — a cell once seen is kept across
  // mounts so flipping sky ⇄ earth is instant. A MISS is never kept: a
  // partner's settings replicate a beat after we first ask (so a miss is
  // retried while the earth is up, like the palette's colour look-up), and a
  // place claimed later in Settings must show on the next look — the picker
  // announces it (`kiosk:hex-changed`) so an open dock lands the beacon at
  // once.
  const hexCache: Map<string, string> = ((
    globalThis as any
  ).__kioskDockHexes ??= new Map());
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const looking = new Set<string>();

  async function lookupHex(hs: HoloSphere, id: string): Promise<void> {
    if (looking.has(id)) return;
    looking.add(id);
    try {
      for (const delay of [0, 800, 2000]) {
        if (delay) await sleep(delay);
        if (!alive) return;
        const hex = await readSettingsHex(hs, id);
        if (hex) {
          hexCache.set(id, hex);
          return;
        }
      }
    } finally {
      looking.delete(id);
    }
  }

  /** The cell a board is currently drawn on, as far as the map knows. */
  export function hexOf(id: string): string | null {
    return hexCache.get(id) ?? null;
  }

  async function loadHexes(entries: DockEntry[]) {
    // `get`, not `has`: a stale falsy entry (older code cached misses) is a miss.
    const missing = entries.filter((e) => !hexCache.get(e.id));
    if (missing.length) {
      try {
        const hs = await getHolosphere();
        // Place whatever is already known while the misses are retried, and
        // again as each retry lands, so a late reply still gets its hexagon.
        await Promise.all(
          missing.map((e) => lookupHex(hs, e.id).then(() => place(entries))),
        );
      } catch {
        /* unreachable — those boards stay off the earth this time */
      }
    }
    place(entries);
  }

  function place(entries: DockEntry[]) {
    if (!alive) return;
    located = entries.flatMap((e) => {
      const hex = hexCache.get(e.id);
      if (!hex) return [];
      const [lat, lng] = cellToLatLng(hex);
      return [{ ...e, hex, lng, lat }];
    });
    loadingHexes = false;
    placeBoards();
  }

  /** Settings → Set location just claimed (or moved) a board's place. */
  function onHexChanged(ev: Event) {
    const d = (ev as CustomEvent<{ holon?: string; hex?: string }>).detail;
    if (!d?.holon) return;
    if (d.hex) hexCache.set(d.holon, d.hex);
    else hexCache.delete(d.holon);
    void loadHexes($dockEntries);
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
            "line-opacity": ["*", 0.18, ["get", "fade"]],
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
            "line-opacity": ["*", 0.45, ["get", "fade"]],
          },
        });
        map.on("moveend", onViewChange);
        map.on("zoomend", onViewChange);
        // The sky above relays its placed orbs out when the earth settles
        // (the live sky re-projects every frame on its own).
        map.on("moveend", () => onmove());
        map.on("resize", () => onmove());
        // Cells lit by the selected lens — the dashboard map's highlighted
        // hexagons, in the same per-lens colour.
        map.addSource("lens-cells", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "lens-cells-fill",
          type: "fill",
          source: "lens-cells",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.45 },
        });
        map.addLayer({
          id: "lens-cells-line",
          type: "line",
          source: "lens-cells",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 2,
            "line-opacity": 0.8,
          },
        });
        // A board's PARENT neighbourhood, drawn invisibly: it is purely the
        // tap target for "take me there" (see the click handler), because at
        // country zoom a board's exact cell is far too small to hit. The orb
        // hovering above it is the visual marker, so nothing is painted here.
        map.addSource("dock-parents", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "dock-parents-fill",
          type: "fill",
          source: "dock-parents",
          paint: { "fill-color": "#000000", "fill-opacity": 0 },
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
        // The drop target's cell (see `highlight`), above the resting cells.
        map.addSource("drop-cell", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "drop-cell-fill",
          type: "fill",
          source: "drop-cell",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.75 },
        });
        map.addLayer({
          id: "drop-cell-line",
          type: "line",
          source: "drop-cell",
          paint: {
            "line-color": resolveCssColor("var(--teal)"),
            "line-width": 5,
            "line-dasharray": [1.5, 1],
          },
        });
        // The click-selected cell, in the dashboard's selected-hexagon teal.
        map.addSource("sel-cell", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "sel-cell-fill",
          type: "fill",
          source: "sel-cell",
          paint: { "fill-color": "#088", "fill-opacity": 0.6 },
        });
        map.addLayer({
          id: "sel-cell-line",
          type: "line",
          source: "sel-cell",
          paint: {
            "line-color": "#088",
            "line-width": 2,
            "line-opacity": 0.8,
          },
        });
        // A tap: on a board's parent hexagon while zoomed at/above the
        // parent's own scale it means "take me there" (the dashboard's
        // goToHex move); anywhere else it selects the tapped cell at the
        // current resolution, exactly like clicking the dashboard map.
        map.on("click", (e: any) => {
          if (onbackdrop()) return; // the tap stood the dock's edit mode down
          const hits = map.queryRenderedFeatures(e.point, {
            layers: ["dock-parents-fill"],
          });
          const target = hits?.[0]?.properties?.hex;
          if (typeof target === "string" && target) {
            const parentRes = Math.max(
              getResolution(target) - PARENT_COARSER,
              0,
            );
            if (zoomToResolution(map.getZoom()) <= parentRes) {
              flyToCell(target);
              return;
            }
          }
          selectCell(
            latLngToCell(
              e.lngLat.lat,
              e.lngLat.lng,
              zoomToResolution(map.getZoom()),
            ),
          );
        });
        rebuildGrid();
        renderLens();
        reconcileLens();
        placeBoards();
      });
    } catch (err) {
      console.warn("[kiosk] dock map unavailable", err);
    }
  }

  /** The viewport as a lat/lng polygon (h3's vertex order), or null. */
  /** The viewport as Mapbox reports it (longitudes may run past ±180). */
  function viewBox(): ViewBox | null {
    const bounds = map?.getBounds();
    if (!bounds) return null;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    return { west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat };
  }

  /**
   * How strongly a cell is drawn: 1 in the middle of the map, dissolving to
   * 0 at the corners — the grid fades into the card's edge instead of being
   * cut off by it. Data-driven per cell, so it survives pans between
   * rebuilds well enough and never touches the lit lens cells.
   */
  function cellFade(cell: string): number {
    if (!map) return 1;
    const el = map.getContainer() as HTMLElement;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    const [lat, lng] = cellToLatLng(cell);
    const p = map.project([lng, lat]);
    return edgeFade((p.x - w / 2) / (w / 2), (p.y - h / 2) / (h / 2));
  }

  /** Every move/zoom settles into: grid, lens highlights, subscriptions. */
  function onViewChange() {
    rebuildGrid();
    renderLens();
    reconcileLens();
  }

  /**
   * Refill the viewport grid at the zoom-matched resolution (plus the next
   * finer one). Both layers live in one source, told apart by `kind`; a cap
   * keeps a pathological viewport from ever exploding the cell count.
   */
  function rebuildGrid() {
    if (!map) return;
    const src = map.getSource("dock-grid");
    const view = viewBox();
    if (!src || !view) return;
    const res = zoomToResolution(map.getZoom());
    const features: any[] = [];
    for (const [kind, r, cap] of [
      ["grid", res, 3000],
      ["fine", res + 1, 6000],
    ] as const) {
      const cells = viewportCells(view, r);
      if (cells.length > cap) continue;
      for (const c of cells) {
        const fade = cellFade(c);
        if (fade <= 0) continue;
        features.push({
          type: "Feature",
          properties: { kind, fade },
          geometry: { type: "Polygon", coordinates: [ring(c)] },
        });
      }
    }
    src.setData({ type: "FeatureCollection", features });
  }

  /** Fly to a cell at the zoom its resolution reads best (goToHex-style). */
  function flyToCell(hex: string) {
    if (!map) return;
    const [lat, lng] = cellToLatLng(hex);
    map.flyTo({
      center: [lng, lat],
      zoom: resolutionToZoom(getResolution(hex)),
      essential: true,
    });
  }

  // ── Lens layer (dashboard-aligned) ───────────────────────────────────────--
  //
  // One live presence subscription per visible (lens, hex) cell, exactly the
  // dashboard map's model: a lit set per lens (monotonic within a session —
  // a cell stays known once seen; only a real "nothing left" emission unlights
  // it), seeded from the persisted presence cache so a cold map paints its
  // last-known highlights instantly.

  const appName = resolveAppName();
  const LENS_CHOICE_KEY = `kiosk.mapLens.${appName}`;
  const presenceKey = (lens: LensId) => `kiosk.presence.${appName}.${lens}`;
  const lensKey = (id: LensId) => `lens.${id}` as MessageKey;

  function loadLensChoice(): LensId | null {
    try {
      const raw = localStorage.getItem(LENS_CHOICE_KEY);
      if (raw === "") return null; // an explicit "no lens" choice
      return isLensId(raw) ? raw : "quests";
    } catch {
      return "quests";
    }
  }

  let selectedLens: LensId | null = loadLensChoice();
  let hs: HoloSphere | null = null;

  const presence = new Map<LensId, Map<string, PresenceEntry>>();
  const lit = new Map<LensId, Set<string>>();
  let lensSubs = new Map<string, Subscription>(); // active lens only
  const persistTimers = new Map<LensId, ReturnType<typeof setTimeout>>();
  const LENS_CELL_CAP = 3000;

  /** The lens's lit-cell set, hydrating rows from the persisted cache once. */
  function litSet(lens: LensId): Set<string> {
    let s = lit.get(lens);
    if (!s) {
      let rows: Map<string, PresenceEntry>;
      try {
        rows = parsePresence(localStorage.getItem(presenceKey(lens)));
      } catch {
        rows = new Map();
      }
      presence.set(lens, rows);
      s = new Set([...rows].filter(([, e]) => e.has).map(([cell]) => cell));
      lit.set(lens, s);
    }
    return s;
  }

  function schedulePersist(lens: LensId) {
    clearTimeout(persistTimers.get(lens));
    persistTimers.set(
      lens,
      setTimeout(() => {
        const rows = presence.get(lens);
        if (!rows) return;
        try {
          localStorage.setItem(presenceKey(lens), serializePresence(rows));
        } catch {
          /* private mode / quota — highlights just won't survive a reload */
        }
      }, 400),
    );
  }

  /** Paint the lit cells (at-or-finer than the view's resolution, like the
   *  dashboard) in the lens's colour. */
  function renderLens() {
    const src = map?.getSource("lens-cells");
    if (!src) return;
    const lens = selectedLens;
    if (!lens) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const res = zoomToResolution(map.getZoom());
    const color = lensColor(lens);
    src.setData({
      type: "FeatureCollection",
      features: [...litSet(lens)]
        .filter((cell) => res <= getResolution(cell))
        .map((cell) => ({
          type: "Feature",
          properties: { color },
          geometry: { type: "Polygon", coordinates: [ring(cell)] },
        })),
    });
  }

  /**
   * Reconcile live presence subscriptions against the viewport: every visible
   * cell at the zoom-matched resolution gets one, cells that scrolled away
   * are released (their cache row survives, so panning back paints
   * instantly). Auto-propagation writes hologram pointers up the parent
   * chain, so presence resolves at the visible cell at any zoom.
   */
  function reconcileLens() {
    if (!map || !hs) return;
    const lens = selectedLens;
    if (!lens) return;
    const view = viewBox();
    if (!view) return;
    const cells = viewportCells(view, zoomToResolution(map.getZoom()));
    if (cells.length > LENS_CELL_CAP) return;
    const wanted = new Set(cells);
    litSet(lens); // ensure the lens's cache rows are hydrated
    const rows = presence.get(lens)!;
    for (const cell of wanted) {
      if (lensSubs.has(cell)) continue;
      lensSubs.set(
        cell,
        subscribeLensPresence(
          hs,
          cell,
          lens,
          (has) => {
            if (!alive || selectedLens !== lens) return;
            rows.set(cell, { has, ts: Date.now() });
            schedulePersist(lens);
            const s = litSet(lens);
            const changed = has ? !s.has(cell) : s.delete(cell);
            if (has) s.add(cell);
            if (changed) renderLens();
          },
          (item, key) => {
            // Keep the records themselves: the store replays a cell's data to the
            // FIRST subscriber only, and that's this one — the panel can't
            // re-read what already replayed, so it seeds from here.
            if (!alive || selectedLens !== lens) return;
            const id = String(item.id ?? key);
            let held = liveItems.get(cell);
            if (!held) liveItems.set(cell, (held = new Map()));
            if (item._deleted === true) held.delete(id);
            else held.set(id, item);
            if (selectedCell === cell) panelIngest?.(item, key);
          },
        ),
      );
    }
    for (const [cell, sub] of lensSubs) {
      if (!wanted.has(cell)) {
        sub.unsubscribe();
        lensSubs.delete(cell);
      }
    }
  }

  function teardownLensSubs() {
    for (const sub of lensSubs.values()) sub.unsubscribe();
    lensSubs = new Map();
    liveItems.clear(); // the held records belong to the outgoing lens
  }

  /** Pick a lens chip; tapping the active one stands the lens layer down. */
  function setLens(id: LensId) {
    teardownLensSubs();
    selectedLens = selectedLens === id ? null : id;
    try {
      localStorage.setItem(LENS_CHOICE_KEY, selectedLens ?? "");
    } catch {
      /* private mode — the choice just won't survive a reload */
    }
    renderLens();
    reconcileLens();
    refreshPanel();
  }

  // ── Cell selection (the dashboard's click-to-select) ─────────────────────--

  let selectedCell: string | null = null;
  let panelItems: Array<Record<string, unknown>> | null = null;
  /** The list row tapped through to its details (by record id). */
  let detailId: string | null = null;
  $: detailItem =
    detailId != null
      ? (panelItems?.find((it) => String(it.id ?? "") === detailId) ?? null)
      : null;
  // The record's own fields, formatted for people (lib/maplens); dates in
  // the kiosk's language.
  $: detailRows = detailItem
    ? itemDetails(detailItem, {
        formatDate: (d) =>
          new Intl.DateTimeFormat($locale, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(d),
      })
    : [];
  /** A row's label: the catalog's, else the field name spaced out. */
  function fieldLabel(key: string): string {
    const k = `map.field.${key}`;
    if (k in en) return $t(k as MessageKey);
    return key
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase());
  }
  const idOf = (it: Record<string, unknown>) => String(it.id ?? "");
  let panelSub: Subscription | null = null;
  /** Records the presence channel has heard, per cell — the panel's seed. */
  const liveItems = new Map<string, Map<string, Record<string, unknown>>>();
  /** Open panel's intake, so the presence channel can feed it live. */
  let panelIngest:
    | ((item: Record<string, unknown>, key: string) => void)
    | null = null;

  function selectCell(cell: string) {
    selectedCell = cell;
    detailId = null;
    map?.getSource("sel-cell")?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring(cell)] },
    });
    refreshPanel();
  }

  /**
   * (Re)load the selected (cell, lens) pair into one accumulator with three
   * feeds, ordered by trust in what the store actually delivers here:
   *
   *  1. `liveItems` — the records the presence channel already heard. The store
   *     replays a cell's data to the FIRST subscriber only, and the presence
   *     subscription that lit the cell was it; nothing subscribed later ever
   *     hears that replay, so this seed is usually the whole answer.
   *  2. A fresh live subscription, for writes landing while the panel is
   *     open (and for a selected cell that scrolled out of the reconciled
   *     viewport, whose presence channel was released).
   *  3. A cold `getAll`, raced against a timeout — it can hang forever on
   *     cells whose content is propagated holograms — folding in anything
   *     the replay didn't cover, and settling "Loading…" into a truthful
   *     empty state when there's really nothing.
   */
  function refreshPanel() {
    panelSub?.unsubscribe();
    panelSub = null;
    panelIngest = null;
    panelItems = null;
    detailId = null;
    const cell = selectedCell;
    const lens = selectedLens;
    if (!cell || !lens || !hs) return;
    const acc = new Map<string, Record<string, unknown>>(
      liveItems.get(cell) ?? [],
    );
    const stale = () =>
      !alive || selectedCell !== cell || selectedLens !== lens;
    const emit = () => {
      panelItems = [...acc.values()].filter((it) => countsAsPresent(lens, it));
    };
    const ingest = (item: any, key?: string) => {
      if (stale()) return;
      const id = String((item && (item.id ?? key)) ?? key ?? "");
      if (!id || id === "_" || id === "#") return;
      if (item == null || item._deleted) acc.delete(id);
      else acc.set(id, item);
      emit();
    };
    panelIngest = ingest;
    panelSub = normalizeSub(hs.subscribe(cell, lens, ingest));
    void Promise.race([
      hs.getAll(cell, lens),
      new Promise<null>((res) => setTimeout(() => res(null), 5000)),
    ])
      .then((items) => {
        if (stale()) return;
        if (Array.isArray(items)) {
          for (const it of items as Array<Record<string, unknown>>) {
            const id = String(it?.id ?? "");
            if (id && !acc.has(id)) acc.set(id, it);
          }
        }
        emit();
      })
      .catch(() => {
        if (!stale()) emit();
      });
    if (acc.size) emit(); // the seed paints immediately
  }

  function closeSelection() {
    selectedCell = null;
    detailId = null;
    panelSub?.unsubscribe();
    panelSub = null;
    panelIngest = null;
    panelItems = null;
    map?.getSource("sel-cell")?.setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  /** Draw every located board: parent + cell polygons, and the hex badge. */
  // Repaint when a caretaker colour lands or the day/night palette flips —
  // the map takes literal colours, resolved from the theme's note variables.
  $: if (map) {
    void $holonColors;
    void $activeTheme;
    placeBoards();
  }

  /** The holon's colour as a literal the map can take. */
  const paint = (id: string) => resolveCssColor(holonColor(id, $holonColors));

  function placeBoards() {
    if (!map || !mapboxglMod) return;
    const src = map.getSource("dock-cells");
    if (src)
      src.setData({
        type: "FeatureCollection",
        features: located.map((e) => ({
          type: "Feature",
          properties: { color: paint(e.id), id: e.id },
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
              id: e.id,
              hex: e.hex, // the tap-to-go-to target, not the parent itself
            },
            geometry: {
              type: "Polygon",
              coordinates: [ring(cellToParent(e.hex, res))],
            },
          };
        }),
      });

    // Frame the places once per cast — not on every colour or theme repaint,
    // which would yank the earth out from under a sky someone is looking
    // at. Headroom at the top: the orbs hover above their hexagons.
    const key = located
      .map((e) => e.id)
      .sort()
      .join("\n");
    if (key === fittedKey) return;
    fittedKey = key;
    if (located.length === 1) {
      const { lng, lat, hex } = located[0];
      map.jumpTo({
        center: [lng, lat],
        zoom: Math.max(3, getResolution(hex) + 3),
      });
    } else if (located.length > 1) {
      const bounds = new mapboxglMod.LngLatBounds();
      for (const e of located) bounds.extend([e.lng, e.lat]);
      map.fitBounds(bounds, {
        padding: { top: 200, bottom: 260, left: 90, right: 90 },
        maxZoom: 12,
        duration: 0,
      });
    }
  }
  let fittedKey = "";

  $: if (alive) void loadHexes($dockEntries);

  // The top bar's place search lands here: glide the map to the pick.
  export function flyTo(lng: number, lat: number) {
    map?.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 12),
      essential: true,
    });
  }

  // The ONLY place this view asks for coordinates — an explicit tap on the
  // top bar's My-location button (DockView). The fix is cached (setGeo) so
  // the sunset theme can track the real horizon without ever prompting on
  // its own.
  export let locating = false;
  export function locate() {
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
    window.addEventListener("kiosk:hex-changed", onHexChanged);
    // The lens layer needs the shared holosphere; once it's up, reconcile
    // whatever the map is already showing (and any pre-selected cell).
    void getHolosphere().then((h) => {
      if (!alive) return;
      hs = h;
      reconcileLens();
      if (selectedCell) refreshPanel();
    });
  });
  onDestroy(() => {
    alive = false;
    if (typeof window !== "undefined")
      window.removeEventListener("kiosk:hex-changed", onHexChanged);
    teardownLensSubs();
    panelSub?.unsubscribe();
    panelSub = null;
    for (const timer of persistTimers.values()) clearTimeout(timer);
    try {
      map?.remove();
    } catch {}
    map = null;
  });
</script>

<div class="mapwrap">
  {#if MAPBOX_TOKEN}
    <div class="map" bind:this={mapContainer}></div>

    <!-- The dashboard's lens picker, as touch chips: light the cells that
         hold this kind of thing. Tapping the active chip stands it down. -->
    <div class="lensbar" role="group" aria-label={$t("map.lensAria")}>
      {#each LENSES as l (l.id)}
        <button
          type="button"
          class="chip"
          class:active={selectedLens === l.id}
          style:--c={l.color}
          aria-pressed={selectedLens === l.id}
          on:click={() => setLens(l.id)}
        >
          <span class="cdot" aria-hidden="true"></span>{$t(lensKey(l.id))}
        </button>
      {/each}
    </div>

    <!-- What lives in the tapped cell, for the selected lens — the
         dashboard sidebar's job, sized for a kiosk. -->
    {#if selectedCell}
      <aside class="cellpanel">
        <header>
          {#if detailItem}
            <button
              type="button"
              class="backp"
              on:click={() => (detailId = null)}
              aria-label={$t("map.back")}
              title={$t("map.back")}
            >
              ‹
            </button>
          {/if}
          {#if selectedLens}
            <span
              class="cdot"
              style:--c={lensColor(selectedLens)}
              aria-hidden="true"
            ></span>
            <strong>{$t(lensKey(selectedLens))}</strong>
          {/if}
          <code>{selectedCell}</code>
          <button
            type="button"
            class="closep"
            on:click={closeSelection}
            aria-label={$t("map.closePanel")}
          >
            ×
          </button>
        </header>
        {#if !selectedLens}
          <p class="hint">{$t("map.cellPickLens")}</p>
        {:else if panelItems == null}
          <p class="hint">{$t("map.cellLoading")}</p>
        {:else if panelItems.length === 0}
          <p class="hint">{$t("map.cellEmpty")}</p>
        {:else if detailItem}
          <!-- One record, read straight off its JSON: headline, then the
               well-known fields formatted for people, then the rest. -->
          <article class="detail">
            <h3>{itemLabel(detailItem)}</h3>
            {#if detailRows.length === 0}
              <p class="hint">{$t("map.detailEmpty")}</p>
            {:else}
              <dl>
                {#each detailRows as row (row.key)}
                  <div class="row" class:long={row.key === "description"}>
                    <dt>{fieldLabel(row.key)}</dt>
                    <dd>
                      {#if row.key === "link" && /^https?:\/\//.test(row.value)}
                        <a href={row.value} target="_blank" rel="noopener"
                          >{row.value}</a
                        >
                      {:else}
                        {row.value}
                      {/if}
                    </dd>
                  </div>
                {/each}
              </dl>
            {/if}
          </article>
        {:else}
          <p class="count">{$t("map.cellItems", { n: panelItems.length })}</p>
          <ul>
            {#each panelItems.slice(0, 40) as item, i (item.id ?? i)}
              <li>
                <button
                  type="button"
                  class="rowbtn"
                  on:click={() => (detailId = idOf(item))}
                >
                  <span class="rowlabel">{itemLabel(item)}</span>
                  <span class="chev" aria-hidden="true">›</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </aside>
    {/if}
  {:else}
    <p class="empty">{$t("dock.mapUnavailable")}</p>
  {/if}
</div>

<style>
  /* The earth fills the sky's box edge to edge — the SAME box the gravity
     field and the beacons are drawn in, so nothing has to translate between
     map px and field px. No stacking context of its own: the lens chips and
     the cell panel below rise above the orbs on the sky's z-order, so a
     wandering orb never covers a chip. The hex grid dissolves before it
     reaches the rim (see cellFade) and a soft vignette settles the satellite
     imagery under the sky. */
  .mapwrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #1a2426;
    /* How far the earth is washed back toward the paper. Per skin, because
       the two washes do opposite things to the imagery: the dark skin's
       near-black sinks it under the sky, while the light skin's cream at the
       same strength bleached it out — so the day earth keeps most of its own
       colour and leans on the vignette instead. */
    --earth-wash: 22%;
    --earth-saturate: 0.95;
    --earth-vignette: rgba(10, 18, 20, 0.3);
  }
  :global(:root[data-theme="dark"]) .mapwrap {
    --earth-wash: 58%;
    --earth-saturate: 0.6;
    --earth-vignette: rgba(10, 18, 20, 0.5);
  }
  .map {
    position: absolute;
    inset: 0;
  }
  .mapwrap::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    /* Washed back toward the paper: the earth is the ground the sky floats
       over, and the orbs and their beams must read against it. */
    background: color-mix(
      in srgb,
      var(--paper-deep) var(--earth-wash),
      transparent
    );
    backdrop-filter: saturate(var(--earth-saturate));
    box-shadow: inset 0 0 64px var(--earth-vignette);
  }

  /* The lens chips: one horizontal, swipeable row along the very bottom
     edge — the first thing a thumb reaches. The dock reserves the row as
     --dock-lens and stacks its tray above it, so the two never collide.
     z 4 and up sit above the sky's field (z 2) — see DockView. */
  .lensbar {
    position: absolute;
    left: 0.9rem;
    right: 0.9rem;
    bottom: calc(0.9rem + env(safe-area-inset-bottom));
    z-index: 4;
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    padding: 0.15rem 0.1rem;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .lensbar::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 2.2rem;
    padding: 0 0.85rem;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: color-mix(in srgb, var(--card) 88%, transparent);
    color: var(--ink-soft);
    font-size: 0.82rem;
    font-weight: 700;
    font-family: inherit;
    white-space: nowrap;
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(6px);
  }
  .chip.active {
    border-color: var(--c);
    background: color-mix(in srgb, var(--c) 22%, var(--card));
    color: var(--ink);
  }
  .cdot {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    background: var(--c);
    flex: none;
  }

  /* The tapped cell's contents — a floating card above the lens bar. */
  .cellpanel {
    position: absolute;
    left: 0.9rem;
    bottom: calc(var(--dock-tray, 0px) + 0.8rem);
    z-index: 5;
    width: min(21rem, calc(100% - 6rem));
    max-height: 60%;
    overflow-y: auto;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow-soft);
    padding: 0.7rem 0.9rem;
  }
  .cellpanel header {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }
  .cellpanel strong {
    color: var(--ink);
    font-size: 0.9rem;
  }
  .cellpanel code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.68rem;
    color: var(--muted);
  }
  .closep,
  .backp {
    flex: none;
    width: 1.8rem;
    height: 1.8rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 1.2rem;
    line-height: 1;
  }
  .backp {
    margin-left: -0.35rem;
    font-size: 1.5rem;
    color: var(--ink-soft);
  }
  .cellpanel .hint,
  .cellpanel .count {
    margin: 0.55rem 0 0;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .cellpanel ul {
    margin: 0.35rem 0 0;
    padding: 0;
    list-style: none;
  }
  .cellpanel li {
    border-top: 1px solid var(--line);
  }
  /* Each row is a tap-through to the record's details. */
  .rowbtn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0;
    background: none;
    border: none;
    text-align: left;
    font-family: inherit;
    font-size: 0.86rem;
    color: var(--ink);
  }
  .rowbtn:active {
    opacity: 0.7;
  }
  .rowlabel {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    flex: none;
    color: var(--muted);
    font-size: 1.1rem;
    line-height: 1;
  }

  /* The record's details: headline, then label/value pairs off its JSON. */
  .detail h3 {
    margin: 0.55rem 0 0.3rem;
    font-size: 0.98rem;
    font-weight: 700;
    color: var(--ink);
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .detail dl {
    margin: 0;
  }
  .detail .row {
    display: grid;
    grid-template-columns: 6.2rem 1fr;
    gap: 0.5rem;
    padding: 0.4rem 0;
    border-top: 1px solid var(--line);
    font-size: 0.84rem;
  }
  .detail .row.long {
    grid-template-columns: 1fr;
    gap: 0.15rem;
  }
  .detail dt {
    color: var(--muted);
    font-weight: 600;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding-top: 0.1rem;
  }
  .detail dd {
    margin: 0;
    color: var(--ink);
    overflow-wrap: anywhere;
    white-space: pre-line;
  }
  .detail a {
    color: var(--teal-deep);
    text-decoration: underline;
  }
  .empty {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 5;
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
</style>
