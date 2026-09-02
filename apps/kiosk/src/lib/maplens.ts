// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The dock map's lens layer, kept in lock-step with the web dashboard's map
// (apps/web/src/components/Map.svelte): the same lens catalog and colours,
// the same zoom ↔ H3-resolution bands, and the same persisted presence-cache
// row format — so a cell that lights up on the dashboard lights up here too,
// at the same zoom, in the same colour. Pure data + functions; the Mapbox
// wiring lives in DockMap.svelte.

import { cellToChildren, getRes0Cells, polygonToCells } from "h3-js";

/** The dashboard map's lens catalog, colour-for-colour. */
export const LENSES = [
  { id: "quests", color: "#f44336" },
  { id: "needs", color: "#2196f3" },
  { id: "offers", color: "#4caf50" },
  { id: "communities", color: "#ff9800" },
  { id: "organizations", color: "#9c27b0" },
  { id: "projects", color: "#3f51b5" },
  { id: "currencies", color: "#e91e63" },
  { id: "people", color: "#607d8b" },
  { id: "holons", color: "#ff5722" },
  { id: "events", color: "#fbc02d" },
  { id: "library", color: "#00bcd4" },
  { id: "roles", color: "#795548" },
  { id: "announcements", color: "#ffc107" },
  { id: "expenses", color: "#8bc34a" },
  { id: "checklists", color: "#009688" },
  { id: "appreciations", color: "#f06292" },
  { id: "rea_events", color: "#673ab7" },
  { id: "canvases", color: "#455a64" },
] as const;

export type LensId = (typeof LENSES)[number]["id"];

export function lensColor(id: LensId): string {
  return LENSES.find((l) => l.id === id)?.color ?? "#088";
}

export function isLensId(v: unknown): v is LensId {
  return typeof v === "string" && LENSES.some((l) => l.id === v);
}

// Zoom ↔ resolution bands, verbatim from the dashboard map so the grid and
// the lit cells line up cell-for-cell across the two surfaces.
const ZOOM_BANDS: ReadonlyArray<readonly [number, number]> = [
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

/** The H3 resolution the map works at for a given zoom (dashboard bands). */
export function zoomToResolution(zoom: number): number {
  for (const [z, r] of ZOOM_BANDS) if (zoom <= z) return r;
  return 15;
}

/** The zoom where a cell of `resolution` reads naturally (goToHex-style). */
export function resolutionToZoom(resolution: number): number {
  const band = ZOOM_BANDS.find(([, r]) => r === resolution);
  return band ? band[0] : 22.0;
}

// ── Viewport grid ────────────────────────────────────────────────────────--

/** A map viewport in degrees, as Mapbox reports it: longitudes may be
 *  unwrapped past ±180 when the world repeats, latitudes stop near ±85. */
export type ViewBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** Every cell on the globe at `res` — the res-0 base cells, or their
 *  descendants. Only sensible for coarse resolutions (0 → 122, 1 → 842,
 *  2 → 5882 cells); finer ones return nothing rather than tens of thousands
 *  of polygons — no viewport wide enough to need them exists at those zooms. */
export function globalCells(res: number): string[] {
  if (res < 0 || res > 2) return [];
  const base = getRes0Cells();
  return res === 0 ? base : base.flatMap((c) => cellToChildren(c, res));
}

/**
 * The cells covering a viewport at `res`. h3's polygon fill silently returns
 * nothing for a polygon wider than half the globe — exactly the fully
 * zoomed-out kiosk view — so a world-wide box is served from the global cell
 * set instead. Longitudes are re-wrapped so the west edge sits in [-180, 180)
 * (h3 copes with the east edge running past 180), and latitudes are kept off
 * the poles, where the polygon fill degenerates.
 */
export function viewportCells(box: ViewBox, res: number): string[] {
  let { west, east } = box;
  const span = east - west;
  if (!(span > 0)) return [];
  if (span >= 180) return globalCells(res);
  while (west < -180) {
    west += 360;
    east += 360;
  }
  while (west >= 180) {
    west -= 360;
    east -= 360;
  }
  const north = Math.min(89.5, box.north);
  const south = Math.max(-89.5, box.south);
  if (!(north > south)) return [];
  try {
    return polygonToCells(
      [
        [north, west],
        [north, east],
        [south, east],
        [south, west],
        [north, west],
      ],
      res,
    );
  } catch {
    return [];
  }
}

/**
 * How strongly a grid cell is drawn given where its centre sits in the
 * viewport, `nx`/`ny` being the position normalised to [-1, 1] across the
 * width and height. Full strength in the middle disk, dissolving smoothly
 * toward the edge and gone by the corners — the wequest map's hex disk
 * fading into its rounded card.
 */
export function edgeFade(nx: number, ny: number): number {
  const d = Math.hypot(nx, ny);
  const inner = 0.5;
  const outer = 1.1;
  if (d <= inner) return 1;
  if (d >= outer) return 0;
  const t = (d - inner) / (outer - inner);
  const smooth = t * t * (3 - 2 * t);
  return Math.round((1 - smooth) * 100) / 100;
}

// ── Presence cache ───────────────────────────────────────────────────────--
//
// Per-(lens, hex) "does this cell contain anything" rows, persisted to
// localStorage in the dashboard's format — `{ [hex]: [ts, 0|1] }` — so a
// refresh paints last-known highlights instantly instead of waiting on the
// Gun round-trip. Rows expire after the same 7-day TTL.

export type PresenceEntry = { has: boolean; ts: number };

export const PRESENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Parse a persisted presence blob, dropping expired or malformed rows. */
export function parsePresence(
  raw: string | null,
  now = Date.now(),
  ttl = PRESENCE_TTL_MS,
): Map<string, PresenceEntry> {
  const out = new Map<string, PresenceEntry>();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, [number, 0 | 1]>;
    if (!parsed || typeof parsed !== "object") return out;
    for (const [hex, tuple] of Object.entries(parsed)) {
      if (!Array.isArray(tuple)) continue;
      const [ts, hasNum] = tuple;
      if (typeof ts !== "number" || now - ts > ttl) continue;
      out.set(hex, { has: hasNum === 1, ts });
    }
  } catch {
    /* corrupt blob — start fresh */
  }
  return out;
}

