// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The dock map's lens layer, kept in lock-step with the web dashboard's map
// (apps/web/src/components/Map.svelte): the same lens catalog and colours,
// the same zoom ↔ H3-resolution bands, and the same persisted presence-cache
// row format — so a cell that lights up on the dashboard lights up here too,
// at the same zoom, in the same colour. Pure data + functions; the Mapbox
// wiring lives in DockMap.svelte.

import {
  cellToBoundary,
  cellToChildren,
  getHexagonEdgeLengthAvg,
  getRes0Cells,
  polygonToCells,
  UNITS,
} from "h3-js";

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

// ── Cell outlines ────────────────────────────────────────────────────────--
//
// An H3 cell edge is a straight line on the icosahedron face it lives on —
// which is a GREAT-CIRCLE arc on the globe, not a straight line in lng/lat.
// Mapbox draws a GeoJSON segment straight in projected space, so handing it
// the six bare vertices draws six chords: at coarse resolutions and high
// latitudes, where Mercator stretches hard, those chords miss the true edge
// by hundreds of pixels and the hexagon reads as bowed the wrong way. So we
// walk each edge along the arc instead. Fine cells come back untouched — an
// edge shorter than the step is one segment, exactly as before.

const DEG = Math.PI / 180;
type Vec3 = [number, number, number];

const toVec = (lng: number, lat: number): Vec3 => [
  Math.cos(lat * DEG) * Math.cos(lng * DEG),
  Math.cos(lat * DEG) * Math.sin(lng * DEG),
  Math.sin(lat * DEG),
];

const toLngLat = ([x, y, z]: Vec3): [number, number] => [
  Math.atan2(y, x) / DEG,
  Math.asin(Math.max(-1, Math.min(1, z))) / DEG,
];

/** The angle subtended by two points on the globe, in degrees. */
export function arcDegrees(a: [number, number], b: [number, number]): number {
  const [ax, ay, az] = toVec(a[0], a[1]);
  const [bx, by, bz] = toVec(b[0], b[1]);
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  return Math.acos(dot) / DEG;
}

/** The point `t` of the way along the great circle from `a` to `b`. */
function slerp(
  a: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  const A = toVec(a[0], a[1]);
  const B = toVec(b[0], b[1]);
  const dot = Math.max(
    -1,
    Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]),
  );
  const omega = Math.acos(dot);
  if (omega < 1e-9) return a;
  const s = Math.sin(omega);
  const k1 = Math.sin((1 - t) * omega) / s;
  const k2 = Math.sin(t * omega) / s;
  return toLngLat([
    A[0] * k1 + B[0] * k2,
    A[1] * k1 + B[1] * k2,
    A[2] * k1 + B[2] * k2,
  ]);
}

/**
 * Longitudes made continuous along the ring: each step is nudged by whole
 * turns until it is the short way round, so a cell straddling ±180° stays a
 * local polygon instead of painting a band across the whole world. Mapbox
 * wraps the out-of-range result back for us.
 */
function unwrapLongitudes(pts: Array<[number, number]>): number[][] {
  const out: number[][] = [];
  let offset = 0;
  let prev: number | null = null;
  for (const [lng, lat] of pts) {
    if (prev !== null) {
      const step = lng + offset - prev;
      if (step > 180) offset -= 360;
      else if (step < -180) offset += 360;
    }
    prev = lng + offset;
    out.push([prev, lat]);
  }
  return out;
}

/** How finely a cell edge is walked, in degrees of arc. Half a degree puts
 *  the worst coarse-cell error under a couple of pixels away from the poles,
 *  and leaves every cell at res 4 and finer as its plain six vertices. */
export const RING_STEP_DEGREES = 0.5;

/**
 * A cell's outline as a closed GeoJSON ring of `[lng, lat]`, its edges
 * followed along the globe rather than cut straight across.
 */
export function cellRing(
  cell: string,
  stepDegrees = RING_STEP_DEGREES,
): number[][] {
  const verts = cellToBoundary(cell, true) as Array<[number, number]>;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const steps = Math.max(1, Math.ceil(arcDegrees(a, b) / stepDegrees));
    for (let k = 0; k < steps; k++)
      pts.push(k === 0 ? a : slerp(a, b, k / steps));
  }
  const ring = unwrapLongitudes(pts);
  ring.push([...ring[0]]);
  return ring;
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

/** Degrees of latitude per kilometre — the meridian is 40 008 km round. */
const KM_PER_DEGREE = 40008 / 360;

