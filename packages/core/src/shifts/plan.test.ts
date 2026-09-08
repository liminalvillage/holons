// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { signerFromSecretKey } from '../holosphere/signers.js';
import {
  DEFAULT_SHIFT_DEFINITIONS,
  SHIFT_DELETE_KIND,
  SHIFT_OCCURRENCE_KIND,
  addDays,
  buildOccurrenceDeleteTemplate,
  buildOccurrenceTemplate,
  coverageOf,
  createShiftRelayClient,
  defaultShiftPlan,
  expectedShifts,
  generateShiftCode,
  isoWeekday,
  localToUnix,
  parseShiftOccurrence,
  planFromOccurrences,
  readShiftPlan,
  reconcileSchedule,
  removeShiftDefinition,
  saveShiftPlan,
  shiftAddress,
  shiftDTag,
  todayIn,
  upsertShiftDefinition,
  validateShiftDefinition,
  type ShiftOccurrence,
  type ShiftPlan,
  type ShiftPoolLike,
  type ShiftRsvp,
} from './index.js';
import { bytesToHex } from '@noble/hashes/utils';

const GROUP = '-5459621960';

function keypair() {
  const sk = generateSecretKey();
  return { sk: bytesToHex(sk), pk: getPublicKey(sk) };
}

describe('shift plan — catalog rules (Elinor parity)', () => {
  it('seeds Elinor’s five shifts with capacity 2', () => {
    const plan = defaultShiftPlan('Europe/Brussels', 'Valley of the Commons');
    expect(plan.shifts.map((s) => s.code)).toEqual(['mc', 'lp', 'lc', 'dp', 'dc']);
    expect(plan.shifts.every((s) => s.capacity === 2 && s.enabled)).toBe(true);
    expect(plan.horizonDays).toBe(14);
    expect(DEFAULT_SHIFT_DEFINITIONS[0].title).toBe('Morning Cleaning');
  });

  it('validates exactly like Elinor’s validateDef', () => {
    expect(validateShiftDefinition({ title: '', start: '08:00', end: '09:00' })).toMatchObject({ ok: false });
    expect(validateShiftDefinition({ title: 'x'.repeat(41), start: '08:00', end: '09:00' })).toMatchObject({ ok: false });
    expect(validateShiftDefinition({ title: 'Ok', start: '8:00', end: '09:00' })).toMatchObject({ ok: false });
    expect(validateShiftDefinition({ title: 'Ok', start: '09:00', end: '09:00' })).toMatchObject({ ok: false });
    expect(validateShiftDefinition({ title: 'Ok', start: '09:00', end: '10:00', capacity: 21 })).toMatchObject({ ok: false });
    expect(validateShiftDefinition({ title: 'Ok', start: '09:00', end: '10:00', capacity: 0 })).toMatchObject({ ok: false });
    expect(validateShiftDefinition({ title: 'Ok', start: '09:00', end: '10:00', code: 'Bad-Code' })).toMatchObject({ ok: false });
    const v = validateShiftDefinition({ title: ' Garden ', start: '09:00', end: '10:00', capacity: 3, description: ' weed ', days: [7, 1, 1] });
    expect(v).toMatchObject({ ok: true, value: { title: 'Garden', capacity: 3, description: 'weed', days: [1, 7], enabled: true } });
    // Every day collapses to "no days" — the Elinor default.
    const all = validateShiftDefinition({ title: 'All', start: '09:00', end: '10:00', days: [1, 2, 3, 4, 5, 6, 7] });
    expect(all.ok && all.value.days).toBeUndefined();
  });

  it('generates codes from initials and disambiguates', () => {
    expect(generateShiftCode('Garden Work', [])).toBe('gw');
    expect(generateShiftCode('Garden Work', ['gw'])).toBe('gw2');
    expect(generateShiftCode('Garden Work', ['gw', 'gw2'])).toBe('gw3');
    expect(generateShiftCode('X', [])).toBe('x');
    expect(generateShiftCode('!!', [])).toBe('shift');
  });

  it('adds, edits and removes definitions, keeping start order', () => {
    let plan = defaultShiftPlan('UTC');
    const added = upsertShiftDefinition(plan, { title: 'Garden Work', start: '09:00', end: '11:00', capacity: 4 });
    expect(added.ok && added.created).toBe(true);
    if (!added.ok) throw new Error(added.error);
    expect(added.code).toBe('gw');
    plan = added.plan;
    expect(plan.shifts.map((s) => s.code)).toEqual(['mc', 'gw', 'lp', 'lc', 'dp', 'dc']);

    const edited = upsertShiftDefinition(plan, { code: 'gw', title: 'Garden', start: '15:00', end: '16:00', capacity: 1, enabled: false });
    if (!edited.ok) throw new Error(edited.error);
    expect(edited.created).toBe(false);
    expect(edited.plan.shifts.find((s) => s.code === 'gw')).toMatchObject({ title: 'Garden', enabled: false, start: '15:00' });
    expect(edited.plan.shifts.map((s) => s.code)).toEqual(['mc', 'lp', 'lc', 'gw', 'dp', 'dc']);

    expect(upsertShiftDefinition(plan, { code: 'zz', title: 'Ghost', start: '09:00', end: '10:00' })).toMatchObject({ ok: false, error: 'Unknown shift.' });

    const removed = removeShiftDefinition(edited.plan, 'gw');
    expect(removed.shifts.map((s) => s.code)).toEqual(['mc', 'lp', 'lc', 'dp', 'dc']);
    // Non-destructive on the input.
    expect(edited.plan.shifts.length).toBe(6);
  });
});

