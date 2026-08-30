// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// `quests` / `events` → NIP-52 calendar events (31923 time-based, 31922
// date-based) plus one 31925 RSVP companion per participant. Quests of
// `type:'need'` are classifieds, not calendar entries — see classified.ts.

import type { Companion, EventTemplate, LensCodec, NostrEventLike, Projected, ProjectionCtx, Reversed } from '../types.js';
import {
  commonTags,
  deletionTemplate,
  geohashFromH3,
  isDateOnly,
  isUrl,
  isoToUnix,
  nowOf,
  parseProjectionAddress,
  parseProjectionDTag,
  projectionAddress,
  projectionDTag,
  pushIf,
  tagValue,
  unixToIso,
} from '../tags.js';
import { addParticipant, removeParticipant } from '../../tasks/participants.js';
import type { Quest, QuestParticipant } from '../../tasks/types.js';
import { classifiedCodec, CLASSIFIED_KIND } from './classified.js';
import { REACTION_KIND, parseReaction, reactionCompanions } from './reactions.js';
import { addAppreciation, removeAppreciation } from '../../tasks/participants.js';

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
  appreciation?: Participant[];
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
  const out = projectCalendarPrimary(lens, holon, item, ctx);
  if (!out || item.id === undefined || item.id === null) return out;
  const d = out.primary.tags.find((t) => t[0] === 'd')?.[1];
  if (!d) return out;
  const reactions = reactionCompanions(ctx, holon, lens, item.id, out.primary.kind, d, item.appreciation);
  return reactions.length ? { ...out, companions: [...(out.companions ?? []), ...reactions] } : out;
}

function projectCalendarPrimary(lens: string, holon: string, item: CalendarRecord, ctx: ProjectionCtx): Projected | null {
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

// ---------------------------------------------------------------------------
// Reverse: external 31923/31922 edits and 31925 RSVPs → record claims.
// ---------------------------------------------------------------------------

/**
 * Only fields the event carries are patched — a calendar client that drops
 * `location` does not blank it. Status/category/participants never round-trip
 * through the calendar kinds (RSVPs do, separately).
 */
function parseCalendar(lens: string, event: NostrEventLike, ctx: ProjectionCtx): Reversed<CalendarRecord> | null {
  if (event.kind === CALENDAR_RSVP_KIND) return parseRsvp(lens, event, ctx);
  if (event.kind === REACTION_KIND) return parseReaction(event, ctx, lens) as Reversed<CalendarRecord> | null;
  if (event.kind === CLASSIFIED_KIND) {
    const r = classifiedCodec.parse!(event, ctx);
    return r && r.lens === lens ? (r as Reversed<CalendarRecord>) : null;
  }
  if (event.kind !== CALENDAR_TIME_KIND && event.kind !== CALENDAR_DATE_KIND) return null;
  const addr = parseProjectionDTag(tagValue(event, 'd'));
  if (!addr || addr.lens !== lens) return null;
  const patch: Partial<CalendarRecord> = {};
  const title = tagValue(event, 'title');
  if (typeof title === 'string' && title.trim()) patch.title = title;
  if (typeof event.content === 'string' && event.content.trim()) patch.description = event.content;
  const start = tagValue(event, 'start');
  const end = tagValue(event, 'end');
  if (event.kind === CALENDAR_DATE_KIND) {
    if (isDateOnly(start)) patch.when = start;
    if (isDateOnly(end)) patch.ends = end;
  } else {
    const s = unixToIso(start);
    if (s) patch.when = s;
    const e = unixToIso(end);
    if (e) patch.ends = e;
  }
  const location = tagValue(event, 'location');
  if (typeof location === 'string' && location.trim()) patch.location = location;
  return {
    lens, holon: addr.holon, id: addr.id, kind: event.kind, pubkey: event.pubkey,
    createdAt: event.created_at, eventId: event.id, patch,
  };
}

function parseRsvp(lens: string, event: NostrEventLike, ctx: ProjectionCtx): Reversed<CalendarRecord> | null {
  // The `a` address is authoritative; the RSVP's own `d` may follow another
  // grammar (Elinor's `rsvp-…`) and is ignored. Any pubkey in the address is
  // accepted — web and bot publish under different holon keys.
  const a = parseProjectionAddress(tagValue(event, 'a'));
  if (!a || (a.kind !== CALENDAR_TIME_KIND && a.kind !== CALENDAR_DATE_KIND)) return null;
  const addr = parseProjectionDTag(a.dTag);
  if (!addr || addr.lens !== lens) return null;
  const status = tagValue(event, 'status');
  if (status !== 'accepted' && status !== 'declined') return null;
  return {
    lens, holon: addr.holon, id: addr.id, kind: event.kind, pubkey: event.pubkey,
    createdAt: event.created_at, eventId: event.id,
    rsvp: { pubkey: event.pubkey, userId: ctx.userIdFor?.(event.pubkey), status },
  };
}

function mergeCalendar(current: CalendarRecord, r: Reversed<CalendarRecord>, ctx: ProjectionCtx): CalendarRecord | null {
  if (r.reaction) {
    const uid = r.reaction.userId;
    if (uid === undefined || uid === null) return null;
    const quest = current as unknown as Quest;
    const list = Array.isArray(quest.appreciation) ? quest.appreciation : [];
    const has = list.some((p) => p && String(p.id) === String(uid));
    if (r.reaction.status === 'add') return has ? null : (addAppreciation(quest, { id: uid }) as unknown as CalendarRecord);
    return has ? (removeAppreciation(quest, uid) as unknown as CalendarRecord) : null;
  }
  if (r.rsvp) {
    const uid = r.rsvp.userId;
    if (uid === undefined || uid === null) return null; // unknown signer — nothing to toggle
    const quest = current as unknown as Quest;
    const has = (Array.isArray(quest.participants) ? quest.participants : []).some((p) => p && String(p.id) === String(uid));
    if (r.rsvp.status === 'accepted') {
      if (has) return null;
      const existing = (current.participants ?? []).find((p) => typeof p === 'object' && p && String(p.id) === String(uid));
      const user: QuestParticipant = (existing as QuestParticipant) ?? { id: uid };
      return addParticipant(quest, user) as unknown as CalendarRecord;
    }
    if (!has) return null;
    return removeParticipant(quest, uid) as unknown as CalendarRecord;
  }
  if (r.patch) {
    if (r.kind === CLASSIFIED_KIND) return classifiedCodec.merge!(current, r as never, ctx) as CalendarRecord | null;
    let changed = false;
    const next: CalendarRecord = { ...current };
    for (const [k, v] of Object.entries(r.patch)) {
      if (v === undefined || (current as Record<string, unknown>)[k] === v) continue;
      (next as Record<string, unknown>)[k] = v;
      changed = true;
    }
    return changed ? next : null;
  }
  return null;
}

export function calendarCodec(lens: 'quests' | 'events'): LensCodec<CalendarRecord> {
  return {
    lens,
    kinds: [CALENDAR_TIME_KIND, CALENDAR_DATE_KIND, CALENDAR_RSVP_KIND, REACTION_KIND, ...classifiedCodec.kinds],
    primary: '30078',
    project: (holon, item, ctx) => projectCalendar(lens, holon, item, ctx),
    retract: (holon, id, ctx) => retractCalendar(lens, holon, id, ctx),
    parse: (event, ctx) => parseCalendar(lens, event, ctx),
    merge: (current, r, ctx) => mergeCalendar(current, r, ctx),
  };
}
