// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import type { HoloSphere } from 'holosphere';
import {
  HOME_HEX_DEFAULT_HOPS,
  mirrorItemToHomeHex,
  normalizeHops,
  readHomeHexLink,
  retractItemFromHomeHex,
  setHomeHexLink,
  unlinkHomeHex,
} from './home-hex.js';

const CELL = '8928308280fffff';

interface MockOptions {
  hex?: unknown;
  federated?: string[];
  lensConfig?: Record<string, unknown>;
}

function mockHolosphere(opts: MockOptions = {}) {
  const { hex = CELL, federated = [], lensConfig = {} } = opts;
  return {
    get: vi.fn(async () => ({ hex })),
    getFederation: vi.fn(async () => ({ federated, lensConfig, partnerNames: {} })),
    federateHolon: vi.fn(async () => true),
    unfederateHolon: vi.fn(async () => true),
    put: vi.fn(async () => ({ success: true })),
    createHologram: vi.fn(async (holon: string, lens: string, item: any) => ({
      id: item.id,
      soul: `app/${holon}/${lens}/${item.id}`,
    })),
    retractFromHexPartners: vi.fn(async () => [CELL]),
  } as unknown as HoloSphere;
}

describe('normalizeHops', () => {
  it('clamps into 0–15 and floors', () => {
    expect(normalizeHops(5)).toBe(5);
    expect(normalizeHops(0)).toBe(0);
    expect(normalizeHops(-3)).toBe(0);
    expect(normalizeHops(99)).toBe(15);
    expect(normalizeHops(4.7)).toBe(4);
  });

  it('reads unparseable values as no reach', () => {
    expect(normalizeHops(undefined)).toBe(0);
    expect(normalizeHops('not a number')).toBe(0);
    expect(normalizeHops(NaN)).toBe(0);
  });
});

describe('readHomeHexLink', () => {
  it('returns the link when the hex is a federation partner', async () => {
    const hs = mockHolosphere({
      federated: [CELL, 'peer'],
      lensConfig: { [CELL]: { inbound: ['announcements'], outbound: ['quests'], hops: 5 } },
    });
    expect(await readHomeHexLink(hs, 'h1')).toEqual({
      cell: CELL,
      inbound: ['announcements'],
      outbound: ['quests'],
      hops: 5,
    });
  });

  it('returns null when a hex is set but never linked', async () => {
    const hs = mockHolosphere({ federated: ['peer'] });
    expect(await readHomeHexLink(hs, 'h1')).toBeNull();
  });

  it('returns null when no hex address is set', async () => {
    const hs = mockHolosphere({ hex: '', federated: [CELL] });
    expect(await readHomeHexLink(hs, 'h1')).toBeNull();
  });

  it('returns null for the legacy CSS-color hex, even if somehow federated', async () => {
    const hs = mockHolosphere({ hex: '#3b82f6', federated: ['#3b82f6'] });
    expect(await readHomeHexLink(hs, 'h1')).toBeNull();
  });

  it('normalizes a missing or absurd reach', async () => {
    const hs = mockHolosphere({
      federated: [CELL],
      lensConfig: { [CELL]: { inbound: [], outbound: ['quests'] } },
    });
    expect((await readHomeHexLink(hs, 'h1'))?.hops).toBe(0);
  });
});

describe('setHomeHexLink', () => {
  it('federates the cell with the given lenses and reach', async () => {
    const hs = mockHolosphere();
    const link = await setHomeHexLink(hs, 'h1', {
      inbound: [],
      outbound: ['quests', 'offers'],
      hops: 3,
    });

    expect(link).toEqual({ cell: CELL, inbound: [], outbound: ['quests', 'offers'], hops: 3 });
    expect(hs.federateHolon).toHaveBeenCalledWith('h1', CELL, {
      lensConfig: { inbound: [], outbound: ['quests', 'offers'], hops: 3 },
      partnerName: 'Home hex',
    });
  });

  it('defaults the reach to five levels', async () => {
    const hs = mockHolosphere();
    const link = await setHomeHexLink(hs, 'h1', { inbound: [], outbound: ['quests'] });
    expect(link.hops).toBe(HOME_HEX_DEFAULT_HOPS);
    expect((hs.federateHolon as any).mock.calls[0][2].lensConfig.hops).toBe(5);
  });

  it('clamps an out-of-range reach', async () => {
    const hs = mockHolosphere();
    expect((await setHomeHexLink(hs, 'h1', { inbound: [], outbound: [], hops: 40 })).hops).toBe(15);
    expect((await setHomeHexLink(hs, 'h1', { inbound: [], outbound: [], hops: -1 })).hops).toBe(0);
  });

  it('refuses when no hex address is set, without touching holosphere', async () => {
    const hs = mockHolosphere({ hex: '' });
    await expect(setHomeHexLink(hs, 'h1', { inbound: [], outbound: ['quests'] })).rejects.toThrow(
      /no hex address set/
    );
    expect(hs.federateHolon).not.toHaveBeenCalled();
  });
});

