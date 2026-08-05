// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Real H3 neighbourhood geometry for the home map: the cells around the
// holon's `settings.hex`, projected into the phone viewport with a local
// equirectangular projection (fine at neighbourhood scale).

import {
  cellToBoundary,
  cellToLatLng,
  greatCircleDistance,
  gridDisk,
  UNITS,
} from "h3-js";

export interface ProjectedCell {
  cell: string;
  /** SVG points string in viewport coordinates. */
  pts: string;
  /** Cell centre in viewport coordinates. */
  cx: number;
  cy: number;
  /** Great-circle distance from the centre cell, km. */
  distKm: number;
}

/** The centre cell plus `rings` rings around it. */
export function neighborhood(center: string, rings = 4): string[] {
  return gridDisk(center, rings);
}

/**
 * Project cells into a w×h viewport. Local equirectangular around the centre
 * cell (x: east, y: south), uniformly scaled so the whole disk fits.
 */
export function projectCells(
  center: string,
  cells: string[],
  w: number,
  h: number,
): ProjectedCell[] {
  const [clat, clng] = cellToLatLng(center);
  const cosLat = Math.cos((clat * Math.PI) / 180);
  const toLocal = (lat: number, lng: number): [number, number] => [
    (lng - clng) * cosLat,
    -(lat - clat),
  ];

  const raw = cells.map((cell) => {
    const boundary = cellToBoundary(cell).map(([lat, lng]) =>
      toLocal(lat, lng),
    );
    const [plat, plng] = cellToLatLng(cell);
    return {
      cell,
      boundary,
      center: toLocal(plat, plng),
      distKm: greatCircleDistance([clat, clng], [plat, plng], UNITS.km),
    };
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of raw) {
    for (const [x, y] of r.boundary) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min(w / spanX, h / spanY);
  // Centre the (uniformly scaled) disk in the viewport.
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  const px = (x: number) => (x - minX) * scale + offX;
  const py = (y: number) => (y - minY) * scale + offY;

  return raw.map((r) => ({
    cell: r.cell,
    pts: r.boundary
      .map(([x, y]) => px(x).toFixed(1) + "," + py(y).toFixed(1))
      .join(" "),
    cx: px(r.center[0]),
    cy: py(r.center[1]),
    distKm: r.distKm,
  }));
}

/** "400 m" / "1.2 km" style label. */
export function distLabel(km: number): string {
  return km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(1) + " km";
}