describe('shift plan — time', () => {
  it('converts wall-clock to unix DST-safely (Brussels)', () => {
    // 2026-08-30 16:30 Europe/Brussels (CEST, UTC+2) = 14:30Z = 1788100200 — the live Elinor event.
    expect(localToUnix('2026-08-30', '16:30', 'Europe/Brussels')).toBe(1788100200);
    // Winter: UTC+1.
    expect(localToUnix('2026-01-15', '10:00', 'Europe/Brussels')).toBe(Date.UTC(2026, 0, 15, 9) / 1000);
    expect(localToUnix('2026-01-15', '10:00', 'UTC')).toBe(Date.UTC(2026, 0, 15, 10) / 1000);
  });

  it('day arithmetic', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(isoWeekday('2026-09-07')).toBe(1); // Monday
    expect(isoWeekday('2026-09-13')).toBe(7); // Sunday
    expect(todayIn('UTC', new Date(Date.UTC(2026, 8, 8, 23, 30)))).toBe('2026-09-08');
    expect(todayIn('Pacific/Auckland', new Date(Date.UTC(2026, 8, 8, 23, 30)))).toBe('2026-09-09');
  });
});

describe('shift plan — materialisation', () => {
  const plan: ShiftPlan = {
    tzid: 'Europe/Brussels',
    location: 'Valley of the Commons',
    horizonDays: 14,
    shifts: [
      { code: 'mc', title: 'Morning Cleaning', start: '08:30', end: '10:30', capacity: 2, enabled: true },
      { code: 'gw', title: 'Garden', start: '09:00', end: '11:00', capacity: 3, enabled: true, days: [6, 7], location: 'Garden' },
      { code: 'off', title: 'Disabled', start: '12:00', end: '13:00', capacity: 1, enabled: false },
    ],
  };

  it('expands enabled definitions over the window, honouring days', () => {
    // 2026-09-07 is a Monday.
    const list = expectedShifts(plan, GROUP, '2026-09-07', 7);
    expect(list.map((e) => `${e.date}-${e.code}`)).toEqual([
      '2026-09-07-mc',
      '2026-09-08-mc',
      '2026-09-09-mc',
      '2026-09-10-mc',
      '2026-09-11-mc',
      '2026-09-12-mc',
      '2026-09-12-gw',
      '2026-09-13-mc',
      '2026-09-13-gw',
    ]);
    const gw = list.find((e) => e.code === 'gw')!;
    expect(gw.location).toBe('Garden');
    expect(gw.dTag).toBe(shiftDTag({ groupId: GROUP, date: '2026-09-12', code: 'gw' }));
    expect(gw.start).toBe(localToUnix('2026-09-12', '09:00', 'Europe/Brussels'));
    expect(list[0].location).toBe('Valley of the Commons');
    expect(list[0].timeRange).toBe('08:30–10:30');
  });

  it('defaults the window to the plan horizon', () => {
    expect(expectedShifts(plan, GROUP, '2026-09-07').filter((e) => e.code === 'mc')).toHaveLength(14);
  });
});

