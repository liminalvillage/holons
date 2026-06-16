/**
 * Subscribe under enforce mode must annotate provenance when called with
 * `{ includeUnverified: true }` — signed items get `_verified: true`, unsigned
 * (legacy/forged) items are surfaced tagged `_unverified: true`. This is what
 * the dashboard's "show all data" toggle + signed/unsigned badges rely on.
 *
 * Regression guard for the listener-dedup in Utils.subscribe: the shared Gun
 * listener must still deliver each event to the per-call enforce wrapper.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey, buildEvent } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'tasks';
const TS = 1700000000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('subscribe under enforce — provenance annotation', () => {
  let sphere, dir, Ask;

  async function writeSignedAndRaw(lens, sk, item, at) {
    const evt = buildEvent({ holon: HOLON, lens, item, sk, created_at: at });
    await new Promise((r) => {
      let s = false; const d = () => { if (!s) { s = true; r(); } };
      setTimeout(d, 2000);
      sphere.gun.get(sphere.appname).get(HOLON).get('_events').get(lens).get(item.id).get(evt.pubkey)
        .put(JSON.stringify(evt), () => d());
    });
    await sphere.put(HOLON, lens, item, null, { _skipSign: true, autoPropagate: false });
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-subenf-'));
    Ask = generateSecretKey();
    sphere = new HoloSphere({
      appName: 'subenf-test',
      privateKey: Ask,
      gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false },
    });
    await sphere.enableSigning({ relays: [], enforce: 'membership' });
    await sphere.foundHolon(HOLON, { at: TS });
    await writeSignedAndRaw(LENS, Ask, { id: 't1', title: 'A signed task' }, TS + 1);
    await sphere.put(HOLON, LENS, { id: 't-unsigned', title: 'forged' }, null, { _skipSign: true });
    await wait(1500);
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 15000);

  test('includeUnverified subscribe tags signed -> _verified, unsigned -> _unverified', async () => {
    const seen = new Map();
    const sub = sphere.subscribe(
      HOLON,
      LENS,
      (item) => { if (item && item.id) seen.set(item.id, item); },
      { includeUnverified: true },
    );
    await wait(2000);
    sub.unsubscribe();

    const t1 = seen.get('t1');
    const tu = seen.get('t-unsigned');

    expect(t1).toBeTruthy();
    expect(t1._verified).toBe(true);

    expect(tu).toBeTruthy();
    expect(tu._unverified).toBe(true);
  }, 20000);
});
