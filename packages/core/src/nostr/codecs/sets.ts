// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// `checklists` / `shopping` / `library` → NIP-51 sets (30003). Entries ride
// as `['item', …]` tags — third-party NIP-51 clients show the set's title but
// not these custom tags; that is the accepted phase-1 limitation.

import type { EventTemplate, LensCodec, NostrEventLike, Projected, ProjectionCtx, Reversed } from '../types.js';
import { commonTags, deletionTemplate, nowOf, parseProjectionDTag, projectionDTag, pushIf, sameRecord, tagValue, tagValues } from '../tags.js';

export const SET_KIND = 30003;

export interface SetRecord {
  id?: string | number;
  title?: string;
  type?: string;
  items?: Array<{ text?: string; checked?: boolean } | string>;
  // library item fields
  category?: string;
  borrowed?: boolean;
  description?: string;
  [key: string]: unknown;
}

function itemTags(lens: string, item: SetRecord): string[][] {
  if (lens === 'library') {
    const title = typeof item.description === 'string' && item.description.trim() ? item.description : String(item.id);
    return [['item', title, String(item.type ?? item.category ?? ''), item.borrowed ? 'borrowed' : 'available']];
  }
  const out: string[][] = [];
  for (const entry of Array.isArray(item.items) ? item.items : []) {
    if (typeof entry === 'string') out.push(['item', entry, '0']);
    else if (entry && typeof entry.text === 'string' && entry.text.trim()) out.push(['item', entry.text, entry.checked ? '1' : '0']);
  }
  return out;
}

function projectSet(lens: string, holon: string, item: SetRecord, ctx: ProjectionCtx): Projected | null {
  if (item.id === undefined || item.id === null) return null;
  const dTag = projectionDTag(lens, holon, item.id);
  const tags: string[][] = [['d', dTag]];
  const title = lens === 'library' ? (item.description || String(item.id)) : (item.title || String(item.id));
  pushIf(tags, 'title', title);
  pushIf(tags, 't', lens);
  pushIf(tags, 't', item.type !== lens ? item.type : undefined);
  tags.push(...itemTags(lens, item));
  tags.push(...commonTags(ctx, holon, lens, item.id));
  const primary: EventTemplate = { kind: SET_KIND, created_at: nowOf(ctx), tags, content: '' };
  return { primary };
}

/**
 * Reverse of `itemTags`. Checklists/shopping: `items[]` is rebuilt from the
 * `item` tags, keeping extra fields (ids, creator) of entries whose text still
 * matches. Library: only `borrowed` is patched (a set cannot express bookings).
 */
function parseSet(lens: string, event: NostrEventLike): Reversed<SetRecord> | null {
  if (event.kind !== SET_KIND) return null;
  const addr = parseProjectionDTag(tagValue(event, 'd'));
  if (!addr || addr.lens !== lens) return null;
  const patch: Partial<SetRecord> = {};
  const items = tagValues(event, 'item');
  if (lens === 'library') {
    const mine = items[0];
    if (mine && (mine[2] === 'borrowed' || mine[2] === 'available')) patch.borrowed = mine[2] === 'borrowed';
  } else {
    const title = tagValue(event, 'title');
    if (typeof title === 'string' && title.trim()) patch.title = title;
    patch.items = items.filter((t) => typeof t[0] === 'string' && t[0].trim()).map((t) => ({ text: t[0], checked: t[1] === '1' }));
  }
  return {
    lens, holon: addr.holon, id: addr.id, kind: event.kind, pubkey: event.pubkey,
    createdAt: event.created_at, eventId: event.id, patch,
  };
}

function mergeSet(lens: string, current: SetRecord, r: Reversed<SetRecord>): SetRecord | null {
  if (!r.patch) return null;
  const next: SetRecord = { ...current };
  let changed = false;
  if (lens === 'library') {
    if (r.patch.borrowed !== undefined && Boolean(current.borrowed) !== r.patch.borrowed) {
      next.borrowed = r.patch.borrowed;
      changed = true;
    }
    return changed ? next : null;
  }
  if (r.patch.title !== undefined && r.patch.title !== current.title && lens !== 'shopping') {
    next.title = r.patch.title;
    changed = true;
  }
  if (Array.isArray(r.patch.items)) {
    const cur = Array.isArray(current.items) ? current.items : [];
    const byText = new Map<string, Record<string, unknown>>();
    for (const e of cur) if (e && typeof e === 'object' && typeof e.text === 'string') byText.set(e.text, e as Record<string, unknown>);
    const merged = r.patch.items.map((e) => {
      const text = typeof e === 'string' ? e : String(e.text ?? '');
      const checked = typeof e === 'string' ? false : Boolean(e.checked);
      const prev = byText.get(text);
      return prev ? { ...prev, checked } : { text, checked };
    });
    if (!sameRecord(cur, merged)) {
      next.items = merged as SetRecord['items'];
      changed = true;
    }
  }
  return changed ? next : null;
}

export function setCodec(lens: 'checklists' | 'shopping' | 'library'): LensCodec<SetRecord> {
  return {
    lens,
    kinds: [SET_KIND],
    primary: '30078',
    project: (holon, item, ctx) => projectSet(lens, holon, item, ctx),
    retract: (holon, id, ctx) => [deletionTemplate(ctx, [{ kind: SET_KIND, dTag: projectionDTag(lens, holon, id) }])],
    parse: (event) => parseSet(lens, event),
    merge: (current, r) => mergeSet(lens, current, r),
  };
}
