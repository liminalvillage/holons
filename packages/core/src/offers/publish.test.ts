// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { HoloSphere } from 'holosphere';
import { getResolution } from 'h3-js';
import { cellAcrossKm, cellLabel, formatAcross, readCellMarket, scaleChain, scaleLadder } from './cell.js';
import { reserveOffer } from './lifecycle.js';
import { publishOfferNearby, refreshPublishedOffer, withdrawPublishedOffer } from './publish.js';
import { createOffer } from './transform.js';

const HEX = '891f1d48b4bffff'; // a real res-9 cell

function mockHolosphere(opts: { settingsHex?: string | null; federated?: string[]; cells?: Record<string, Record<string, unknown[]>> } = {}) {
  const put = vi.fn(async () => {});
  const del = vi.fn(async () => {});
  const propagate = vi.fn(async () => ({ success: opts.federated?.length ?? 0 }));
  const createHologram = vi.fn(async (holon: string, lens: string, item: any) => ({
    id: item.id,
    soul: `test-app/${holon}/${lens}/${item.id}`,
  }));
  const holosphere = {
    put,
    delete: del,
    propagate,
    createHologram,
    getNodeRef: vi.fn(() => ({ get: () => ({ get: () => ({ put: () => {} }) }) })),
    appname: 'test-app',
    getFederation: vi.fn(async () => ({ federated: opts.federated ?? [] })),
    get: vi.fn(async (_h: string, lens: string) => (lens === 'settings' ? { hex: opts.settingsHex ?? null } : null)),
    getAll: vi.fn(async (holon: string, lens: string) => opts.cells?.[holon]?.[lens] ?? []),
    isValidH3: (id: string) => /^8[0-9a-f]{14}$/.test(id),
  } as unknown as HoloSphere;
  return { holosphere, put, del, propagate, createHologram };
}

const offer = () =>
  createOffer({ holonId: 'h1', initiator: { id: 7 }, title: 'Flour', category: 'food', supply: { quantity: 5, unit: 'kg' }, id: 'o1', now: 0 });

describe('publishOfferNearby', () => {
  it('persists the canonical record on quests and stamps published', async () => {
    const m = mockHolosphere();
    const out = await publishOfferNearby(m.holosphere, 'h1', offer(), { toPartners: false, now: 1700 });
    expect(m.put).toHaveBeenCalledWith('h1', 'quests', expect.objectContaining({ id: 'o1', published: { at: 1700, toPartners: false } }));
    expect(out.errors).toEqual([]);
    expect(out.hexCell).toBeUndefined();
  });

  it('lights the offers lens at the hex cell with a cross-lens hologram into quests', async () => {
    const m = mockHolosphere({ settingsHex: HEX });
    const out = await publishOfferNearby(m.holosphere, 'h1', offer(), { toPartners: false, toHex: true, now: 1 });
    expect(out.offer.hex).toBe(HEX);
    expect(out.offer.published).toEqual({ at: 1, toPartners: false, toHex: HEX });
    // The {id, soul} pair written at the cell points at the canonical
    // quests record, on the offers lens, climbing the parents.
    expect(m.put).toHaveBeenCalledWith(
      HEX,
      'offers',
      { id: 'o1', soul: 'test-app/h1/quests/o1' },
      expect.objectContaining({
        autoPropagate: true,
        propagationOptions: expect.objectContaining({ useHolograms: true, propagateToParents: true }),
      }),
    );
    expect(out.hexCell?.usedHolograms).toBe(true);
  });

  it('skips the map with a message when there is no hex', async () => {
    const m = mockHolosphere({ settingsHex: null });
    const out = await publishOfferNearby(m.holosphere, 'h1', offer(), { toPartners: false, toHex: true });
    expect(out.errors.join(' ')).toMatch(/No hex address/);
    expect(out.offer.hex).toBeUndefined();
  });
});

