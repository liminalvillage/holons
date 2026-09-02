/**
 * Shadow-mode verification (Phase 1, last step): signed envelopes are stored in
 * Gun and reads are classified accounted-vs-would-drop WITHOUT changing output.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'tasks';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('shadow-mode verification (Phase 1)', () => {
  let sphere, dir;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-shadow-'));
    sphere = new HoloSphere({
      appName: 'shadow-test',
      privateKey: generateSecretKey(),
      store: { adapter: 'memory' },
    });
    // shadow mode (no relay needed) — stores signed envelopes locally
    await sphere.enableSigning({ relays: [], shadow: true });

    // two SIGNED writes (normal put -> envelope stored)
    await sphere.put(HOLON, LENS, { id: 'task-signed-1', title: 'Repair the well' });
    await sphere.put(HOLON, LENS, { id: 'task-signed-2', title: 'Plant the orchard' });
    // one UNSIGNED write (bypasses signing -> raw item, no envelope) — a forgery surface
    await sphere.put(HOLON, LENS, { id: 'task-unsigned', title: 'Who wrote this?' }, null, { _skipSign: true });

    await wait(1500); // let envelopes flush
  });

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test('getAll output is UNCHANGED — all items returned, signed or not', async () => {
    const items = await sphere.getAll(HOLON, LENS);
    const ids = items.map((i) => i.id).sort();
    expect(ids).toEqual(['task-signed-1', 'task-signed-2', 'task-unsigned']);
  });

  test('auditLens classifies accounted vs would-drop', async () => {
    const r = await sphere.auditLens(HOLON, LENS);
    expect(r.items).toBe(3);
    expect(r.accounted).toBe(2);     // the two signed writes
    expect(r.wouldDrop).toBe(1);     // the unsigned write
    expect(r.unsigned).toBe(1);
    expect(r.invalidSig).toBe(0);
    expect(r.mismatch).toBe(0);
  });

  test('cumulative report attributes accounted items to the author pubkey', async () => {
    const report = sphere.getShadowReport();
    expect(report.accounted).toBeGreaterThanOrEqual(2);
    expect(report.wouldDrop).toBeGreaterThanOrEqual(1);
    expect(report.byPubkey[sphere._signer.pubkey]).toBeGreaterThanOrEqual(2);
  });

  test('resetShadowReport clears counters', () => {
    sphere.resetShadowReport();
    const r = sphere.getShadowReport();
    expect(r.items).toBe(0);
    expect(r.accounted).toBe(0);
    expect(r.wouldDrop).toBe(0);
  });
});
