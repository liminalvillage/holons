/**
 * `backend: 'nostr'` — the whole system functioning on the Nostr relay.
 *
 * Two (or more) HoloSphere instances with NO Gun peers, connected only
 * through an in-process Nostr relay (spike/mini-relay.js): every write is a
 * signed event on the wire, every read/subscription live-syncs from the
 * relay into the local peerless Gun cache.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import WebSocket from 'ws';
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey, buildEvent } from '../nostr-events.js';

const APP = 'nostr-backend-test';
const HOLON = '89283082803ffff';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (a) => (a || []).map((i) => i.id).sort();

/** Poll `fn` until it returns truthy or the deadline passes. */
async function eventually(fn, { timeout = 8000, step = 200 } = {}) {
  const until = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last || Date.now() > until) return last;
    await wait(step);
  }
}

describe('nostr backend (relay is the wire)', () => {
  let relay;
  const dirs = [];
  const spheres = [];

  function nostrSphere({ appName = APP, privateKey = generateSecretKey(), relays } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-nostr-'));
    dirs.push(dir);
    const sphere = new HoloSphere({
      appName,
      privateKey,
      backend: 'nostr',
      nostr: { relays: relays || [relay.url], syncTimeoutMs: 3000 },
      gunOptions: {
        peers: [], axe: false, multicast: false, stats: false,
        radisk: true, file: path.join(dir, 'radata'), localStorage: false,
      },
    });
    spheres.push(sphere);
    return sphere;
  }

  beforeAll(async () => {
    relay = await startRelay();
  });

  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } }
    try { await relay.close(); } catch { /* closed */ }
    for (const d of dirs.splice(0)) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* tmp */ }
    }
    // nostr-tools' Node WebSocket leaves one dead-but-referenced socket even
    // after pool.close() (verified with a minimal SimplePool repro) — unref
    // stragglers so the jest worker can exit; everything real closed above.
    await wait(200);
    for (const h of (typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [])) {
      if (h?.constructor?.name === 'Socket' && typeof h.unref === 'function') h.unref();
    }
  });

  test('gun stays peerless — the relay is the only wire', async () => {
    const a = nostrSphere();
    await a.ready();
    expect(Object.keys(a.gun?._?.opt?.peers || {})).toHaveLength(0);
    expect(a._relayTransport).toBeTruthy();
    expect(a.signingEnabled).toBe(true);
  }, 15000);

  test('put on A → cold getAll on B (separate store, same relay)', async () => {
    const a = nostrSphere();
    const b = nostrSphere();
    await a.put(HOLON, 'tasks', { id: 't1', title: 'Repair the well' });
    const seen = await eventually(async () => {
      const items = await b.getAll(HOLON, 'tasks');
      return items.some((i) => i.id === 't1') ? items : null;
    });
    expect(seen).toBeTruthy();
    expect(seen.find((i) => i.id === 't1').title).toBe('Repair the well');
  }, 20000);

  test('live subscribe on B receives A’s put', async () => {
    const a = nostrSphere();
    const b = nostrSphere();
    const got = [];
    const sub = b.subscribe(HOLON, 'quests', (item) => { if (item && item.id) got.push(item); });
    await b.getAll(HOLON, 'quests'); // ensure the relay sync is warm
    await a.put(HOLON, 'quests', { id: 'q1', title: 'Cross the river' });
    const arrived = await eventually(() => got.find((i) => i.id === 'q1'));
    sub.unsubscribe();
    expect(arrived).toBeTruthy();
    expect(arrived.title).toBe('Cross the river');
  }, 20000);

  test('update wins over create (LWW across the wire)', async () => {
    const a = nostrSphere();
    const b = nostrSphere();
    await a.put(HOLON, 'tasks2', { id: 'u1', status: 'open' });
    await a.put(HOLON, 'tasks2', { id: 'u1', status: 'done' });
    const done = await eventually(async () => {
      const item = await b.get(HOLON, 'tasks2', 'u1');
      return item && item.status === 'done' ? item : null;
    });
    expect(done).toBeTruthy();
  }, 20000);

  test('delete on A tombstones the item on B', async () => {
    const a = nostrSphere();
    const b = nostrSphere();
    await a.put(HOLON, 'chores', { id: 'c1', title: 'Sweep' });
    await eventually(async () => (await b.getAll(HOLON, 'chores')).some((i) => i.id === 'c1'));
    await a.delete(HOLON, 'chores', 'c1');
    const gone = await eventually(async () => {
      const items = await b.getAll(HOLON, 'chores');
      return items.every((i) => i.id !== 'c1');
    });
    expect(gone).toBe(true);
  }, 25000);

  test('globals travel the wire too (sentinel holon tag)', async () => {
    const a = nostrSphere();
    const b = nostrSphere();
    await a.putGlobal('federation', { id: 'fed-1', partners: ['x'] });
    const seen = await eventually(async () => {
      const v = await b.getGlobal('federation', 'fed-1');
      return v && v.id === 'fed-1' ? v : null;
    });
    expect(seen).toBeTruthy();
    expect(seen.partners).toEqual(['x']);
  }, 20000);

  test('cold-start recovery: a brand-new instance sees existing data', async () => {
    const a = nostrSphere();
    await a.put(HOLON, 'library', { id: 'book-1', title: 'Walden' });
    await wait(500); // let the publish land on the relay
    const fresh = nostrSphere(); // empty radisk — everything must come from the relay
    const items = await eventually(async () => {
      const got = await fresh.getAll(HOLON, 'library');
      return got.some((i) => i.id === 'book-1') ? got : null;
    });
    expect(ids(items)).toContain('book-1');
  }, 20000);

  test('a forged event on the relay is not ingested', async () => {
    const b = nostrSphere();
    // Craft a valid event, then tamper the content — signature no longer
    // matches. Push it straight onto the relay, bypassing any client checks.
    const evt = buildEvent({
      holon: HOLON, lens: 'vault', item: { id: 'forged', amount: 1 },
      sk: generateSecretKey(), extraTags: [['n', APP]],
    });
    evt.content = JSON.stringify({ id: 'forged', amount: 999999 });
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(relay.url);
      ws.on('open', () => { ws.send(JSON.stringify(['EVENT', evt])); setTimeout(() => { ws.close(); resolve(); }, 200); });
      ws.on('error', reject);
    });
    await wait(300);
    const items = await b.getAll(HOLON, 'vault');
    await wait(1000); // give a bad ingest time to (not) land
    const after = await b.getAll(HOLON, 'vault');
    expect(items.every((i) => i.id !== 'forged')).toBe(true);
    expect(after.every((i) => i.id !== 'forged')).toBe(true);
  }, 20000);

  test('app namespaces are isolated on a shared relay', async () => {
    const a = nostrSphere();
    const other = nostrSphere({ appName: 'some-other-app' });
    await a.put(HOLON, 'notes', { id: 'n1', text: 'ours' });
    await eventually(async () => (await nostrSphere().getAll(HOLON, 'notes')).some((i) => i.id === 'n1'));
    const theirs = await other.getAll(HOLON, 'notes');
    expect(theirs.every((i) => i.id !== 'n1')).toBe(true);
  }, 25000);

  test('same-second create-then-update publishes strictly increasing created_at', async () => {
    const sphere = nostrSphere({ appName: APP + '-mono' });
    await sphere.put(HOLON, 'tasks', { id: 'mono', title: 'v1' });
    await sphere.put(HOLON, 'tasks', { id: 'mono', title: 'v2' });
    await sphere.put(HOLON, 'tasks', { id: 'mono', title: 'v3' });
    const evs = await eventually(() => {
      const e = relay.events().filter((x) => x.kind === 30078 && x.tags.some((t) => t[0] === 'd' && t[1] === `${HOLON}/tasks/mono`));
      return e.length ? e : null;
    });
    // mini-relay keeps only the newest per address; it must be v3 and its
    // timestamp must exceed the first publish (three puts in one second).
    const newest = evs[evs.length - 1];
    expect(JSON.parse(newest.content).title).toBe('v3');
    expect(newest.created_at).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + 1);
  }, 15000);
});
