/**
 * Signing integration: every write is a signed event on the wire, a fresh
 * instance rebuilds from the relay, and signed data moves between relays
 * verbatim — exercised through the real HoloSphere put path against an
 * embedded (Docker-free) relay.
 */
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey, verifyEvent, eventToItem, tag } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'tasks';
const APP = 'sign-test';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeout = 12000, step = 50) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await pred()) return true; await wait(step); }
  return false;
}

describe('signing integration', () => {
  let relayA, relayB, sphere;
  const spheres = [];
  const make = (opts) => { const s = new HoloSphere({ appName: APP, store: { adapter: 'memory' }, ...opts }); spheres.push(s); return s; };

  beforeAll(async () => {
    relayA = await startRelay();
    relayB = await startRelay();
  });

  afterAll(async () => {
    for (const s of spheres) { try { await s.close(); } catch { /* ignore */ } }
    await relayA?.close();
    await relayB?.close();
  }, 30000);

  test('put publishes a verifiable signed event to the relay', async () => {
    sphere = make({ privateKey: generateSecretKey(), relays: [relayA.url] });
    await sphere.ready();
    expect(sphere.signingEnabled).toBe(true);

    await sphere.put(HOLON, LENS, { id: 'task-1', title: 'Repair the well' });

    expect(await waitFor(() => relayA.count() >= 1)).toBe(true);

    const evt = relayA.events().find((e) => tag(e, 'd') === `${HOLON}/${LENS}/task-1`);
    expect(evt).toBeTruthy();
    expect(verifyEvent(evt)).toBe(true);
    expect(tag(evt, 'h')).toBe(HOLON);
    expect(tag(evt, 'l')).toBe(LENS);
    expect(tag(evt, 'n')).toBe(APP);
    expect(evt.pubkey).toBe(sphere.currentPubkey);
    expect(eventToItem(evt).title).toBe('Repair the well');
    // the store holds exactly the event the wire carries
    expect(sphere.store.getEvents(HOLON, LENS, 'task-1')[0].id).toBe(evt.id);
  });

  test('a local-only instance (no relays) never publishes', async () => {
    const plain = make({ privateKey: generateSecretKey() });
    await plain.put(HOLON, LENS, { id: 'task-unsigned', title: 'no relay' });
    await wait(400);
    expect(plain.nostrRelays()).toEqual([]);
    const leaked = relayA.events().find((e) => tag(e, 'd')?.endsWith('/task-unsigned'));
    expect(leaked).toBeUndefined();
  });

  test('a fresh instance on the same relay rebuilds the lens (cold sync) and records a cursor', async () => {
    const fresh = make({ privateKey: generateSecretKey(), relays: [relayA.url] });
    await fresh.ready();
    expect(fresh.store.listKeys(HOLON, LENS)).toEqual([]); // nothing local yet

    const after = await fresh.getAll(HOLON, LENS);
    expect(after.find((i) => i.id === 'task-1')?.title).toBe('Repair the well');
    expect(await waitFor(() => fresh._relayTransport.isSynced(HOLON, LENS))).toBe(true);
    expect(fresh.store.getCursor(HOLON, LENS)?.since).toBeGreaterThan(0);
  });

  test('exportEvents + importEvents({ publish }) moves signed data to a new relay verbatim', async () => {
    expect(relayB.count()).toBe(0);
    const events = sphere.exportEvents({ holon: HOLON, lens: LENS });
    expect(events.length).toBeGreaterThanOrEqual(1);

    const mover = make({ privateKey: generateSecretKey(), relays: [relayB.url] });
    await mover.ready();
    const res = await mover.importEvents(events, { publish: true });
    expect(res.applied).toBeGreaterThanOrEqual(1);
    expect(await waitFor(() => relayB.count() >= 1)).toBe(true);

    // same signed event id on the destination — republished verbatim, still valid
    const onA = relayA.events().find((e) => tag(e, 'd') === `${HOLON}/${LENS}/task-1`);
    const onB = relayB.events().find((e) => tag(e, 'd') === `${HOLON}/${LENS}/task-1`);
    expect(onB?.id).toBe(onA.id);
    expect(verifyEvent(onB)).toBe(true);
  });
});
