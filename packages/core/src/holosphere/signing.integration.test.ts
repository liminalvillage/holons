/**
 * Integration: HoloSphere signing exercised through the real @holons/core
 * factory, in the holons runtime. Default authorized-read model = your
 * FEDERATION read-list (sign with your key, read from keys you trust).
 *
 * Requires the local holosphere build (root pnpm override
 * `holosphere: link:../holosphere`). Proves the API works when consumed exactly
 * the way the dashboard consumes it — `createHoloSphere(...)`.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateSecretKey, getPublicKey, buildEvent } from 'holosphere/nostr-events';
import { createHoloSphere } from './factory.js';

const HOLON = '89283082803ffff';
const LENS = 'tasks';
const ids = (arr: any[]) => arr.map((i) => i.id).sort();

describe('holosphere signing — federation read-list via @holons/core factory', () => {
  let sphere: any;
  let dir: string;
  let Apub: string;
  let Bsk: Uint8Array;
  let Bpub: string;

  async function writeAs(sk: Uint8Array, item: any) {
    const evt = buildEvent({ holon: HOLON, lens: LENS, item, sk });
    await new Promise<void>((r) => {
      let s = false; const d = () => { if (!s) { s = true; r(); } };
      setTimeout(d, 2000);
      sphere.gun.get(sphere.appname).get(HOLON).get('_events').get(LENS).get(item.id).get(evt.pubkey)
        .put(JSON.stringify(evt), () => d());
    });
    await sphere.put(HOLON, LENS, item, null, { _skipSign: true, autoPropagate: false });
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holons-sign-'));
    const Ask = generateSecretKey();
    Apub = getPublicKey(Ask);
    Bsk = generateSecretKey();
    Bpub = getPublicKey(Bsk);

    sphere = createHoloSphere({
      appName: 'holons-sign-test',
      privateKey: Ask,
      extra: {
        gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false },
      },
    });

    await sphere.enableSigning({ relays: [], enforce: true });               // federation read-list (default)
    await sphere.put(HOLON, LENS, { id: 't1', title: 'mine' });              // signed by my key
    await sphere.put(HOLON, LENS, { id: 't-forged', title: 'unsigned' }, null, { _skipSign: true });
    await writeAs(Bsk, { id: 't2', title: 'from B' });                       // a key I do not trust yet
    await new Promise((r) => setTimeout(r, 1500));
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch { /* ignore */ }
    try { await sphere?.close?.(); } catch { /* ignore */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('reads only my own signed writes by default', async () => {
    expect(ids(await sphere.getAll(HOLON, LENS))).toEqual(['t1']);
  });

  it('unsigned + untrusted writes are pending, but retained in the raw store', async () => {
    expect(ids(await sphere.getPending(HOLON, LENS))).toEqual(['t-forged', 't2']);
    expect(ids(await sphere.getAll(HOLON, LENS, null, { _skipAuthorize: true }))).toEqual(['t-forged', 't1', 't2']);
  });

  it('adding a key to my read-list surfaces its signed writes; removing hides them', async () => {
    await sphere.addReadKey(Bpub);
    expect(ids(await sphere.getAll(HOLON, LENS))).toEqual(['t1', 't2']);
    await sphere.removeReadKey(Bpub);
    expect(ids(await sphere.getAll(HOLON, LENS))).toEqual(['t1']);
  });

  it('my own key is always in the read-list', () => {
    expect(sphere.getReadKeys()).toContain(Apub);
  });

  it('includeUnverified returns everything, tagged by provenance (migration/display)', async () => {
    const all: any[] = await sphere.getAll(HOLON, LENS, null, { includeUnverified: true });
    const byId = Object.fromEntries(all.map((i) => [i.id, i]));
    expect(ids(all)).toEqual(['t-forged', 't1', 't2']);     // nothing hidden
    expect(byId.t1._verified).toBe(true);                   // my signed write
    expect(byId['t-forged']._verified).toBe(false);         // unsigned write
    expect(byId['t-forged']._unverified).toBe(true);
  });
});