/**
 * A viewport grown enough that every cell TOUCHING it comes back from the
 * fill, not just the ones centred inside it — h3 keeps a cell when its
 * centre lands in the polygon, so the bare viewport leaves a bald ring
 * around the edge where the straddling hexagons should be. A whole cell of
 * margin covers the worst case (a cell centred just outside, reaching in by
 * nearly its full radius); a tenth of the view on top keeps the grid ahead
 * of a small pan. Longitude degrees shrink toward the poles, so the
 * east-west margin is widened by the same factor.
 *
 * The margin never pushes a sub-global viewport past the half-globe line,
 * where h3's fill gives up and only base cells come back.
 */
export function paddedViewBox(view: ViewBox, res: number): ViewBox {
  const span = view.east - view.west;
  const cellDeg = (getHexagonEdgeLengthAvg(res, UNITS.km) * 2) / KM_PER_DEGREE;
  const midLat = (view.north + view.south) / 2;
  // cos() collapses at the poles; a floor keeps the margin finite there.
  const shrink = Math.max(0.15, Math.cos(midLat * DEG));
  const dy = Math.max((view.north - view.south) * 0.1, cellDeg);
  const dx = Math.min(
    Math.max(span * 0.1, cellDeg / shrink),
    Math.max(0, (179.9 - span) / 2),
  );
  return {
    west: view.west - dx,
    east: view.east + dx,
    south: view.south - dy,
    north: view.north + dy,
  };
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
 * How strongly a grid cell's outline is drawn, given how near its centre is
 * to the rim of the map: `edge` is the distance to the NEAREST edge as a
 * fraction of the half-box (0 at the middle, 1 on an edge, more outside).
 *
 * Full strength across almost the whole map, thinning across a band at the
 * rim and gone a little way past it — so the grid dissolves into the edge
 * instead of being cut off by it, while the cells straddling the edge still
 * draw. The distance is to an edge, not out from the centre: a hexagon at
 * the middle of the bottom edge is exactly as near the rim as one in a
 * corner, and a centre-out measure would wrongly fade the whole map into a
 * disk.
 */
export function rimFade(edge: number): number {
  const inner = 0.86;
  const outer = 1.16;
  if (edge <= inner) return 1;
  if (edge >= outer) return 0;
  const t = (edge - inner) / (outer - inner);
  const smooth = t * t * (3 - 2 * t);
  return Math.round((1 - smooth) * 100) / 100;
}

// ── Presence cache ───────────────────────────────────────────────────────--
//
// Per-(lens, hex) "does this cell contain anything" rows, persisted to
// localStorage in the dashboard's format — `{ [hex]: [ts, 0|1] }` — so a
// refresh paints last-known highlights instantly instead of waiting on the
// relay round-trip. Rows expire after the same 7-day TTL.

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
  "content",
  "description",
] as const;

/**
 * Whether an emission is a real lens record at all: every real record across
 * the lenses carries at least one of these identity/content fields, and a
 * malformed one must not light a cell on the map.
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

/** The fields a record's headline can live in, best first — `id` is what a
 *  record is, not what it is called, so it is never a label. */
const LABEL_FIELDS = RECORD_FIELDS.filter((f) => f !== "id");

/**
 * A one-line human label for a lens item in the cell panel. Lenses carry
 * different shapes (quests have `title`, people have `name`, announcements
 * have `text`…) — take the first present, trimmed to a tap-list length.
 */
export function itemLabel(item: unknown): string {
  const it = item as Record<string, unknown> | null;
  if (it == null || typeof it !== "object") return "";
  for (const field of LABEL_FIELDS) {
    const v = it[field];
    if (typeof v === "string" && v.trim()) {
      const line = v.trim().split("\n")[0];
      return line.length > 80 ? `${line.slice(0, 79)}…` : line;
    }
  }
  return String(it.id ?? "");
}

// ── Adding to a cell (the map's quick add) ───────────────────────────────--
//
// The cell panel says what lives here, so with a cell AND a lens in hand the
// dock's "+" adds into that pair instead of adding a hub — through a form
// built from the lens's own schema (see lib/lensform.ts). This table holds
// what the schema can't say: which field is the record's HEADLINE (the line
// the panel lists it by, so the line the form asks for first), and the few
// constants a lens's record carries whatever anyone types.
//
// Two lenses are deliberately missing: an appreciation names a giver AND a
// receiver, an REA event a provider AND a receiver — a second person a map
// tap can't know, and neither record means anything without them. Over those
// the "+" stays a hub add.

