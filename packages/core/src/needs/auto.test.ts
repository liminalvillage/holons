// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { shoppingNeedId, shoppingNeeds, syncNeedsFromShopping } from './auto.js';
import type { ShoppingChecklist } from '../shopping/types.js';
import type { PublishedNeed } from './types.js';

const initiator = { id: 42, username: 'roberto' };
const H = 'h1';
const list = (items: ShoppingChecklist['items']): ShoppingChecklist => ({
  id: 'shopping',
  type: 'shopping',
  title: 'Shopping List',
  items,
  created: new Date(0).toISOString(),
});
const need = (id: string, itemId: string, extra: Partial<PublishedNeed> = {}): PublishedNeed =>
  ({ id, type: 'need', status: 'requested', title: itemId, holon: H, source: { kind: 'shopping', itemId, auto: true }, responses: [], participants: [], ...extra }) as PublishedNeed;

describe('shoppingNeeds', () => {
  it('raises one need per item still to buy, stamps the list, and leaves standing ones alone', () => {
    const plan = shoppingNeeds({
      holonId: H,
      initiator,
      list: list([
        { id: 'eggs', text: 'eggs', checked: false, category: 'food', quantity: 12 },
        { id: 'bread', text: 'bread', checked: false, needId: 'need-shop-bread' },
        { id: 'milk', text: 'milk', checked: true },
      ]),
      needs: [need('need-shop-bread', 'bread')],
      now: 1700000000000,
    });
    expect(plan.create.map((n) => n.id)).toEqual(['need-shop-eggs']);
    expect(plan.create[0]).toMatchObject({ status: 'requested', category: 'food', demand: { quantity: 12, unit: 'one' }, source: { kind: 'shopping', itemId: 'eggs', auto: true } });
    expect(plan.keep.map((n) => n.id)).toEqual(['need-shop-bread']);
    expect(plan.close).toEqual([]);
    expect(plan.list?.items.find((i) => i.id === 'eggs')?.needId).toBe('need-shop-eggs');
  });

  it('is idempotent: a list in step plans nothing', () => {
    const plan = shoppingNeeds({
      holonId: H,
      initiator,
      list: list([{ id: 'bread', text: 'bread', checked: false, needId: 'need-shop-bread' }]),
      needs: [need('need-shop-bread', 'bread')],
    });
    expect(plan.create).toEqual([]);
    expect(plan.close).toEqual([]);
    expect(plan.list).toBeNull();
  });

  it('checking an item off fulfils its need, switch or no switch; a claimed one too', () => {
    const input = {
      holonId: H,
      initiator,
      list: list([
        { id: 'bread', text: 'bread', checked: true, needId: 'need-shop-bread' },
        { id: 'oil', text: 'oil', checked: true, needId: 'n-oil' },
      ]),
      needs: [need('need-shop-bread', 'bread'), need('n-oil', 'oil', { status: 'claimed', source: { kind: 'shopping', itemId: 'oil' } })],
    };
    for (const enabled of [true, false]) {
      const plan = shoppingNeeds(input, enabled);
      expect(plan.close.map((c) => [c.need.id, c.outcome, c.need.status])).toEqual([
        ['need-shop-bread', 'fulfilled', 'fulfilled'],
        ['n-oil', 'fulfilled', 'fulfilled'],
      ]);
      expect(plan.create).toEqual([]);
    }
  });

  it('off: takes back only what it raised and nobody answered, and unstamps the row', () => {
    const plan = shoppingNeeds(
      {
        holonId: H,
        initiator,
        list: list([
          { id: 'eggs', text: 'eggs', checked: false, needId: 'need-shop-eggs' },
          { id: 'bread', text: 'bread', checked: false, needId: 'need-shop-bread' },
          { id: 'jam', text: 'jam', checked: false, needId: 'n-jam' },
          { id: 'new', text: 'new thing', checked: false },
        ]),
        needs: [
          need('need-shop-eggs', 'eggs'),
          need('need-shop-bread', 'bread', { status: 'offered', responses: [{ id: 'r1', responder: { id: 7 }, createdAt: 'x' }] }),
          need('n-jam', 'jam', { source: { kind: 'shopping', itemId: 'jam' } }), // published by hand, not auto
        ],
      },
      false,
    );
    expect(plan.close.map((c) => [c.need.id, c.outcome])).toEqual([['need-shop-eggs', 'cancelled']]);
    expect(plan.keep.map((n) => n.id).sort()).toEqual(['n-jam', 'need-shop-bread']);
    expect(plan.create).toEqual([]);
    const rows = Object.fromEntries(plan.list!.items.map((i) => [i.id, i.needId]));
    expect(rows).toEqual({ eggs: undefined, bread: 'need-shop-bread', jam: 'n-jam', new: undefined });
  });

  it('an item that left the list cancels its unanswered auto need; an answered one stands', () => {
    const plan = shoppingNeeds({
      holonId: H,
      initiator,
      list: list([]),
      needs: [
        need('need-shop-gone', 'gone'),
        need('need-shop-wanted', 'wanted', { status: 'offered', responses: [{ id: 'r1', responder: { id: 7 }, createdAt: 'x' }] }),
      ],
    });
    expect(plan.close.map((c) => [c.need.id, c.outcome])).toEqual([['need-shop-gone', 'cancelled']]);
  });

  it('a stale stamp (need closed) is replaced by a fresh need with a suffixed id', () => {
    const plan = shoppingNeeds({
      holonId: H,
      initiator,
      list: list([{ id: 'eggs', text: 'eggs', checked: false, needId: 'need-shop-eggs' }]),
      needs: [need('need-shop-eggs', 'eggs', { status: 'fulfilled' })],
    });
    expect(plan.create.map((n) => n.id)).toEqual(['need-shop-eggs-2']);
    expect(plan.list?.items[0].needId).toBe('need-shop-eggs-2');
    expect(shoppingNeedId('x', new Set(['need-shop-x', 'need-shop-x-2']))).toBe('need-shop-x-3');
  });
});

