// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// `checklists` / `shopping` / `library` → NIP-51 sets (30003). Entries ride
// as `['item', …]` tags — third-party NIP-51 clients show the set's title but
// not these custom tags; that is the accepted phase-1 limitation.

import type { EventTemplate, LensCodec, Projected, ProjectionCtx } from '../types.js';
import { commonTags, deletionTemplate, nowOf, projectionDTag, pushIf } from '../tags.js';

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

export function setCodec(lens: 'checklists' | 'shopping' | 'library'): LensCodec<SetRecord> {
  return {
    lens,
    kinds: [SET_KIND],
    primary: '30078',
    project: (holon, item, ctx) => projectSet(lens, holon, item, ctx),
    retract: (holon, id, ctx) => [deletionTemplate(ctx, [{ kind: SET_KIND, dTag: projectionDTag(lens, holon, id) }])],
  };
}
