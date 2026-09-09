// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { HoloSphere } from 'holosphere';
import type { StockItemSpec, StockLevel } from '../inventory/types.js';
import { reserveOffer } from './lifecycle.js';
import { itemSurplus, keepBack, readAutoOfferSetting, surplusOffers, syncSurplusFromShelf, syncSurplusOffers } from './surplus.js';
import { remainingSupply, stockOfferId } from './transform.js';

const initiator = { id: 7, username: 'ada' };
const level = (itemId: string, onhand: number, reserved = 0): StockLevel => ({
  itemId, holonId: 'a', unit: 'kg', onhand, confirmed: onhand, pending: 0, reserved, incoming: 0, available: onhand - reserved, updatedAt: 0,
});
const flour: StockItemSpec = { id: 'flour', name: 'Flour', category: 'food', unit: 'kg', min: 2, target: 5 };
const nails: StockItemSpec = { id: 'nails', name: 'Nails', category: 'workshop', unit: 'one' };
const input = (levels: StockLevel[], offers: unknown[] = [], specs = [flour, nails]) => ({ holonId: 'a', levels, specs, offers, initiator, now: 100 });

describe('keepBack / itemSurplus', () => {
  it('keeps the larger of min and target; surplus nets reservations', () => {
    expect(keepBack(flour)).toBe(5);
    expect(keepBack(nails)).toBe(0);
    expect(itemSurplus(level('flour', 12, 3), flour)).toBe(4);
    expect(itemSurplus(level('flour', 4), flour)).toBe(0);
  });
});

describe('surplusOffers', () => {
  it('creates one auto offer per item with surplus, nothing for the rest', () => {
    const plan = surplusOffers(input([level('flour', 12), level('nails', 0)]));
    expect(plan.create.map((o) => o.id)).toEqual([stockOfferId('flour')]);
    expect(plan.create[0]).toMatchObject({ category: 'food', mode: 'give', source: { kind: 'stock', itemId: 'flour' }, supply: { itemId: 'flour', quantity: 7, unit: 'kg' } });
    expect(plan.update).toEqual([]);
    expect(plan.withdraw).toEqual([]);
  });

  it('is idempotent: a second pass over its own output keeps everything', () => {
    const first = surplusOffers(input([level('flour', 12)]));
    const second = surplusOffers(input([level('flour', 12)], first.create));
    expect(second.create).toEqual([]);
    expect(second.update).toEqual([]);
    expect(second.withdraw).toEqual([]);
    expect(second.keep.map((o) => o.id)).toEqual([stockOfferId('flour')]);
  });

  it('follows the shelf: more stock grows the offer, less shrinks it, none withdraws it', () => {
    const current = surplusOffers(input([level('flour', 12)])).create[0];
    expect(surplusOffers(input([level('flour', 15)], [current])).update[0].supply.quantity).toBe(10);
    expect(surplusOffers(input([level('flour', 8)], [current])).update[0].supply.quantity).toBe(3);
    const gone = surplusOffers(input([level('flour', 5)], [current]));
    expect(gone.withdraw.map((o) => o.id)).toEqual([stockOfferId('flour')]);
    expect(gone.update).toEqual([]);
  });

  it('never withdraws a held offer; it shrinks to its promises and keeps them on top of new surplus', () => {
    const fresh = surplusOffers(input([level('flour', 12)])).create[0]; // 7 free
    const held = reserveOffer(fresh, { needId: 'n', needHolonId: 'b', responseId: 'p', quantity: 4, id: 'r' }).offer;
    // Shelf drops to 5: nothing spare, but 4 are promised.
    const shrunk = surplusOffers(input([level('flour', 5)], [held]));
    expect(shrunk.withdraw).toEqual([]);
    expect(shrunk.update[0].supply.quantity).toBe(4);
    expect(remainingSupply(shrunk.update[0])).toBe(0);
    // Shelf back to 12: 7 spare + 4 promised.
    const grown = surplusOffers(input([level('flour', 12)], [held]));
    expect(grown.update[0].supply.quantity).toBe(11);
    expect(remainingSupply(grown.update[0])).toBe(7);
  });

  it('re-creates after a withdrawal, withdraws orphans, and leaves hand-made offers alone', () => {
    const withdrawn = { ...surplusOffers(input([level('flour', 12)])).create[0], status: 'withdrawn' as const };
    expect(surplusOffers(input([level('flour', 12)], [withdrawn])).create).toHaveLength(1);
    const orphan = surplusOffers(input([level('nails', 30)], [], [nails])).create[0];
    const plan = surplusOffers(input([level('flour', 12)], [orphan], [flour]));
    expect(plan.withdraw.map((o) => o.id)).toEqual([stockOfferId('nails')]);
    const manual = { id: 'my-offer', type: 'offer', status: 'open', category: 'food', supply: { itemId: 'flour', quantity: 3, unit: 'kg' } };
    const p2 = surplusOffers(input([level('flour', 5)], [manual]));
    expect(p2.withdraw).toEqual([]);
    expect(p2.create).toEqual([]);
  });

  it('disabled plans withdrawals only', () => {
    const current = surplusOffers(input([level('flour', 12)])).create[0];
    const off = surplusOffers(input([level('flour', 12)], [current]), false);
    expect(off.create).toEqual([]);
    expect(off.withdraw.map((o) => o.id)).toEqual([stockOfferId('flour')]);
    expect(surplusOffers(input([level('flour', 12)]), false).create).toEqual([]);
  });
});

