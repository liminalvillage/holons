// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { needFromShoppingItem, normalizeNeed } from './transform.js';
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

  it('stringifies numeric legacy shopping-item ids in the back-link', () => {
    const need = needFromShoppingItem(
      { ...item, id: 1700000000123 },
      { holonId: 'h1', initiator, id: 'need-1' }
    );
    expect(need.source?.itemId).toBe('1700000000123');
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
