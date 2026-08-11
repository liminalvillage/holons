// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  GROUP_BUY_TAG,
  buildGroupBuyQuest,
  clusterKeyOf,
  clusterNeedsByCategory,
  groupBuyId,
  isGroupBuy,
  upsertGroupBuys,
} from './groupbuy.js';
import type { PublishedNeed } from './types.js';
import type { HoloSphere } from 'holosphere';

const need = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  type: 'need',
  status: 'requested',
  title: `${id} title`,
  participants: [],
  responses: [],
  ...over,
});

describe('clustering', () => {
  it('derives the key from category, else the first title word', () => {
    expect(clusterKeyOf({ category: 'Bread & Grain' } as never)).toBe('bread-grain');
    expect(clusterKeyOf({ title: 'Flour 5kg' } as never)).toBe('flour');
  });

  it('clusters open needs by category with a minimum size', () => {
    const clusters = clusterNeedsByCategory(
      [
        need('a', { category: 'bread' }),
        need('b', { category: 'bread', status: 'offered' }),
        need('c', { category: 'bread', status: 'fulfilled' }), // closed — out
        need('d', { category: 'milk' }), // alone — below minSize
        need('e', { tags: [GROUP_BUY_TAG], category: 'bread' }), // never re-cluster
        null,
      ],
      { minSize: 2 }
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].key).toBe('bread');
    expect(clusters[0].members.map((m) => m.needId)).toEqual(['a', 'b']);
  });

  it('carries the member need owner from the hologram envelope', () => {
    const clusters = clusterNeedsByCategory([
      need('a', { category: 'bread', _hologram: { isHologram: true, sourceHolon: 'h9' } }),
      need('b', { category: 'bread' }),
    ]);
    expect(clusters[0].members[0].holonId).toBe('h9');
    expect(clusters[0].members[1].holonId).toBeUndefined();
  });
});

describe('buildGroupBuyQuest', () => {
  const cluster = {
    key: 'bread',
    label: 'bread',
    members: [
      { needId: 'a', title: 'sourdough ×2' },
      { needId: 'b', title: 'flour 5kg' },
    ],
  };

  it('builds the cell-initiated quest with membership and the tag', () => {
    const q = buildGroupBuyQuest('cell-1', cluster, { now: 1700000000000 });
    expect(q).toMatchObject({
      id: groupBuyId('cell-1', 'bread'),
      type: 'need',
      status: 'requested',
      title: 'Group buy: bread ×2',
      initiator: { id: 'cell-1' },
      tags: [GROUP_BUY_TAG],
    });
    expect((q as never as { members: unknown[] }).members).toHaveLength(2);
    expect(q.description).toContain('• sourdough ×2');
    expect(isGroupBuy(q)).toBe(true);
  });

  it('preserves lifecycle state when refreshing an existing group buy', () => {
    const existing = buildGroupBuyQuest('cell-1', cluster, { now: 1 });
    existing.status = 'offered';
    existing.participants = [{ id: 'u1' }] as never;
    existing.responses = [{ id: 'r1', responder: { id: 'p' }, createdAt: 'x' }];
    const grown = buildGroupBuyQuest(
      'cell-1',
      { ...cluster, members: [...cluster.members, { needId: 'c', title: 'rye loaf' }] },
      { existing, now: 2 }
    );
    expect(grown.status).toBe('offered');
    expect(grown.participants).toHaveLength(1);
    expect(grown.responses).toHaveLength(1);
    expect(grown.title).toBe('Group buy: bread ×3');
  });
});

describe('upsertGroupBuys', () => {
  function fakeCell(records: unknown[]) {
    const writes: Array<{ holon: string; lens: string; value: any }> = [];
    const canonical = new Map<string, unknown>();
    const db = {
      getAll: vi.fn(async () => records),
      get: vi.fn(async (_h: string, _l: string, key: string) => canonical.get(String(key)) ?? null),
      put: vi.fn(async (holon: string, lens: string, value: any) => {
        writes.push({ holon, lens, value });
        if (lens === 'quests') canonical.set(String(value.id), value);
      }),
    };
    const holosphere = { appname: 'test-app' } as unknown as HoloSphere;
    return { db, writes, canonical, holosphere };
  }

  it('writes the quest on the cell holon plus the cross-lens hologram', async () => {
    const { db, writes, holosphere } = fakeCell([
      need('a', { category: 'bread' }),
      need('b', { category: 'bread' }),
    ]);
    const out = await upsertGroupBuys(holosphere, 'cell-1', { db, now: 1 });
    expect(out.upserted).toEqual([groupBuyId('cell-1', 'bread')]);
    expect(out.errors).toEqual([]);
    const quest = writes.find((w) => w.lens === 'quests');
    expect(quest?.holon).toBe('cell-1');
    expect(quest?.value.title).toBe('Group buy: bread ×2');
    const pointer = writes.find((w) => w.lens === 'needs');
    expect(pointer?.value).toEqual({
      id: 'groupbuy-cell-1-bread',
      soul: 'test-app/cell-1/quests/groupbuy-cell-1-bread',
    });
  });

  it('is idempotent and keeps lifecycle state across re-aggregations', async () => {
    const { db, writes, canonical, holosphere } = fakeCell([
      need('a', { category: 'bread' }),
      need('b', { category: 'bread' }),
    ]);
    await upsertGroupBuys(holosphere, 'cell-1', { db, now: 1 });
    const first = canonical.get('groupbuy-cell-1-bread') as any;
    canonical.set('groupbuy-cell-1-bread', {
      ...first,
      status: 'offered',
      participants: [{ id: 'u1' }],
    });
    await upsertGroupBuys(holosphere, 'cell-1', { db, now: 2 });
    const quests = writes.filter((w) => w.lens === 'quests');
    expect(quests).toHaveLength(2);
    expect(quests[1].value.status).toBe('offered');
    expect(quests[1].value.participants).toHaveLength(1);
  });

  it('never resurrects a settled group buy', async () => {
    const { db, canonical, writes, holosphere } = fakeCell([
      need('a', { category: 'bread' }),
      need('b', { category: 'bread' }),
    ]);
    canonical.set('groupbuy-cell-1-bread', {
      ...buildGroupBuyQuest('cell-1', {
        key: 'bread',
        label: 'bread',
        members: [{ needId: 'a', title: 'x' }],
      }),
      status: 'fulfilled',
    });
    const out = await upsertGroupBuys(holosphere, 'cell-1', { db });
    expect(out.upserted).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('cancels an open group buy whose cluster dissolved', async () => {
    const gb = buildGroupBuyQuest(
      'cell-1',
      { key: 'bread', label: 'bread', members: [{ needId: 'a', title: 'x' }] },
      { now: 1 }
    );
    const { db, writes, holosphere } = fakeCell([
      { ...gb }, // the stale aggregate is still visible at the cell
      need('a', { category: 'bread', status: 'fulfilled' }), // its member closed
    ]);
    const out = await upsertGroupBuys(holosphere, 'cell-1', { db, now: 2 });
    expect(out.upserted).toEqual([]);
    expect(out.cancelled).toEqual(['groupbuy-cell-1-bread']);
    const cancelled = writes.find((w) => w.lens === 'quests');
    expect(cancelled?.value.status).toBe('cancelled');
  });
});