describe('shift plan — adopted from the wall', () => {
  it('builds one definition per code from the newest occurrence, in the published zone', () => {
    const coord = keypair();
    const mk = (date: string, code: string, title: string, startH: string, endH: string, createdAt: number, cap?: number): ShiftOccurrence => {
      const dTag = shiftDTag({ groupId: GROUP, date, code });
      return {
        dTag,
        address: shiftAddress(coord.pk, dTag),
        pubkey: coord.pk,
        groupId: GROUP,
        date,
        code,
        title,
        start: localToUnix(date, startH, 'Europe/Brussels'),
        end: localToUnix(date, endH, 'Europe/Brussels'),
        startTzid: 'Europe/Brussels',
        location: 'Valley of the Commons',
        ...(cap !== undefined ? { capacity: cap } : {}),
        content: '',
        createdAt,
        id: `${date}-${code}`,
      };
    };
    const plan = planFromOccurrences([
      mk('2026-09-08', 'dp', 'Dinner Prep (old)', '16:00', '18:00', 1, 2),
      mk('2026-09-09', 'dp', 'Dinner Preparation', '16:30', '18:30', 2, 2),
      mk('2026-09-09', 'mc', 'Morning Cleaning', '08:30', '10:30', 2),
    ])!;
    expect(plan.tzid).toBe('Europe/Brussels');
    expect(plan.location).toBe('Valley of the Commons');
    expect(plan.shifts).toEqual([
      { code: 'mc', title: 'Morning Cleaning', start: '08:30', end: '10:30', capacity: 2, enabled: true },
      { code: 'dp', title: 'Dinner Preparation', start: '16:30', end: '18:30', capacity: 2, enabled: true },
    ]);
    expect(planFromOccurrences([])).toBeNull();
  });
});

