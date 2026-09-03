import { describe, expect, it } from 'vitest';
import {
  BUNDLE_KEY,
  migrateLegacyBundleRecord,
  readBundleRecord,
  saveBundleRecord,
  readAllocationConfig,
  readZoneAssignments,
} from './index.js';

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const ADDR2 = '0xabcdef1234567890abcdef1234567890abcdef12';

/**
 * A settings lens that keys records the way `ContentOps.put` really does:
 * by `data.id`, generating a random key when it is missing. That generation is
 * the whole bug, so the fake has to reproduce it or the tests prove nothing.
 */
function fakeLens(initial: Record<string, any> = {}) {
  const store: Record<string, any> = { ...initial };
  let counter = 0;
  return {
    store,
    deletes: [] as string[],
    async get(_holon: string, _lens: string, key: string) {
      return store[key] ?? null;
    },
    async getAll() {
      return Object.values(store);
    },
    async put(_holon: string, _lens: string, data: any) {
      const key = data.id ?? `random-${++counter}`;
      if (!data.id) data.id = key;
      // The mock merges field-wise; the real store replaces the record, and core always writes full records.
      store[key] = { ...(store[key] ?? {}), ...data };
    },
    async delete(_holon: string, _lens: string, key: string) {
      delete store[key];
      this.deletes.push(key);
    },
  };
}

const canonicalDoc = {
  id: 'h1',
  name: 'Casa',
  hex: '8a2a1072b59ffff',
  valueEquation: { completed: 2 },
  currencies: ['eur'],
};

describe('the bug this fixes', () => {
  it('reproduces the fork: a put with no id mints a new record every call', async () => {
    const hs = fakeLens({ h1: { ...canonicalDoc } });

    // Exactly what FlowManagement used to do, twice.
    await hs.put('h1', 'settings', { bundle: { address: ADDR } });
    await hs.put('h1', 'settings', { federationZones: { p1: 2 } });

    // Three records where there should be one, and the canonical document
    // never learned about either write.
    expect(Object.keys(hs.store)).toHaveLength(3);
    expect(readBundleRecord(hs.store.h1)).toBeNull();
    expect(readZoneAssignments(hs.store.h1)).toEqual({});
  });
});

describe('saveBundleRecord', () => {
  it('lands on the canonical record instead of forking', async () => {
    const hs = fakeLens({ h1: { ...canonicalDoc } });
    await saveBundleRecord(hs as any, 'h1', { address: ADDR, nzones: 6 });

    expect(Object.keys(hs.store)).toEqual(['h1']);
    expect(readBundleRecord(hs.store.h1)?.address).toBe(ADDR);
  });

  it('preserves the rest of the settings document', async () => {
    const hs = fakeLens({ h1: { ...canonicalDoc } });
    await saveBundleRecord(hs as any, 'h1', { address: ADDR });

    expect(hs.store.h1.name).toBe('Casa');
    expect(hs.store.h1.hex).toBe('8a2a1072b59ffff');
    expect(hs.store.h1.valueEquation).toEqual({ completed: 2 });
    expect(hs.store.h1.currencies).toEqual(['eur']);
  });

  it('stamps the id even when nothing is stored yet', async () => {
    const hs = fakeLens();
    await saveBundleRecord(hs as any, 'h1', { address: ADDR });
    expect(hs.store.h1.id).toBe('h1');
  });

  it('still writes when the read fails', async () => {
    const hs = fakeLens();
    hs.get = async () => {
      throw new Error('relay down');
    };
    await saveBundleRecord(hs as any, 'h1', { address: ADDR });
    expect(readBundleRecord(hs.store.h1)?.address).toBe(ADDR);
  });
});

describe('readBundleRecord', () => {
  it('is null when unset', () => {
    expect(readBundleRecord(null)).toBeNull();
    expect(readBundleRecord({})).toBeNull();
  });

  it('rejects a record with no usable address', () => {
    // The old loader guarded on this inline; keeping it means a half-written
    // record cannot masquerade as a deployed bundle.
    expect(readBundleRecord({ [BUNDLE_KEY]: { address: 'nonsense' } })).toBeNull();
    expect(readBundleRecord({ [BUNDLE_KEY]: { address: '0x123' } })).toBeNull();
  });

  it('keeps steepness a string', () => {
    // WAD-scaled steepness exceeds Number's safe range; coercing it would
    // silently corrupt the value the contract round-trips.
    const bundle = readBundleRecord({
      [BUNDLE_KEY]: { address: ADDR, steepness: '500000000000000000' },
    });
    expect(bundle?.steepness).toBe('500000000000000000');
  });
});

