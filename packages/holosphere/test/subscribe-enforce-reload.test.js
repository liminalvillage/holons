/**
 * After a reload, a SIGNED item must resolve as verified immediately: the
 * record and its signed claim live in the same store and hydrate together,
 * so there is no "raw arrived before the envelope" race any more.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'quests';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('subscribe under enforce — verified straight after a reload', () => {
  let dir, sk;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-reload-'));
    sk = generateSecretKey();
    const first = new HoloSphere({ appName: 'reload-test', privateKey: sk, store: { adapter: 'file', dir } });
    await first.enableSigning({ enforce: true });
    for (let i = 0; i < 4; i++) {
      await first.put(HOLON, LENS, { id: `m${i}`, title: `signed ${i}` }, null, { autoPropagate: false });
    }
    await first.close();
  }, 60000);

  afterAll(async () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 15000);

  test('every signed item is verified on the reopened store, none unverified', async () => {
    const sphere = new HoloSphere({ appName: 'reload-test', privateKey: sk, store: { adapter: 'file', dir } });
    await sphere.enableSigning({ enforce: true });
    expect(sphere.store.listKeys(HOLON, LENS).sort()).toEqual(['m0', 'm1', 'm2', 'm3']);

    const status = new Map();
    const sub = sphere.subscribe(
      HOLON, LENS,
      (item, key) => {
        if (item && item.id) status.set(item.id, item._verified ? 'verified' : (item._unverified ? 'unverified' : 'plain'));
        else if (key) status.delete(key);
      },
      { includeUnverified: true },
    );
    await wait(400);
    sub.unsubscribe();

    expect(status.size).toBe(4);
    expect([...status.values()].every((v) => v === 'verified')).toBe(true);
    expect((await sphere.getAll(HOLON, LENS)).map((i) => i.id).sort()).toEqual(['m0', 'm1', 'm2', 'm3']);
    await sphere.close();
  }, 30000);
});