describe('occurrence templates', () => {
  const coord = keypair();
  const signer = signerFromSecretKey(coord.sk);

  it('builds the 31923 exactly as Elinor publishes it', () => {
    const t = buildOccurrenceTemplate({
      groupId: GROUP,
      date: '2026-08-30',
      code: 'dp',
      title: 'Dinner Preparation',
      start: 1788100200,
      end: 1788107400,
      tzid: 'Europe/Brussels',
      location: 'Valley of the Commons',
      capacity: 2,
      timeRange: '16:30–18:30',
      now: 1788078250,
    });
    expect(t.kind).toBe(SHIFT_OCCURRENCE_KIND);
    expect(t.tags).toEqual([
      ['d', 'shift--5459621960-2026-08-30-dp'],
      ['title', 'Dinner Preparation'],
      ['start', '1788100200'],
      ['end', '1788107400'],
      ['start_tzid', 'Europe/Brussels'],
      ['location', 'Valley of the Commons'],
      ['capacity', '2'],
      ['t', 'shift'],
      ['t', 'dp'],
      ['t', 'group--5459621960'],
    ]);
    expect(t.content).toBe('Dinner Preparation shift, 16:30–18:30 (Valley of the Commons)');
    const signed = signer.sign(t);
    expect(verifyEvent(signed)).toBe(true);
    const occ = parseShiftOccurrence(signed)!;
    expect(occ.address).toBe(shiftAddress(coord.pk, 'shift--5459621960-2026-08-30-dp'));
    expect(occ.capacity).toBe(2);
  });

  it('appends the description and derives the time range when none is given', () => {
    const t = buildOccurrenceTemplate({
      groupId: GROUP,
      date: '2026-08-30',
      code: 'dp',
      title: 'Dinner Preparation',
      start: 1788100200,
      end: 1788107400,
      tzid: 'Europe/Brussels',
      description: 'bring an apron',
    });
    expect(t.content).toBe('Dinner Preparation shift, 16:30–18:30 — bring an apron');
    expect(t.tags.some((x) => x[0] === 'location')).toBe(false);
    expect(t.tags.some((x) => x[0] === 'capacity')).toBe(false);
  });

  it('refuses malformed keys and inverted times', () => {
    const base = { groupId: GROUP, date: '2026-08-30', code: 'dp', title: 'x', start: 10, end: 20 };
    expect(() => buildOccurrenceTemplate({ ...base, code: 'Bad' })).toThrow();
    expect(() => buildOccurrenceTemplate({ ...base, date: '30-08-2026' })).toThrow();
    expect(() => buildOccurrenceTemplate({ ...base, end: 10 })).toThrow();
  });

  it('builds a NIP-09 retraction naming each coordinate, id and kind', () => {
    const t = buildOccurrenceDeleteTemplate(
      [
        { address: `31923:${coord.pk}:shift--1-2026-08-30-dp`, id: 'e1' },
        { address: `31923:${coord.pk}:shift--1-2026-08-30-lp` },
      ],
      { now: 5, reason: 'cancelled' },
    );
    expect(t.kind).toBe(SHIFT_DELETE_KIND);
    expect(t.tags).toEqual([
      ['a', `31923:${coord.pk}:shift--1-2026-08-30-dp`],
      ['e', 'e1'],
      ['a', `31923:${coord.pk}:shift--1-2026-08-30-lp`],
      ['k', '31923'],
    ]);
    expect(t.content).toBe('cancelled');
    expect(() => buildOccurrenceDeleteTemplate([])).toThrow();
  });
});

