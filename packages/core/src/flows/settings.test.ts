import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOCATION_CONFIG,
  readAllocationConfig,
  readCollectiveSlug,
  readZoneAssignments,
  readZonePeople,
  saveAllocationConfig,
  saveCollectiveSlug,
  toAllocationPartners,
} from './index.js';

/** A minimal settings-lens stand-in that records what was written. */
function fakeHolosphere(initial: any = null) {
  const writes: any[] = [];
  return {
    writes,
    get current() {
      return writes.length ? writes[writes.length - 1].data : initial;
    },
    async get() {
      return writes.length ? writes[writes.length - 1].data : initial;
    },
    async put(holon: string, lens: string, data: any) {
      writes.push({ holon, lens, data });
    },
  };
}

const existingDoc = {
  id: 'h1',
  name: 'Casa',
  hex: '8a2a1072b59ffff',
  valueEquation: { completed: 2 },
  currencies: ['eur'],
};

describe('readCollectiveSlug', () => {
  it('is empty when unset', () => {
    expect(readCollectiveSlug(null)).toBe('');
    expect(readCollectiveSlug({})).toBe('');
  });

  it('reads and normalizes what is stored', () => {
    expect(readCollectiveSlug({ openCollective: { slug: 'Our-Collective' } })).toBe(
      'our-collective',
    );
  });
});

describe('saveCollectiveSlug', () => {
  it('preserves the rest of the settings document', () => {
    const hs = fakeHolosphere(existingDoc);
    return saveCollectiveSlug(hs as any, 'h1', 'our-collective').then(() => {
      // A bare put would wipe these; the whole point of read-merge-write.
      expect(hs.current.name).toBe('Casa');
      expect(hs.current.hex).toBe('8a2a1072b59ffff');
      expect(hs.current.valueEquation).toEqual({ completed: 2 });
      expect(hs.current.openCollective).toEqual({ slug: 'our-collective' });
    });
  });

  it('stamps the id so the record does not fork', () => {
    const hs = fakeHolosphere(null);
    return saveCollectiveSlug(hs as any, 'h1', 'x').then(() => {
      expect(hs.current.id).toBe('h1');
      expect(hs.writes[0].lens).toBe('settings');
      expect(hs.writes[0].holon).toBe('h1');
    });
  });

  it('accepts a pasted URL and returns the stored slug', async () => {
    const hs = fakeHolosphere(null);
    const stored = await saveCollectiveSlug(
      hs as any,
      'h1',
      'https://opencollective.com/our-collective',
    );
    expect(stored).toBe('our-collective');
    expect(hs.current.openCollective.slug).toBe('our-collective');
  });

  it('still writes when the read fails', async () => {
    // A relay hiccup must not cost the caretaker their edit.
    const hs = {
      writes: [] as any[],
      async get() {
        throw new Error('relay down');
      },
      async put(holon: string, lens: string, data: any) {
        this.writes.push({ holon, lens, data });
      },
    };
    await saveCollectiveSlug(hs as any, 'h1', 'ours');
    expect(hs.writes[0].data.openCollective).toEqual({ slug: 'ours' });
  });

  it('clears the link when given nothing', async () => {
    const hs = fakeHolosphere({ openCollective: { slug: 'old' } });
    await saveCollectiveSlug(hs as any, 'h1', '');
    expect(readCollectiveSlug(hs.current)).toBe('');
  });
});

describe('readAllocationConfig', () => {
  it('defaults when nothing is stored', () => {
    expect(readAllocationConfig(null)).toEqual(DEFAULT_ALLOCATION_CONFIG);
  });

  it('reads a stored split', () => {
    expect(
      readAllocationConfig({ allocation: { interiorPercent: 70, steepness: 30, nzones: 4 } }),
    ).toEqual({ interiorPercent: 70, steepness: 30, nzones: 4 });
  });

  it('repairs nonsense rather than propagating it', () => {
    expect(
      readAllocationConfig({ allocation: { interiorPercent: 500, nzones: -2 } }).interiorPercent,
    ).toBe(100);
  });
});

