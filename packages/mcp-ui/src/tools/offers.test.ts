// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The offer tools drive core end to end over a fake holosphere: list, share,
// match, accept, withdraw — and the surplus sync from a seeded shelf.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { registerOffersTools } from './offers.js';
import type { ToolDeps } from './index.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

function capture() {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _def: { inputSchema: Record<string, ZodTypeAny> }, handler: Handler) => {
      tools.set(name, handler);
    },
  };
  return { server: server as never, tools };
}

function fakeDeps(seed: Record<string, Record<string, Record<string, unknown>>> = {}) {
  const db: Record<string, Record<string, Record<string, unknown>>> = { ...seed };
  const hs = {
    appname: 'test',
    get: async (holon: string, lens: string, key?: string) => (key ? (db[`${holon}/${lens}`]?.[key] ?? null) : null),
    getAll: async (holon: string, lens: string) => Object.values(db[`${holon}/${lens}`] ?? {}),
    put: async (holon: string, lens: string, rec: { id?: string | number; soul?: string }) => {
      // A {id, soul} pointer resolves like a hologram would: the source record, stamped.
      const m = typeof rec.soul === 'string' ? rec.soul.match(/^test\/([^/]+)\/([^/]+)\/(.+)$/) : null;
      const value = m ? { ...(db[`${m[1]}/${m[2]}`]?.[m[3]] ?? {}), _hologram: { isHologram: true, sourceHolon: m[1], sourceKey: m[3], soul: rec.soul } } : rec;
      (db[`${holon}/${lens}`] ??= {})[String(rec.id)] = value;
      return true;
    },
    delete: async (holon: string, lens: string, key: string) => {
      delete db[`${holon}/${lens}`]?.[key];
    },
    propagate: async () => ({ success: 0 }),
    getFederation: async (holon: string) => ({ federated: holon === 'a' ? ['b'] : holon === 'b' ? ['a'] : [] }),
  };
  const deps: ToolDeps = { getHoloSphere: async () => hs, resolveActor: () => ({ id: '7', username: 'ada', first_name: 'Ada' }) as never };
  return { deps, db };
}

const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);
const HEX = '891f1d48b4bffff';

describe('offer tools', () => {
  it('create → publish → withdraw, through core', async () => {
    const { server, tools } = capture();
    const { deps, db } = fakeDeps({ 'a/settings': { a: { id: 'a', hex: HEX } } });
    registerOffersTools(server, deps);
    const created = payload(await tools.get('offer_create')!({ holon: 'a', title: 'Flour', category: 'food', quantity: 8, unit: 'kg', id: 'o1' }));
    expect(created.offer).toMatchObject({ id: 'o1', type: 'offer', status: 'open', mode: 'give', supply: { quantity: 8, unit: 'kg' } });
    expect(db['a/quests'].o1).toBeTruthy();

    const shared = payload(await tools.get('offer_publish')!({ holon: 'a', offerId: 'o1', toHex: true, toPartners: false }));
    expect(shared.success).toBe(true);
    expect(shared.offer.hex).toBe(HEX);
    expect(db[`${HEX}/offers`]?.o1).toBeTruthy();

    const edited = payload(await tools.get('offer_edit')!({ holon: 'a', offerId: 'o1', quantity: 10, price: 2, mode: 'sell', currency: 'EUR' }));
    expect(edited.offer).toMatchObject({ supply: { quantity: 10 }, mode: 'sell', price: 2 });

    const gone = payload(await tools.get('offer_withdraw')!({ holon: 'a', offerId: 'o1' }));
    expect(gone.offer.status).toBe('withdrawn');
    expect(db[`${HEX}/offers`]?.o1).toBeUndefined();
  });

  it('match → accept: the partner’s need is answered from the offer and the units reserved', async () => {
    const { server, tools } = capture();
    const need = { id: 'n1', type: 'need', status: 'requested', title: 'flour', category: 'food', holon: 'b', initiator: { id: 9 }, stock: { itemId: 'flour', quantity: 5, unit: 'kg' }, responses: [] };
    const { deps, db } = fakeDeps({ 'b/quests': { n1: need }, 'a/quests': { n1: { ...need } } });
    registerOffersTools(server, deps);
    await tools.get('offer_create')!({ holon: 'a', title: 'Flour', category: 'food', quantity: 8, unit: 'kg', id: 'o1' });

    const match = payload(await tools.get('market_match')!({ holon: 'a' }));
    expect(match.legs).toEqual([{ offerId: 'o1', needId: 'n1', offerHolonId: 'a', needHolonId: 'b', category: 'food', quantity: 5, cost: 1 }]);
    expect(match.byCategory[0]).toMatchObject({ category: 'food', supply: 8, demand: 5, blocked: 0 });
    expect(match.needPrice.n1).toBe(1);

    const accepted = payload(await tools.get('offer_accept_match')!({ offerHolon: 'a', offerId: 'o1', needHolon: 'b', needId: 'n1', quantity: 5 }));
    expect(accepted.success).toBe(true);
    const stored = db['b/quests'].n1 as { status: string; responses: Array<{ offerId?: string }> };
    expect(stored.status).toBe('offered');
    expect(stored.responses[0].offerId).toBe('o1');
    const offer = db['a/quests'].o1 as { status: string; reservations: Array<{ quantity: number }> };
    expect(offer.status).toBe('reserved');
    expect(offer.reservations[0].quantity).toBe(5);

    // The standing reservation is now a committed leg, nothing left to propose.
    const again = payload(await tools.get('market_match')!({ holon: 'a' }));
    expect(again.committed).toHaveLength(1);
    expect(again.legs).toEqual([]);

    const refused = await tools.get('offer_withdraw')!({ holon: 'a', offerId: 'o1' });
    expect(refused.isError).toBe(true);
  });

  it('surplus sync lists the shelf’s spare stock and lists the cell', async () => {
    const { server, tools } = capture();
    const { deps, db } = fakeDeps({
      'a/settings': { a: { id: 'a', hex: HEX } },
      'a/stock': { flour: { type: 'stock-item', id: 'flour', name: 'Flour', category: 'food', unit: 'kg', min: 2, created: 'x' } },
      'a/rea_events': { e: { id: 'e', eventType: 'stock:produced', resource: { quantity: 12, unit: 'kg', resourceId: 'flour' }, context: { holonId: 'a' }, timestamp: 1 } },
    });
    registerOffersTools(server, deps);
    const out = payload(await tools.get('offer_sync_surplus')!({ holon: 'a' }));
    expect(out.created).toEqual([{ id: 'offer-stock-flour', supply: { itemId: 'flour', quantity: 10, unit: 'kg' } }]);
    const listed = payload(await tools.get('offers_list_at_hex')!({ cell: HEX }));
    expect(listed.count).toBe(1);
    expect(db['a/quests']['offer-stock-flour']).toBeTruthy();
    const off = payload(await tools.get('offer_sync_surplus')!({ holon: 'a', enabled: false }));
    expect(off.withdrawn).toEqual(['offer-stock-flour']);
  });
});
