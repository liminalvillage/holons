import { describe, it, expect } from 'vitest';
import {
  CALENDAR_DATE_KIND,
  CALENDAR_RSVP_KIND,
  CALENDAR_TIME_KIND,
  CLASSIFIED_KIND,
  PROFILE_KIND,
  PROJECTION_CODECS,
  REVERSE_KINDS,
  SET_KIND,
  buildProjections,
  parseProjectionAddress,
  parseProjectionDTag,
  projectionAddress,
  projectionDTag,
  sameRecord,
  type NostrEventLike,
  type ProjectionCtx,
} from './index.js';

const HOLON = '-1003864542239';
const PUB = 'a'.repeat(64);
const ALICE = 'b'.repeat(64);
const BOB = 'c'.repeat(64);
const ctx: ProjectionCtx = {
  appName: 'HolonsTest',
  holonPubkey: PUB,
  now: () => 1_800_000_000,
  timezoneFor: () => 'Europe/Rome',
  pubkeyFor: (id) => (String(id) === '42' ? ALICE : String(id) === '7' ? BOB : undefined),
  userIdFor: (pk) => (pk === ALICE ? 42 : pk === BOB ? 7 : undefined),
};
const ev = (kind: number, tags: string[][], content = '', pubkey = PUB, created_at = 1_800_000_100): NostrEventLike =>
  ({ id: 'e1', kind, tags, content, pubkey, created_at });

