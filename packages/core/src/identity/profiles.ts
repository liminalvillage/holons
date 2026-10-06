// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Kind-0 profile metadata as a READ: parse one, name it, fetch a batch
// through holosphere's budgeted relay query. A leaf: the kind-0 codec and the
// resolver both build on it.

import type { NostrEventLike } from '../nostr/types.js';
import { cleanName, normalizeId } from './ids.js';

export const PROFILE_KIND = 0;

/** What a kind 0 says about a key, cleaned for display. */
export interface ProfileMeta {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  /** Unix seconds of the event. */
  createdAt: number;
  /** The full content object, for a merge-on-edit that keeps every other field. */
  raw: Record<string, unknown>;
}

const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim());

/** A kind 0 with a JSON object content → its metadata; anything else → null. */
export function parseProfileEvent(event: NostrEventLike | null | undefined): ProfileMeta | null {
  if (!event || event.kind !== PROFILE_KIND) return null;
  const pubkey = normalizeId(event.pubkey);
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(event.content || '{}');
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const meta = raw as Record<string, unknown>;
  const out: ProfileMeta = { pubkey, createdAt: Number(event.created_at) || 0, raw: meta };
  const display = cleanName(meta.display_name ?? meta.displayName);
  const name = cleanName(meta.name ?? meta.username);
  const about = typeof meta.about === 'string' ? meta.about.trim().slice(0, 2000) : '';
  const nip05 = cleanName(meta.nip05);
  if (display) out.display_name = display;
  if (name) out.name = name;
  if (about) out.about = about;
  if (nip05) out.nip05 = nip05;
  if (isUrl(meta.picture)) out.picture = (meta.picture as string).trim();
  return out;
}

/** The name a profile shows: display_name, else name. '' when neither is a name (numbers alone are not). */
export function profileDisplayName(p: ProfileMeta | null | undefined): string {
  if (!p) return '';
  for (const v of [p.display_name, p.name]) {
    const s = cleanName(v);
    if (s && !/^\d+$/.test(s)) return s;
  }
  return '';
}

/** What `fetchProfiles` needs of holosphere. */
export interface ProfileQueryHost {
  queryNostr(filter: Record<string, unknown>): Promise<NostrEventLike[]>;
}

/** How many authors ride in one filter (the same chunk reverse-sync uses). */
export const PROFILE_AUTHORS_CHUNK = 100;

/**
 * The newest kind 0 per key, fetched in author chunks through the budgeted
 * query — one bounded REQ per hundred keys, nothing left open. Keys without
 * a profile are simply absent from the result.
 */
export async function fetchProfiles(
  host: ProfileQueryHost | null | undefined,
  pubkeys: Iterable<string>,
  opts: { chunk?: number } = {},
): Promise<Map<string, ProfileMeta>> {
  const out = new Map<string, ProfileMeta>();
  if (!host || typeof host.queryNostr !== 'function') return out;
  const keys = [...new Set([...pubkeys].map(normalizeId).filter((k) => /^[0-9a-f]{64}$/.test(k)))];
  if (!keys.length) return out;
  const size = Math.max(1, opts.chunk ?? PROFILE_AUTHORS_CHUNK);
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += size) chunks.push(keys.slice(i, i + size));
  const batches = await Promise.all(
    chunks.map(async (authors) => {
      try {
        return (await host.queryNostr({ kinds: [PROFILE_KIND], authors })) ?? [];
      } catch {
        return [] as NostrEventLike[];
      }
    }),
  );
  for (const events of batches) {
    for (const ev of events) {
      const p = parseProfileEvent(ev);
      if (!p) continue;
      const cur = out.get(p.pubkey);
      if (!cur || p.createdAt > cur.createdAt) out.set(p.pubkey, p);
    }
  }
  return out;
}

/**
 * The content of a profile after an edit: every field the existing kind 0
 * carries, with `patch` laid over it. An empty-string patch value removes the
 * field; `undefined` leaves it alone. This is how a name change made in
 * Holons never drops the nip05, lud16 or banner another client set.
 */
export function mergeProfileContent(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, string | undefined>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === '') delete out[k];
    else out[k] = v;
  }
  return out;
}
