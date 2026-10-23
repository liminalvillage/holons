/**
 * Field clocks: a write from a device holding a stale copy only wins the
 * fields its author actually changed. Reproduces the 2026-10-22 Lunation 84
 * case — a task rescheduled (or deleted) by one member came back on its old
 * date because another member's join re-asserted the whole stale record.
 */
import HoloSphere from '../holosphere.js';
import { generateSecretKey, buildEvent } from '../nostr-events.js';
import { stampClock, foldClaims, hasClock } from '../store/clock.js';

const HOLON = '-1009990000001';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => wait(1100);   // created_at has a 1 s resolution

describe('stampClock', () => {
  const AT = 'h/quests/q';
  const base = { item: { id: 'q', title: 'Mats', when: 'Y', _clock: { '@': AT, title: 10, when: 10 } }, created_at: 10 };

  test('unchanged fields keep the base stamp, changed ones get the write time', () => {
    const clock = stampClock({ id: 'q', title: 'Mats', when: 'T', _clock: { '@': AT, title: 10, when: 10 } }, base, 20, AT);
    expect(clock).toEqual({ '@': AT, title: 10, when: 20 });
  });

  test('a removed field is stamped as a change', () => {
    expect(stampClock({ id: 'q', title: 'Mats' }, base, 20, AT)).toEqual({ '@': AT, title: 10, when: 20 });
  });

  test('a field edited on an outdated copy keeps the outdated stamp', () => {
    const fresh = { item: { id: 'q', title: 'Mats', when: 'T', _clock: { '@': AT, title: 10, when: 20 } }, created_at: 20 };
    // The writer's copy saw `when` at 10; the store already holds a newer one.
    const clock = stampClock({ id: 'q', title: 'Mats', when: 'Y', p: [1], _clock: { '@': AT, title: 10, when: 10 } }, fresh, 30, AT);
    expect(clock).toEqual({ '@': AT, title: 10, when: 10, p: 30 });
  });

  test('a clock read from another address says nothing about this one', () => {
    const fresh = { item: { id: 'q', title: 'Mats', when: 'T', _clock: { '@': AT, title: 10, when: 20 } }, created_at: 20 };
    const copied = { id: 'q', title: 'Mats', when: 'Y', _clock: { '@': 'source/quests/q', title: 10, when: 10 } };
    expect(stampClock(copied, fresh, 30, AT)).toEqual({ '@': AT, title: 10, when: 30 });
  });

  test('a base without a clock asserted every field at its own time', () => {
    const legacy = { item: { id: 'q', title: 'Mats', when: 'Y' }, created_at: 10 };
    expect(stampClock({ id: 'q', title: 'Mats', when: 'T' }, legacy, 20, AT)).toEqual({ '@': AT, title: 10, when: 20 });
  });

  test('no base: every field is new', () => {
    expect(stampClock({ id: 'q', title: 'Mats' }, null, 20, AT)).toEqual({ '@': AT, title: 20 });
  });
});

describe('foldClaims', () => {
  test('claims without a clock fold to the newest item, untouched', () => {
    const a = { id: 'q', when: 'Y' };
    const b = { id: 'q', when: 'T' };
    expect(foldClaims([{ item: a, created_at: 10, eventId: 'a' }, { item: b, created_at: 20, eventId: 'b' }])).toBe(b);
  });

  test('each field takes its highest stamp', () => {
    const r = { id: 'q', when: 'T', p: [], _clock: { '@': 'x', when: 20, p: 5 } };
    const a = { id: 'q', when: 'Y', p: [1], _clock: { '@': 'x', when: 5, p: 30 } };
    const out = foldClaims([{ item: r, created_at: 20, eventId: 'r' }, { item: a, created_at: 30, eventId: 'a' }], 'x');
    expect(out).toMatchObject({ id: 'q', when: 'T', p: [1] });
    expect(out._clock).toEqual({ '@': 'x', when: 20, p: 30 });
  });

  test('a newer claim without a clock asserts every field, absences included', () => {
    const r = { id: 'q', when: 'T', extra: 1, _clock: { when: 20, extra: 20 } };
    const legacy = { id: 'q', when: 'Y' };
    const out = foldClaims([{ item: r, created_at: 20, eventId: 'r' }, { item: legacy, created_at: 25, eventId: 'l' }]);
    expect(out.when).toBe('Y');
    expect(out).not.toHaveProperty('extra');
  });

  test('a stamp past its own write counts as the write\'s time, no later', () => {
    const forged = { id: 'q', when: 'never', _clock: { when: 9e9 } };
    const later = { id: 'q', when: 'today', _clock: { when: 30 } };
    const out = foldClaims([{ item: forged, created_at: 20, eventId: 'f' }, { item: later, created_at: 30, eventId: 'l' }]);
    expect(out.when).toBe('today');
    expect(out._clock.when).toBe(30);
  });

  test('a field one clocked claim never mentions comes from the claims that do', () => {
    const r = { id: 'q', _deleted: true, _clock: { _deleted: 20 } };
    const a = { id: 'q', title: 'Mats', p: [1], _clock: { title: 5, p: 30 } };
    const out = foldClaims([{ item: r, created_at: 20, eventId: 'r' }, { item: a, created_at: 30, eventId: 'a' }]);
    expect(out._deleted).toBe(true);
  });
});

