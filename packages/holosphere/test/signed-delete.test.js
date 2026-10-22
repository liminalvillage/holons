/**
 * Signed delete: a delete is a signed tombstone. It removes the item from the
 * resolved view only when it comes from a trusted key, and (per-actor) retracts
 * just that actor's own record. Resolution reads the signed envelope store, so a
 * raw-store deletion by a stranger can't hide your signed data.
 */
import HoloSphere from '../holosphere.js';
import { generateSecretKey, getPublicKey, buildEvent } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (a) => a.map((i) => i.id).sort();
const owners = (a) => a.map((r) => r._owner).sort();

describe('signed delete', () => {
  let sphere, Bsk, Bpub;

  async function writeAs(sk, lens, item, at) {
    const evt = buildEvent({ holon: HOLON, lens, item, sk, created_at: at });
    sphere.store.apply(evt, { origin: 'remote' });
  }

  beforeAll(async () => {
    Bsk = generateSecretKey(); Bpub = getPublicKey(Bsk);
    sphere = new HoloSphere({ appName: 'del-test', privateKey: generateSecretKey(),
      store: { adapter: 'memory' } });
    await sphere.enableSigning({ relays: [], enforce: true, perActorLenses: ['participation'] });
    await sphere.addReadKey(Bpub);
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
  }, 15000);

  test('a singleton item disappears from the view after a signed delete', async () => {
    await sphere.put(HOLON, 'tasks', { id: 't1', title: 'Repair the well' });
    await wait(300);
    expect(ids(await sphere.getAll(HOLON, 'tasks'))).toEqual(['t1']);
    expect((await sphere.get(HOLON, 'tasks', 't1'))?.id).toBe('t1');

    await wait(1100);                       // ensure the tombstone is newer (1s clock)
    await sphere.delete(HOLON, 'tasks', 't1');
    await wait(500);

    expect(ids(await sphere.getAll(HOLON, 'tasks'))).toEqual([]);
    expect(await sphere.get(HOLON, 'tasks', 't1')).toBeNull();
  });

  test('a stranger raw-deleting cannot hide a signed item', async () => {
    await sphere.put(HOLON, 'tasks', { id: 't2', title: 'Plant the orchard' });
    await wait(300);
    // simulate an attacker wiping the raw slot (open graph) — no signed tombstone
    sphere.store.putRaw(HOLON, 'tasks', 't2', { id: 't2', _deleted: true });
    await wait(300);
    // the signed envelope is intact, so the item still resolves
    expect(ids(await sphere.getAll(HOLON, 'tasks'))).toEqual(['t2']);
  });

  test('per-actor: delete retracts only the owner\'s own record', async () => {
    await sphere.put(HOLON, 'participation', { id: 'q1', user: 'me', status: 'in' }); // my record
    await writeAs(Bsk, 'participation', { id: 'q1', user: 'bob', status: 'in' }, 1700000000); // B's record
    await wait(400);
    expect(owners(await sphere.aggregate(HOLON, 'participation', 'q1'))).toEqual([sphere._signer.pubkey, Bpub].sort());

    await wait(1100);
    await sphere.delete(HOLON, 'participation', 'q1');  // I retract my own participation
    await wait(500);

    const recs = await sphere.aggregate(HOLON, 'participation', 'q1');
    expect(owners(recs)).toEqual([Bpub]);               // only B remains; B untouched
    expect(recs[0].user).toBe('bob');
  });
});
