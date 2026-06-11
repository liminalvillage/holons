/**
 * subscribe() notifies on deletes too — callback(null, key) when an item is
 * removed (contract is `object | null`). Works for plain and enforce-mode.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mk(signing) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-subdel-'));
  const sphere = new HoloSphere({ appName: 'subdel-test', privateKey: signing ? generateSecretKey() : undefined,
    gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false } });
  return { sphere, dir };
}

describe('subscribe notifies on deletes', () => {
  test('plain subscribe fires callback(null, key) on delete', async () => {
    const { sphere, dir } = mk(false);
    const events = [];
    const sub = sphere.subscribe(HOLON, 'tasks', (data, key) => events.push({ key, data }));

    await sphere.put(HOLON, 'tasks', { id: 't1', title: 'Repair the well' });
    await wait(700);
    expect(events.some((e) => e.key === 't1' && e.data && e.data.id === 't1')).toBe(true);

    await sphere.delete(HOLON, 'tasks', 't1');
    await wait(700);
    const lastT1 = [...events].reverse().find((e) => e.key === 't1');
    expect(lastT1.data).toBeNull(); // notified of the delete

    sub.unsubscribe();
    try { await sphere.close?.(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20000);

  test('enforce-mode subscribe re-resolves and notifies on a signed delete', async () => {
    const { sphere, dir } = mk(true);
    await sphere.enableSigning({ relays: [], enforce: true });
    const events = [];
    const sub = sphere.subscribe(HOLON, 'tasks', (data, key) => events.push({ key, data }));

    await sphere.put(HOLON, 'tasks', { id: 't1', title: 'mine' }); // signed
    await wait(800);
    expect(events.some((e) => e.key === 't1' && e.data && e.data.id === 't1')).toBe(true);

    await wait(1100); // ensure the tombstone is newer (1s clock)
    await sphere.delete(HOLON, 'tasks', 't1'); // signed tombstone
    await wait(900);
    const lastT1 = [...events].reverse().find((e) => e.key === 't1');
    expect(lastT1.data).toBeNull(); // resolved to absent after the signed delete

    sub.unsubscribe();
    sphere.disableSigning();
    try { await sphere.close?.(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }, 25000);
});
