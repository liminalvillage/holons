import { nsecToHex, toNsec, generateNsec, pubkeyOf } from './projections.js';
import { describe, it, expect } from 'vitest';
import { cellToLatLng } from 'h3-js';
import {
  CALENDAR_DATE_KIND,
  CALENDAR_RSVP_KIND,
  CALENDAR_TIME_KIND,
  CLASSIFIED_KIND,
  DELETION_KIND,
  PROFILE_KIND,
  PROJECTABLE_LENSES,
  PROJECTION_CODECS,
  SET_KIND,
  buildProjections,
  geohashEncode,
  groupTag,
  parseProjectionList,
  projectionDTag,
  type ProjectionCtx,
} from './index.js';

const HOLON = '-1003864542239';
const PUB = 'a'.repeat(64);
const ctx: ProjectionCtx = {
  appName: 'HolonsTest',
  holonPubkey: PUB,
  now: () => 1_800_000_000,
  timezoneFor: () => 'Europe/Rome',
  cellToLatLng,
  pubkeyFor: (id) => (String(id) === '42' ? 'b'.repeat(64) : undefined),
};
const tag = (t: string[][], name: string) => t.find((x) => x[0] === name);
const tags = (t: string[][], name: string) => t.filter((x) => x[0] === name).map((x) => x.slice(1));

describe('tags', () => {
  it('builds holon-scoped d tags that survive negative chat ids', () => {
    expect(projectionDTag('quests', HOLON, 734)).toBe(`holons:quests:${HOLON}:734`);
    expect(projectionDTag('quests', 'other', 734)).not.toBe(projectionDTag('quests', HOLON, 734));
    expect(groupTag(HOLON)).toBe(`group-${HOLON}`);
  });
  it('geohash matches known vectors', () => {
    expect(geohashEncode(42.6, -5.6, 5)).toBe('ezs42');
    expect(geohashEncode(48.8566, 2.3522, 7)).toBe('u09tvw0');
  });
  it('parses the env list', () => {
    expect(parseProjectionList('off')).toEqual([]);
    expect(parseProjectionList(undefined)).toEqual([...PROJECTABLE_LENSES]); // on by default
    expect(parseProjectionList('')).toEqual([...PROJECTABLE_LENSES]);
    expect(parseProjectionList('all')).toEqual([...PROJECTABLE_LENSES]);
    expect(parseProjectionList('quests, events,bogus')).toEqual(['quests', 'events']);
  });
});