describe('syncSurplusOffers / readAutoOfferSetting', () => {
  function fake(settings: unknown = null) {
    const put = vi.fn(async () => {});
    const holosphere = {
      put,
      delete: vi.fn(async () => {}),
      propagate: vi.fn(async () => ({ success: 0 })),
      getFederation: vi.fn(async () => ({ federated: [] })),
      get: vi.fn(async (_h: string, lens: string) => (lens === 'settings' ? settings : null)),
      appname: 'test-app',
    } as unknown as HoloSphere;
    return { holosphere, put };
  }

  it('publishes creations to partners and the map, refreshes updates, withdraws the rest', async () => {
    const { holosphere, put } = fake({ hex: '891f1d48b4bffff' });
    const out = await syncSurplusOffers(holosphere, input([level('flour', 12)]), { now: 100 });
    expect(out.created.map((o) => o.id)).toEqual([stockOfferId('flour')]);
    expect(out.created[0].published).toMatchObject({ toPartners: true, toHex: '891f1d48b4bffff' });
    expect(put).toHaveBeenCalledWith('a', 'quests', expect.objectContaining({ id: stockOfferId('flour') }));
    put.mockClear();
    const again = await syncSurplusOffers(holosphere, input([level('flour', 12)], out.created));
    expect(again.created).toEqual([]);
    expect(put).not.toHaveBeenCalled();
    const less = await syncSurplusOffers(holosphere, input([level('flour', 5)], out.created));
    expect(less.withdrawn.map((o) => o.status)).toEqual(['withdrawn']);
  });

  it('the per-holon switch defaults on and reads settings.stock.autoOffer', async () => {
    expect(await readAutoOfferSetting(fake(null).holosphere, 'a')).toBe(true);
    expect(await readAutoOfferSetting(fake({ stock: { autoOffer: false } }).holosphere, 'a')).toBe(false);
    expect(await readAutoOfferSetting(fake({ stock: { autoOffer: true } }).holosphere, 'a')).toBe(true);
  });
});

describe('syncSurplusFromShelf', () => {
  it('reads specs, ledger and needs, nets local demand, honours the switch', async () => {
    const lenses: Record<string, unknown[]> = {
      stock: [{ type: 'stock-item', id: 'flour', name: 'Flour', category: 'food', unit: 'kg', min: 2, created: 'x' }],
      rea_events: [{ id: 'e', eventType: 'stock:produced', resource: { quantity: 12, unit: 'kg', resourceId: 'flour' }, context: { holonId: 'a' }, timestamp: 1 }],
      quests: [
        { id: 'n', type: 'need', status: 'requested', category: 'food', stock: { itemId: 'flour', quantity: 3 } },
        // A partner's need, copied in without its envelope: not our demand.
        { id: 'pn', type: 'need', status: 'requested', category: 'food', holonId: 'b', stock: { itemId: 'flour', quantity: 4 } },
      ],
    };
    const put = vi.fn(async () => {});
    const holosphere = {
      put,
      delete: vi.fn(async () => {}),
      propagate: vi.fn(async () => ({ success: 0 })),
      getFederation: vi.fn(async () => ({ federated: [] })),
      get: vi.fn(async (_h: string, lens: string) => (lens === 'settings' ? { hex: '891f1d48b4bffff' } : null)),
      getAll: vi.fn(async (_h: string, lens: string) => lenses[lens] ?? []),
      appname: 'test-app',
    } as unknown as HoloSphere;
    const out = await syncSurplusFromShelf(holosphere, 'a', { initiator, now: 5 });
    // 12 on hand − 3 reserved for the local need − 2 keep-back = 7
    expect(out.created[0].supply.quantity).toBe(7);
    expect(out.errors).toEqual([]);
    const off = await syncSurplusFromShelf(holosphere, 'a', { initiator, enabled: false });
    expect(off.created).toEqual([]);
  });

  it('never throws', async () => {
    const holosphere = { getAll: vi.fn(async () => { throw new Error('boom'); }), get: vi.fn(async () => null) } as unknown as HoloSphere;
    const out = await syncSurplusFromShelf(holosphere, 'a', { initiator });
    expect(out.created).toEqual([]);
  });
});
