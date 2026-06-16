/**
 * Regression: a SIGNED item that first resolves UNVERIFIED because its `_events`
 * envelope hadn't loaded yet (the cold-load race after a page reload — the raw
 * item arrives from radisk/a peer before the local envelope) must self-correct
 * to verified, not stay "unsigned" forever.
 *
 * The enforce subscribe wrapper drops value-identical echoes to kill the
 * re-resolution storm; this test guards that the drop does NOT also suppress
 * the recovery of a late-loading envelope — unconfirmed resolves get a few
 * time-spaced re-verifications.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'quests';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('subscribe under enforce — late envelope recovery after reload', () => {
  let sphere, dir;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-reload-'));
    sphere = new HoloSphere({
      appName: 'reload-test',
      privateKey: generateSecretKey(),
      gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false },
    });
    await sphere.enableSigning({ relays: [], enforce: true });
    for (let i = 0; i < 4; i++) {
      await sphere.put(HOLON, LENS, { id: `m${i}`, title: `signed ${i}` }, null, { autoPropagate: false });
    }
    await wait(500);
  }, 60000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 15000);

  test('a signed item that resolves unverified on first (cold) read upgrades to verified', async () => {
    // Force the FIRST resolve of each id to miss the envelope (cold), as if the
    // raw item arrived before `_events` finished loading; later reads succeed.
    const real = sphere._signer.resolveItem.bind(sphere._signer);
    const cold = new Set();
    sphere._signer.resolveItem = async (holo, holon, lens, key) => {
      if (!cold.has(key)) { cold.add(key); return null; }
      return real(holo, holon, lens, key);
    };

    const status = new Map();
    const sub = sphere.subscribe(
      HOLON, LENS,
      (item, key) => {
        if (item && item.id) status.set(item.id, item._verified ? 'verified' : (item._unverified ? 'unverified' : 'plain'));
        else if (key) status.delete(key);
      },
      { includeUnverified: true },
    );

    await wait(400); // initial: cold -> unverified
    const initialUnverified = [...status.values()].filter((v) => v === 'unverified').length;

    await wait(3000); // time-spaced re-verification should kick in and upgrade
    sub.unsubscribe();
    sphere._signer.resolveItem = real;

    const verified = [...status.values()].filter((v) => v === 'verified').length;

    expect(status.size).toBe(4);
    expect(initialUnverified).toBeGreaterThan(0); // proves the cold race was exercised
    expect(verified).toBe(4);                     // and that every item recovered
  }, 30000);
});
