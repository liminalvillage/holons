/**
 * Global functions are just get/put without a holon: data at appname/table/key.
 * Proves putGlobal/getGlobal interoperate with holon-less put/get on the same path.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';

const TABLE = 'mytable';
const ids = (a) => a.map((i) => i.id).sort();

describe('global = get/put without a holon', () => {
  let sphere, dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-global-'));
    sphere = new HoloSphere({ appName: 'global-test', privateKey: undefined,
      store: { adapter: 'memory' } });
  });

  afterAll(async () => {
    try { await sphere?.close?.(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test('putGlobal is readable via holon-less get', async () => {
    await sphere.putGlobal(TABLE, { id: 'g1', v: 1 });
    expect((await sphere.get(null, TABLE, 'g1'))?.v).toBe(1);
  });

  test('holon-less put is readable via getGlobal', async () => {
    await sphere.put(null, TABLE, { id: 'g2', v: 2 });
    expect((await sphere.getGlobal(TABLE, 'g2'))?.v).toBe(2);
  });

  test('getAllGlobal == getAll(null, table)', async () => {
    expect(ids(await sphere.getAllGlobal(TABLE))).toEqual(['g1', 'g2']);
    expect(ids(await sphere.getAll(null, TABLE))).toEqual(['g1', 'g2']);
  });

  test('deleteGlobal removes from the global table', async () => {
    await sphere.deleteGlobal(TABLE, 'g1');
    expect(await sphere.getGlobal(TABLE, 'g1')).toBeNull();
    expect(ids(await sphere.getAllGlobal(TABLE))).toEqual(['g2']);
  });
});
