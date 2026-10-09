/**
 * The outbox: a write made while no relay is reachable lands locally at once,
 * waits in the store, and reaches the relay once it is back — through a
 * resync (what the browser's `online` handler calls), through the retry
 * timer, and from a fresh instance that reopened the same store.
 */
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey } from '../nostr-events.js';
import { createMemoryAdapter } from '../store/index.js';

const APP = 'outbox-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeout = 15000, step = 50) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await pred()) return true; await wait(step); }
  return false;
}

describe('relay outbox', () => {
  const spheres = [];
  const relays = [];
  const make = (url, opts = {}) => {
    const s = new HoloSphere({
      appName: APP, privateKey: opts.privateKey || generateSecretKey(), relays: [url],
      store: { adapter: opts.adapter || 'memory' },
      nostr: { syncTimeoutMs: 1500, freshnessMs: 0, grants: false, projections: [], reverseSync: false },
    });
    spheres.push(s);
    return s;
  };

  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* ignore */ } }
    for (const r of relays.splice(0)) { try { await r.close(); } catch { /* ignore */ } }
    await wait(200);
    for (const h of (typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [])) {
      if (h?.constructor?.name === 'Socket' && typeof h.unref === 'function') h.unref();
    }
  }, 30000);

  test('a write with no relay reachable stays local, then travels on resync', async () => {
    // Learn a free port, then take the relay DOWN before the sphere writes.
    const probe = await startRelay();
    const { port, url } = probe;
    await probe.close();

    const sphere = make(url);
    await sphere.ready();
    await sphere.put('hub', 'quests', { id: 'q1', title: 'Offline tick' });
    // Local-first: the record is readable at once, before any relay is up.
    expect((await sphere.get('hub', 'quests', 'q1'))?.title).toBe('Offline tick');
    // ...and is remembered as unsent.
    expect(await waitFor(async () => (await sphere.getOutbox()).length === 1)).toBe(true);
    // Give the first publish attempt time to fail.
    await wait(1500);
    expect((await sphere.getOutbox()).length).toBe(1);

    // The relay comes back on the same port; the `online` path resends.
    const relay = await startRelay({ port });
    relays.push(relay);
    await sphere.resyncSubscriptions();
    expect(await waitFor(() => relay.count() >= 1)).toBe(true);
    expect(relay.events().some((e) => e.tags.some((t) => t[0] === 'd' && t[1].endsWith('q1')))).toBe(true);
    expect(await waitFor(async () => (await sphere.getOutbox()).length === 0)).toBe(true);

    // Another instance reads it from the relay: the write really travelled.
    const reader = make(relay.url);
    expect((await reader.get('hub', 'quests', 'q1'))?.title).toBe('Offline tick');
  }, 40000);

  test('an acknowledged write leaves the outbox', async () => {
    const relay = await startRelay();
    relays.push(relay);
    const sphere = make(relay.url);
    await sphere.put('hub2', 'quests', { id: 'q2', title: 'Online' });
    expect(await waitFor(() => relay.count() >= 1)).toBe(true);
    expect(await waitFor(async () => (await sphere.getOutbox()).length === 0)).toBe(true);
    expect(sphere._relayTransport.outboxCount()).toBe(0);
  }, 20000);

  test('the retry timer resends without anyone calling resync', async () => {
    const probe = await startRelay();
    const { port, url } = probe;
    await probe.close();

    const sphere = make(url);
    await sphere.put('hub3', 'quests', { id: 'q3', title: 'Timer' });
    expect(await waitFor(async () => (await sphere.getOutbox()).length === 1)).toBe(true);
    // Let the first attempt fail and arm the 5 s backoff.
    await wait(1500);
    const relay = await startRelay({ port });
    relays.push(relay);
    expect(await waitFor(() => relay.count() >= 1, 15000)).toBe(true);
    expect(await waitFor(async () => (await sphere.getOutbox()).length === 0)).toBe(true);
  }, 40000);

  test('an outbox left by a previous run is sent when the next instance starts', async () => {
    const probe = await startRelay();
    const { port, url } = probe;
    await probe.close();

    const adapter = createMemoryAdapter({ retain: true });
    const sk = generateSecretKey();
    const first = make(url, { adapter, privateKey: sk });
    await first.put('hub4', 'quests', { id: 'q4', title: 'Reload' });
    expect(await waitFor(async () => (await first.getOutbox()).length === 1)).toBe(true);
    await wait(1500);
    await first.close();

    const relay = await startRelay({ port });
    relays.push(relay);
    const second = make(url, { adapter, privateKey: sk });
    await second.ready();
    expect((await second.get('hub4', 'quests', 'q4'))?.title).toBe('Reload');
    expect(await waitFor(() => relay.count() >= 1)).toBe(true);
    expect(await waitFor(async () => (await second.getOutbox()).length === 0)).toBe(true);
  }, 40000);

  test('a burst of edits offline resends only the newest claim per record', async () => {
    const probe = await startRelay();
    const { port, url } = probe;
    await probe.close();

    const sphere = make(url);
    await sphere.put('hub5', 'quests', { id: 'q5', title: 'v1' });
    await sphere.put('hub5', 'quests', { id: 'q5', title: 'v2' });
    await sphere.put('hub5', 'quests', { id: 'q5', title: 'v3' });
    await sphere.put('hub5', 'quests', { id: 'other', title: 'o' });
    const pending = await sphere.getOutbox();
    expect(pending).toHaveLength(2);
    const relay = await startRelay({ port });
    relays.push(relay);
    await sphere.resyncSubscriptions();
    expect(await waitFor(() => relay.count() >= 2)).toBe(true);
    const reader = make(relay.url);
    expect((await reader.get('hub5', 'quests', 'q5'))?.title).toBe('v3');
  }, 40000);
});
