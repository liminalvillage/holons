// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Demand-heat layer on the real mapbox basemap: the H3 neighbourhood around
// the home hex rendered as fill/line/count layers, with tap-to-inspect.
// mapbox-gl loads lazily; callers fall back to the SVG disk without a token.

import { cellToBoundary, cellToLatLng } from "h3-js";
import { HEAT } from "./hex";
import { neighborhood } from "./geomap";

export const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

export interface HeatInfo {
  count: number;
  tags: string[];
  /** Emergency mode: some need in the cell is marked urgent. */
  urgent?: boolean;
}

export interface HexHeatMap {
  setHeat(heat: Record<string, HeatInfo>): void;
  setSelected(cell: string | null): void;
  destroy(): void;
}

function ring(cell: string): number[][] {
  const r = (cellToBoundary(cell, true) as Array<[number, number]>).map(
    ([lng, lat]) => [lng, lat],
  );
  r.push(r[0]);
  return r;
}

function heatFC(cells: string[], heat: Record<string, HeatInfo>): any {
  return {
    type: "FeatureCollection",
    features: cells.map((cell) => ({
      type: "Feature",
      properties: {
        cell,
        count: heat[cell]?.count ?? 0,
        urgent: heat[cell]?.urgent === true,
      },
      geometry: { type: "Polygon", coordinates: [ring(cell)] },
    })),
  };
}

/**
 * Mount the heat map into `container`, centred on `homeHex`'s 4-ring
 * neighbourhood. `onTapCell` fires with the cell id and its distance rank
 * when a hexagon is tapped.
 */
export async function createHexHeatMap(
  container: HTMLElement,
  homeHex: string,
  onTapCell: (cell: string) => void,
): Promise<HexHeatMap> {
  const [{ default: mapboxgl }] = await Promise.all([
    import("mapbox-gl"),
    import("mapbox-gl/dist/mapbox-gl.css"),
  ]);
  mapboxgl.accessToken = MAPBOX_TOKEN;

  const cells = neighborhood(homeHex, 4);

  // Fit the whole neighbourhood disk.
  let minLng = Infinity,
    maxLng = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const c of cells) {
    for (const [lng, lat] of ring(c)) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  const map = new mapboxgl.Map({
    container,
    style: "mapbox://styles/mapbox/satellite-streets-v12",
    bounds: [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    fitBoundsOptions: { padding: 8 },
    interactive: false,
    attributionControl: false,
  });

  let pendingHeat: Record<string, HeatInfo> = {};
  let pendingSelected: string | null = null;
  let ready = false;

  const [homeLat, homeLng] = cellToLatLng(homeHex);

  map.on("load", () => {
    map.addSource("wq-heat", {
      type: "geojson",
      data: heatFC(cells, pendingHeat),
    });
    map.addLayer({
      id: "wq-heat-fill",
      type: "fill",
      source: "wq-heat",
      paint: {
        "fill-color": [
          "step",
          ["get", "count"],
          "rgba(46,43,37,0.25)",
          1,
          HEAT[1],
          2,
          HEAT[2],
          3,
          HEAT[3],
          4,
          HEAT[4],
        ],
      },
    });
    map.addLayer({
      id: "wq-heat-line",
      type: "line",
      source: "wq-heat",
      paint: { "line-color": "rgba(245,234,216,0.5)", "line-width": 1 },
    });
    // Emergency mode: urgent cells get a loud outline over the normal grid.
    map.addLayer({
      id: "wq-heat-urgent",
      type: "line",
      source: "wq-heat",
      filter: ["==", ["get", "urgent"], true],
      paint: { "line-color": "#e0492f", "line-width": 2.5 },
    });
    map.addLayer({
      id: "wq-heat-count",
      type: "symbol",
      source: "wq-heat",
      filter: [">", ["get", "count"], 0],
      layout: {
        "text-field": ["to-string", ["get", "count"]],
        "text-size": 13,
        "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#f5ead8",
        "text-halo-color": "rgba(32,30,29,0.6)",
        "text-halo-width": 1.2,
      },
    });
    map.addSource("wq-sel", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "wq-sel-line",
      type: "line",
      source: "wq-sel",
      paint: { "line-color": "#f5ead8", "line-width": 2.5 },
    });
    map.addSource("wq-home", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [homeLng, homeLat] },
          },
        ],
      },
    });
    map.addLayer({
      id: "wq-home-dot",
      type: "circle",
      source: "wq-home",
      paint: {
        "circle-radius": 7,
        "circle-color": "#c67139",
        "circle-stroke-color": "#f5ead8",
        "circle-stroke-width": 2.5,
      },
    });
    map.on("click", "wq-heat-fill", (e: any) => {
      const cell = e.features?.[0]?.properties?.cell;
      if (cell) onTapCell(String(cell));
    });
    ready = true;
    if (pendingSelected !== null) api.setSelected(pendingSelected);
  });

  const api: HexHeatMap = {
    setHeat(heat) {
      pendingHeat = heat;
      if (!ready) return;
      (map.getSource("wq-heat") as any)?.setData(heatFC(cells, heat));
    },
    setSelected(cell) {
      pendingSelected = cell;
      if (!ready) return;
      (map.getSource("wq-sel") as any)?.setData({
        type: "FeatureCollection",
        features: cell
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Polygon", coordinates: [ring(cell)] },
              },
            ]
          : [],
      });
    },
    destroy() {
      try {
        map.remove();
      } catch {
        /* already gone */
      }
    },
  };
  return api;
}
