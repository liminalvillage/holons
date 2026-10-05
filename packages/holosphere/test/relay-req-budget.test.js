/**
 * The REQ budget: reads pull and leave nothing open; subscribers own ONE
 * multiplexed live REQ; a cold start of hundreds of pairs never trips a
 * relay's per-connection cap (strfry: "too many concurrent REQs").
 */
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey, getPublicKey } from '../nostr-events.js';
import { mergeFilters } from '../relay-transport.js';

const APP = 'req-budget-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeout = 12000, step = 50) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await pred()) return true; await wait(step); }
  return false;
}

describe('relay REQ budget', () => {
  let relay;
  const spheres = [];
  const make = (opts = {}) => {
    const s = new HoloSphere({
      appName: APP, privateKey: generateSecretKey(), relays: [relay.url],
      store: { adapter: 'memory' }, nostr: { syncTimeoutMs: 3000, freshnessMs: 0, grants: false, ...(opts.nostr || {}) }, ...opts,
    });
    spheres.push(s);
    return s;
  };

  // strfry's default: 20 subscriptions per connection.
  beforeAll(async () => { relay = await startRelay({ maxSubsPerConnection: 20 }); });
  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* ignore */ } }
    try { await relay.close(); } catch { /* ignore */ }
    await wait(200);
    for (const h of (typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [])) {
      if (h?.constructor?.name === 'Socket' && typeof h.unref === 'function') h.unref();
    }
  }, 30000);

  test('reads of hundreds of pairs leave no subscription open and none are rejected', async () => {
    const writer = make();
    await writer.ready();
    const holons = Array.from({ length: 60 }, (_, i) => `hub-${i}`);
    for (const h of holons) {
      await writer.put(h, 'settings', { id: h, name: `Hub ${h}` });
      await writer.put(h, 'users', { id: `u-${h}`, first_name: 'Someone' });
    }
    expect(await waitFor(() => relay.count() >= 120)).toBe(true);

    const bot = make();
    await bot.ready();
    const rejectedBefore = relay.rejected();
    // A bot's startup: every hub's settings and users, all at once.
    const reads = await Promise.all(holons.flatMap((h) => [bot.get(h, 'settings', h), bot.getAll(h, 'users')]));
    for (let i = 0; i < holons.length; i++) {
      expect(reads[2 * i]?.name).toBe(`Hub ${holons[i]}`);
      expect(reads[2 * i + 1]).toHaveLength(1);
    }
    expect(relay.rejected() - rejectedBefore).toBe(0);
    expect(relay.peakSubs()).toBeLessThanOrEqual(20);
    expect(bot._relayTransport.syncCount()).toBeGreaterThanOrEqual(120);
    expect(bot._relayTransport.liveCount()).toBe(0);
    await waitFor(() => relay.openSubs() === 0);
    expect(relay.openSubs()).toBe(0);
  }, 60000);

  test('a later write is seen by the next read without any subscription', async () => {
    const writer = make();
    const reader = make();
    expect(await reader.get('pull-hub', 'settings', 'pull-hub')).toBeNull();
    await writer.put('pull-hub', 'settings', { id: 'pull-hub', name: 'First' });
    expect(await waitFor(async () => (await reader.get('pull-hub', 'settings', 'pull-hub'))?.name === 'First')).toBe(true);
    await wait(1100);
    await writer.put('pull-hub', 'settings', { id: 'pull-hub', name: 'Second' });
    expect(await waitFor(async () => (await reader.get('pull-hub', 'settings', 'pull-hub'))?.name === 'Second')).toBe(true);
    expect(reader._relayTransport.liveCount()).toBe(0);
  }, 30000);

  test('the grants listener is the one standing REQ of a plain reader', async () => {
    const reader = make({ nostr: { syncTimeoutMs: 3000, freshnessMs: 0, grants: true } });
    await reader.ready();
    await reader.getAll('grants-hub', 'quests');
    expect(await waitFor(() => reader._relayTransport.liveCount() === 1)).toBe(true);
    await reader.getAll('grants-hub', 'users');
    await reader.getAll('other-hub', 'users');
    await wait(200);
    expect(reader._relayTransport.liveCount()).toBe(1);
    expect(reader._relayTransport.watchCount()).toBe(0);
  }, 20000);

  test('a fresh pair is answered from the store: no second query inside the window', async () => {
    const reader = make({ nostr: { freshnessMs: 60000 } });
    await reader.ready();
    const before = relay.reqCount();
    await reader.getAll('fresh-hub', 'quests');
    const afterFirst = relay.reqCount();
    expect(afterFirst).toBeGreaterThan(before);
    await reader.getAll('fresh-hub', 'quests');
    await reader.get('fresh-hub', 'quests', 'nothing');
    expect(relay.reqCount()).toBe(afterFirst);
  }, 20000);

  test('subscribers share one live REQ; it closes with the last of them', async () => {
    const writer = make();
    const kiosk = make();
    await kiosk.ready();
    await wait(200);
    const base = relay.openSubs(); // other instances' standing REQs
    const seen = [];
    const subs = [
      kiosk.subscribe('hub-a', 'quests', (item) => { if (item) seen.push(item.id); }),
      kiosk.subscribe('hub-a', 'users', () => {}),
      kiosk.subscribe('hub-b', 'quests', () => {}),
      kiosk.subscribe('hub-b', 'settings', () => {}),
    ];
    expect(await waitFor(() => kiosk._relayTransport.liveCount() === 1)).toBe(true);
    expect(kiosk._relayTransport.watchCount()).toBe(4);
    // Settled: exactly one subscription stands on the relay for this client.
    await wait(300);
    expect(relay.openSubs()).toBe(base + 1);

    await writer.put('hub-a', 'quests', { id: 'q1', title: 'Live' });
    expect(await waitFor(() => seen.includes('q1'))).toBe(true);
    // A lens of a watched holon nobody subscribed to still lands in the cache.
    await writer.put('hub-a', 'checklists', { id: 'c1', title: 'Rode along' });
    expect(await waitFor(() => !!kiosk.store.get('hub-a', 'checklists', 'c1'))).toBe(true);

    subs[0].unsubscribe();
    subs[1].unsubscribe();
    await wait(200);
    expect(kiosk._relayTransport.liveCount()).toBe(1);   // hub-b still watched
    subs[2].unsubscribe();
    subs[3].unsubscribe();
    expect(await waitFor(() => kiosk._relayTransport.liveCount() === 0)).toBe(true);
    expect(await waitFor(() => relay.openSubs() === base)).toBe(true);
  }, 30000);

  test('a raw listener rides the same live REQ', async () => {
    const kiosk = make();
    await kiosk.ready();
    await wait(200);
    const base = relay.openSubs();
    const sub = kiosk.subscribe('hub-raw', 'quests', () => {});
    const got = [];
    const pk = getPublicKey(generateSecretKey());
    const stop = kiosk.subscribeNostr({ kinds: [1059], '#p': [pk] }, (e) => got.push(e.id));
    expect(await waitFor(() => kiosk._relayTransport.liveCount() === 1)).toBe(true);
    await wait(300);
    expect(relay.openSubs()).toBe(base + 1);
    stop();
    sub.unsubscribe();
    expect(await waitFor(() => relay.openSubs() === base)).toBe(true);
  }, 20000);

  test('a subscription taken before the wire is up holds its watch once it starts', async () => {
    const kiosk = make();
    const sub = kiosk.subscribe('early-hub', 'quests', () => {});   // before ready()
    expect(await waitFor(() => kiosk._relayTransport?.liveCount() === 1)).toBe(true);
    sub.unsubscribe();
    expect(await waitFor(() => kiosk._relayTransport.liveCount() === 0)).toBe(true);
  }, 20000);
});

describe('mergeFilters', () => {
  test('folds filters that differ in one list and keeps the rest apart', () => {
    const merged = mergeFilters([
      { kinds: [31923], '#t': ['group-a'], since: 10 },
      { kinds: [31923], '#t': ['group-b'], since: 5 },
      { kinds: [31923], authors: ['x'], since: 10 },
      { kinds: [31923], authors: ['y'], since: 10 },
      { kinds: [0], authors: ['x'], since: 10 },
    ]);
    expect(merged).toEqual([
      { kinds: [31923], '#t': ['group-a', 'group-b'], since: 5 },
      { kinds: [31923], authors: ['x', 'y'], since: 10 },
      { kinds: [0], authors: ['x'], since: 10 },
    ]);
  });

  test('a list never grows past the cap', () => {
    const merged = mergeFilters([
      { kinds: [1], '#h': ['a', 'b'] },
      { kinds: [1], '#h': ['c'] },
      { kinds: [1], '#h': ['d'] },
    ], 3);
    expect(merged).toEqual([
      { kinds: [1], '#h': ['a', 'b', 'c'] },
      { kinds: [1], '#h': ['d'] },
    ]);
  });
});
