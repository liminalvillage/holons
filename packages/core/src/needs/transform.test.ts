// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createNeed, needFromShoppingItem, normalizeNeed, stockRefOf } from './transform.js';
import type { ShoppingItem } from '../shopping/types.js';

const initiator = { id: 42, username: 'roberto' };
const item: ShoppingItem = {
  id: '1700000000000-abc123',
  text: '  flour 5kg  ',
  checked: false,
  createdBy: 42,
  category: 'Baking',
};

describe('needFromShoppingItem', () => {
  it('builds a requested need carrying text, category and creator', () => {
    const need = needFromShoppingItem(item, {
      holonId: 'h1',
      initiator,
      id: 'need-1',
      now: 1700000000000,
    });
    expect(need.type).toBe('need');
    expect(need.status).toBe('requested');
    expect(need.title).toBe('flour 5kg');
    expect(need.category).toBe('Baking');
    expect(need.initiator).toMatchObject({ id: 42 });
    expect(need.exchange_type).toBe('want');
    expect(need.item_type).toBe('good');
    expect(need.responses).toEqual([]);
    expect(need.created).toBe(new Date(1700000000000).toISOString());
  });

  it('back-links the originating shopping item', () => {
    const need = needFromShoppingItem(item, { holonId: 'h1', initiator, id: 'need-1' });
    expect(need.source).toEqual({ kind: 'shopping', itemId: '1700000000000-abc123' });
  });

  it('stamps the hex when provided and generates an id when not overridden', () => {
    const need = needFromShoppingItem(item, { holonId: 'h1', initiator, hex: '8928308280fffff' });
    expect(need.hex).toBe('8928308280fffff');
    expect(need.id).toMatch(/^need-/);
  });

  it('carries the requester’s own demand when given, in the stock unit by default', () => {
    const plain = needFromShoppingItem(item, { holonId: 'h1', initiator, demand: { quantity: 3, unit: 'kg' } });
    expect(plain.demand).toEqual({ quantity: 3, unit: 'kg' });
    const stocked = needFromShoppingItem(
      { ...item, stock: { itemId: 'flour', quantity: 5, unit: 'kg' } } as ShoppingItem,
      { holonId: 'h1', initiator, demand: { quantity: 2 } }
    );
    expect(stocked.demand).toEqual({ quantity: 2, unit: 'kg' });
    expect(needFromShoppingItem(item, { holonId: 'h1', initiator }).demand).toBeUndefined();
  });

  it('stringifies numeric legacy shopping-item ids in the back-link', () => {
    const need = needFromShoppingItem(
      { ...item, id: 1700000000123 },
      { holonId: 'h1', initiator, id: 'need-1' }
    );
    expect(need.source?.itemId).toBe('1700000000123');
  });
});

describe('createNeed', () => {
  it('builds a requested need with demand in the asked unit, no shopping back-link', () => {
    const need = createNeed({
      holonId: 'h1',
      initiator,
      title: '  learn guitar ',
      category: 'skills',
      demand: { quantity: 5, unit: 'hour' },
      id: 'need-1',
      now: 1700000000000,
    });
    expect(need.type).toBe('need');
    expect(need.status).toBe('requested');
    expect(need.title).toBe('learn guitar');
    expect(need.category).toBe('skills');
    expect(need.demand).toEqual({ quantity: 5, unit: 'hour' });
    expect(need.source).toBeUndefined();
    expect(need.responses).toEqual([]);
    expect(need.exchange_type).toBe('want');
    expect(need.created).toBe(new Date(1700000000000).toISOString());
  });

  it('infers a service from a time unit and a good otherwise; explicit itemType wins', () => {
    expect(createNeed({ holonId: 'h1', initiator, title: 'guitar lessons', demand: { unit: 'hour' } }).item_type).toBe('service');
    expect(createNeed({ holonId: 'h1', initiator, title: 'a ladder' }).item_type).toBe('good');
    expect(
      createNeed({ holonId: 'h1', initiator, title: 'babysitting', demand: { unit: 'one' }, itemType: 'service' }).item_type,
    ).toBe('service');
  });

  it('defaults demand to one unit and rejects an empty title', () => {
    const need = createNeed({ holonId: 'h1', initiator, title: 'a ride to town' });
    expect(need.demand).toEqual({ quantity: 1, unit: 'one' });
    expect(need.id).toMatch(/^need-/);
    expect(() => createNeed({ holonId: 'h1', initiator, title: '   ' })).toThrow();
  });

  it('stamps hex and urgency when given', () => {
    const need = createNeed({ holonId: 'h1', initiator, title: 'insulin', hex: '8928308280fffff', urgency: 'urgent' });
    expect(need.hex).toBe('8928308280fffff');
    expect(need.urgency).toBe('urgent');
  });
});

describe('normalizeNeed', () => {
  const base = { id: 'need-1', type: 'need', title: 'flour', status: 'offered', participants: [] };

  it('passes through a valid need and keeps its status', () => {
    const need = normalizeNeed({ ...base, responses: [{ id: 'r1', responder: { id: 7 } }] });
    expect(need?.status).toBe('offered');
    expect(need?.responses).toHaveLength(1);
  });

  it('rejects non-needs and deleted records', () => {
    expect(normalizeNeed(null)).toBeNull();
    expect(normalizeNeed({ ...base, type: 'offer' })).toBeNull();
    expect(normalizeNeed({ ...base, _deleted: true })).toBeNull();
  });

  it('falls back to requested on unknown status and drops malformed responses', () => {
    const need = normalizeNeed({ ...base, status: 'ongoing', responses: [null, { id: 'r1', responder: { id: 7 } }] });
    expect(need?.status).toBe('requested');
    expect(need?.responses).toHaveLength(1);
  });
});

describe('stock reference on a need', () => {
  it('carries the reorder row\'s stock reference onto the need', () => {
    const need = needFromShoppingItem(
      { ...item, stock: { itemId: 'flour', quantity: 5, unit: 'kg' } },
      { holonId: 'h1', initiator, id: 'need-stock' }
    );
    expect(need.stock).toEqual({ itemId: 'flour', quantity: 5, unit: 'kg' });
  });

  it('reads a plain checklist row\'s stockItemId as one unit of that item', () => {
    const need = needFromShoppingItem(
      { ...item, stockItemId: 'flour' } as ShoppingItem,
      { holonId: 'h1', initiator, id: 'need-row' }
    );
    expect(need.stock).toEqual({ itemId: 'flour', quantity: 1 });
  });

  it('leaves hand-written rows without a stock reference', () => {
    const need = needFromShoppingItem(item, { holonId: 'h1', initiator, id: 'need-plain' });
    expect(need.stock).toBeUndefined();
    expect(stockRefOf(item)).toBeUndefined();
  });
});
