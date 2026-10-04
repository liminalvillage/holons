/**
 * Vouched pointers: a hologram written into a governed holon by a key that is
 * not seated there still counts when the app's `vouch` hook says the target
 * (or source) stands behind it. Tombstones from unseated keys never count.
 */
import HoloSphere from '../holosphere.js';
import { buildEvent, generateSecretKey, getPublicKey } from '../nostr-events.js';

const APP = 'vouch-test';
const MINE = '-100900';     // governed: only the reader counts
const SOURCE = '-100901';   // open: nobody defined, reads plain
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('signing: vouched pointers', () => {
  const spheres = [];
  afterAll(async () => { for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } } });

  const readerSk = generateSecretKey(), readerPub = getPublicKey(readerSk);
  const strangerSk = generateSecretKey();
  const authority = async (_holo, holon) => (holon === MINE ? (pub) => pub === readerPub : null);
  const asked = [];
  // The app's rule, reduced to its first clause: the target names this holon.
  const vouch = async (_holo, ctx) => {
    asked.push(ctx);
    return Array.isArray(ctx.resolved?.participants) && ctx.resolved.participants.some((p) => String(p.id) === ctx.holon);
  };
  const make = (sk) => {
    const s = new HoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' }, signing: { enforce: 'authority', authority, vouch } });
    spheres.push(s);
    return s;
  };
  let clock = Math.floor(Date.now() / 1000) + 10;
  const plant = (holo, holon, lens, item, sk = strangerSk) => {
    const evt = buildEvent({ holon, lens, item, sk, created_at: ++clock, extraTags: [['n', APP]] });
    holo.store.apply(evt, { origin: 'remote' });
    return evt;
  };
  const pointer = (id, key = id) => ({ id, soul: `${APP}/${SOURCE}/quests/${key}` });

  test('a stranger\'s pointer counts when its target names the holon, and only then', async () => {
    const holo = make(readerSk);
    await holo.ready();
    plant(holo, SOURCE, 'quests', { id: 'q1', title: 'joined', participants: [{ id: Number(MINE) }] });
    plant(holo, SOURCE, 'quests', { id: 'q2', title: 'not mine', participants: [{ id: 42 }] });
    plant(holo, MINE, 'quests', pointer('q1'));
    plant(holo, MINE, 'quests', pointer('q2'));

    const view = await holo.getAll(MINE, 'quests');
    expect(view.map((q) => q.id)).toEqual(['q1']);
    expect(view[0].title).toBe('joined');
    expect(view[0]._hologram?.soul).toBe(`${APP}/${SOURCE}/quests/q1`);
    expect((await holo.getPending(MINE, 'quests')).map((q) => q.id)).toEqual(['q2']);
    expect((await holo.get(MINE, 'quests', 'q1'))?.title).toBe('joined');
    expect(await holo.get(MINE, 'quests', 'q2')).toBeNull();
    expect(asked.every((c) => c.holon === MINE && c.lens === 'quests' && c.claim.soul && c.author === getPublicKey(strangerSk))).toBe(true);
  });

  test('a stranger retracts only their own pointer; the reader removes it; a fresh vouched claim brings it back', async () => {
    const holo = make(readerSk);
    await holo.ready();
    const otherSk = generateSecretKey();
    plant(holo, SOURCE, 'quests', { id: 'q1', title: 'joined', participants: [{ id: Number(MINE) }] });
    plant(holo, MINE, 'quests', pointer('q1'));
    plant(holo, MINE, 'quests', pointer('q1'), otherSk);
    expect((await holo.getAll(MINE, 'quests')).map((q) => q.id)).toEqual(['q1']);

    // The store keeps one claim per author per address: a stranger's tombstone
    // replaces THEIR pointer and is never counted — the other author's pointer
    // still stands, and so does the item.
    plant(holo, MINE, 'quests', { id: 'q1', _deleted: true });
    expect((await holo.getAll(MINE, 'quests')).map((q) => q.id)).toEqual(['q1']);
    plant(holo, MINE, 'quests', { id: 'q1', _deleted: true }, otherSk);
    expect(await holo.getAll(MINE, 'quests')).toEqual([]);
    plant(holo, MINE, 'quests', pointer('q1'), otherSk);
    expect((await holo.getAll(MINE, 'quests')).map((q) => q.id)).toEqual(['q1']);

    plant(holo, MINE, 'quests', { id: 'q1', _deleted: true }, readerSk); // the reader left: newest counted claim
    expect(await holo.getAll(MINE, 'quests')).toEqual([]);
    expect(await holo.get(MINE, 'quests', 'q1')).toBeNull();

    plant(holo, MINE, 'quests', pointer('q1'));                          // re-added by someone else, target still vouches
    expect((await holo.getAll(MINE, 'quests')).map((q) => q.id)).toEqual(['q1']);
  });

  test('when the target stops naming the holon the pointer disappears without a delete', async () => {
    const holo = make(readerSk);
    await holo.ready();
    plant(holo, SOURCE, 'quests', { id: 'q1', title: 'joined', participants: [{ id: Number(MINE) }] });
    plant(holo, MINE, 'quests', pointer('q1'));
    expect((await holo.getAll(MINE, 'quests')).map((q) => q.id)).toEqual(['q1']);
    plant(holo, SOURCE, 'quests', { id: 'q1', title: 'left', participants: [] });
    expect(await holo.getAll(MINE, 'quests')).toEqual([]);
    expect((await holo.getPending(MINE, 'quests')).map((q) => q.id)).toEqual(['q1']);
  });

  test('subscriptions deliver the vouched value and null for the rest', async () => {
    const holo = make(readerSk);
    await holo.ready();
    plant(holo, SOURCE, 'quests', { id: 'q1', title: 'joined', participants: [{ id: Number(MINE) }] });
    plant(holo, SOURCE, 'quests', { id: 'q2', title: 'not mine', participants: [] });
    const seen = [];
    holo.subscribe(MINE, 'quests', (item, key) => seen.push(`${key}:${item ? item.title : null}`));
    await wait(20);
    plant(holo, MINE, 'quests', pointer('q1'));
    plant(holo, MINE, 'quests', pointer('q2'));
    await wait(150);
    expect(seen).toContain('q1:joined');
    expect(seen).toContain('q2:null');
    expect(seen).not.toContain('q2:not mine');
  });

  test('without a vouch hook a stranger\'s pointer stays pending', async () => {
    const s = new HoloSphere({ appName: APP, privateKey: readerSk, store: { adapter: 'memory' }, signing: { enforce: 'authority', authority } });
    spheres.push(s);
    await s.ready();
    plant(s, SOURCE, 'quests', { id: 'q1', title: 'joined', participants: [{ id: Number(MINE) }] });
    plant(s, MINE, 'quests', pointer('q1'));
    expect(await s.getAll(MINE, 'quests')).toEqual([]);
    expect((await s.getPending(MINE, 'quests')).map((q) => q.id)).toEqual(['q1']);
  });
});