describe('calendar codec', () => {
  const quests = PROJECTION_CODECS.quests;
  it('projects a timed quest to 31923 with tz, participants and RSVP companions', () => {
    const out = quests.project(HOLON, {
      id: 734, title: 'Garden day', description: 'Bring gloves', when: '2026-09-01T08:00:00Z', ends: '2026-09-01T12:00:00Z',
      location: 'Liminal', category: 'garden', picture: 'https://x/y.jpg', participants: [{ id: 42, first_name: 'A' }, { id: 7 }],
    }, ctx)!;
    const p = out.primary;
    expect(p.kind).toBe(CALENDAR_TIME_KIND);
    expect(p.content).toBe('Bring gloves');
    expect(tag(p.tags, 'd')![1]).toBe(`holons:quests:${HOLON}:734`);
    expect(tag(p.tags, 'start')![1]).toBe(String(Date.parse('2026-09-01T08:00:00Z') / 1000));
    expect(tag(p.tags, 'end')![1]).toBe(String(Date.parse('2026-09-01T12:00:00Z') / 1000));
    expect(tag(p.tags, 'start_tzid')![1]).toBe('Europe/Rome');
    expect(tag(p.tags, 'location')![1]).toBe('Liminal');
    expect(tag(p.tags, 'image')![1]).toBe('https://x/y.jpg');
    expect(tags(p.tags, 't')).toEqual(expect.arrayContaining([[`group-${HOLON}`], ['garden']]));
    expect(tag(p.tags, 'n')![1]).toBe('HolonsTest');
    expect(tag(p.tags, 'holons')).toEqual(['holons', 'quests', HOLON, '734']);
    // only the resolvable participant gets a p tag; both get RSVP companions
    expect(tags(p.tags, 'p')).toEqual([['b'.repeat(64), '', 'participant']]);
    expect(out.companions).toHaveLength(2);
    const r = out.companions![0];
    expect(r.template.kind).toBe(CALENDAR_RSVP_KIND);
    expect(tag(r.template.tags, 'a')![1]).toBe(`${CALENDAR_TIME_KIND}:${PUB}:holons:quests:${HOLON}:734`);
    expect(tag(r.template.tags, 'status')![1]).toBe('accepted');
    expect(r.authorHint).toEqual({ userId: 42 });
  });
  it('projects a date-only quest to 31922 and skips undated / cancelled ones', () => {
    const out = quests.project(HOLON, { id: 1, title: 'x', when: '2026-09-01', ends: '2026-09-02' }, ctx)!;
    expect(out.primary.kind).toBe(CALENDAR_DATE_KIND);
    expect(tag(out.primary.tags, 'start')![1]).toBe('2026-09-01');
    expect(tag(out.primary.tags, 'end')![1]).toBe('2026-09-02');
    expect(quests.project(HOLON, { id: 2, title: 'open task' }, ctx)).toBeNull();
    expect(quests.project(HOLON, { id: 3, title: 'x', when: '2026-09-01T08:00:00Z', status: 'cancelled' }, ctx)).toBeNull();
    expect(quests.project(HOLON, { title: 'no id', when: '2026-09-01T08:00:00Z' }, ctx)).toBeNull();
  });
  it('routes need quests to a 30402 classified with a geohash from the hex', () => {
    const out = quests.project(HOLON, {
      id: 9, type: 'need', status: 'requested', title: 'Ladder', description: 'Need a ladder', hex: '891e850d50fffff', urgency: 'urgent', created: '2026-08-30T00:00:00Z',
    }, ctx)!;
    expect(out.primary.kind).toBe(CLASSIFIED_KIND);
    expect(tag(out.primary.tags, 'd')![1]).toBe(`holons:quests:${HOLON}:9`);
    expect(tag(out.primary.tags, 'status')![1]).toBe('active');
    expect(tags(out.primary.tags, 't')).toEqual(expect.arrayContaining([['need'], ['urgent']]));
    const [lat, lng] = cellToLatLng('891e850d50fffff');
    expect(tag(out.primary.tags, 'g')![1]).toBe(geohashEncode(lat, lng, 7));
    expect(tag(out.primary.tags, 'published_at')![1]).toBe(String(Date.parse('2026-08-30T00:00:00Z') / 1000));
  });
  it('retracts with one kind-5 covering both calendar kinds and the classified', () => {
    const dels = quests.retract(HOLON, '734', ctx);
    expect(dels.every((d) => d.kind === DELETION_KIND)).toBe(true);
    const a = dels.flatMap((d) => tags(d.tags, 'a').map((x) => x[0]));
    expect(a).toContain(`${CALENDAR_TIME_KIND}:${PUB}:holons:quests:${HOLON}:734`);
    expect(a).toContain(`${CALENDAR_DATE_KIND}:${PUB}:holons:quests:${HOLON}:734`);
    expect(a).toContain(`${CLASSIFIED_KIND}:${PUB}:holons:quests:${HOLON}:734`);
  });
  it('events lens uses until/where aliases', () => {
    const out = PROJECTION_CODECS.events.project(HOLON, { id: 'e1', title: 'Dinner', when: '2026-09-01T18:00:00Z', until: '2026-09-01T20:00:00Z', where: 'Kitchen' }, ctx)!;
    expect(tag(out.primary.tags, 'end')).toBeDefined();
    expect(tag(out.primary.tags, 'location')![1]).toBe('Kitchen');
    expect(tag(out.primary.tags, 'd')![1]).toBe(`holons:events:${HOLON}:e1`);
  });
});

describe('classified codec', () => {
  it('maps a marketplace offer with expiry, price and own geohash', () => {
    const out = PROJECTION_CODECS.offers.project(HOLON, {
      id: 'o1', title: 'Bike', description: 'd', exchange_type: 'offer', item_type: 'goods', tags: ['bike'], geohash: 'u09tvw0',
      expires_at: 1_900_000_000, price: 50, currency: 'EUR', status: 'fulfilled',
    }, ctx)!;
    const t = out.primary.tags;
    expect(out.primary.kind).toBe(CLASSIFIED_KIND);
    expect(tag(t, 'status')![1]).toBe('sold');
    expect(tags(t, 't')).toEqual(expect.arrayContaining([['offer'], ['goods'], ['bike']]));
    expect(tag(t, 'price')).toEqual(['price', '50', 'EUR']);
    expect(tag(t, 'g')![1]).toBe('u09tvw0');
    expect(tag(t, 'expiration')![1]).toBe('1900000000');
  });
});

