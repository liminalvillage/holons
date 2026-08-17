/**
 * Fire-storm quarantine: a lens that was detached for a runaway map().on()
 * storm (corrupt circular hologram) must refuse re-subscription for a cooldown,
 * so a caller that re-subscribes on every update can't instantly restart the
 * storm. Verifies the refusal path returns an inert subscription and delivers
 * no callbacks.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'quests';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('subscribe — fire-storm quarantine refusal', () => {
  let sphere, dir;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-q-'));
    sphere = new HoloSphere({
      appName: 'q-test',
      privateKey: generateSecretKey(),
      gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false },
    });
  }, 30000);

  afterAll(async () => {
    try { await sphere?.close?.(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 15000);

  test('a quarantined lens refuses to re-subscribe and delivers nothing', async () => {
    // Mark the lens quarantined, as the storm breaker would.
    sphere.__quarantined = new Map();
    sphere.__quarantined.set(`${HOLON} ${LENS}`, Date.now());

    let fires = 0;
    const sub = sphere.subscribe(HOLON, LENS, () => { fires++; });

    // It returns an inert { unsubscribe } and must NOT have attached a listener.
    expect(typeof sub.unsubscribe).toBe('function');
    await sphere.put(HOLON, LENS, { id: 'x1', title: 'should not surface' }, null, { autoPropagate: false });
    await wait(600);

    expect(fires).toBe(0);
    expect(() => sub.unsubscribe()).not.toThrow();
  }, 20000);

  test('once the cooldown is cleared, subscription works again', async () => {
    sphere.__quarantined.delete(`${HOLON} ${LENS}`);

    const seen = new Set();
    const sub = sphere.subscribe(HOLON, LENS, (item, key) => { if (item && item.id) seen.add(item.id); else if (key) seen.delete(key); });
    await sphere.put(HOLON, LENS, { id: 'x2', title: 'should surface now' }, null, { autoPropagate: false });
    await wait(800);
    sub.unsubscribe();

    expect(seen.has('x2')).toBe(true);
  }, 20000);

  // A burst over the threshold is normal for a lens full of holograms: every
  // pointer resolution reads its source, and those reads make Gun re-emit the
  // whole lens. That settles by itself, so only a burst that is STILL over the
  // threshold a grace window later may quarantine the lens. Both tests drive
  // the breaker through the per-instance overrides — real thresholds would need
  // thousands of fires to reproduce.
  test('a short burst over the threshold does not quarantine', async () => {
    const lens = 'burst';
    sphere.__quarantineFireThreshold = 3;
    sphere.__quarantineGraceMs = 60000; // far longer than this burst

    const seen = new Set();
    const sub = sphere.subscribe(HOLON, lens, (item) => { if (item?.id) seen.add(item.id); });
    for (let i = 0; i < 12; i++) {
      await sphere.put(HOLON, lens, { id: `b${i}`, title: `burst ${i}` }, null, { autoPropagate: false });
    }
    await wait(400);

    expect(sphere.__quarantined?.has(`${HOLON} ${lens}`)).toBeFalsy();
    // Still live: a write after the burst is still delivered.
    await sphere.put(HOLON, lens, { id: 'after', title: 'still listening' }, null, { autoPropagate: false });
    await wait(600);
    sub.unsubscribe();

    expect(seen.has('after')).toBe(true);
  }, 30000);

  test('a storm sustained past the grace window quarantines the lens', async () => {
    const lens = 'storm';
    sphere.__quarantineFireThreshold = 3;
    sphere.__quarantineGraceMs = 100; // any burst outliving this is a runaway

    const sub = sphere.subscribe(HOLON, lens, () => {});
    for (let i = 0; i < 30 && !sphere.__quarantined?.has(`${HOLON} ${lens}`); i++) {
      await sphere.put(HOLON, lens, { id: `s${i}`, title: `storm ${i}` }, null, { autoPropagate: false });
      await wait(20); // keep firing across the grace window
    }
    sub.unsubscribe();

    expect(sphere.__quarantined?.has(`${HOLON} ${lens}`)).toBe(true);
    // ...and the quarantine refuses the next subscribe, as before.
    let fires = 0;
    const refused = sphere.subscribe(HOLON, lens, () => { fires++; });
    await sphere.put(HOLON, lens, { id: 'after-storm' }, null, { autoPropagate: false });
    await wait(600);
    refused.unsubscribe();

    expect(fires).toBe(0);
  }, 30000);
});