describe('readZoneAssignments', () => {
  it('reads the canonical map', () => {
    expect(readZoneAssignments({ allocation: { zones: { p1: 2 } } })).toEqual({ p1: 2 });
  });

  it('falls back to the legacy top-level field', () => {
    // Flow Management has been writing `federationZones` at the top level.
    expect(readZoneAssignments({ federationZones: { p1: 3 } })).toEqual({ p1: 3 });
  });

  it('prefers the canonical map over the legacy one', () => {
    expect(
      readZoneAssignments({ allocation: { zones: { p1: 1 } }, federationZones: { p1: 9 } }),
    ).toEqual({ p1: 1 });
  });

  it('drops unassigned and unusable entries', () => {
    expect(readZoneAssignments({ allocation: { zones: { a: 0, b: 'x', c: 2 } } })).toEqual({
      c: 2,
    });
  });
});

describe('toAllocationPartners', () => {
  it('drops duplicate and empty partner ids', () => {
    const partners = toAllocationPartners(['p1', 'p1', '', 'p2'], {}, {});
    expect(partners.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('pairs partners with their zone and name', () => {
    const partners = toAllocationPartners(['p1', 'p2'], { p1: 'One' }, { p1: 2 });
    expect(partners).toEqual([
      { id: 'p1', name: 'One', zone: 2, kind: 'holon' },
      // Unnamed falls back to the id; unassigned lands at zone 0, which
      // `allocate` treats as outside every ring.
      { id: 'p2', name: 'p2', zone: 0, kind: 'holon' },
    ]);
  });

  it('seats placed people after the partners, named from the people map', () => {
    const partners = toAllocationPartners(
      ['p1'],
      { p1: 'One' },
      { p1: 1 },
      { u1: 2, u2: 0, p1: 3 },
      { u1: 'Ada' },
    );
    expect(partners).toEqual([
      { id: 'p1', name: 'One', zone: 1, kind: 'holon' },
      // u2 is unplaced and so absent; p1 keeps its partner seat, not a second one.
      { id: 'u1', name: 'Ada', zone: 2, kind: 'person' },
    ]);
  });
});

describe('readZonePeople', () => {
  it('reads placed people and drops the unplaced', () => {
    const doc = { allocation: { zones: { p1: 1 }, people: { u1: 2, u2: 0, u3: 'x' } } };
    expect(readZonePeople(doc)).toEqual({ u1: 2 });
    // People never leak into the partner map, nor the other way round.
    expect(readZoneAssignments(doc)).toEqual({ p1: 1 });
  });
});

describe('saveAllocationConfig', () => {
  it('merges into the existing document and keeps zones', async () => {
    const hs = fakeHolosphere({ ...existingDoc, allocation: { zones: { p1: 2 } } });
    await saveAllocationConfig(hs as any, 'h1', { interiorPercent: 70 });

    expect(hs.current.name).toBe('Casa');
    expect(hs.current.allocation.interiorPercent).toBe(70);
    // Untouched knobs keep their stored values, not the defaults.
    expect(hs.current.allocation.zones).toEqual({ p1: 2 });
  });

  it('replaces zones when given a new map', async () => {
    const hs = fakeHolosphere({ allocation: { zones: { p1: 2 } } });
    await saveAllocationConfig(hs as any, 'h1', {}, { p2: 1 });
    expect(hs.current.allocation.zones).toEqual({ p2: 1 });
  });

  it('keeps people placements through a partner-zone sync, and replaces them when given', async () => {
    const hs = fakeHolosphere({ allocation: { zones: { p1: 2 }, people: { u1: 1 } } });
    await saveAllocationConfig(hs as any, 'h1', {}, { p2: 1 });
    expect(hs.current.allocation.people).toEqual({ u1: 1 });
    await saveAllocationConfig(hs as any, 'h1', {}, undefined, { u2: 3, u1: 0 });
    expect(hs.current.allocation.people).toEqual({ u2: 3 });
    expect(hs.current.allocation.zones).toEqual({ p2: 1 });
  });

  it('carries unspecified knobs over from what was stored', async () => {
    const hs = fakeHolosphere({ allocation: { interiorPercent: 80, steepness: 20, nzones: 3 } });
    const saved = await saveAllocationConfig(hs as any, 'h1', { nzones: 5 });
    expect(saved).toEqual({ interiorPercent: 80, steepness: 20, nzones: 5 });
  });
});