describe('profile codec', () => {
  it('emits kind 0 with public fields only and requires the user author', () => {
    const codec = PROJECTION_CODECS.users;
    expect(codec.requiresAuthor).toBe('user');
    const out = codec.project(HOLON, { id: 42, username: 'ann', first_name: 'Ann', last_name: 'Lee', values: ['x'], participated: { 1: true } }, ctx)!;
    expect(out.primary.kind).toBe(PROFILE_KIND);
    expect(JSON.parse(out.primary.content)).toEqual({ name: 'ann', display_name: 'Ann Lee' });
    expect(tag(out.primary.tags, 'd')).toBeUndefined();
    expect(codec.project(HOLON, { id: 1 }, ctx)).toBeNull();
    // leaving is a NIP-29 remove-user by the holon key (pubkey 42 resolves); unknown ids emit nothing
    expect(codec.retract(HOLON, '42', ctx).map((t) => t.kind)).toEqual([9001]);
    expect(codec.retract(HOLON, '1', ctx)).toEqual([]);
  });

  it('claims the telegram identity (NIP-39) and attests it as the provider', () => {
    const codec = PROJECTION_CODECS.users;
    const providerCtx: ProjectionCtx = { ...ctx, providerPubkey: 'f'.repeat(64) };
    const out = codec.project(HOLON, { id: 42, username: 'ann', first_name: 'Ann', last_name: 'Lee' }, providerCtx)!;
    expect(tag(out.primary.tags, 'i')).toEqual(['i', 'telegram:42']);
    const att = out.companions!.find((c) => c.template.kind === 31926)!;
    expect(att.authorHint).toEqual({ role: 'provider' });
    expect(att.template.tags).toEqual([['d', 'telegram:42'], ['p', 'b'.repeat(64)]]);
    expect(JSON.parse(att.template.content)).toEqual({ name: 'Ann Lee' });
    expect(att.dedupe).toEqual({ key: 'attest|telegram:42', state: `${'b'.repeat(64)}|Ann Lee` });
  });

  it('emits no claim or attestation for non-telegram ids or without a provider', () => {
    const codec = PROJECTION_CODECS.users;
    // No providerPubkey in ctx → no attestation companion.
    const plain = codec.project(HOLON, { id: 42, username: 'ann' }, ctx)!;
    expect(plain.companions!.some((c) => c.template.kind === 31926)).toBe(false);
    expect(tag(plain.primary.tags, 'i')).toEqual(['i', 'telegram:42']);
    // Non-numeric id → neither the claim nor the attestation.
    const providerCtx: ProjectionCtx = {
      ...ctx,
      providerPubkey: 'f'.repeat(64),
      pubkeyFor: () => 'b'.repeat(64),
    };
    const keyUser = codec.project(HOLON, { id: 'abc123def', username: 'key-user' }, providerCtx)!;
    expect(tag(keyUser.primary.tags, 'i')).toBeUndefined();
    expect(keyUser.companions!.some((c) => c.template.kind === 31926)).toBe(false);
  });
});

describe('set codec', () => {
  it('maps checklist items and library items to 30003', () => {
    const c = PROJECTION_CODECS.checklists.project(HOLON, { id: 'c1', title: 'Cleaning', items: [{ text: 'floor', checked: true }, { text: 'sink', checked: false }] }, ctx)!;
    expect(c.primary.kind).toBe(SET_KIND);
    expect(tags(c.primary.tags, 'item')).toEqual([['floor', '1'], ['sink', '0']]);
    const l = PROJECTION_CODECS.library.project(HOLON, { id: 'l1', type: 'tool', description: 'Drill', borrowed: true }, ctx)!;
    expect(tags(l.primary.tags, 'item')).toEqual([['Drill', 'tool', 'borrowed']]);
    expect(tag(l.primary.tags, 'title')![1]).toBe('Drill');
  });
});

describe('buildProjections', () => {
  it('binds codecs to the context and ignores unknown lenses', () => {
    const hooks = buildProjections(['quests', 'nope', 'users'], ctx);
    expect(hooks.map((h) => h.lens)).toEqual(['quests', 'users']);
    const out = hooks[0].project(HOLON, 'quests', { id: 1, title: 't', when: '2026-09-01T08:00:00Z' });
    expect(out?.primary.created_at).toBe(1_800_000_000);
    expect(hooks[1].requiresAuthor).toBe('user');
    expect(hooks[0].retract(HOLON, 'quests', '1')[0].kind).toBe(DELETION_KIND);
  });
});

describe('nsec helpers', () => {
  it('round-trips hex ↔ nsec and derives one pubkey', () => {
    const nsec = generateNsec();
    expect(nsec.startsWith('nsec1')).toBe(true);
    const hex = nsecToHex(nsec);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(toNsec(hex)).toBe(nsec);
    expect(nsecToHex(hex.toUpperCase())).toBe(hex);
    expect(pubkeyOf(nsec)).toBe(pubkeyOf(hex));
    expect(() => nsecToHex('npub1qqqq')).toThrow();
    expect(() => nsecToHex('garbage')).toThrow(/64 hex/);
  });
});
