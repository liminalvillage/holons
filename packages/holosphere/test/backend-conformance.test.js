/**
 * Backend conformance test suite.
 *
 * Verifies that both GunBackend and AD4MBackend satisfy the StorageBackend
 * interface contract.  GunBackend runs everywhere (in-memory, no peers). The
 * AD4M half is an integration test that needs a live executor, so it is opt-in:
 * it runs only when AD4M_TEST_URL is set, and is skipped otherwise so the suite
 * stays green in CI / executor-less environments.
 *
 * Run:            npm test -- backend-conformance
 * Run + AD4M:     AD4M_TEST_URL=ws://localhost:12100/graphql \
 *                 AD4M_TEST_TOKEN=<cap-jwt> npm test -- backend-conformance
 *   Point AD4M_TEST_URL at a *disposable* test executor — never a shared or
 *   production one — since the suite creates and deletes perspectives.
 */

import { jest } from '@jest/globals';
import { GunBackend } from '../backends/gun.js';

jest.setTimeout(15000);

// AD4M backend is loaded conditionally — the import itself will fail if
// @coasys/ad4m isn't installed, which is fine for Gun-only environments.
let AD4MBackend;
let ad4mAvailable = false;
try {
  ({ AD4MBackend } = await import('../backends/ad4m.js'));
  ad4mAvailable = true;
} catch {
  // @coasys/ad4m not installed — skip AD4M tests
}

// jest's `node` test environment exposes a `WebSocket` global, but its
// undici-backed implementation can't open a live connection from inside the
// VM-module sandbox — the handshake fails with an opaque ErrorEvent. Swap in
// the userland `ws` implementation for the AD4M integration run so the client
// can actually reach the executor. Real Node (22+) and browsers work off the
// native global unchanged; this only rewrites it for the test process, and the
// Gun path never touches the global WebSocket.
if (process.env.AD4M_TEST_URL) {
  const NodeWs = (await import('ws')).default;
  globalThis.WebSocket = NodeWs;
}

// ─── Shared conformance suite ────────────────────────────────────────────────

// Poll an async read until `ok(value)` holds (or attempts run out), then return
// the last value read. Lets one shared suite serve a synchronous backend (Gun,
// satisfied on the first read) and an eventually-consistent one (AD4M, whose
// executor propagates writes asynchronously) without baking a fixed sleep into
// every assertion.
async function readEventually(read, ok, { tries = 20, delay = 150 } = {}) {
  let value = await read();
  for (let i = 0; i < tries && !ok(value); i++) {
    await new Promise(r => setTimeout(r, delay));
    value = await read();
  }
  return value;
}

// Poll a predicate until it holds or attempts run out. Used for subscribe
// assertions, where the signal is a callback firing rather than a return value.
async function waitFor(pred, { tries = 20, delay = 150 } = {}) {
  for (let i = 0; i < tries && !pred(); i++) {
    await new Promise(r => setTimeout(r, delay));
  }
}

