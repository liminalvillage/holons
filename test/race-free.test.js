/**
 * Race-free by construction: the signed envelope is issued before the raw write,
 * so a read (get/getAll/aggregate) immediately after `await put` — with NO delay
 * — already resolves the written value.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';

const HOLON = '89283082803ffff';

describe('race-free read-after-write (enforce)', () => {
  let sphere, dir;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-rf-'));
    sphere = new HoloSphere({ appName: 'rf-test', privateKey: generateSecretKey(),
      gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false } });
    await sphere.enableSigning({ relays: [], enforce: true, perActorLenses: ['participation'] });
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test('getAll sees a write with no delay', async () => {
    await sphere.put(HOLON, 'tasks', { id: 'a1', title: 'x' });
    expect((await sphere.getAll(HOLON, 'tasks')).map((i) => i.id)).toContain('a1');
  });

  test('get sees a write with no delay', async () => {
    await sphere.put(HOLON, 'tasks', { id: 'a2', title: 'y' });
    expect((await sphere.get(HOLON, 'tasks', 'a2'))?.id).toBe('a2');
  });

  test('aggregate sees a per-actor write with no delay', async () => {
    await sphere.put(HOLON, 'participation', { id: 'q9', user: 'me', status: 'in' });
    const recs = await sphere.aggregate(HOLON, 'participation', 'q9');
    expect(recs.map((r) => r._owner)).toContain(sphere._signer.pubkey);
  });
});