describe('field clocks across two devices', () => {
  let roberto, anna;

  async function device() {
    const s = new HoloSphere({ appName: 'clock-test', privateKey: generateSecretKey(), store: { adapter: 'memory' } });
    await s.enableSigning({ relays: [] });
    return s;
  }
  /** Hand every signed event one device holds for the lens to the other. */
  function sync(from, to) {
    to.store.importEvents(from.store.exportEvents({ holon: HOLON, lens: 'quests' }));
  }
  const read = (s, id, opts) => s.get(HOLON, 'quests', id, null, opts);

  beforeEach(async () => {
    roberto = await device();
    anna = await device();
  }, 30000);

  afterEach(async () => {
    for (const s of [roberto, anna]) {
      try { s?.disableSigning(); } catch {}
      try { await s?.close?.(); } catch {}
    }
  }, 15000);

  test('a stale join does not undo a reschedule', async () => {
    await roberto.put(HOLON, 'quests', { id: '331', title: 'Clean and store yoga mats', when: 'yesterday', participants: [] });
    sync(roberto, anna);
    await tick();

    const mine = await read(roberto, '331');
    await roberto.put(HOLON, 'quests', { ...mine, when: 'today' });
    await tick();

    // Anna never received the reschedule and joins from her copy.
    const hers = await read(anna, '331');
    expect(hers.when).toBe('yesterday');
    await anna.put(HOLON, 'quests', { ...hers, participants: ['kamala'] });

    sync(roberto, anna);
    sync(anna, roberto);
    for (const s of [roberto, anna]) {
      const q = await read(s, '331');
      expect(q.when).toBe('today');
      expect(q.participants).toEqual(['kamala']);
    }
  }, 20000);

  test('a stale join does not bring a deleted task back', async () => {
    await roberto.put(HOLON, 'quests', { id: 'a', title: 'Mats', when: 'yesterday', participants: [] });
    await roberto.put(HOLON, 'quests', { id: 'b', title: 'Map', when: 'yesterday', participants: [] });
    sync(roberto, anna);
    await tick();

    // Both delete styles: the kiosk's full-copy tombstone and holosphere.delete.
    await roberto.put(HOLON, 'quests', { ...(await read(roberto, 'a')), _deleted: true });
    await roberto.delete(HOLON, 'quests', 'b');
    await tick();

    for (const id of ['a', 'b']) {
      const hers = await read(anna, id);
      await anna.put(HOLON, 'quests', { ...hers, participants: ['kamala'] });
    }

    sync(roberto, anna);
    sync(anna, roberto);
    for (const s of [roberto, anna]) {
      expect(await read(s, 'a')).toBeNull();
      expect(await read(s, 'b')).toBeNull();
      expect((await s.getAll(HOLON, 'quests')).map((q) => q.id)).toEqual([]);
    }
  }, 20000);

  test('an edit made on an outdated in-memory copy keeps the newer value', async () => {
    await roberto.put(HOLON, 'quests', { id: 'q', title: 'Mats', when: 'yesterday', participants: [] });
    sync(roberto, anna);
    const heldOpen = await read(anna, 'q');      // a detail sheet left open
    await tick();

    await roberto.put(HOLON, 'quests', { ...(await read(roberto, 'q')), when: 'today' });
    sync(roberto, anna);                         // Anna's store is fresh now…
    await tick();

    await anna.put(HOLON, 'quests', { ...heldOpen, participants: ['anna'] });   // …her sheet is not
    sync(anna, roberto);
    for (const s of [roberto, anna]) {
      const q = await read(s, 'q');
      expect(q.when).toBe('today');
      expect(q.participants).toEqual(['anna']);
    }
  }, 20000);

  test('restoring a deleted task brings it back', async () => {
    await roberto.put(HOLON, 'quests', { id: 'q', title: 'Mats' });
    await tick();
    await roberto.put(HOLON, 'quests', { ...(await read(roberto, 'q')), _deleted: true });
    await tick();
    const tomb = await read(roberto, 'q', { includeDeleted: true });
    const { _deleted, ...restored } = tomb;
    await roberto.put(HOLON, 'quests', restored);
    expect((await read(roberto, 'q'))?.title).toBe('Mats');
  }, 20000);

  test('a newer write from a client without clocks still wins outright', async () => {
    await roberto.put(HOLON, 'quests', { id: 'q', title: 'Mats', when: 'today' });
    expect(hasClock((await read(roberto, 'q')))).toBe(true);
    await tick();
    const sk = generateSecretKey();
    roberto.store.apply(buildEvent({ holon: HOLON, lens: 'quests', sk, item: { id: 'q', title: 'Mats', when: 'yesterday' } }), { origin: 'remote' });
    const q = await read(roberto, 'q');
    expect(q.when).toBe('yesterday');
  }, 20000);

  test('enforced reads fold the accepted claims the same way', async () => {
    const reader = new HoloSphere({ appName: 'clock-test', privateKey: generateSecretKey(), store: { adapter: 'memory' } });
    await reader.enableSigning({ relays: [], enforce: true });
    await reader.addReadKey(roberto._signer.pubkey);
    await reader.addReadKey(anna._signer.pubkey);
    try {
      await roberto.put(HOLON, 'quests', { id: 'q', title: 'Mats', when: 'yesterday', participants: [] });
      sync(roberto, anna);
      await tick();
      await roberto.put(HOLON, 'quests', { ...(await read(roberto, 'q')), when: 'today' });
      await tick();
      await anna.put(HOLON, 'quests', { ...(await read(anna, 'q')), participants: ['kamala'] });
      sync(roberto, reader);
      sync(anna, reader);
      const [q] = await reader.getAll(HOLON, 'quests');
      expect(q).toMatchObject({ id: 'q', when: 'today', participants: ['kamala'] });
      expect((await read(reader, 'q')).when).toBe('today');
    } finally {
      try { reader.disableSigning(); } catch {}
      try { await reader.close?.(); } catch {}
    }
  }, 20000);
});