function conformanceSuite(name, createBackend) {
  describe(`StorageBackend conformance: ${name}`, () => {
    let backend;

    beforeAll(async () => {
      backend = createBackend();
      await backend.ready();
    });

    afterAll(async () => {
      await backend.close();
    });

    test('type discriminator is set', () => {
      expect(['gun', 'ad4m']).toContain(backend.type);
    });

    test('put then get returns same payload', async () => {
      const payload = JSON.stringify({ id: 'conf-1', title: 'Test Item' });
      const result = await backend.put('holon-a', 'quests', 'conf-1', payload);
      expect(result.ok).toBe(true);

      const retrieved = await readEventually(
        () => backend.get('holon-a', 'quests', 'conf-1'),
        v => v !== null,
      );
      expect(retrieved).not.toBeNull();
      // toMatchObject, not toEqual: a backend may carry additive provenance
      // (AD4M attaches author DID + createdAt/updatedAt). The contract is
      // "at least the fields written", not "exactly them".
      expect(JSON.parse(retrieved)).toMatchObject({ id: 'conf-1', title: 'Test Item' });
    });

    test('get on missing key returns null', async () => {
      const result = await backend.get('holon-a', 'quests', 'nonexistent-key');
      expect(result).toBeNull();
    });

    test('getAll returns all items in lens', async () => {
      await backend.put('holon-b', 'roles', 'r1', JSON.stringify({ id: 'r1', name: 'Admin' }));
      await backend.put('holon-b', 'roles', 'r2', JSON.stringify({ id: 'r2', name: 'Member' }));

      const all = await readEventually(
        () => backend.getAll('holon-b', 'roles'),
        m => m.has('r1') && m.has('r2') &&
             JSON.parse(m.get('r1')).name === 'Admin' &&
             JSON.parse(m.get('r2')).name === 'Member',
      );
      expect(all).toBeInstanceOf(Map);
      expect(all.size).toBeGreaterThanOrEqual(2);

      const r1 = JSON.parse(all.get('r1'));
      expect(r1.name).toBe('Admin');
      const r2 = JSON.parse(all.get('r2'));
      expect(r2.name).toBe('Member');
    });

    test('getAll on empty lens returns empty map', async () => {
      const result = await backend.getAll('holon-empty', 'nonexistent-lens');
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    test('delete removes item', async () => {
      const payload = JSON.stringify({ id: 'del-1', title: 'To Delete' });
      await backend.put('holon-c', 'tasks', 'del-1', payload);
      await readEventually(() => backend.get('holon-c', 'tasks', 'del-1'), v => v !== null);

      const deleted = await backend.delete('holon-c', 'tasks', 'del-1');
      expect(deleted).toBe(true);

      const result = await readEventually(
        () => backend.get('holon-c', 'tasks', 'del-1'),
        v => v === null,
      );
      expect(result).toBeNull();
    });

    test('global table (null holon) works', async () => {
      const payload = JSON.stringify({ id: 'g1', value: 'global data' });
      await backend.put(null, 'settings', 'g1', payload);

      const result = await readEventually(
        () => backend.get(null, 'settings', 'g1'),
        v => v !== null,
      );
      expect(result).not.toBeNull();
      expect(JSON.parse(result)).toMatchObject({ id: 'g1', value: 'global data' });
    });

    test('items in different holons are isolated', async () => {
      await backend.put('holon-x', 'data', 'k1', JSON.stringify({ id: 'k1', from: 'x' }));
      await backend.put('holon-y', 'data', 'k1', JSON.stringify({ id: 'k1', from: 'y' }));

      const fromX = JSON.parse(await readEventually(() => backend.get('holon-x', 'data', 'k1'), v => v !== null));
      const fromY = JSON.parse(await readEventually(() => backend.get('holon-y', 'data', 'k1'), v => v !== null));

      expect(fromX.from).toBe('x');
      expect(fromY.from).toBe('y');
    });

    test('items in different lenses are isolated', async () => {
      await backend.put('holon-z', 'alpha', 'k1', JSON.stringify({ id: 'k1', lens: 'alpha' }));
      await backend.put('holon-z', 'beta', 'k1', JSON.stringify({ id: 'k1', lens: 'beta' }));

      const fromAlpha = JSON.parse(await readEventually(() => backend.get('holon-z', 'alpha', 'k1'), v => v !== null));
      const fromBeta = JSON.parse(await readEventually(() => backend.get('holon-z', 'beta', 'k1'), v => v !== null));

      expect(fromAlpha.lens).toBe('alpha');
      expect(fromBeta.lens).toBe('beta');
    });

    test('subscribe fires on put', async () => {
      const received = [];
      const sub = backend.subscribe('holon-sub', 'events', (key, value) => {
        received.push({ key, value });
      });

      // Wait for the subscription to establish its baseline before writing, so
      // the put registers as a change against a live subscription rather than
      // racing its async setup. AD4M's subscribe sets up asynchronously and
      // exposes `ready()`; Gun's is synchronous and has no such field, so the
      // optional-chain is a no-op there. (Real consumers subscribe once up front
      // and write later — this models that ordering rather than a same-tick race.)
      await sub.ready?.();

      await backend.put('holon-sub', 'events', 'e1', JSON.stringify({ id: 'e1', title: 'Event 1' }));

      // Poll until the subscription fires rather than betting on a fixed sleep —
      // AD4M's change propagation is asynchronous and slower than Gun's.
      await waitFor(() => received.some(r => r.key === 'e1'));

      sub.unsubscribe();

      expect(received.length).toBeGreaterThanOrEqual(1);
      const match = received.find(r => r.key === 'e1');
      expect(match).toBeDefined();
    });

    test('subscribe fires null on delete', async () => {
      await backend.put('holon-del-sub', 'items', 'd1', JSON.stringify({ id: 'd1', val: 'x' }));
      await readEventually(() => backend.get('holon-del-sub', 'items', 'd1'), v => v !== null);

      const received = [];
      const sub = backend.subscribe('holon-del-sub', 'items', (key, value) => {
        received.push({ key, value });
      }, { includeDeletes: true });

      // Let the subscription establish its initial snapshot before deleting, so
      // the delete registers as a change rather than being absent from the start.
      await waitFor(() => received.some(r => r.key === 'd1' && r.value !== null));
      await backend.delete('holon-del-sub', 'items', 'd1');
      await waitFor(() => received.some(r => r.key === 'd1' && r.value === null));

      sub.unsubscribe();

      const deletion = received.find(r => r.key === 'd1' && r.value === null);
      expect(deletion).toBeDefined();
    });

    test('concurrent puts to same key converge', async () => {
      const promises = [
        backend.put('holon-cc', 'data', 'race', JSON.stringify({ id: 'race', v: 1 })),
        backend.put('holon-cc', 'data', 'race', JSON.stringify({ id: 'race', v: 2 })),
        backend.put('holon-cc', 'data', 'race', JSON.stringify({ id: 'race', v: 3 })),
      ];
      await Promise.all(promises);

      const result = await readEventually(
        () => backend.get('holon-cc', 'data', 'race'),
        v => v !== null,
      );
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result);
      expect(parsed.id).toBe('race');
      expect([1, 2, 3]).toContain(parsed.v);
    });

    test('getNodeRef returns a traversable reference', () => {
      const ref = backend.getNodeRef('TestApp/holon1/lens1/key1');
      expect(ref).toBeDefined();
      expect(typeof ref.get).toBe('function');
      expect(typeof ref.put).toBe('function');
      expect(typeof ref.once).toBe('function');
    });

    test('put with overwrite updates value', async () => {
      await backend.put('holon-ow', 'data', 'ow1', JSON.stringify({ id: 'ow1', v: 'first' }));
      await backend.put('holon-ow', 'data', 'ow1', JSON.stringify({ id: 'ow1', v: 'second' }));

      const result = JSON.parse(await readEventually(
        () => backend.get('holon-ow', 'data', 'ow1'),
        v => v !== null && JSON.parse(v).v === 'second',
      ));
      expect(result.v).toBe('second');
    });
  });
}

// ─── Run conformance for GunBackend ──────────────────────────────────────────

conformanceSuite('GunBackend', () => {
  const id = Math.random().toString(36).slice(2, 8);
  return new GunBackend(`conformance-test-${id}`, {
    file: false,
    radisk: false,
    peers: [],
  });
});

// ─── Run conformance for AD4MBackend (skipped if not available) ──────────────

// Opt-in: only run against an executor explicitly named by AD4M_TEST_URL. No
// default URL — a default risks silently connecting to (and polluting) whatever
// executor happens to be on that port.
const AD4M_TEST_URL = process.env.AD4M_TEST_URL;

if (ad4mAvailable && AD4M_TEST_URL) {
  conformanceSuite('AD4MBackend', () => {
    const id = Math.random().toString(36).slice(2, 8);
    // Run in opaque mode (`schemas: new Map()` → no dedicated subject classes,
    // every lens backed by the generic model). The shared suite asserts the
    // StorageBackend contract: an opaque key-value store partitioned by
    // (holon, lens, key), which is exactly what GunBackend provides. AD4M's
    // dedicated-schema mode is a *different*, richer contract — it persists
    // only a lens's declared properties and drops undeclared fields by design —
    // so pointing the opaque-KV suite at it would test the wrong contract.
    // Dedicated/semantic behaviour is covered by its own tests.
    return new AD4MBackend(`conformance-test-${id}`, {
      url: AD4M_TEST_URL,
      token: process.env.AD4M_TEST_TOKEN,
      schemas: new Map(),
    });
  });
} else {
  describe('AD4MBackend conformance (skipped)', () => {
    test.skip(
      ad4mAvailable
        ? 'set AD4M_TEST_URL to run against a live test executor'
        : 'requires @coasys/ad4m to be installed',
      () => {},
    );
  });
}
