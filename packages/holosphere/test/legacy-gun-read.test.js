/**
 * getAllLegacy — reading records stranded on the legacy Gun relay while the
 * nostr backend (peerless Gun) is the wire.
 *
 * Setup: a gun-backend "legacy writer" pushes records to a throwaway Gun
 * relay; a nostr-backend sphere (connected only to an in-process Nostr
 * relay) must NOT see them through the normal read path, but MUST surface
 * them — tagged `_unverified`/`_legacy` — through getAllLegacy.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { testSphere, startLocalRelay, cleanupTestEnv } from './helpers/testenv.js';
import { generateSecretKey } from '../nostr-events.js';

const APP = 'legacy-gun-read-test';
const HOLON = '89283082803ffff';
const LENS = 'quests';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns truthy or the deadline passes. */
async function eventually(fn, { timeout = 8000, step = 200 } = {}) {
  const until = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > until) return last;
    await wait(step);
  }
}

describe('getAllLegacy (legacy Gun relay reads on the nostr backend)', () => {
  let nostrRelay;
  let gunRelay;
  let legacyWriter;
  const dirs = [];
  const spheres = [];

  function nostrSphere(extraNostr = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-legacy-'));
    dirs.push(dir);
    const sphere = new HoloSphere({
      appName: APP,
      privateKey: generateSecretKey(),
      backend: 'nostr',
      nostr: { relays: [nostrRelay.url], syncTimeoutMs: 3000, ...extraNostr },
      gunOptions: {
        peers: [], axe: false, multicast: false, stats: false,
        radisk: true, file: path.join(dir, 'radata'), localStorage: false,
      },
    });
    spheres.push(sphere);
    return sphere;
  }

  beforeAll(async () => {
    nostrRelay = await startRelay();
    gunRelay = await startLocalRelay();
    // Legacy writer: plain gun backend peered with the legacy relay. Signing
    // is irrelevant here — legacy data predates the nostr wire.
    legacyWriter = await testSphere(APP, {
      gunOptions: { peers: [gunRelay.url] },
    });
    await legacyWriter.put(HOLON, LENS, { id: 'legacy-1', title: 'Old gun quest' });
    // Let the write reach the relay's graph before readers connect.
    await wait(500);
  });

  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } }
    await cleanupTestEnv();
    try { await nostrRelay.close(); } catch { /* closed */ }
    for (const d of dirs.splice(0)) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* tmp */ }
    }
    // Same straggler-socket hygiene as nostr-backend.test.js.
    await wait(200);
    for (const h of (typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [])) {
      if (h?.constructor?.name === 'Socket' && typeof h.unref === 'function') h.unref();
    }
  });

  test('legacy items are invisible to the normal read path but surface tagged via getAllLegacy', async () => {
    const sphere = nostrSphere({ legacyGunPeers: [gunRelay.url] });
    await sphere.ready();

    // Write one native item over the nostr wire so both sources exist.
    await sphere.put(HOLON, LENS, { id: 'native-1', title: 'Relay quest' });

    const native = await sphere.getAll(HOLON, LENS);
    expect(native.map((i) => i.id)).toContain('native-1');
    expect(native.map((i) => i.id)).not.toContain('legacy-1');

    const legacy = await eventually(async () => {
      const items = await sphere.getAllLegacy(HOLON, LENS);
      return items.length ? items : null;
    });
    expect(legacy).toBeTruthy();
    const item = legacy.find((i) => i.id === 'legacy-1');
    expect(item).toBeTruthy();
    expect(item.title).toBe('Old gun quest');
    expect(item._legacy).toBe(true);
    expect(item._unverified).toBe(true);
    expect(item._verified).toBe(false);

    // The mirror is a side channel: nothing leaked into the primary graph.
    const after = await sphere.getAll(HOLON, LENS);
    expect(after.map((i) => i.id)).not.toContain('legacy-1');
  }, 20000);

  test('subscribeFederated folds legacy items in and setLegacy toggles them live', async () => {
    const sphere = nostrSphere({ legacyGunPeers: [gunRelay.url] });
    await sphere.ready();
    await sphere.put(HOLON, LENS, { id: 'native-2', title: 'Relay quest 2' });

    let snapshot = [];
    const sub = sphere.subscribeFederated(
      HOLON, LENS,
      (items) => { snapshot = items; },
      { includeFederated: false, includeLegacy: true },
    );

    const withLegacy = await eventually(() => {
      const legacy = snapshot.find((i) => i.id === 'legacy-1');
      const native = snapshot.find((i) => i.id === 'native-2');
      return legacy && native ? { legacy, native } : null;
    });
    expect(withLegacy).toBeTruthy();
    expect(withLegacy.legacy._legacy).toBe(true);
    expect(withLegacy.legacy._unverified).toBe(true);
    expect(withLegacy.native._legacy).toBeUndefined();

    sub.setLegacy(false);
    const dropped = await eventually(() => (snapshot.some((i) => i.id === 'legacy-1') ? null : snapshot));
    expect(dropped.some((i) => i.id === 'native-2')).toBe(true);

    sub.setLegacy(true);
    const back = await eventually(() => snapshot.find((i) => i.id === 'legacy-1'));
    expect(back).toBeTruthy();
    sub.unsubscribe();
  }, 30000);

  test('no-op off the nostr backend and with legacy reads disabled', async () => {
    // gun backend → [] (the relay data already IS the wire there)
    const gunSphere = await testSphere(APP);
    expect(await gunSphere.getAllLegacy(HOLON, LENS)).toEqual([]);

    // nostr backend with legacyGunPeers: [] → disabled
    const disabled = nostrSphere({ legacyGunPeers: [] });
    await disabled.ready();
    expect(await disabled.getAllLegacy(HOLON, LENS)).toEqual([]);
    expect(disabled._legacyMirror).toBeNull();
  }, 20000);
});