/** Where each addable lens carries the line someone types first. */
const HEADLINE_FIELD: Partial<
  Record<LensId, "title" | "name" | "content" | "description" | "id">
> = {
  quests: "title",
  needs: "title",
  offers: "title",
  communities: "name",
  organizations: "name",
  projects: "name",
  currencies: "name",
  people: "name",
  holons: "name",
  events: "title",
  // A library thing is keyed BY its name — `addItem(db, holon, name)` — so
  // the line someone types becomes the record's id, not a field beside it.
  library: "id",
  roles: "title",
  announcements: "content",
  expenses: "description",
  checklists: "title",
  canvases: "title",
};

/** The field a lens's records are listed by, or null when the map can't add
 *  to that lens at all. */
export function headlineField(lens: LensId): string | null {
  return HEADLINE_FIELD[lens] ?? null;
}

/** Whether the map offers to add a record of this lens to a cell. */
export function canAddToCell(lens: LensId): boolean {
  return lens in HEADLINE_FIELD;
}

/**
 * What a lens's record carries beyond the headline, the moment's own
 * bookkeeping (see lensform's `baseRecord`) and whatever is typed: an event
 * says which lens it belongs to, a checklist starts with no items, a library
 * thing that isn't given a kind is simply "other".
 */
export function lensScaffold(lens: LensId): Record<string, unknown> {
  if (lens === "events") return { type: "event" };
  if (lens === "library") return { type: "other" };
  if (lens === "checklists") return { type: "checklist", items: [] };
  return {};
}

/**
 * A bare headline record for `lens` — what an add writes when there is no
 * form to fill in (the hub noted into its cell), or null when the lens isn't
 * addable or the line is blank.
 */
export function newLensItem(
  lens: LensId,
  text: string,
  id: string,
): Record<string, unknown> | null {
  const field = HEADLINE_FIELD[lens];
  const headline = (text ?? "").trim();
  if (!field || !headline || !id) return null;
  if (field === "id") return { id: headline, ...lensScaffold(lens) };
  return { id, [field]: headline, ...lensScaffold(lens) };
}

// ── Item details (the cell panel's tap-through) ─────────────────────────--
//
// A lens record is whatever shape its lens writes — a quest carries
// `status`/`when`/`participants`, a library thing `borrower`/`value`, an
// expense `amount`/`currency`… The panel doesn't know the lens's schema, so
// this reads the JSON generically: the well-known fields first, in a fixed
// order and formatted for people (dates localised, people by name, lists
// joined), then whatever other scalar fields the record carries, and never
// the graph's own bookkeeping.

export type DetailRow = { key: string; value: string };

export type DetailOptions = {
  /** How a date is rendered; defaults to the `en` medium date + short time. */
  formatDate?: (d: Date) => string;
  /** Long-text cap (descriptions); other values are capped at a fourth. */
  maxLength?: number;
};

/** Fields shown first, in this order, under a stable row key. */
const DETAIL_ORDER: ReadonlyArray<readonly [key: string, ...fields: string[]]> =
  [
    ["status", "status"],
    ["type", "type"],
    ["category", "category"],
    ["description", "description", "content", "text", "body", "notes"],
    ["when", "when", "date", "start", "startDate", "starts"],
    ["ends", "ends", "end", "endDate", "until"],
    ["location", "location", "address", "place", "geolocation", "geo"],
    ["amount", "amount"],
    ["value", "value", "price"],
    ["participants", "participants", "members", "attendees"],
    ["initiator", "initiator", "author", "creator", "createdByUsername"],
    ["paidBy", "paidBy"],
    ["splitWith", "splitWith"],
    ["borrower", "borrower"],
    ["tags", "tags"],
    ["link", "url", "link", "website", "primaryUrl", "primary_url", "href"],
    ["origin", "_holon"],
    ["created", "created", "createdAt", "timestamp"],
  ];

