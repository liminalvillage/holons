// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Tag helpers shared by every projection codec.

import type { EventTemplate, ProjectionCtx } from './types.js';

/** Origin pointer: `['holons', lens, holon, id]` — lets a later phase map a standard event back to its record. */
export const HOLONS_ORIGIN_TAG = 'holons';
/** Reserved for phase 2: Holons-only fields the standard kind cannot express. */
export const X_HOLONS_TAG = 'x-holons';
export const CLIENT_TAG_VALUE = 'holons';
export const DELETION_KIND = 5;

/**
 * `d` tag for a projected addressable event: `holons:<lens>:<holon>:<id>`.
 * `:`-separated because holon ids may be negative Telegram chat ids, and
 * holon-scoped so H3/federation copies of one record never collide.
 */
export function projectionDTag(lens: string, holon: string, id: string | number): string {
  return `holons:${lens}:${holon}:${id}`;
}

export function projectionAddress(kind: number, pubkey: string, dTag: string): string {
  return `${kind}:${pubkey}:${dTag}`;
}

/** Same grammar as Elinor's group hashtag, so `#t = group-<chatId>` works across both. */
export function groupTag(holon: string): string {
  return `group-${holon}`;
}

/** Tags every projected event carries. */
export function commonTags(ctx: ProjectionCtx, holon: string, lens: string, id: string | number): string[][] {
  return [
    ['n', ctx.appName],
    ['h', holon],
    ['t', groupTag(holon)],
    [HOLONS_ORIGIN_TAG, lens, holon, String(id)],
    ['client', CLIENT_TAG_VALUE],
  ];
}

export function nowOf(ctx: ProjectionCtx): number {
  return ctx.now ? ctx.now() : Math.floor(Date.now() / 1000);
}

/** ISO instant (or anything `Date` parses) → unix seconds; `undefined` when unparsable. */
export function isoToUnix(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e11 ? Math.floor(value / 1000) : Math.floor(value);
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}

/** True for a bare `YYYY-MM-DD`. */
export function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isUrl(value: unknown): value is string {
  return typeof value === 'string' && /^(https?:\/\/|data:image\/)/i.test(value);
}

/** Build a NIP-09 deletion for a set of addressable events. */
export function deletionTemplate(ctx: ProjectionCtx, addresses: Array<{ kind: number; dTag: string }>, reason = ''): EventTemplate {
  const tags: string[][] = [['n', ctx.appName]];
  const kinds = new Set<number>();
  for (const { kind, dTag } of addresses) {
    tags.push(['a', projectionAddress(kind, ctx.holonPubkey, dTag)]);
    kinds.add(kind);
  }
  for (const k of kinds) tags.push(['k', String(k)]);
  return { kind: DELETION_KIND, created_at: nowOf(ctx), tags, content: reason };
}

// ---------------------------------------------------------------------------
// Geohash (base32, no dependency) — for NIP-52/NIP-99 `g` tags.
// ---------------------------------------------------------------------------

const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohashEncode(lat: number, lng: number, precision = 7): string {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = '';
  let bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngMin = mid; } else { ch <<= 1; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latMin = mid; } else { ch <<= 1; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) { hash += GEOHASH_ALPHABET[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

/** Geohash of an H3 cell's centre, or `undefined` without an injected `cellToLatLng`. */
export function geohashFromH3(hex: unknown, ctx: ProjectionCtx, precision = 7): string | undefined {
  if (typeof hex !== 'string' || !hex || !ctx.cellToLatLng) return undefined;
  try {
    const [lat, lng] = ctx.cellToLatLng(hex);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    return geohashEncode(lat, lng, precision);
  } catch {
    return undefined;
  }
}

/** Push `[name, value]` only when value is a non-empty string. */
export function pushIf(tags: string[][], name: string, value: unknown, ...rest: string[]): void {
  if (typeof value === 'string' && value.trim()) tags.push([name, value, ...rest]);
  else if (typeof value === 'number' && Number.isFinite(value)) tags.push([name, String(value), ...rest]);
}

// ---------------------------------------------------------------------------
// Reverse helpers (phase 2 — folding external edits back into records).
// ---------------------------------------------------------------------------

/** First value of tag `name`, or undefined. */
export function tagValue(event: { tags: string[][] }, name: string): string | undefined {
  return (event.tags || []).find((t) => t[0] === name)?.[1];
}

/** Every `[name, …]` tag, without the name. */
export function tagValues(event: { tags: string[][] }, name: string): string[][] {
  return (event.tags || []).filter((t) => t[0] === name).map((t) => t.slice(1));
}

/** Inverse of `projectionDTag`; `null` for any other grammar (e.g. Elinor's `shift-…`). */
export function parseProjectionDTag(d: unknown): { lens: string; holon: string; id: string } | null {
  if (typeof d !== 'string') return null;
  const parts = d.split(':');
  if (parts.length < 4 || parts[0] !== 'holons' || !parts[1] || !parts[2]) return null;
  const id = parts.slice(3).join(':');
  if (!id) return null;
  return { lens: parts[1], holon: parts[2], id };
}

/** `<kind>:<pubkey>:<d>` → parts; `null` when malformed. */
export function parseProjectionAddress(a: unknown): { kind: number; pubkey: string; dTag: string } | null {
  if (typeof a !== 'string') return null;
  const i = a.indexOf(':');
  const j = a.indexOf(':', i + 1);
  if (i <= 0 || j <= i) return null;
  const kind = Number(a.slice(0, i));
  const pubkey = a.slice(i + 1, j);
  const dTag = a.slice(j + 1);
  if (!Number.isInteger(kind) || !/^[0-9a-f]{64}$/i.test(pubkey) || !dTag) return null;
  return { kind, pubkey, dTag };
}

/** Unix seconds → ISO instant (`undefined` when not a finite number). */
export function unixToIso(value: unknown): string | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return new Date(n * 1000).toISOString();
}

/** Shallow structural equality for plain records (arrays/objects, JSON-safe). */
export function sameRecord(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameRecord((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
