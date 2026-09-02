/**
 * Relay sync mechanics: cursors, paginated backfill, warm catch-up and
 * reopening after a relay restart — two instances that share nothing but an
 * in-process relay.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey } from '../nostr-events.js';

const APP = 'relay-sync-test';
const HOLON = 'sync-holon';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeout = 12000, step = 50) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await pred()) return true; await wait(step); }
  return false;
}

describe('relay sync: cursors, pagination, reconnect', () => {
  let relay;
  const spheres = [];
  const dirs = [];
  const make = (opts = {}) => {
    const s = new HoloSphere({
      appName: APP, privateKey: generateSecretKey(), relays: [relay.url],
      store: { adapter: 'memory' }, nostr: { syncTimeoutMs: 3000, pageSize: 7 }, ...opts,
    });
    spheres.push(s);
    return s;
  };

  beforeAll(async () => { relay = await startRelay(); });
  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* ignore */ } }
    try { await relay.close(); } catch { /* ignore */ }
    for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
    // nostr-tools' Node WebSocket can leave a dead-but-referenced socket after
    // pool.close(); unref stragglers so the jest worker can exit.
    await wait(200);
    for (const h of (typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [])) {
      if (h?.constructor?.name === 'Socket' && typeof h.unref === 'function') h.unref();
    }
  }, 30000);

  test('a cold store backfills a lens larger than one relay page', async () => {
    const writer = make();
    await writer.ready();
    for (let i = 0; i < 20; i++) await writer.put(HOLON, 'many', { id: `m${i}`, n: i });
    expect(await waitFor(() => relay.events().filter((e) => e.tags.some((t) => t[0] === 'l' && t[1] === 'many')).length >= 20)).toBe(true);

    const reader = make(); // pageSize 7 → three pages
    const items = await reader.getAll(HOLON, 'many');
    expect(items).toHaveLength(20);
    expect(await waitFor(() => reader._relayTransport.isSynced(HOLON, 'many'))).toBe(true);
    expect(reader.store.getCursor(HOLON, 'many')?.since).toBeGreaterThan(0);
  }, 30000);

  test('a warm store catches up from its cursor and keeps it moving on live events', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-sync-'));
    dirs.push(dir);
    const sk = generateSecretKey();
    const writer = make();

    const first = make({ privateKey: sk, store: { adapter: 'file', dir } });
    await writer.put(HOLON, 'warm', { id: 'w1' });
    expect(await waitFor(async () => (await first.getAll(HOLON, 'warm')).length === 1)).toBe(true);
    expect(await waitFor(() => first._relayTransport.isSynced(HOLON, 'warm'))).toBe(true);
    const c1 = first.store.getCursor(HOLON, 'warm').since;
    await first.close();

    // Written while the warm store was offline.
    await wait(1100);
    await writer.put(HOLON, 'warm', { id: 'w2' });
    await wait(300);

    const second = make({ privateKey: sk, store: { adapter: 'file', dir } });
    await second.ready();
    expect(second.store.listKeys(HOLON, 'warm')).toEqual(['w1']); // hydrated from disk
    expect(second.store.getCursor(HOLON, 'warm').since).toBe(c1);
    const items = await second.getAll(HOLON, 'warm');
    expect(items.map((i) => i.id).sort()).toEqual(['w1', 'w2']);
    expect(await waitFor(() => second.store.getCursor(HOLON, 'warm').since > c1)).toBe(true);

    // A live event moves the cursor again.
    await wait(1100);
    await writer.put(HOLON, 'warm', { id: 'w3' });
    expect(await waitFor(() => second.store.listKeys(HOLON, 'warm').length === 3)).toBe(true);
    const cursorAfterLive = second.store.getCursor(HOLON, 'warm').since;
    expect(cursorAfterLive).toBeGreaterThan(c1);
    await second.close();
  }, 40000);

  test('tombstones from another author win by time, not by arrival order', async () => {
    const a = make();
    const b = make();
    await a.put(HOLON, 'lww', { id: 'x', v: 1 });
    expect(await waitFor(async () => (await b.get(HOLON, 'lww', 'x'))?.v === 1)).toBe(true);
    await wait(1100);
    await b.delete(HOLON, 'lww', 'x');
    expect(await waitFor(async () => (await a.get(HOLON, 'lww', 'x')) === null)).toBe(true);
    // A's older signed claim is still tracked, B's tombstone is current.
    expect(a.store.getEvents(HOLON, 'lww', 'x')).toHaveLength(2);
    expect(a.store.get(HOLON, 'lww', 'x').item._deleted).toBe(true);
  }, 30000);

  test('a relay restart on the same port is survived: writes after it still arrive', async () => {
    const port = relay.port;
    const a = make();
    const b = make();
    await a.put(HOLON, 'restart', { id: 'r1' });
    expect(await waitFor(async () => (await b.getAll(HOLON, 'restart')).length === 1)).toBe(true);

    await relay.close();
    await wait(300);
    relay = await startRelay({ port });

    // Both sides reconnect (nostr-tools) or reopen (transport backoff).
    await wait(1100);
    await a.put(HOLON, 'restart', { id: 'r2' });
    expect(await waitFor(async () => (await b.getAll(HOLON, 'restart')).length === 2, 30000)).toBe(true);
  }, 60000);

  test('resync() re-fetches every synced lens from its cursor', async () => {
    const a = make();
    const b = make();
    await b.getAll(HOLON, 'resync'); // open the sync
    await a.put(HOLON, 'resync', { id: 'z1' });
    expect(await waitFor(async () => (await b.getAll(HOLON, 'resync')).length === 1)).toBe(true);
    await b.resyncSubscriptions();
    expect((await b.getAll(HOLON, 'resync')).map((i) => i.id)).toEqual(['z1']);
  }, 30000);
});
