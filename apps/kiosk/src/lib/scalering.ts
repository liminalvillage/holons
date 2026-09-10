// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The radius, drawn. The Offers board's cell scales are real H3 cells — the
// home cell and its parents — so the picture is their true outlines, nested,
// projected flat around the home cell's centre. Pure geometry: the component
// only paints what this returns.

import {
  cellToBoundary,
  cellToLatLng,
  getHexagonEdgeLengthAvg,
  getResolution,
  isValidCell,
} from "h3-js";

export interface RingShape {
  /** The scale option id this ring stands for (`cell:<level>`). */
  id: string;
  cell: string;
  level: number;
  /** SVG polygon points in the ring's own viewBox units. */
  points: string;
  /** Rough width of the cell, corner to corner, in km. */
  acrossKm: number;
}

export interface ScaleRingPicture {
  /** Square viewBox side; the picture is centred at (side/2, side/2). */
  side: number;
  /** Home cell centre in viewBox units — always the middle. */
  centre: { x: number; y: number };
  /** Rings, innermost first. */
  rings: RingShape[];
  /**
   * The ground the square covers, `[west, south, east, north]` in degrees —
   * what a basemap behind the rings must show edge to edge.
   */
  bbox: [number, number, number, number];
}

const KM_PER_DEG = 111.32;

/** Across-corners width of a cell at this resolution, in km. */
export function cellAcrossKm(cell: string): number {
  if (!isValidCell(cell)) return 0;
  return 2 * getHexagonEdgeLengthAvg(getResolution(cell), "km");
}

/** "≈ 1.2 km" / "≈ 45 km" / "≈ 350 m" — the label under the picture. */
export function formatAcross(km: number): string {
  if (!(km > 0)) return "";
  if (km < 1) return `≈ ${Math.round(km * 100) * 10} m`;
  if (km < 10) return `≈ ${km.toFixed(1)} km`;
  return `≈ ${Math.round(km)} km`;
}

/**
 * Nest the chain's cells around the home centre and fit the picture so the
 * `fitLevel` ring fills it (with a little margin). Larger rings run off the
 * edge — the clip is the hint that the market goes on. `null` without a
 * valid home cell.
 */
export function scaleRingPicture(
  chain: string[],
  fitLevel: number,
  side = 100,
): ScaleRingPicture | null {
  const home = chain[0];
  if (!home || !isValidCell(home)) return null;
  const [lat0, lng0] = cellToLatLng(home);
  const cosLat = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
  // Flat local frame in km, east/north of the home centre.
  const toKm = ([lat, lng]: [number, number]): [number, number] => [
    (lng - lng0) * KM_PER_DEG * cosLat,
    (lat - lat0) * KM_PER_DEG,
  ];
  const outlines = chain.map((cell) =>
    cellToBoundary(cell).map((p) => toKm(p as [number, number])),
  );
  const fit =
    outlines[Math.min(Math.max(0, fitLevel), outlines.length - 1)] ??
    outlines[0];
  const radius = Math.max(...fit.map(([x, y]) => Math.hypot(x, y)), 1e-6);
  const scale = ((side / 2) * 0.9) / radius;
  const centre = { x: side / 2, y: side / 2 };
  // Half the square, back in degrees: the square is (side / scale) km wide.
  const halfKm = side / 2 / scale;
  const dLng = halfKm / (KM_PER_DEG * cosLat);
  const dLat = halfKm / KM_PER_DEG;
  const bbox: [number, number, number, number] = [
    lng0 - dLng,
    lat0 - dLat,
    lng0 + dLng,
    lat0 + dLat,
  ];
  const rings = chain.map((cell, level) => ({
    id: `cell:${level}`,
    cell,
    level,
    points: outlines[level]
      .map(
        ([x, y]) =>
          `${(centre.x + x * scale).toFixed(2)},${(centre.y - y * scale).toFixed(2)}`,
      )
      .join(" "),
    acrossKm: cellAcrossKm(cell),
  }));
  return { side, centre, rings, bbox };
}

/**
 * A Mapbox Static Images URL for the ground under the picture: the bbox
 * fitted edge to edge into a square, no logo or attribution baked into the
 * thumbnail (the component credits the map in its tooltip). Empty without a
 * token — the ring then keeps its plain tinted ground.
 */
export function scaleRingMapUrl(
  picture: ScaleRingPicture,
  token: string,
  px = 160,
  style = "mapbox/outdoors-v12",
): string {
  if (!token) return "";
  const bbox = picture.bbox.map((v) => v.toFixed(5)).join(",");
  return (
    `https://api.mapbox.com/styles/v1/${style}/static/[${bbox}]/${px}x${px}@2x` +
    `?padding=0&logo=false&attribution=false&access_token=${encodeURIComponent(token)}`
  );
}