/** Never rows: the record's identity, its picture, and graph bookkeeping. */
const DETAIL_SKIP = new Set([
  "id",
  "picture",
  "image",
  "images",
  "avatar",
  "currency", // folded into `amount`
  "canvasId",
  "orderIndex",
  "chat",
  "user",
  "bookings",
  "borrowed",
  "borrowerId",
  "borrowerInitials",
  "dependencies",
  "subtasks",
  "appreciation",
  "stoppers",
  "ratings",
  "issues",
  "#",
  ">",
  "_",
]);

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function defaultFormatDate(d: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/** A date from an ISO string or an epoch-millis number, else null. */
function asDate(v: unknown): Date | null {
  if (typeof v === "number" && v > 1e11 && v < 1e14) return new Date(v);
  if (typeof v === "string" && ISO_DATE.test(v.trim())) {
    const d = new Date(v.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** A `{ lat, lng|lon|long }` object as "lat, lng", else null. */
function latLngOf(o: Record<string, unknown>): string | null {
  const lat = o.lat ?? o.latitude;
  const lng = o.lng ?? o.lon ?? o.long ?? o.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/** A person-ish object by its most human handle. */
function personName(v: unknown): string {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  const p = v as Record<string, unknown>;
  for (const f of ["name", "username", "first_name", "title", "label", "id"]) {
    const s = p[f];
    if (typeof s === "string" && s.trim()) return s.trim();
    if (typeof s === "number") return String(s);
  }
  return "";
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Render one field's value for the panel; "" means "leave this row out". */
export function formatDetailValue(
  v: unknown,
  opts: DetailOptions = {},
): string {
  const fmt = opts.formatDate ?? defaultFormatDate;
  const max = opts.maxLength ?? 600;
  if (v == null || v === "") return "";
  const d = asDate(v);
  if (d) return fmt(d);
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return clip(v, max);
  if (Array.isArray(v)) {
    const names = v.map(personName).filter(Boolean);
    if (!names.length) return "";
    return clip(`${names.length} · ${names.join(", ")}`, max);
  }
  if (typeof v === "object") {
    const coords = latLngOf(v as Record<string, unknown>);
    if (coords) return coords;
    const name = personName(v);
    if (name) return clip(name, max);
    // An id-keyed set (participants as {id: {…}}) — count and name them.
    const members = Object.values(v as Record<string, unknown>).filter(
      (m) => m != null && m !== false && m !== 0 && m !== "",
    );
    if (!members.length) return "";
    const names = members.map(personName).filter(Boolean);
    return clip(
      names.length
        ? `${names.length} · ${names.join(", ")}`
        : String(members.length),
      max,
    );
  }
  return "";
}

/**
 * The rows the panel shows for one tapped record: well-known fields first
 * (see DETAIL_ORDER), then the record's remaining scalar fields, minus the
 * field already used as its headline (see itemLabel) and the skip list.
 */
export function itemDetails(
  item: unknown,
  opts: DetailOptions = {},
): DetailRow[] {
  const it = item as Record<string, unknown> | null;
  if (it == null || typeof it !== "object" || Array.isArray(it)) return [];
  const short = { ...opts, maxLength: Math.ceil((opts.maxLength ?? 600) / 4) };
  const rows: DetailRow[] = [];
  const used = new Set<string>();

  // The headline field is the panel's title — don't repeat it as a row,
  // nor any other field that merely says the same thing (`name` = `title`).
  let headline = "";
  for (const f of ["title", "name", "label", "text", "description"]) {
    const v = it[f];
    if (typeof v === "string" && v.trim()) {
      used.add(f);
      headline = v.trim();
      break;
    }
  }
  const echoesHeadline = (v: unknown) =>
    typeof v === "string" && v.trim() === headline;

  for (const [key, ...fields] of DETAIL_ORDER) {
    for (const f of fields) {
      if (used.has(f) || !formatDetailValue(it[f], short)) continue; // absent
      used.add(f);
      if (echoesHeadline(it[f])) break;
      let value: string;
      if (key === "amount" && typeof it.amount === "number") {
        const cur = typeof it.currency === "string" ? it.currency : "";
        value = cur ? `${it.amount} ${cur}` : String(it.amount);
      } else {
        value = formatDetailValue(it[f], key === "description" ? opts : short);
      }
      if (value) rows.push({ key, value });
      break; // the first present alias wins the row
    }
  }

  const rest = Object.keys(it)
    .filter(
      (k) =>
        !used.has(k) &&
        !DETAIL_SKIP.has(k) &&
        !k.startsWith("_") &&
        !echoesHeadline(it[k]) &&
        (typeof it[k] === "string" ||
          typeof it[k] === "number" ||
          typeof it[k] === "boolean"),
    )
    .sort();
  for (const k of rest) {
    const value = formatDetailValue(it[k], short);
    if (value) rows.push({ key: k, value });
  }
  return rows;
}
