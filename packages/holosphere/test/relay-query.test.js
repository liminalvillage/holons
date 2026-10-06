/**
 * `queryNostr`: one bounded relay query through the REQ budget. Hundreds at
 * once never trip a relay's per-connection cap, nothing stays open, and an
 * instance without relays (or closed) answers [] instead of hanging.
 */
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey, getPublicKey, signEvent } from '../nostr-events.js';

const APP = 'relay-query-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeout = 12000, step = 50) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await pred()) return true; await wait(step); }
  return false;
}

describe('queryNostr', () => {
  let relay;
  const spheres = [];
  const make = (opts = {}) => {
    const s = new HoloSphere({
      appName: APP, privateKey: generateSecretKey(), relays: [relay.url],
      store: { adapter: 'memory' }, nostr: { syncTimeoutMs: 3000, freshnessMs: 0, grants: false }, ...opts,
    });
    spheres.push(s);
    return s;
  };

  beforeAll(async () => { relay = await startRelay({ maxSubsPerConnection: 20 }); });
  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* ignore */ } }
    try { await relay.close(); } catch { /* ignore */ }
    await wait(200);
  }, 30000);

  test('hundreds of concurrent queries stay under the cap and leave nothing open', async () => {
    const people = Array.from({ length: 30 }, () => generateSecretKey());
    const reader = make();
    await reader.ready();
    // Kind-0 profiles by thirty keys, published straight to the relay.
    const { SimplePool } = await import('nostr-tools/pool');
    const pool = new SimplePool();
    for (const [i, sk] of people.entries()) {
      const ev = signEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ name: `person-${i}` }) }, sk);
      await Promise.allSettled(pool.publish([relay.url], ev));
    }
    expect(await waitFor(() => relay.count() >= 30)).toBe(true);
    const rejectedBefore = relay.rejected();
    const authors = people.map((sk) => getPublicKey(sk));
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => reader.queryNostr({ kinds: [0], authors: [authors[i % authors.length]] })));
    for (const [i, evs] of results.entries()) {
      expect(evs).toHaveLength(1);
      expect(JSON.parse(evs[0].content).name).toBe(`person-${i % authors.length}`);
    }
    const all = await reader.queryNostr({ kinds: [0], authors });
    expect(all).toHaveLength(30);
    expect(relay.rejected() - rejectedBefore).toBe(0);
    expect(relay.peakSubs()).toBeLessThanOrEqual(20);
    expect(reader._relayTransport.liveCount()).toBe(0);
    await waitFor(() => relay.openSubs() === 0);
    expect(relay.openSubs()).toBe(0);
    try { pool.close([relay.url]); } catch { /* ignore */ }
  }, 60000);

  test('answers [] without relays, with no filter, and once closed', async () => {
    const local = new HoloSphere({ appName: APP, privateKey: generateSecretKey(), store: { adapter: 'memory' } });
    spheres.push(local);
    expect(await local.queryNostr({ kinds: [0] })).toEqual([]);
    const wired = make();
    await wired.ready();
    expect(await wired.queryNostr(null)).toEqual([]);
    await wired.close();
    expect(await wired.queryNostr({ kinds: [0] })).toEqual([]);
  }, 20000);
});
