// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// `offers` and need/offer/request quests → NIP-99 classified listings (30402).

import type { EventTemplate, LensCodec, NostrEventLike, Projected, ProjectionCtx, Reversed } from '../types.js';
import {
  commonTags, deletionTemplate, geohashFromH3, isUrl, isoToUnix, nowOf, parseProjectionDTag, projectionDTag, pushIf,
  tagValue, tagValues, unixToIso,
} from '../tags.js';

export const CLASSIFIED_KIND = 30402;

export interface ClassifiedRecord {
  id?: string | number;
  title?: string;
  description?: string;
  type?: string;
  status?: string;
  category?: string;
  picture?: string | null;
  created?: string | number;
  exchange_type?: string;
  item_type?: string;
  transaction_type?: string[] | string;
  tags?: string[];
  geohash?: string;
  hex?: string;
  location?: string;
  expires_at?: number | string;
  price?: number;
  currency?: string;
  urgency?: string;
  [key: string]: unknown;
}

/** NIP-99 knows `active` and `sold`; everything closed maps to `sold`. */
export function classifiedStatus(status: unknown): 'active' | 'sold' {
  switch (status) {
    case 'claimed':
    case 'fulfilled':
    case 'cancelled':
    case 'completed':
    case 'sold':
    case 'closed':
      return 'sold';
    default:
      return 'active';
  }
}

function listingKind(item: ClassifiedRecord): string | undefined {
  if (item.type === 'need') return 'need';
  if (item.exchange_type === 'offer' || item.type === 'offer') return 'offer';
  if (item.exchange_type === 'want' || item.type === 'request' || item.type === 'want') return 'want';
  return undefined;
}

export const classifiedCodec: LensCodec<ClassifiedRecord> = {
  lens: 'offers',
  kinds: [CLASSIFIED_KIND],
  primary: '30078',
  project(holon, item, ctx): Projected | null {
    if (item.id === undefined || item.id === null) return null;
    // Address under the record's real lens: need quests live on `quests`.
    const lens = item.type === 'need' || item.type === 'offer' || item.type === 'request' ? 'quests' : 'offers';
    const dTag = projectionDTag(lens, holon, item.id);
    const description = typeof item.description === 'string' ? item.description : '';
    const tags: string[][] = [['d', dTag]];
    pushIf(tags, 'title', item.title ?? String(item.id));
    pushIf(tags, 'summary', description.slice(0, 200));
    pushIf(tags, 'published_at', isoToUnix(item.created));
    tags.push(['status', classifiedStatus(item.status)]);
    pushIf(tags, 't', listingKind(item));
    pushIf(tags, 't', item.item_type);
    pushIf(tags, 't', item.category);
    for (const t of Array.isArray(item.tags) ? item.tags : []) pushIf(tags, 't', t);
    if (item.urgency === 'urgent') tags.push(['t', 'urgent']);
    if (typeof item.price === 'number' && Number.isFinite(item.price)) {
      tags.push(['price', String(item.price), ...(item.currency ? [item.currency] : [])]);
    }
    pushIf(tags, 'location', item.location);
    pushIf(tags, 'g', typeof item.geohash === 'string' && item.geohash ? item.geohash : geohashFromH3(item.hex, ctx));
    const exp = isoToUnix(item.expires_at);
    if (exp !== undefined) tags.push(['expiration', String(exp)]);
    if (isUrl(item.picture)) tags.push(['image', item.picture]);
    tags.push(...commonTags(ctx, holon, lens, item.id));
    const primary: EventTemplate = { kind: CLASSIFIED_KIND, created_at: nowOf(ctx), tags, content: description };
    return { primary };
  },
  retract(holon, id, ctx) {
    return [
      deletionTemplate(ctx, [
        { kind: CLASSIFIED_KIND, dTag: projectionDTag('offers', holon, id) },
        { kind: CLASSIFIED_KIND, dTag: projectionDTag('quests', holon, id) },
      ]),
    ];
  },
  /** The address lens (`quests` for need/offer/request quests, else `offers`) comes from `d`. */
  parse(event: NostrEventLike): Reversed<ClassifiedRecord> | null {
    if (event.kind !== CLASSIFIED_KIND) return null;
    const addr = parseProjectionDTag(tagValue(event, 'd'));
    if (!addr || (addr.lens !== 'offers' && addr.lens !== 'quests')) return null;
    const patch: Partial<ClassifiedRecord> = {};
    const title = tagValue(event, 'title');
    if (typeof title === 'string' && title.trim()) patch.title = title;
    if (typeof event.content === 'string' && event.content.trim()) patch.description = event.content;
    const location = tagValue(event, 'location');
    if (typeof location === 'string' && location.trim()) patch.location = location;
    const price = (event.tags || []).find((t) => t[0] === 'price');
    if (price && Number.isFinite(Number(price[1]))) {
      patch.price = Number(price[1]);
      if (price[2]) patch.currency = price[2];
    }
    const exp = unixToIso(tagValue(event, 'expiration'));
    if (exp) patch.expires_at = exp;
    const status = tagValue(event, 'status');
    if (status === 'sold' || status === 'active') patch.status = status;
    // Free-form hashtags only: listing-kind / structural tags are ours.
    const structural = new Set(['offer', 'want', 'need', 'urgent', String(tagValue(event, 'holons') ?? '')]);
    const t = tagValues(event, 't').map((x) => x[0]).filter((x) => x && !structural.has(x) && !x.startsWith('group-'));
    if (t.length) patch.tags = t;
    return {
      lens: addr.lens, holon: addr.holon, id: addr.id, kind: event.kind, pubkey: event.pubkey,
      createdAt: event.created_at, eventId: event.id, patch,
    };
  },
  /**
   * Lossy by design: NIP-99 `sold` closes an open record (`fulfilled`);
   * `active` never reopens a closed one. Hashtags replace the record's own
   * free-form tags only when the event carries any.
   */
  merge(current, r): ClassifiedRecord | null {
    if (!r.patch) return null;
    const next: ClassifiedRecord = { ...current };
    let changed = false;
    const set = (k: keyof ClassifiedRecord, v: unknown) => {
      if (v === undefined || (current as Record<string, unknown>)[k as string] === v) return;
      (next as Record<string, unknown>)[k as string] = v;
      changed = true;
    };
    const { status, tags, ...rest } = r.patch;
    for (const [k, v] of Object.entries(rest)) set(k as keyof ClassifiedRecord, v);
    if (status === 'sold' && classifiedStatus(current.status) === 'active') set('status', 'fulfilled');
    if (Array.isArray(tags) && tags.length) {
      const cur = Array.isArray(current.tags) ? current.tags : [];
      if (cur.length !== tags.length || cur.some((x, i) => x !== tags[i])) set('tags', tags);
    }
    return changed ? next : null;
  },
};