/** Serialize presence rows back into the dashboard's persisted format. */
export function serializePresence(
  entries: ReadonlyMap<string, PresenceEntry>,
): string {
  const out: Record<string, [number, 0 | 1]> = {};
  for (const [hex, e] of entries) out[hex] = [e.ts, e.has ? 1 : 0];
  return JSON.stringify(out);
}

const RECORD_FIELDS = [
  "id",
  "title",
  "name",
  "label",
  "text",
  "description",
] as const;

/**
 * Whether an emission is a real lens record at all. Gun leaks graph metadata
 * through subscribe on some cells — HAM state fragments like
 * `{ true: 1730… }` under key ">", soul refs like `{ "#": true }` — and one
 * junk emission must not light a cell on the map. Every real record across
 * the lenses carries at least one of these identity/content fields.
 */
export function looksLikeRecord(item: unknown): boolean {
  const it = item as Record<string, unknown> | null;
  if (it == null || typeof it !== "object" || Array.isArray(it)) return false;
  return RECORD_FIELDS.some((f) => it[f] != null);
}

/**
 * Whether one emitted item lights its cell — the dashboard's rule: any real
 * record counts except tombstones, and a quest additionally must still be
 * open (completed quests must not keep a cell lit).
 */
export function countsAsPresent(lens: LensId, item: unknown): boolean {
  if (!looksLikeRecord(item)) return false;
  const it = item as { _deleted?: unknown; status?: unknown };
  if (it._deleted === true) return false;
  if (lens === "quests" && it.status === "completed") return false;
  return true;
}

/**
 * A one-line human label for a lens item in the cell panel. Lenses carry
 * different shapes (quests have `title`, people have `name`, announcements
 * have `text`…) — take the first present, trimmed to a tap-list length.
 */
export function itemLabel(item: unknown): string {
  const it = item as Record<string, unknown> | null;
  if (it == null || typeof it !== "object") return "";
  for (const field of ["title", "name", "label", "text", "description"]) {
    const v = it[field];
    if (typeof v === "string" && v.trim()) {
      const line = v.trim().split("\n")[0];
      return line.length > 80 ? `${line.slice(0, 79)}…` : line;
    }
  }
  return String(it.id ?? "");
}
