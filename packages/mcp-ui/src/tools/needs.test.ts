// SPDX-License-Identifier: AGPL-3.0-or-later
//
// need_create: the demand-first entry point, over a fake holosphere — and
// the proof that a direct need is demand the matcher counts in its own unit.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { registerNeedsTools } from './needs.js';
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
      const m = typeof rec.soul === 'string' ? rec.soul.match(/^test\/([^/]+)\/([^/]+)\/(.+)$/) : null;
      const value = m ? { ...(db[`${m[1]}/${m[2]}`]?.[m[3]] ?? {}), _hologram: { isHologram: true, sourceHolon: m[1], sourceKey: m[3], soul: rec.soul } } : rec;
      (db[`${holon}/${lens}`] ??= {})[String(rec.id)] = value;
      return true;
    },
    delete: async (holon: string, lens: string, key: string) => {
      delete db[`${holon}/${lens}`]?.[key];
    },
    propagate: async () => ({ success: 0 }),
    getFederation: async () => ({ federated: [] }),
  };
  const deps: ToolDeps = { getHoloSphere: async () => hs, resolveActor: () => ({ id: '7', username: 'ada', first_name: 'Ada' }) as never };
  return { deps, db };
}

const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);
const HEX = '891f1d48b4bffff';

describe('need_create', () => {
  it('asks for something nobody would put on a shopping list, kept on the holon', async () => {
    const { server, tools } = capture();
    const { deps, db } = fakeDeps();
    registerNeedsTools(server, deps);
    const out = payload(
      await tools.get('need_create')!({ holon: 'a', title: 'learn guitar', category: 'skills', quantity: 5, unit: 'hour', id: 'n1', toPartners: false }),
    );
    expect(out.success).toBe(true);
    expect(out.need).toMatchObject({ id: 'n1', type: 'need', status: 'requested', item_type: 'service', demand: { quantity: 5, unit: 'hour' } });
    expect(out.need.source).toBeUndefined();
    expect(out.need.published).toBeUndefined();
    expect(db['a/quests'].n1).toBeTruthy();
    expect(db[`${HEX}/needs`]).toBeUndefined();
  });

  it('lights the map when asked, and refuses an empty title', async () => {
    const { server, tools } = capture();
    const { deps, db } = fakeDeps({ 'a/settings': { a: { id: 'a', hex: HEX } } });
    registerNeedsTools(server, deps);
    const out = payload(await tools.get('need_create')!({ holon: 'a', title: 'a ladder', category: 'tools', id: 'n2', toHex: true }));
    expect(out.success).toBe(true);
    expect(out.need.hex).toBe(HEX);
    expect(out.publishedToHex.length).toBeGreaterThan(0);
    expect(db[`${HEX}/needs`]?.n2).toBeTruthy();

    const bad = await tools.get('need_create')!({ holon: 'a', title: '   ' });
    expect(bad.isError).toBe(true);
  });

  it('need_sync_shopping raises a need per open item and fulfils it once checked off', async () => {
    const { server, tools } = capture();
    const { deps, db } = fakeDeps({
      'a/checklists': { shopping: { id: 'shopping', type: 'shopping', title: 'Shopping List', created: 'x', items: [{ id: 'eggs', text: 'eggs', checked: false, category: 'food' }] } },
    });
    registerNeedsTools(server, deps);
    const first = payload(await tools.get('need_sync_shopping')!({ holon: 'a', toHex: false }));
    expect(first.created.map((n: { id: string }) => n.id)).toEqual(['need-shop-eggs']);
    expect((db['a/checklists'].shopping as { items: { needId?: string }[] }).items[0].needId).toBe('need-shop-eggs');

    (db['a/checklists'].shopping as { items: { checked: boolean }[] }).items[0].checked = true;
    const second = payload(await tools.get('need_sync_shopping')!({ holon: 'a', toHex: false }));
    expect(second.created).toEqual([]);
    expect(second.closed).toEqual([{ id: 'need-shop-eggs', outcome: 'fulfilled' }]);
    expect((db['a/quests']['need-shop-eggs'] as { status: string }).status).toBe('fulfilled');
  });

  it('is demand the matcher serves from an offer in the same category and unit', async () => {
    const { server, tools } = capture();
    const { deps } = fakeDeps();
    registerNeedsTools(server, deps);
    registerOffersTools(server, deps);
    await tools.get('need_create')!({ holon: 'a', title: 'learn guitar', category: 'skills', quantity: 3, unit: 'hour', id: 'n3', toPartners: false });
    await tools.get('offer_create')!({ holon: 'a', title: 'Guitar lessons', category: 'skills', quantity: 4, unit: 'hour', itemType: 'service', id: 'o3' });
    const plan = payload(await tools.get('market_match')!({ holon: 'a' }));
    expect(plan.needs).toEqual([{ needId: 'n3', holonId: 'a', category: 'skills', quantity: 3 }]);
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0]).toMatchObject({ offerId: 'o3', needId: 'n3', quantity: 3 });
    expect(plan.unmetNeeds).toEqual({});
  });
});