describe('coverage', () => {
  const coord = keypair();
  const a = keypair();
  const b = keypair();
  const dTag = shiftDTag({ groupId: GROUP, date: '2026-09-08', code: 'mc' });
  const occ: ShiftOccurrence = {
    dTag,
    address: shiftAddress(coord.pk, dTag),
    pubkey: coord.pk,
    groupId: GROUP,
    date: '2026-09-08',
    code: 'mc',
    title: 'Morning Cleaning',
    start: localToUnix('2026-09-08', '08:30', 'UTC'),
    end: localToUnix('2026-09-08', '10:30', 'UTC'),
    capacity: 2,
    content: '',
    createdAt: 1,
    id: 'occ1',
  };
  const rsvp = (pk: string, status: 'accepted' | 'declined', createdAt: number, id: string): ShiftRsvp => ({
    pubkey: pk,
    address: occ.address,
    dTag: dTag.replace(/^shift-/, 'rsvp-'),
    status,
    createdAt,
    id,
  });

  it('classifies one occurrence', () => {
    expect(coverageOf(occ, [])).toMatchObject({ state: 'unstaffed', missing: 2, enrolled: [] });
    expect(coverageOf(occ, [rsvp(a.pk, 'accepted', 1, 'r1')])).toMatchObject({ state: 'short', missing: 1 });
    expect(coverageOf(occ, [rsvp(a.pk, 'accepted', 1, 'r1'), rsvp(b.pk, 'accepted', 2, 'r2')])).toMatchObject({ state: 'covered', missing: 0 });
    expect(coverageOf(occ, [rsvp(a.pk, 'accepted', 1, 'r1'), rsvp(a.pk, 'declined', 2, 'r2')])).toMatchObject({ state: 'unstaffed' });
    expect(coverageOf({ ...occ, capacity: undefined }, [])).toMatchObject({ state: 'open', missing: 0 });
  });

  it('reconciles the plan against the schedule: unpublished, unstaffed, short, covered, stale, drifted', () => {
    const plan: ShiftPlan = {
      tzid: 'UTC',
      horizonDays: 2,
      shifts: [
        { code: 'mc', title: 'Morning Cleaning', start: '08:30', end: '10:30', capacity: 2, enabled: true },
        { code: 'lp', title: 'Lunch Preparation', start: '10:30', end: '12:30', capacity: 1, enabled: true },
      ],
    };
    const expected = expectedShifts(plan, GROUP, '2026-09-08', 2);
    const lpTag = shiftDTag({ groupId: GROUP, date: '2026-09-08', code: 'lp' });
    const lp: ShiftOccurrence = {
      ...occ,
      dTag: lpTag,
      address: shiftAddress(coord.pk, lpTag),
      code: 'lp',
      title: 'Lunch Preparation',
      start: localToUnix('2026-09-08', '11:00', 'UTC'), // drifted from the plan's 10:30
      end: localToUnix('2026-09-08', '12:30', 'UTC'),
      capacity: 1,
      id: 'occ2',
    };
    const staleTag = shiftDTag({ groupId: GROUP, date: '2026-09-09', code: 'zz' });
    const stale: ShiftOccurrence = { ...occ, dTag: staleTag, address: shiftAddress(coord.pk, staleTag), date: '2026-09-09', code: 'zz', id: 'occ3', start: occ.start + 86400, end: occ.end + 86400 };
    const foreignTag = shiftDTag({ groupId: GROUP, date: '2026-09-09', code: 'mc' });
    const foreign: ShiftOccurrence = { ...occ, pubkey: a.pk, dTag: foreignTag, address: shiftAddress(a.pk, foreignTag), date: '2026-09-09', id: 'occ4', start: occ.start + 86400, end: occ.end + 86400 };

    const { items, summary } = reconcileSchedule(expected, [occ, lp, stale, foreign], [rsvp(a.pk, 'accepted', 1, 'r1')], {
      coordinatorPubkey: coord.pk,
    });
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey['2026-09-08-mc']).toMatchObject({ state: 'short', missing: 1, drifted: false });
    expect(byKey['2026-09-08-lp']).toMatchObject({ state: 'unstaffed', missing: 1, drifted: true });
    expect(byKey['2026-09-09-mc']).toMatchObject({ state: 'unpublished', missing: 2 }); // the foreign one does not count
    expect(byKey['2026-09-09-lp']).toMatchObject({ state: 'unpublished' });
    expect(byKey['2026-09-09-zz']).toMatchObject({ state: 'stale' });
    expect(summary).toEqual({
      expected: 4,
      unpublished: 2,
      unstaffed: 1, // lp; the stale one counts as stale only
      short: 1,
      covered: 0,
      stale: 1,
      spotsOpen: 1 + 1 + 2,
      spotsFilled: 1,
      spotsTotal: 2 + 1 + 2,
    });
    // Sorted by start.
    expect(items.map((i) => i.key)).toEqual(['2026-09-08-mc', '2026-09-08-lp', '2026-09-09-mc', '2026-09-09-zz', '2026-09-09-lp']);
  });

  it('applies the window to both sides', () => {
    const plan: ShiftPlan = { tzid: 'UTC', horizonDays: 3, shifts: [{ code: 'mc', title: 'M', start: '08:30', end: '10:30', capacity: 2, enabled: true }] };
    const expected = expectedShifts(plan, GROUP, '2026-09-08', 3);
    const { items } = reconcileSchedule(expected, [occ], [], { window: { since: occ.end + 1 } });
    expect(items.map((i) => i.key)).toEqual(['2026-09-09-mc', '2026-09-10-mc']);
  });
});

