// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Places by name: the Mapbox geocoder behind the map's search box and the
// hex picker's. This module is the request and the reading of its answer —
// what a query asks for and what a row carries — so the boxes only render.

/** A place the geocoder found. */
export type PlaceHit = {
  id: string;
  /** The place's own name ("Bologna"). */
  name: string;
  /** Where that is ("Emilia-Romagna, Italy") — empty when it has no parent. */
  context: string;
  /** Name and context in one line, as the geocoder writes it. */
  label: string;
  lat: number;
  lng: number;
  /** West, south, east, north — only places with an extent carry one. */
  bbox?: [number, number, number, number];
};

export type PlaceSearchOptions = {
  /** Mapbox place types to keep (`place,locality,…`); all of them when unset. */
  types?: string;
  limit?: number;
  /** Rank what is near here first — the map's centre. */
  proximity?: { lat: number; lng: number } | null;
  /** The language to name places in. */
  language?: string;
  signal?: AbortSignal;
};

const ENDPOINT = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** The geocoder request for a query. */
export function placesUrl(
  query: string,
  token: string,
  opts: PlaceSearchOptions = {},
): string {
  const params = new URLSearchParams({
    access_token: token,
    limit: String(opts.limit ?? 5),
  });
  if (opts.types) params.set("types", opts.types);
  if (opts.language) params.set("language", opts.language);
  const near = opts.proximity;
  if (near && finite(near.lat) && finite(near.lng))
    params.set("proximity", `${near.lng},${near.lat}`);
  return `${ENDPOINT}/${encodeURIComponent(query.trim())}.json?${params}`;
}

/**
 * The geocoder's answer as rows. A feature with no usable centre is not a
 * place anyone can be flown to, so it is dropped rather than listed.
 */
export function parsePlaces(data: unknown): PlaceHit[] {
  const features = (data as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: PlaceHit[] = [];
  for (const f of features as Array<Record<string, any>>) {
    const [lng, lat] = Array.isArray(f?.center) ? f.center : [];
    if (!finite(lat) || !finite(lng)) continue;
    const label = String(f.place_name ?? f.text ?? "").trim();
    const name = String(f.text ?? "").trim() || label;
    if (!name) continue;
    const context = label.startsWith(name)
      ? label.slice(name.length).replace(/^[\s,]+/, "")
      : "";
    const hit: PlaceHit = {
      id: String(f.id ?? `${lng},${lat}`),
      name,
      context,
      label: label || name,
      lat,
      lng,
    };
    if (Array.isArray(f.bbox) && f.bbox.length === 4 && f.bbox.every(finite))
      hit.bbox = f.bbox as PlaceHit["bbox"];
    out.push(hit);
  }
  return out;
}

/** Ask the geocoder. Throws on a failed request — the caller decides what an
 *  unreachable geocoder looks like. */
export async function searchPlaces(
  query: string,
  token: string,
  opts: PlaceSearchOptions = {},
): Promise<PlaceHit[]> {
  if (!token || !query.trim()) return [];
  const res = await fetch(placesUrl(query, token, opts), {
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`geocoder answered ${res.status}`);
  return parsePlaces(await res.json());
}
