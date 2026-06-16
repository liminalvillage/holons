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
});