describe('syncNeedsFromShopping', () => {
  function fakeHs(seed: Record<string, Record<string, unknown>> = {}) {
    const db: Record<string, Record<string, unknown>> = { ...seed };
    const puts: string[] = [];
    const hs = {
      get: async (holon: string, lens: string, key: string) => (db[`${holon}/${lens}`] as Record<string, unknown> | undefined)?.[key] ?? null,
      getAll: async (holon: string, lens: string) => Object.values(db[`${holon}/${lens}`] ?? {}),
      put: async (holon: string, lens: string, rec: { id: string }) => {
        (db[`${holon}/${lens}`] ??= {})[rec.id] = rec;
        puts.push(`${holon}/${lens}/${rec.id}`);
        return true;
      },
      delete: async () => {},
      propagate: async () => ({ success: 0 }),
      getFederation: async () => ({ federated: [] }),
    };
    return { hs: hs as never, db, puts };
  }

  it('gives id-less rows (generic checklist writes) an id, raises for them, and persists the ids', async () => {
    const { hs, db } = fakeHs({
      'h1/checklists': { shopping: { id: 'shopping', type: 'shopping', title: 'Shopping List', created: 'x', items: [{ text: 'olive oil', checked: false }, { text: 'done', checked: true }] } },
    });
    const out = await syncNeedsFromShopping(hs, 'h1', { initiator, toHex: false });
    expect(out.created).toHaveLength(1);
    expect(out.created[0].title).toBe('olive oil');
    const items = (db['h1/checklists'] as Record<string, ShoppingChecklist>).shopping.items as { id?: string; needId?: string; text: string }[];
    expect(items.every((i) => typeof i.id === 'string' && i.id)).toBe(true);
    expect(items.find((i) => i.text === 'olive oil')?.needId).toBe(out.created[0].id);
    // Second run: ids stable, nothing new.
    const again = await syncNeedsFromShopping(hs, 'h1', { initiator, toHex: false });
    expect(again.created).toEqual([]);
    expect((db['h1/checklists'] as Record<string, ShoppingChecklist>).shopping.items.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it('uses the list handed in instead of re-reading it', async () => {
    const { hs, db } = fakeHs({ 'h1/checklists': { shopping: list([]) } });
    const out = await syncNeedsFromShopping(hs, 'h1', { initiator, toHex: false, list: list([{ id: 'oil', text: 'olive oil', checked: false }]) });
    expect(out.created.map((n) => n.id)).toEqual(['need-shop-oil']);
    expect((db['h1/checklists'] as Record<string, ShoppingChecklist>).shopping.items.map((i) => i.id)).toEqual(['oil']);
  });

  it('raises, stamps, honours the switch in settings, and a second run writes nothing', async () => {
    const { hs, db, puts } = fakeHs({
      'h1/checklists': { shopping: list([{ id: 'eggs', text: 'eggs', checked: false }]) },
    });
    const first = await syncNeedsFromShopping(hs, 'h1', { initiator, toHex: false });
    expect(first.created.map((n) => n.id)).toEqual(['need-shop-eggs']);
    expect((db['h1/quests'] as Record<string, PublishedNeed>)['need-shop-eggs'].status).toBe('requested');
    expect(((db['h1/checklists'] as Record<string, ShoppingChecklist>).shopping.items[0] as { needId?: string }).needId).toBe('need-shop-eggs');
    const n = puts.length;
    const second = await syncNeedsFromShopping(hs, 'h1', { initiator, toHex: false });
    expect(second.created).toEqual([]);
    expect(second.closed).toEqual([]);
    expect(puts.length).toBe(n);

    (db['h1/settings'] ??= {}).h1 = { id: 'h1', shopping: { autoNeed: false } };
    const off = await syncNeedsFromShopping(hs, 'h1', { initiator });
    expect(off.closed.map((c) => [c.need.id, c.outcome])).toEqual([['need-shop-eggs', 'cancelled']]);
    expect(((db['h1/checklists'] as Record<string, ShoppingChecklist>).shopping.items[0] as { needId?: string }).needId).toBeUndefined();
  });
});