describe('migrateLegacyBundleRecord', () => {
  it('does nothing when there are no orphans', async () => {
    const hs = fakeLens({ h1: { ...canonicalDoc } });
    const result = await migrateLegacyBundleRecord(hs as any, 'h1');
    expect(result.found).toBe(0);
    expect(result.movedBundle).toBe(false);
    expect(hs.deletes).toEqual([]);
  });

  it('folds an orphaned bundle onto the canonical record and deletes it', async () => {
    const hs = fakeLens({
      h1: { ...canonicalDoc },
      'random-1': { id: 'random-1', bundle: { address: ADDR, deployedAt: 100 } },
    });

    const result = await migrateLegacyBundleRecord(hs as any, 'h1');

    expect(result.movedBundle).toBe(true);
    expect(readBundleRecord(hs.store.h1)?.address).toBe(ADDR);
    expect(hs.store['random-1']).toBeUndefined();
    expect(result.deleted).toEqual(['random-1']);
    // And the document it merged onto is intact.
    expect(hs.store.h1.name).toBe('Casa');
  });

  it('picks the newest deploy when several orphans exist', async () => {
    const hs = fakeLens({
      h1: { ...canonicalDoc },
      a: { id: 'a', bundle: { address: ADDR, deployedAt: 100 } },
      b: { id: 'b', bundle: { address: ADDR2, deployedAt: 900 } },
    });

    await migrateLegacyBundleRecord(hs as any, 'h1');
    expect(readBundleRecord(hs.store.h1)?.address).toBe(ADDR2);
  });

  it('never overwrites a bundle the canonical record already has', async () => {
    const hs = fakeLens({
      h1: { ...canonicalDoc, bundle: { address: ADDR2, deployedAt: 5 } },
      a: { id: 'a', bundle: { address: ADDR, deployedAt: 999 } },
    });

    const result = await migrateLegacyBundleRecord(hs as any, 'h1');

    // Even though the orphan looks newer, the canonical value stands: it was
    // written by the fixed path and is authoritative.
    expect(readBundleRecord(hs.store.h1)?.address).toBe(ADDR2);
    expect(result.movedBundle).toBe(false);
    // The orphan is still cleared away.
    expect(hs.store.a).toBeUndefined();
  });

  it('folds orphaned zone assignments into the allocation record', async () => {
    const hs = fakeLens({
      h1: { ...canonicalDoc },
      z: { id: 'z', federationZones: { p1: 2, p2: 3 } },
    });

    const result = await migrateLegacyBundleRecord(hs as any, 'h1');

    expect(result.movedZones).toBe(true);
    expect(readZoneAssignments(hs.store.h1)).toEqual({ p1: 2, p2: 3 });
    // Folded into `allocation`, so the config alongside it stays coherent.
    expect(readAllocationConfig(hs.store.h1)).toBeTruthy();
  });

  it('takes one zone map whole rather than merging them', async () => {
    // Each sync wrote a COMPLETE snapshot. Merging would resurrect p2 at zone 3
    // after a later sync had dropped it — so exactly one map must win.
    const hs = fakeLens({
      h1: { ...canonicalDoc },
      a: { id: 'a', federationZones: { p1: 1, p2: 3, p3: 4 } },
      b: { id: 'b', federationZones: { p1: 2 } },
    });

    const result = await migrateLegacyBundleRecord(hs as any, 'h1');
    const zones = readZoneAssignments(hs.store.h1);

    expect(zones).toEqual({ p1: 1, p2: 3, p3: 4 });
    // Flagged, because with no timestamps that choice was a heuristic.
    expect(result.ambiguous).toBe(true);
  });

  it('does not claim ambiguity for a single zone map', async () => {
    const hs = fakeLens({
      h1: { ...canonicalDoc },
      a: { id: 'a', federationZones: { p1: 1 } },
    });
    const result = await migrateLegacyBundleRecord(hs as any, 'h1');
    expect(result.ambiguous).toBe(false);
  });

  it('leaves existing zone assignments alone', async () => {
    const hs = fakeLens({
      h1: { ...canonicalDoc, allocation: { interiorPercent: 60, zones: { p9: 1 } } },
      a: { id: 'a', federationZones: { p1: 4 } },
    });

    await migrateLegacyBundleRecord(hs as any, 'h1');
    expect(readZoneAssignments(hs.store.h1)).toEqual({ p9: 1 });
    expect(readAllocationConfig(hs.store.h1).interiorPercent).toBe(60);
  });

  it('handles bundle and zones arriving in separate orphans', async () => {
    const hs = fakeLens({
      h1: { ...canonicalDoc },
      a: { id: 'a', bundle: { address: ADDR, deployedAt: 1 } },
      b: { id: 'b', federationZones: { p1: 2 } },
    });

    const result = await migrateLegacyBundleRecord(hs as any, 'h1');

    expect(readBundleRecord(hs.store.h1)?.address).toBe(ADDR);
    expect(readZoneAssignments(hs.store.h1)).toEqual({ p1: 2 });
    expect(result.deleted.sort()).toEqual(['a', 'b']);
    expect(Object.keys(hs.store)).toEqual(['h1']);
  });

  it('is idempotent', async () => {
    const hs = fakeLens({
      h1: { ...canonicalDoc },
      a: { id: 'a', bundle: { address: ADDR, deployedAt: 1 } },
    });

    await migrateLegacyBundleRecord(hs as any, 'h1');
    const second = await migrateLegacyBundleRecord(hs as any, 'h1');

    expect(second.found).toBe(0);
    expect(readBundleRecord(hs.store.h1)?.address).toBe(ADDR);
  });

  it('ignores unrelated records on the settings lens', async () => {
    const hs = fakeLens({
      h1: { ...canonicalDoc },
      other: { id: 'other', somethingElse: true },
    });
    const result = await migrateLegacyBundleRecord(hs as any, 'h1');
    expect(result.found).toBe(0);
    expect(hs.store.other).toBeDefined();
  });

  it('survives a read failure and a delete failure', async () => {
    const broken = fakeLens();
    broken.getAll = async () => {
      throw new Error('relay down');
    };
    await expect(migrateLegacyBundleRecord(broken as any, 'h1')).resolves.toEqual(
      expect.objectContaining({ found: 0 }),
    );

    const undeletable = fakeLens({
      h1: { ...canonicalDoc },
      a: { id: 'a', bundle: { address: ADDR } },
    });
    undeletable.delete = async () => {
      throw new Error('nope');
    };
    const result = await migrateLegacyBundleRecord(undeletable as any, 'h1');
    // The fold still happened; only the litter remains.
    expect(readBundleRecord(undeletable.store.h1)?.address).toBe(ADDR);
    expect(result.deleted).toEqual([]);
  });

  it('refuses an empty holon id', async () => {
    const hs = fakeLens();
    expect((await migrateLegacyBundleRecord(hs as any, '  ')).found).toBe(0);
  });
});
