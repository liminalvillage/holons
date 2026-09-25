/**
 * enforce: 'authority' — the app's hook says who speaks for a holon. Where
 * it names a predicate, reads collapse to accepted authors; where it says
 * null (nobody defined), the holon reads unenforced. A re-login keeps the
 * mode.
 */
import HoloSphere from '../holosphere.js';
import { buildEvent, generateSecretKey, getPublicKey } from '../nostr-events.js';

const APP = 'authority-test';
const GOVERNED = '-100600';
const OPEN = '-100601';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe("signing: enforce 'authority'", () => {
  const spheres = [];
  afterAll(async () => { for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } } });

  const readerSk = generateSecretKey();
  const readerPub = getPublicKey(readerSk);
  const strangerSk = generateSecretKey();
  const strangerPub = getPublicKey(strangerSk);
  const calls = [];
  const authority = async (_holo, holon) => {
    calls.push(holon);
    if (holon === GOVERNED) return (pub) => pub === readerPub;
    return null;
  };
  const make = (sk) => {
    const s = new HoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' }, signing: { enforce: 'authority', authority } });
    spheres.push(s);
    return s;
  };
  const plant = (holo, holon, item) => {
    const evt = buildEvent({ holon, lens: 'tasks', item, sk: strangerSk, created_at: Math.floor(Date.now() / 1000) + 5, extraTags: [['n', APP]] });
    holo.store.apply(evt, { origin: 'remote' });
    return evt;
  };

  test('a governed holon hides a stranger, an ungoverned one shows everyone', async () => {
    const holo = make(readerSk);
    await holo.ready();
    expect(holo.enforceActive).toBe(true);
    await holo.put(GOVERNED, 'tasks', { id: 'mine', title: 'mine' });
    plant(holo, GOVERNED, { id: 'theirs', title: 'planted' });
    plant(holo, OPEN, { id: 'theirs', title: 'planted-open' });
    await holo.put(OPEN, 'tasks', { id: 'mine', title: 'mine-open' });

    expect((await holo.getAll(GOVERNED, 'tasks')).map((t) => t.id).sort()).toEqual(['mine']);
    expect(await holo.get(GOVERNED, 'tasks', 'theirs')).toBeNull();
    expect((await holo.getPending(GOVERNED, 'tasks')).map((t) => t.id)).toEqual(['theirs']);
    // A stranger's newer claim at MY id does not replace mine either.
    plant(holo, GOVERNED, { id: 'mine', title: 'overwritten' });
    expect((await holo.get(GOVERNED, 'tasks', 'mine')).title).toBe('mine');

    expect((await holo.getAll(OPEN, 'tasks')).map((t) => t.id).sort()).toEqual(['mine', 'theirs']);
    expect((await holo.get(OPEN, 'tasks', 'theirs')).title).toBe('planted-open');
    expect(calls).toContain(GOVERNED);
    expect(calls).toContain(OPEN);
  });

  test('subscriptions follow the same rule', async () => {
    const holo = make(readerSk);
    await holo.ready();
    const governed = [], open = [];
    holo.subscribe(GOVERNED, 'tasks', (item, key) => governed.push(`${key}:${item ? item.title : null}`));
    holo.subscribe(OPEN, 'tasks', (item, key) => open.push(`${key}:${item ? item.title : null}`));
    await wait(20);
    await holo.put(GOVERNED, 'tasks', { id: 'a', title: 'ok' });
    plant(holo, GOVERNED, { id: 'b', title: 'planted' });
    plant(holo, OPEN, { id: 'b', title: 'planted-open' });
    await wait(100);
    expect(governed).toContain('a:ok');
    expect(governed).toContain('b:null');
    expect(governed).not.toContain('b:planted');
    expect(open).toContain('b:planted-open');
  });

  test('a re-login keeps the configured mode and hook', async () => {
    const holo = make(readerSk);
    await holo.ready();
    await holo.login(strangerSk);
    expect(holo.currentPubkey).toBe(strangerPub);
    expect(holo._signer.enforce).toBe('authority');
    // Now the stranger IS this instance, and still not accepted in the governed holon.
    await holo.put(GOVERNED, 'tasks', { id: 's', title: 'as stranger' });
    expect(await holo.get(GOVERNED, 'tasks', 's')).toBeNull();
    expect((await holo.getPending(GOVERNED, 'tasks')).map((t) => t.id)).toEqual(['s']);
  });

  test("the mode needs a hook", () => {
    expect(() => new HoloSphere({ appName: APP, privateKey: generateSecretKey(), store: { adapter: 'memory' }, signing: { enforce: 'authority' } })).toThrow(/authority/);
  });
});
