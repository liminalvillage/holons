import { describe, expect, it } from 'vitest';
import { readHolonSettings } from './index.js';

/**
 * A settings lens holding several records, the way a real one does once a
 * calendar has been imported or an id-less writer has run.
 */
function fakeLens(records: Record<string, any>, opts: { keyedFails?: boolean } = {}) {
  return {
    async get(_holon: string, _lens: string, key: string) {
      if (opts.keyedFails) throw new Error('relay down');
      return records[key] ?? null;
    },
    async getAll() {
      return Object.values(records);
    },
  };
}

const settingsDoc = {
  id: 'h1',
  name: 'Casa',
  language: 'it',
  valueEquation: { completed: 2 },
  currencies: ['eur'],
};

const calendarsDoc = {
  id: 'imported_calendars',
  calendars: [{ url: 'https://example.com/c.ics' }],
  updated: '2026-01-01T00:00:00.000Z',
};

describe('readHolonSettings', () => {
  it('reads the canonical record by key', async () => {
    const hs = fakeLens({ h1: settingsDoc, imported_calendars: calendarsDoc });
    expect(await readHolonSettings(hs as any, 'h1')).toEqual(settingsDoc);
  });

  it('never returns the imported-calendars record', async () => {
    // The bug this replaces: `getAll(...)[0]` can hand back this record, and a
    // caller that spreads and re-saves it copies calendar data into settings
    // while dropping name, language and the value equation.
    const hs = fakeLens({ imported_calendars: calendarsDoc, h1: settingsDoc });
    const doc = await readHolonSettings(hs as any, 'h1');
    expect(doc.name).toBe('Casa');
    expect(doc.calendars).toBeUndefined();
  });

  it('is order-independent', async () => {
    // Record enumeration has no defined order, so the answer must not depend
    // on which record replicated first.
    const forward = fakeLens({ h1: settingsDoc, imported_calendars: calendarsDoc });
    const reverse = fakeLens({ imported_calendars: calendarsDoc, h1: settingsDoc });
    expect(await readHolonSettings(forward as any, 'h1')).toEqual(
      await readHolonSettings(reverse as any, 'h1'),
    );
  });

  it('recovers a name written by an id-less writer', async () => {
    // The SDG pages did `put(id, 'settings', { name })` with no id, so the name
    // lives in a randomly-keyed orphan and nothing sits under the canonical
    // key. A strict keyed read would blank those holons.
    const hs = fakeLens({ 'random-abc': { id: 'random-abc', name: 'SDG 13: Climate Action' } });
    const doc = await readHolonSettings(hs as any, 'sdg-13');
    expect(doc?.name).toBe('SDG 13: Climate Action');
  });

  it('prefers the canonical record over a name-only orphan', async () => {
    const hs = fakeLens({
      'random-abc': { id: 'random-abc', name: 'Stale' },
      h1: settingsDoc,
    });
    expect((await readHolonSettings(hs as any, 'h1')).name).toBe('Casa');
  });

  it('prefers the richest orphan when there is no canonical record', async () => {
    const hs = fakeLens({
      a: { id: 'a', name: 'Thin' },
      b: { id: 'b', name: 'Rich', language: 'en', timezone: 'UTC', currencies: ['eur'] },
    });
    expect((await readHolonSettings(hs as any, 'h1')).name).toBe('Rich');
  });

  it('returns null rather than a record carrying no settings at all', async () => {
    // A lone bundle or zone map is not a settings document; handing one back
    // would be worse than admitting there is nothing stored.
    const hs = fakeLens({
      a: { id: 'a', bundle: { address: '0xabc' } },
      b: { id: 'b', federationZones: { p1: 2 } },
      c: { id: 'c', calendars: [] },
    });
    expect(await readHolonSettings(hs as any, 'h1')).toBeNull();
  });

  it('falls back to the scan when the keyed read throws', async () => {
    const hs = fakeLens({ h1: settingsDoc }, { keyedFails: true });
    expect((await readHolonSettings(hs as any, 'h1')).name).toBe('Casa');
  });

  it('returns null for an empty lens or a blank id', async () => {
    expect(await readHolonSettings(fakeLens({}) as any, 'h1')).toBeNull();
    expect(await readHolonSettings(fakeLens({ h1: settingsDoc }) as any, '  ')).toBeNull();
  });

  it('survives a lens that cannot be listed', async () => {
    const broken = {
      async get() {
        return null;
      },
      async getAll() {
        throw new Error('relay down');
      },
    };
    expect(await readHolonSettings(broken as any, 'h1')).toBeNull();
  });
});
