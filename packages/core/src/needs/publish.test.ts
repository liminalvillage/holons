// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { publishNeedNearby, refreshPublishedNeed } from './publish.js';
import type { PublishedNeed } from './types.js';
import type { HoloSphere } from 'holosphere';

interface MockOpts {
  settingsHex?: string | null;
  federated?: string[];
}

function mockHolosphere(opts: MockOpts = {}) {
  const put = vi.fn(async () => {});
  const propagate = vi.fn(async () => ({ success: opts.federated?.length ?? 0 }));
  const createHologram = vi.fn(async (holon: string, lens: string, item: any) => ({
    id: item.id,
    soul: `test-app/${holon}/${lens}/${item.id}`,
  }));
  const getNodeRef = vi.fn(() => ({
    get: () => ({ get: () => ({ put: () => {} }) }),
  }));
  const holosphere = {
    put,
    propagate,
    createHologram,
    getNodeRef,
    appname: 'test-app',
    getFederation: vi.fn(async () => ({ federated: opts.federated ?? [] })),
    get: vi.fn(async (_h: string, lens: string) =>
      lens === 'settings' ? { hex: opts.settingsHex ?? null } : null
    ),
    isValidH3: (id: string) => /^8[0-9a-f]{14}$/.test(id),
  } as unknown as HoloSphere;
  return { holosphere, put, propagate, createHologram };
}

const need = (): PublishedNeed =>
  ({
    id: 'need-1',
    title: 'flour 5kg',
    type: 'need',
    status: 'requested',
    participants: [],
    responses: [],
  }) as PublishedNeed;

describe('publishNeedNearby', () => {
  it('persists the canonical record on the quests lens and stamps published', async () => {
    const m = mockHolosphere();
    const out = await publishNeedNearby(m.holosphere, 'h1', need(), {
      toPartners: false,
      now: 1700000000000,
    });
    expect(m.put).toHaveBeenCalledWith(
      'h1',
      'quests',
      expect.objectContaining({ id: 'need-1', published: { at: 1700000000000, toPartners: false } })
    );
    expect(out.errors).toEqual([]);
  });

  it('publishes standalone copies to partners (no holograms) via propagate', async () => {
    const m = mockHolosphere({ federated: ['p1', 'p2'] });
    const out = await publishNeedNearby(m.holosphere, 'h1', need(), { now: 1 });
    expect(m.propagate).toHaveBeenCalledWith(
      'h1',
      'quests',
      expect.objectContaining({ id: 'need-1' }),
      expect.objectContaining({ useHolograms: false })
    );
    expect(m.createHologram).not.toHaveBeenCalled();
    expect(out.partners?.usedHolograms).toBe(false);
  });

  it('hex leg writes a cross-lens hologram at the cell under the needs lens, upcast', async () => {
    const m = mockHolosphere({ settingsHex: '8928308280fffff' });
    const out = await publishNeedNearby(m.holosphere, 'h1', need(), {
      toPartners: false,
      toHex: true,
      now: 1,
    });
    // The {id, soul} pair written at the cell must point at the canonical
    // quests record, not at the (empty) needs lens of the source holon.
    expect(m.put).toHaveBeenCalledWith(
      '8928308280fffff',
      'needs',
      { id: 'need-1', soul: 'test-app/h1/quests/need-1' },
      expect.objectContaining({
        autoPropagate: true,
        propagationOptions: expect.objectContaining({ useHolograms: true, propagateToParents: true }),
      })
    );
    expect(out.need.hex).toBe('8928308280fffff');
    expect(out.need.published?.toHex).toBe('8928308280fffff');
    expect(out.hexCell?.usedHolograms).toBe(true);
  });

  it('bounds the upcast climb when upcastLevels is set (the ring dial)', async () => {
    const m = mockHolosphere({ settingsHex: '8928308280fffff' });
    await publishNeedNearby(m.holosphere, 'h1', need(), {
      toPartners: false,
      toHex: true,
      upcastLevels: 2,
    });
    expect(m.put).toHaveBeenCalledWith(
      '8928308280fffff',
      'needs',
      expect.any(Object),
      expect.objectContaining({
        propagationOptions: expect.objectContaining({ maxParentLevels: 2 }),
      })
    );
  });

  it('upcastLevels 0 keeps the need at the exact cell (no parent climb)', async () => {
    const m = mockHolosphere({ settingsHex: '8928308280fffff' });
    await publishNeedNearby(m.holosphere, 'h1', need(), {
      toPartners: false,
      toHex: true,
      upcastLevels: 0,
    });
    // Plain 3-arg put — no propagation options at all.
    expect(m.put).toHaveBeenCalledWith(
      '8928308280fffff',
      'needs',
      expect.objectContaining({ id: 'need-1' })
    );
  });

  it('skips the hex leg with an error (no throw) when settings.hex is missing or invalid', async () => {
    for (const settingsHex of [null, '#3b82f6']) {
      const m = mockHolosphere({ settingsHex });
      const out = await publishNeedNearby(m.holosphere, 'h1', need(), {
        toPartners: false,
        toHex: true,
      });
      expect(out.errors.join(' ')).toMatch(/hex address/i);
      expect(out.need.hex).toBeUndefined();
      expect(m.put).toHaveBeenCalledTimes(1); // canonical record only
    }
  });

  it('throws when the need has no id', async () => {
    const m = mockHolosphere();
    await expect(
      publishNeedNearby(m.holosphere, 'h1', { ...need(), id: undefined } as never)
    ).rejects.toThrow(/need\.id/);
  });
});

describe('refreshPublishedNeed', () => {
  it('re-publishes to partners only when the need was published to partners', async () => {
    const m = mockHolosphere({ federated: ['p1'] });
    const published = { ...need(), status: 'fulfilled' as const, published: { at: 1, toPartners: true } };
    await refreshPublishedNeed(m.holosphere, 'h1', published);
    expect(m.put).toHaveBeenCalledWith('h1', 'quests', expect.objectContaining({ status: 'fulfilled' }));
    expect(m.propagate).toHaveBeenCalledOnce();
  });

  it('only persists locally when the need was never partner-published', async () => {
    const m = mockHolosphere({ federated: ['p1'] });
    const local = { ...need(), published: { at: 1, toPartners: false, toHex: '8928308280fffff' } };
    await refreshPublishedNeed(m.holosphere, 'h1', local);
    expect(m.put).toHaveBeenCalledTimes(1);
    expect(m.propagate).not.toHaveBeenCalled();
  });
});
