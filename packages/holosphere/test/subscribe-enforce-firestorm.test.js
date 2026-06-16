/**
 * The enforce/annotate subscribe wrapper must not pour fuel on a Gun map().on()
 * fire-storm (corrupt circular holograms, mutual-federation cycles): while a
 * storm is flagged it must do NO `_events` reads, and it must never schedule
 * re-verification retries for hologram pointers (which rewrite `updated` every
 * cascade and have no local envelope).
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'quests';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('subscribe under enforce — fire-storm / hologram safety', () => {
  let sphere, dir;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-fs-'));
    sphere = new HoloSphere({
      appName: 'fs-test',
      privateKey: generateSecretKey(),
      gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false },
    });
    await sphere.enableSigning({ relays: [], enforce: true });
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 15000);

  test('no resolveItem reads while a fire-storm is flagged', async () => {
    let resolveCalls = 0;
    const orig = sphere._signer.resolveItem.bind(sphere._signer);
    sphere._signer.resolveItem = async (...a) => { resolveCalls++; return orig(...a); };

    // Simulate the runaway flag that utils.subscribe raises during a storm.
    sphere.__onFireWarnedAt = Date.now();

    const sub = sphere.subscribe(HOLON, LENS, () => {}, { includeUnverified: true });
    // write a few items while "storming"
    for (let i = 0; i < 3; i++) {
      await sphere.put(HOLON, LENS, { id: `s${i}`, title: `s${i}` }, null, { autoPropagate: false });
    }
    await wait(800);
    sub.unsubscribe();
    sphere._signer.resolveItem = orig;
    delete sphere.__onFireWarnedAt;

    expect(resolveCalls).toBe(0); // wrapper stayed dormant — added no fuel
  }, 20000);

  test('a hologram pointer is never retried (no endless re-verification)', async () => {
    let resolveCalls = 0;
    const orig = sphere._signer.resolveItem.bind(sphere._signer);
    sphere._signer.resolveItem = async () => { resolveCalls++; return null; }; // never verifies

    const sub = sphere.subscribe(HOLON, LENS, () => {}, { includeUnverified: true });
    // Drive a hologram-shaped raw straight through the wrapper's notify path.
    const holoRaw = { id: 'h1', soul: 'fs-test/89283082803ffff/quests/h1' };
    sphere.notifySubscribers({ holon: HOLON, lens: LENS, ...holoRaw });

    await wait(2000); // long enough for any [400,1200,3000] retries to have fired
    sub.unsubscribe();
    sphere._signer.resolveItem = orig;

    // One resolve for the initial emit, and crucially NO scheduled retries after.
    expect(resolveCalls).toBeLessThanOrEqual(1);
  }, 20000);
});
