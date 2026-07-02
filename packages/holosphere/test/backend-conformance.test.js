/**
 * Backend conformance test suite.
 *
 * Verifies that both GunBackend and AD4MBackend satisfy the StorageBackend
 * interface contract.  Each backend is tested in isolation — the AD4M tests
 * are skipped when no AD4M test executor is available (CI-friendly).
 *
 * Run:  npm test -- backend-conformance
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

// ─── Shared conformance suite ────────────────────────────────────────────────

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

      const retrieved = await backend.get('holon-a', 'quests', 'conf-1');
      expect(retrieved).not.toBeNull();
      expect(JSON.parse(retrieved)).toEqual({ id: 'conf-1', title: 'Test Item' });
    });

    test('get on missing key returns null', async () => {
      const result = await backend.get('holon-a', 'quests', 'nonexistent-key');
      expect(result).toBeNull();
    });

    test('getAll returns all items in lens', async () => {
      await backend.put('holon-b', 'roles', 'r1', JSON.stringify({ id: 'r1', name: 'Admin' }));
      await backend.put('holon-b', 'roles', 'r2', JSON.stringify({ id: 'r2', name: 'Member' }));

      const all = await backend.getAll('holon-b', 'roles');
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

      const deleted = await backend.delete('holon-c', 'tasks', 'del-1');
      expect(deleted).toBe(true);

      const result = await backend.get('holon-c', 'tasks', 'del-1');
      expect(result).toBeNull();
    });

    test('global table (null holon) works', async () => {
      const payload = JSON.stringify({ id: 'g1', value: 'global data' });
      await backend.put(null, 'settings', 'g1', payload);

      const result = await backend.get(null, 'settings', 'g1');
      expect(result).not.toBeNull();
      expect(JSON.parse(result)).toEqual({ id: 'g1', value: 'global data' });
    });

    test('items in different holons are isolated', async () => {
      await backend.put('holon-x', 'data', 'k1', JSON.stringify({ id: 'k1', from: 'x' }));
      await backend.put('holon-y', 'data', 'k1', JSON.stringify({ id: 'k1', from: 'y' }));

      const fromX = JSON.parse(await backend.get('holon-x', 'data', 'k1'));
      const fromY = JSON.parse(await backend.get('holon-y', 'data', 'k1'));

      expect(fromX.from).toBe('x');
      expect(fromY.from).toBe('y');
    });

    test('items in different lenses are isolated', async () => {
      await backend.put('holon-z', 'alpha', 'k1', JSON.stringify({ id: 'k1', lens: 'alpha' }));
      await backend.put('holon-z', 'beta', 'k1', JSON.stringify({ id: 'k1', lens: 'beta' }));

      const fromAlpha = JSON.parse(await backend.get('holon-z', 'alpha', 'k1'));
      const fromBeta = JSON.parse(await backend.get('holon-z', 'beta', 'k1'));

      expect(fromAlpha.lens).toBe('alpha');
      expect(fromBeta.lens).toBe('beta');
    });

    test('subscribe fires on put', async () => {
      const received = [];
      const sub = backend.subscribe('holon-sub', 'events', (key, value) => {
        received.push({ key, value });
      });

      await backend.put('holon-sub', 'events', 'e1', JSON.stringify({ id: 'e1', title: 'Event 1' }));

      // Give the subscription time to fire
      await new Promise(r => setTimeout(r, 500));

      sub.unsubscribe();

      expect(received.length).toBeGreaterThanOrEqual(1);
      const match = received.find(r => r.key === 'e1');
      expect(match).toBeDefined();
    });

    test('subscribe fires null on delete', async () => {
      await backend.put('holon-del-sub', 'items', 'd1', JSON.stringify({ id: 'd1', val: 'x' }));
      await new Promise(r => setTimeout(r, 200));

      const received = [];
      const sub = backend.subscribe('holon-del-sub', 'items', (key, value) => {
        received.push({ key, value });
      }, { includeDeletes: true });

      await new Promise(r => setTimeout(r, 200));
      await backend.delete('holon-del-sub', 'items', 'd1');
      await new Promise(r => setTimeout(r, 500));

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

      const result = await backend.get('holon-cc', 'data', 'race');
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

      const result = JSON.parse(await backend.get('holon-ow', 'data', 'ow1'));
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

if (ad4mAvailable) {
  const AD4M_TEST_URL = process.env.AD4M_TEST_URL || 'ws://localhost:12000/graphql';
  const AD4M_TEST_TOKEN = process.env.AD4M_TEST_TOKEN;

  conformanceSuite('AD4MBackend', () => {
    const id = Math.random().toString(36).slice(2, 8);
    return new AD4MBackend(`conformance-test-${id}`, {
      url: AD4M_TEST_URL,
      token: AD4M_TEST_TOKEN,
    });
  });
} else {
  describe('AD4MBackend conformance (skipped)', () => {
    test.skip('requires @coasys/ad4m to be installed', () => {});
  });
}