describe('reverse tag helpers', () => {
  it('parses holons d tags (negative ids, ids with colons) and rejects other grammars', () => {
    expect(parseProjectionDTag(projectionDTag('quests', HOLON, 734))).toEqual({ lens: 'quests', holon: HOLON, id: '734' });
    expect(parseProjectionDTag('holons:events:-5:a:b')).toEqual({ lens: 'events', holon: '-5', id: 'a:b' });
    expect(parseProjectionDTag('shift--5459621960-2026-08-30-dp')).toBeNull();
    expect(parseProjectionDTag('holons:quests:')).toBeNull();
  });
  it('parses addresses', () => {
    const a = projectionAddress(CALENDAR_TIME_KIND, PUB, 'holons:quests:-5:1');
    expect(parseProjectionAddress(a)).toEqual({ kind: CALENDAR_TIME_KIND, pubkey: PUB, dTag: 'holons:quests:-5:1' });
    expect(parseProjectionAddress('nope')).toBeNull();
    expect(parseProjectionAddress('31923:short:holons:x')).toBeNull();
  });
  it('sameRecord ignores undefined fields and compares deeply', () => {
    expect(sameRecord({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameRecord({ a: [1, { x: 2 }] }, { a: [1, { x: 2 }] })).toBe(true);
    expect(sameRecord({ a: [1] }, { a: [2] })).toBe(false);
  });
  it('exposes reverse kinds for every codec', () => {
    expect(Object.keys(REVERSE_KINDS).sort()).toEqual(['checklists', 'events', 'library', 'offers', 'quests', 'shopping', 'users']);
  });
});

describe('calendar reverse', () => {
  const quests = PROJECTION_CODECS.quests;
  const record = {
    id: 734, title: 'Garden day', description: 'Bring gloves', when: '2026-09-01T08:00:00.000Z', ends: '2026-09-01T12:00:00.000Z',
    location: 'Liminal', category: 'garden', status: 'ongoing', participants: [{ id: 42, first_name: 'A' }],
  };
  it('round-trips project → parse → merge as a no-op', () => {
    const out = quests.project(HOLON, record, ctx)!;
    const r = quests.parse!(ev(out.primary.kind, out.primary.tags, out.primary.content), ctx)!;
    expect(r).toMatchObject({ lens: 'quests', holon: HOLON, id: '734', pubkey: PUB });
    expect(r.patch).toEqual({ title: 'Garden day', description: 'Bring gloves', when: record.when, ends: record.ends, location: 'Liminal' });
    expect(quests.merge!(record, r, ctx)).toBeNull();
  });
  it('patches only carried fields (a client dropping location does not blank it)', () => {
    const r = quests.parse!(ev(CALENDAR_TIME_KIND, [['d', projectionDTag('quests', HOLON, 734)], ['title', 'Garden DAY'], ['start', '1788600000']], ''), ctx)!;
    const next = quests.merge!(record, r, ctx)!;
    expect(next.title).toBe('Garden DAY');
    expect(next.when).toBe(new Date(1788600000 * 1000).toISOString());
    expect(next.location).toBe('Liminal');
    expect(next.description).toBe('Bring gloves');
    expect(next.participants).toEqual(record.participants);
  });
  it('handles date-only kinds and rejects other lenses / grammars', () => {
    const r = quests.parse!(ev(CALENDAR_DATE_KIND, [['d', projectionDTag('quests', HOLON, 734)], ['start', '2026-09-02'], ['end', '2026-09-03']]), ctx)!;
    expect(r.patch).toEqual({ when: '2026-09-02', ends: '2026-09-03' });
    expect(quests.parse!(ev(CALENDAR_TIME_KIND, [['d', projectionDTag('events', HOLON, 734)], ['start', '1']]), ctx)).toBeNull();
    expect(quests.parse!(ev(CALENDAR_TIME_KIND, [['d', 'shift--5-2026-08-30-dp'], ['start', '1']]), ctx)).toBeNull();
  });
  it('folds RSVPs into participants by the SIGNER, accepting any address pubkey', () => {
    const a = projectionAddress(CALENDAR_TIME_KIND, 'f'.repeat(64), projectionDTag('quests', HOLON, 734));
    const accept = quests.parse!(ev(CALENDAR_RSVP_KIND, [['a', a], ['d', 'rsvp--5-x'], ['status', 'accepted']], '', BOB), ctx)!;
    expect(accept.rsvp).toEqual({ pubkey: BOB, userId: 7, status: 'accepted' });
    const joined = quests.merge!(record, accept, ctx)!;
    expect(joined.participants).toEqual([{ id: 42, first_name: 'A' }, { id: 7 }]);
    expect(quests.merge!(joined, accept, ctx)).toBeNull(); // already in
    const decline = quests.parse!(ev(CALENDAR_RSVP_KIND, [['a', a], ['status', 'declined']], '', ALICE), ctx)!;
    expect(quests.merge!(record, decline, ctx)!.participants).toEqual([]);
    expect(quests.merge!({ ...record, participants: [] }, decline, ctx)).toBeNull();
    // unknown signer → nothing to toggle; bad status → not a claim
    const stranger = quests.parse!(ev(CALENDAR_RSVP_KIND, [['a', a], ['status', 'accepted']], '', 'd'.repeat(64)), ctx)!;
    expect(stranger.rsvp!.userId).toBeUndefined();
    expect(quests.merge!(record, stranger, ctx)).toBeNull();
    expect(quests.parse!(ev(CALENDAR_RSVP_KIND, [['a', a], ['status', 'tentative']]), ctx)).toBeNull();
  });
  it('routes 30402 edits of need quests through the classified codec', () => {
    const need = { id: 9, type: 'need', title: 'Ladder', status: 'requested' };
    const out = quests.project(HOLON, need, ctx)!;
    expect(out.primary.kind).toBe(CLASSIFIED_KIND);
    const r = quests.parse!(ev(CLASSIFIED_KIND, [...out.primary.tags.filter((t) => t[0] !== 'status'), ['status', 'sold']], 'A tall one'), ctx)!;
    expect(r.lens).toBe('quests');
    expect(quests.merge!(need, r, ctx)).toMatchObject({ status: 'fulfilled', description: 'A tall one' });
    // an offers-addressed classified is not a quests claim
    expect(quests.parse!(ev(CLASSIFIED_KIND, [['d', projectionDTag('offers', HOLON, 9)]]), ctx)).toBeNull();
  });
});

describe('classified reverse', () => {
  const offers = PROJECTION_CODECS.offers;
  const item = { id: 'o1', title: 'Bike', description: 'Red', price: 10, currency: 'EUR', status: 'active', tags: ['bike'], location: 'Rome' };
  it('round-trips as a no-op and never reopens a closed listing', () => {
    const out = offers.project(HOLON, item, ctx)!;
    const r = offers.parse!(ev(CLASSIFIED_KIND, out.primary.tags, out.primary.content), ctx)!;
    expect(r.patch).toMatchObject({ title: 'Bike', description: 'Red', price: 10, currency: 'EUR', location: 'Rome', tags: ['bike'], status: 'active' });
    expect(offers.merge!(item, r, ctx)).toBeNull();
    const closed = { ...item, status: 'fulfilled' };
    expect(offers.merge!(closed, r, ctx)).toBeNull();
  });
  it('patches price, expiry, hashtags and closes on sold', () => {
    const r = offers.parse!(ev(CLASSIFIED_KIND, [
      ['d', projectionDTag('offers', HOLON, 'o1')], ['price', '12', 'EUR'], ['expiration', '1800000000'], ['status', 'sold'],
      ['t', 'offer'], ['t', `group-${HOLON}`], ['t', 'bike'], ['t', 'vintage'],
    ]), ctx)!;
    const next = offers.merge!(item, r, ctx)!;
    expect(next).toMatchObject({ price: 12, status: 'fulfilled', tags: ['bike', 'vintage'], expires_at: '2027-01-15T08:00:00.000Z' });
  });
});

describe('profile reverse', () => {
  const users = PROJECTION_CODECS.users;
  const alice = { id: 42, username: 'alice', first_name: 'Alice', last_name: 'B' };
  it('round-trips our own composite display name as a no-op', () => {
    const out = users.project(HOLON, alice, ctx)!;
    const r = users.parse!(ev(PROFILE_KIND, out.primary.tags, out.primary.content, ALICE), ctx)!;
    expect(r).toMatchObject({ lens: 'users', id: '42', ownerOnly: true, holon: '' });
    expect(users.merge!(alice, r, ctx)).toBeNull();
  });
  it('applies name/picture/about edits and ignores unknown signers', () => {
    const r = users.parse!(ev(PROFILE_KIND, [], JSON.stringify({ name: 'alice', display_name: 'Ali', picture: 'https://x/p.png', about: 'hi' }), ALICE), ctx)!;
    expect(users.merge!(alice, r, ctx)).toEqual({ id: 42, username: 'alice', first_name: 'Ali', last_name: '', picture: 'https://x/p.png', about: 'hi' });
    expect(users.parse!(ev(PROFILE_KIND, [], '{"name":"x"}', 'd'.repeat(64)), ctx)).toBeNull();
    expect(users.parse!(ev(PROFILE_KIND, [], 'not json', ALICE), ctx)).toBeNull();
  });
});

describe('set reverse', () => {
  const checklists = PROJECTION_CODECS.checklists;
  const library = PROJECTION_CODECS.library;
  it('rebuilds checklist items keeping extra fields of matching entries', () => {
    const list = { id: 'c1', title: 'Open', items: [{ text: 'milk', checked: false, id: 'x' }, { text: 'eggs', checked: true }] };
    const out = checklists.project(HOLON, list, ctx)!;
    const same = checklists.parse!(ev(SET_KIND, out.primary.tags), ctx)!;
    expect(checklists.merge!(list, same, ctx)).toBeNull();
    const r = checklists.parse!(ev(SET_KIND, [['d', projectionDTag('checklists', HOLON, 'c1')], ['title', 'Open'], ['item', 'milk', '1'], ['item', 'bread', '0']]), ctx)!;
    expect(checklists.merge!(list, r, ctx)!.items).toEqual([{ text: 'milk', checked: true, id: 'x' }, { text: 'bread', checked: false }]);
  });
  it('library only toggles borrowed', () => {
    const tool = { id: 'drill', type: 'tool', description: 'Drill', borrowed: false, bookings: [{ a: 1 }] };
    const r = library.parse!(ev(SET_KIND, [['d', projectionDTag('library', HOLON, 'drill')], ['item', 'Drill', 'tool', 'borrowed']]), ctx)!;
    expect(library.merge!(tool, r, ctx)).toEqual({ ...tool, borrowed: true });
    expect(library.merge!({ ...tool, borrowed: true }, r, ctx)).toBeNull();
  });
});

describe('buildProjections (reverse)', () => {
  it('binds parse/merge to the context', () => {
    const [hook] = buildProjections(['quests'], ctx);
    const a = projectionAddress(CALENDAR_TIME_KIND, PUB, projectionDTag('quests', HOLON, 1));
    const r = hook.parse!(ev(CALENDAR_RSVP_KIND, [['a', a], ['status', 'accepted']], '', ALICE))!;
    expect(r.rsvp!.userId).toBe(42);
    expect((hook.merge!({ id: 1, participants: [] }, r) as { participants: unknown[] }).participants).toEqual([{ id: 42 }]);
  });
});