describe('unlinkHomeHex', () => {
  it('removes the cell as a partner', async () => {
    const hs = mockHolosphere({ federated: [CELL] });
    expect(await unlinkHomeHex(hs, 'h1')).toBe(true);
    expect(hs.unfederateHolon).toHaveBeenCalledWith('h1', CELL);
  });

  it('is a no-op when no hex is set', async () => {
    const hs = mockHolosphere({ hex: '' });
    expect(await unlinkHomeHex(hs, 'h1')).toBe(false);
    expect(hs.unfederateHolon).not.toHaveBeenCalled();
  });
});

describe('mirrorItemToHomeHex', () => {
  const linked = () =>
    mockHolosphere({
      federated: [CELL],
      lensConfig: { [CELL]: { inbound: [], outbound: ['quests'], hops: 5 } },
    });

  it('publishes a hologram at the cell and upcasts to the configured reach', async () => {
    const hs = linked();
    const outcome = await mirrorItemToHomeHex(hs, 'h1', 'quests', { id: 'q1', title: 'Dig' });

    expect(outcome?.usedHolograms).toBe(true);
    expect(outcome?.destinations).toEqual([CELL]);

    const [target, lens, payload, putOpts] = (hs.put as any).mock.calls[0];
    expect(target).toBe(CELL);
    expect(lens).toBe('quests');
    expect(payload).toEqual({ id: 'q1', soul: `app/h1/quests/q1` });
    expect(putOpts).toEqual({
      autoPropagate: true,
      propagationOptions: {
        useHolograms: true,
        propagateToParents: true,
        maxParentLevels: 5,
      },
    });
  });

  it('skips a lens that is not configured outbound', async () => {
    const hs = linked();
    expect(await mirrorItemToHomeHex(hs, 'h1', 'expenses', { id: 'e1' })).toBeNull();
    expect(hs.put).not.toHaveBeenCalled();
  });

  it('skips when the hex is linked with no reach', async () => {
    const hs = mockHolosphere({
      federated: [CELL],
      lensConfig: { [CELL]: { inbound: [], outbound: ['quests'], hops: 0 } },
    });
    expect(await mirrorItemToHomeHex(hs, 'h1', 'quests', { id: 'q1' })).toBeNull();
    expect(hs.put).not.toHaveBeenCalled();
  });

  it('skips when there is no link at all', async () => {
    const hs = mockHolosphere({ federated: [] });
    expect(await mirrorItemToHomeHex(hs, 'h1', 'quests', { id: 'q1' })).toBeNull();
    expect(hs.put).not.toHaveBeenCalled();
  });

  it('accepts a pre-read link so a backfill needs one config read, not N', async () => {
    const hs = mockHolosphere({ federated: [] }); // deliberately unlinked
    const outcome = await mirrorItemToHomeHex(hs, 'h1', 'quests', { id: 'q1' }, {
      cell: CELL,
      inbound: [],
      outbound: ['quests'],
      hops: 2,
    });
    expect(outcome?.destinations).toEqual([CELL]);
    expect(hs.getFederation).not.toHaveBeenCalled();
  });
});

describe('retractItemFromHomeHex', () => {
  it('delegates to holosphere so the ancestors go too', async () => {
    const hs = mockHolosphere();
    expect(await retractItemFromHomeHex(hs, 'h1', 'quests', 'q1')).toEqual([CELL]);
    expect((hs as any).retractFromHexPartners).toHaveBeenCalledWith('h1', 'quests', 'q1');
  });
});