describe('field clocks for one writer', () => {
  let s;
  beforeEach(async () => {
    s = new HoloSphere({ appName: 'clock-test', privateKey: generateSecretKey(), store: { adapter: 'memory' } });
    await s.enableSigning({ relays: [] });
  }, 30000);
  afterEach(async () => {
    try { s?.disableSigning(); } catch {}
    try { await s?.close?.(); } catch {}
  }, 15000);

  test('an edit sheet left open across two saves keeps both edits', async () => {
    await s.put(HOLON, 'quests', { id: 'q', title: 'Mats', when: 'yesterday' });
    const sheet = await s.get(HOLON, 'quests', 'q');
    await s.put(HOLON, 'quests', { ...sheet, when: 'today' });
    await tick();
    // Same stale sheet, same field, second save: the writer's own change.
    await s.put(HOLON, 'quests', { ...sheet, when: 'tomorrow' });
    expect((await s.get(HOLON, 'quests', 'q')).when).toBe('tomorrow');
  }, 20000);

  test('put hands the written clock back on the caller\'s object', async () => {
    const q = { id: 'q', title: 'Mats' };
    await s.put(HOLON, 'quests', q);
    expect(q._clock).toEqual((await s.get(HOLON, 'quests', 'q'))._clock);
  }, 20000);
});