describe('plan persistence', () => {
  it('reads the plan off a settings record and drops bad definitions', () => {
    const doc = {
      id: '1',
      name: 'Casa',
      shifts: {
        tzid: 'Europe/Rome',
        horizonDays: 7,
        shifts: [
          { code: 'mc', title: 'Morning', start: '08:00', end: '09:00', capacity: 2, enabled: true },
          { code: 'BAD CODE', title: 'x', start: '08:00', end: '09:00' },
          { code: 'lp', title: 'Lunch', start: '12:00', end: '11:00' },
        ],
      },
    };
    expect(readShiftPlan(doc)).toEqual({
      tzid: 'Europe/Rome',
      horizonDays: 7,
      shifts: [{ code: 'mc', title: 'Morning', start: '08:00', end: '09:00', capacity: 2, enabled: true }],
    });
    expect(readShiftPlan([{ id: 'x' }, doc])).not.toBeNull();
    expect(readShiftPlan({ id: '1' })).toBeNull();
    expect(readShiftPlan(null)).toBeNull();
    expect(readShiftPlan({ shifts: { tzid: 'Mars/Olympus', shifts: [] } })).toMatchObject({ tzid: 'UTC', horizonDays: 14 });
  });

  it('writes the plan beside the other settings fields', async () => {
    const writes: unknown[] = [];
    const store = {
      get: async () => ({ id: '1', name: 'Casa', allocation: { nzones: 3 } }),
      put: async (_h: string, _l: string, v: unknown) => void writes.push(v),
    };
    const plan = defaultShiftPlan('Europe/Rome', 'Casa Selva');
    await saveShiftPlan(store, '1', plan);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ id: '1', name: 'Casa', allocation: { nzones: 3 }, shifts: { tzid: 'Europe/Rome', location: 'Casa Selva' } });
    expect(readShiftPlan(writes[0])).toEqual(plan);
  });
});

describe('relay client — coordinator side', () => {
  function fakePool() {
    const published: { kind: number; tags: string[][]; pubkey: string }[] = [];
    const pool: ShiftPoolLike = {
      querySync: async () => [],
      publish: (relays, event) => {
        published.push(event);
        return relays.map(() => Promise.resolve('ok'));
      },
    };
    return { pool, published };
  }

  it('publishes an occurrence as the coordinator and returns the parsed shape', async () => {
    const coord = keypair();
    const { pool, published } = fakePool();
    const client = createShiftRelayClient({ relays: ['wss://a', 'wss://b'], pool, coordinatorPubkey: coord.pk });
    const { occurrence, results } = await client.publishOccurrence({
      signer: signerFromSecretKey(coord.sk),
      groupId: GROUP,
      date: '2026-09-08',
      code: 'mc',
      title: 'Morning Cleaning',
      start: 100,
      end: 200,
      capacity: 2,
    });
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(published[0].kind).toBe(31923);
    expect(occurrence.address).toBe(shiftAddress(coord.pk, shiftDTag({ groupId: GROUP, date: '2026-09-08', code: 'mc' })));
  });

  it('refuses to publish as anyone but the pinned coordinator', async () => {
    const coord = keypair();
    const other = keypair();
    const client = createShiftRelayClient({ relays: ['wss://a'], pool: fakePool().pool, coordinatorPubkey: coord.pk });
    await expect(
      client.publishOccurrence({ signer: signerFromSecretKey(other.sk), groupId: GROUP, date: '2026-09-08', code: 'mc', title: 'x', start: 1, end: 2 }),
    ).rejects.toThrow(/not the trusted coordinator/);
  });

  it('retracts only the signer’s own occurrences', async () => {
    const coord = keypair();
    const other = keypair();
    const { pool, published } = fakePool();
    const client = createShiftRelayClient({ relays: ['wss://a'], pool });
    const signer = signerFromSecretKey(coord.sk);
    const mine = { address: shiftAddress(coord.pk, 'shift--1-2026-09-08-mc'), pubkey: coord.pk, id: 'e1' };
    const theirs = { address: shiftAddress(other.pk, 'shift--1-2026-09-08-mc'), pubkey: other.pk, id: 'e2' };
    const { event } = await client.deleteOccurrences({ signer, occurrences: [mine, theirs] });
    expect(event.kind).toBe(5);
    expect(event.tags.filter((t) => t[0] === 'a').map((t) => t[1])).toEqual([mine.address]);
    expect(published).toHaveLength(1);
    await expect(client.deleteOccurrences({ signer, occurrences: [theirs] })).rejects.toThrow(/none of these/);
  });
});
