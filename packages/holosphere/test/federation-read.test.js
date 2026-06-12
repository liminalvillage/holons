/**
 * Default authorized read = your FEDERATION read-list.
 *
 * You sign everything with your key; reads collapse to the latest claim from a
 * key you trust (your own key + your federation list). Current-list semantics —
 * adding a key surfaces its writes, removing it hides them. The Nostr follow
 * model: truth is relative to whose keys you read.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey, getPublicKey, buildEvent } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'tasks';
const ids = (arr) => arr.map((i) => i.id).sort();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('authorized read — federation read-list (default)', () => {
  let sphere, dir, Bsk, Bpub;

  // any key writing into the open graph: signed envelope + raw item
  async function writeAs(sk, item) {
    const evt = buildEvent({ holon: HOLON, lens: LENS, item, sk });
    await new Promise((r) => {
      let s = false; const d = () => { if (!s) { s = true; r(); } };
      setTimeout(d, 2000);
      sphere.gun.get(sphere.appname).get(HOLON).get('_events').get(LENS).get(item.id).get(evt.pubkey)
        .put(JSON.stringify(evt), () => d());
    });
    await sphere.put(HOLON, LENS, item, null, { _skipSign: true, autoPropagate: false });
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-fed-'));
    Bsk = generateSecretKey();
    Bpub = getPublicKey(Bsk);
    sphere = new HoloSphere({
      appName: 'fed-test',
      privateKey: generateSecretKey(),
      gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false },
    });
    await sphere.enableSigning({ relays: [], enforce: true }); // federation mode (default)

    await sphere.put(HOLON, LENS, { id: 't1', title: 'mine' });                       // my key
    await sphere.put(HOLON, LENS, { id: 't-unsigned', title: 'forged' }, null, { _skipSign: true });
    await writeAs(Bsk, { id: 't2', title: 'from B' });                                // a key I do not (yet) trust
    await wait(1500);
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 15000);

  test('by default I read only my own signed writes', async () => {
    expect(ids(await sphere.getAll(HOLON, LENS))).toEqual(['t1']);
  });

  test('unsigned + untrusted writes are pending, not lost', async () => {
    expect(ids(await sphere.getPending(HOLON, LENS))).toEqual(['t-unsigned', 't2']);
    // raw store still holds everything (open graph)
    expect(ids(await sphere.getAll(HOLON, LENS, null, { _skipAuthorize: true }))).toEqual(['t-unsigned', 't1', 't2']);
  });

  test('get() resolves single items through signing too', async () => {
    expect((await sphere.get(HOLON, LENS, 't1'))?.id).toBe('t1');     // mine, authorized
    expect(await sphere.get(HOLON, LENS, 't-unsigned')).toBeNull();   // unsigned -> hidden
    expect(await sphere.get(HOLON, LENS, 't2')).toBeNull();           // untrusted -> hidden
    expect((await sphere.get(HOLON, LENS))?.id).toBe('t1');           // 2-arg form resolves too
  });

  test('adding B to my read-list surfaces B\'s signed writes', async () => {
    await sphere.addReadKey(Bpub);
    expect(ids(await sphere.getAll(HOLON, LENS))).toEqual(['t1', 't2']);
  });

  test('removing B hides them again (current-list semantics)', async () => {
    await sphere.removeReadKey(Bpub);
    expect(ids(await sphere.getAll(HOLON, LENS))).toEqual(['t1']);
  });

  test('getReadKeys includes my own key', () => {
    expect(sphere.getReadKeys()).toContain(sphere._signer.pubkey);
  });
});

describe('read-list IS the saved federation list', () => {
  let sphere, dir, ownPub, Bpub;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-fedsave-'));
    Bpub = getPublicKey(generateSecretKey());
    sphere = new HoloSphere({
      appName: 'fedsave-test',
      privateKey: generateSecretKey(),
      gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false },
    });
    await sphere.enableSigning({ relays: [], enforce: true });
    ownPub = sphere._signer.pubkey;
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 15000);

  test('addReadKey writes through to the saved federation list', async () => {
    await sphere.addReadKey(Bpub);
    const fed = await sphere.getFederation(ownPub);
    expect(fed.federated).toContain(Bpub);
  });

  test('the read-set rehydrates from the saved federation', async () => {
    sphere._allowedAuthors.clear();                 // wipe the in-memory cache
    expect(sphere.getReadKeys()).not.toContain(Bpub);
    await sphere.refreshReadKeys();                 // reload from saved federation
    expect(sphere.getReadKeys()).toContain(Bpub);
  });

  test('removeReadKey writes through too', async () => {
    await sphere.removeReadKey(Bpub);
    const fed = await sphere.getFederation(ownPub);
    expect(fed.federated || []).not.toContain(Bpub);
  });
});