describe('refresh / withdraw', () => {
  it('refresh re-puts and re-sends to partners only when it was published to them', async () => {
    const m = mockHolosphere({ federated: ['p1'] });
    const published = { ...offer(), published: { at: 1, toPartners: true } };
    await refreshPublishedOffer(m.holosphere, 'h1', published);
    expect(m.put).toHaveBeenCalledWith('h1', 'quests', published);
    expect(m.propagate).toHaveBeenCalled();
    m.propagate.mockClear();
    await refreshPublishedOffer(m.holosphere, 'h1', { ...offer(), published: { at: 1, toPartners: false } });
    expect(m.propagate).not.toHaveBeenCalled();
  });

  it('withdraw closes the record, retracts partner copies and unlights the cell', async () => {
    const m = mockHolosphere({ federated: ['p1'] });
    const published = { ...offer(), hex: HEX, published: { at: 1, toPartners: true, toHex: HEX } };
    const out = await withdrawPublishedOffer(m.holosphere, 'h1', published, { now: 5 });
    expect(out.ok).toBe(true);
    expect(out.offer.status).toBe('withdrawn');
    expect(m.del).toHaveBeenCalledWith('p1', 'quests', 'o1');
    expect(m.del).toHaveBeenCalledWith(HEX, 'offers', 'o1');
  });

  it('withdraw is refused, with no writes, while a reservation is live', async () => {
    const m = mockHolosphere();
    const held = reserveOffer(offer(), { needId: 'n', needHolonId: 'b', responseId: 'p', quantity: 2 }).offer;
    const out = await withdrawPublishedOffer(m.holosphere, 'h1', held);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('has_live_reservations');
    expect(m.put).not.toHaveBeenCalled();
  });
});

describe('readCellMarket', () => {
  it('reads both lenses, dedupes, filters closed, and lists the holons', async () => {
    const o = { ...offer(), _hologram: { isHologram: true, sourceHolon: 'h1', soul: 'test-app/h1/quests/o1' } };
    const closed = { ...offer(), id: 'o2', status: 'withdrawn', _hologram: { sourceHolon: 'h2', isHologram: true } };
    const n = { id: 'n1', type: 'need', status: 'requested', category: 'food', _federation: { origin: 'h3' } };
    const done = { id: 'n2', type: 'need', status: 'fulfilled', _federation: { origin: 'h4' } };
    const m = mockHolosphere({ cells: { [HEX]: { offers: [o, o, closed], needs: [n, done] } } });
    const market = await readCellMarket(m.holosphere, HEX);
    expect(market.offers.map((x) => x.id)).toEqual(['o1']);
    expect(market.needs.map((x) => x.id)).toEqual(['n1']);
    expect(market.holons).toEqual(['h1', 'h3']);
    const all = await readCellMarket(m.holosphere, HEX, { includeClosed: true });
    expect(all.offers).toHaveLength(2);
    expect(all.needs).toHaveLength(2);
  });

  it('a read error is an empty side, not a throw', async () => {
    const m = mockHolosphere();
    (m.holosphere as any).getAll = vi.fn(async () => { throw new Error('offline'); });
    const market = await readCellMarket(m.holosphere, HEX);
    expect(market).toEqual({ cell: HEX, offers: [], needs: [], holons: [] });
  });
});

describe('scaleLadder', () => {
  it('climbs the same rungs from any home resolution, nearest first', () => {
    const fromVillage = scaleLadder(HEX); // res 9
    expect(fromVillage).toHaveLength(5);
    expect(fromVillage.map((c) => getResolution(c))).toEqual([9, 8, 6, 4, 2]);
    const region = fromVillage[2]; // res 6
    expect(scaleLadder(region).map((c) => getResolution(c))).toEqual([6, 4, 2]);
    // A holon already on a rung does not repeat it.
    expect(scaleLadder(fromVillage[1]).map((c) => getResolution(c))).toEqual([8, 6, 4, 2]);
    expect(scaleLadder('nope')).toEqual([]);
  });

  it('labels a cell by its width', () => {
    expect(cellAcrossKm(HEX)).toBeGreaterThan(0.3);
    expect(cellAcrossKm(HEX)).toBeLessThan(0.5);
    expect(formatAcross(0.35)).toBe('≈ 350 m');
    expect(formatAcross(1.23)).toBe('≈ 1.2 km');
    expect(formatAcross(45.4)).toBe('≈ 45 km');
    expect(formatAcross(0)).toBe('');
  });
});

describe('scaleChain / cellLabel', () => {
  it('climbs the parents, nearest first, and stops at the top', () => {
    const chain = scaleChain(HEX, 3);
    expect(chain).toHaveLength(4);
    expect(chain[0]).toBe(HEX);
    expect(cellLabel(chain[1])).toMatch(/^res 8 · /);
    expect(scaleChain(HEX, 20)).toHaveLength(10);
    expect(scaleChain('nope', 3)).toEqual([]);
  });
});
