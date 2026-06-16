/**
 * Regression: adding ONE item to an enforce-mode lens that already holds many
 * items must NOT trigger an unbounded re-resolution storm.
 *
 * The enforce/annotate subscribe wrapper resolves each live update through the
 * signing layer, which READS the sibling `_events` envelope subtree from inside
 * the lens's own `map().on()` handler. Those reads make Gun re-emit the whole
 * lens, re-firing the handler with value-identical echoes — a positive feedback
 * loop. Unguarded, a single add fanned out into thousands of `resolveItem`
 * calls, starved the event loop, timed the write out, and the new item never
 * appeared ("freezes / doesn't add it"). The wrapper now drops value-identical
 * echoes and keeps one resolve in flight per id, so it converges.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'quests';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('subscribe under enforce — no re-resolution storm on add', () => {
  let sphere, dir;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-storm-'));
    sphere = new HoloSphere({
      appName: 'storm-test',
      privateKey: generateSecretKey(),
      gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false },
    });
    await sphere.enableSigning({ relays: [], enforce: true }); // federation read-list mode (what the web uses)
    for (let i = 0; i < 25; i++) {
      await sphere.put(HOLON, LENS, { id: `seed-${i}`, title: `seed ${i}` }, null, { autoPropagate: false });
    }
    await wait(400);
  }, 60000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 15000);

  test('adding one task converges quickly and the task appears', async () => {
    // Count resolveItem calls to detect the feedback storm.
    let resolveCalls = 0;
    const orig = sphere._signer.resolveItem.bind(sphere._signer);
    sphere._signer.resolveItem = async (...a) => { resolveCalls++; return orig(...a); };

    const seen = new Map();
    const sub = sphere.subscribe(
      HOLON, LENS,
      (item, key) => { if (item && item.id) seen.set(item.id, item); else if (key) seen.delete(key); },
      { includeUnverified: true },
    );
    await wait(1200); // initial hydration

    resolveCalls = 0;
    const t0 = Date.now();
    await sphere.put(HOLON, LENS, { id: 'NEW', title: 'the new task', status: 'todo' }, null, { autoPropagate: false });
    const putMs = Date.now() - t0;

    await wait(2500); // let the subscription settle
    sub.unsubscribe();
    sphere._signer.resolveItem = orig;

    // put must not stall to the write-timeout (5s); pre-fix it hit ~5.9s.
    expect(putMs).toBeLessThan(3000);
    // The new task must surface in the subscription (pre-fix it never did).
    expect(seen.has('NEW')).toBe(true);
    // Convergence: a single add over 26 items must not fan out into a storm.
    // Pre-fix this climbed into the thousands and kept growing; bound it well
    // below that (a handful of resolves: the map fire + notifySubscribers echo).
    expect(resolveCalls).toBeLessThan(60);
  }, 30000);
});
