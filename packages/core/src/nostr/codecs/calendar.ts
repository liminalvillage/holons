// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// `quests` / `events` → NIP-52 calendar events (31923 time-based, 31922
// date-based) plus one 31925 RSVP companion per participant. Quests of
// `type:'need'` are classifieds, not calendar entries — see classified.ts.

import type { Companion, EventTemplate, LensCodec, Projected, ProjectionCtx } from '../types.js';
import {
  commonTags,
  deletionTemplate,
  geohashFromH3,
  isDateOnly,
  isUrl,
  isoToUnix,
  nowOf,
  projectionAddress,
  projectionDTag,
  pushIf,
} from '../tags.js';
import { classifiedCodec } from './classified.js';

export const CALENDAR_TIME_KIND = 31923;
export const CALENDAR_DATE_KIND = 31922;
export const CALENDAR_RSVP_KIND = 31925;

type Participant = { id?: string | number; username?: string; first_name?: string } | string | number;

export interface CalendarRecord {
  id?: string | number;
  title?: string;
  description?: string;
  type?: string;
  status?: string;
  category?: string;
  picture?: string | null;
  when?: string;
  ends?: string;
  until?: string;
  where?: string;
  location?: string;
  hex?: string;
  participants?: Participant[];
  [key: string]: unknown;
}

function participantId(p: Participant): string | number | undefined {
  if (typeof p === 'string' || typeof p === 'number') return p;
  return p?.id ?? p?.username;
}

function rsvpCompanion(ctx: ProjectionCtx, holon: string, kind: number, dTag: string, id: string | number, userId: string | number): Companion {
  const address = projectionAddress(kind, ctx.holonPubkey, dTag);
  return {
    template: {
      kind: CALENDAR_RSVP_KIND,
      created_at: nowOf(ctx),
      tags: [
        ['a', address],
        ['d', projectionDTag('rsvp', holon, id)],
        ['status', 'accepted'],
        ['p', ctx.holonPubkey, '', 'changed-by'],
        ['t', 'shift'],
        ...commonTags(ctx, holon, 'rsvp', id),
      ],
      content: '',
    },
    authorHint: { userId },
  };
}

function projectCalendar(lens: string, holon: string, item: CalendarRecord, ctx: ProjectionCtx): Projected | null {
  if (item.id === undefined || item.id === null) return null;
  if (item.type === 'need') return classifiedCodec.project(holon, item, ctx);
  if (item.type === 'offer' || item.type === 'request') return classifiedCodec.project(holon, item, ctx);
  if (item.status === 'cancelled') return null;
  const when = item.when ?? item.date;
  if (!when) return null; // an undated task is not a calendar entry
  const endsRaw = item.ends ?? item.until;
  const dTag = projectionDTag(lens, holon, item.id);
  const tags: string[][] = [['d', dTag]];
  pushIf(tags, 'title', item.title ?? String(item.id));

  let kind: number;
  if (isDateOnly(when)) {
    kind = CALENDAR_DATE_KIND;
    tags.push(['start', when]);
    if (isDateOnly(endsRaw)) tags.push(['end', endsRaw]);
  } else {
    const start = isoToUnix(when);
    if (start === undefined) return null;
    kind = CALENDAR_TIME_KIND;
    tags.push(['start', String(start)]);
    const end = isoToUnix(endsRaw);
    if (end !== undefined && end >= start) tags.push(['end', String(end)]);
    const tz = ctx.timezoneFor?.(holon);
    if (tz && tz !== 'UTC') {
      tags.push(['start_tzid', tz]);
      if (end !== undefined) tags.push(['end_tzid', tz]);
    }
  }
  pushIf(tags, 'location', item.location ?? item.where);
  pushIf(tags, 'g', geohashFromH3(item.hex, ctx));
  if (isUrl(item.picture)) tags.push(['image', item.picture]);
  pushIf(tags, 't', item.category);
  pushIf(tags, 't', item.type && item.type !== 'quest' ? item.type : undefined);

  const companions: Companion[] = [];
  for (const p of item.participants ?? []) {
    const uid = participantId(p);
    if (uid === undefined || uid === null) continue;
    const pk = ctx.pubkeyFor?.(uid);
    if (pk) tags.push(['p', pk, '', 'participant']);
    companions.push(rsvpCompanion(ctx, holon, kind, dTag, item.id, uid));
  }
  tags.push(...commonTags(ctx, holon, lens, item.id));

  const primary: EventTemplate = {
    kind,
    created_at: nowOf(ctx),
    tags,
    content: typeof item.description === 'string' ? item.description : '',
  };
  return { primary, companions };
}

function retractCalendar(lens: string, holon: string, id: string, ctx: ProjectionCtx): EventTemplate[] {
  const dTag = projectionDTag(lens, holon, id);
  return [
    deletionTemplate(ctx, [
      { kind: CALENDAR_TIME_KIND, dTag },
      { kind: CALENDAR_DATE_KIND, dTag },
    ]),
    ...classifiedCodec.retract(holon, id, ctx),
  ];
}

export function calendarCodec(lens: 'quests' | 'events'): LensCodec<CalendarRecord> {
  return {
    lens,
    kinds: [CALENDAR_TIME_KIND, CALENDAR_DATE_KIND, CALENDAR_RSVP_KIND, ...classifiedCodec.kinds],
    primary: '30078',
    project: (holon, item, ctx) => projectCalendar(lens, holon, item, ctx),
    retract: (holon, id, ctx) => retractCalendar(lens, holon, id, ctx),
  };
}
