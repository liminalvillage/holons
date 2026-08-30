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
