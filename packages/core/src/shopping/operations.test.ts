import { describe, expect, it } from 'vitest';
import {
  addItem,
  addItems,
  clearChecked,
  createEmptyChecklist,
  createShoppingItem,
  isShoppingDoc,
  needIdOf,
  normalizeChecklist,
  stampNeedId,
  removeChecked,
  removeItem,
  toggleItem,
} from './operations.js';

describe('shopping operations', () => {
  it('createShoppingItem builds a defaulted item', () => {
    const item = createShoppingItem('  Milk  ', { createdBy: 42 });
    expect(item.text).toBe('Milk');
    expect(item.checked).toBe(false);
    expect(item.createdBy).toBe(42);
    expect(item.id).toBeTruthy();
  });

  it('addItem appends without mutating the input', () => {
    const empty = createEmptyChecklist(1000);
    const next = addItem(empty, 'Bread');
    expect(empty.items).toHaveLength(0);
    expect(next.items).toHaveLength(1);
    expect(next.items[0].text).toBe('Bread');
  });

  it('addItem creates a new checklist when given null', () => {
    const next = addItem(null, 'Eggs', { createdBy: 7 });
    expect(next.id).toBe('shopping');
    expect(next.items[0].createdBy).toBe(7);
  });

  it('addItems trims and skips blanks', () => {
    const next = addItems(null, ['  ', 'a', '', 'b']);
    expect(next.items.map((i) => i.text)).toEqual(['a', 'b']);
  });

  it('toggleItem flips checked, removeItem drops by id, removeChecked drops checked', () => {
    let list = addItems(null, ['a', 'b', 'c']);
    const ids = list.items.map((i) => i.id);
    list = toggleItem(list, ids[0])!;
    list = toggleItem(list, ids[2])!;
    expect(list.items.filter((i) => i.checked).map((i) => i.text)).toEqual(['a', 'c']);

    const cleared = clearChecked(list)!;
    expect(cleared.items.every((i) => !i.checked)).toBe(true);

    const pruned = removeChecked(list)!;
    expect(pruned.items.map((i) => i.text)).toEqual(['b']);

    const minusOne = removeItem(list, ids[1])!;
    expect(minusOne.items.map((i) => i.text)).toEqual(['a', 'c']);
  });

  it('normalizeChecklist filters deleted/invalid items and rejects deleted docs', () => {
    expect(normalizeChecklist(null)).toBeNull();
    expect(normalizeChecklist({ _deleted: true })).toBeNull();
    const norm = normalizeChecklist({
      title: 'X',
      createdAt: 5,
      items: [{ id: 1, text: 'ok', checked: false }, null, { id: 2, text: 'gone', _deleted: true }],
    });
    expect(norm?.items.map((i) => i.text)).toEqual(['ok']);
  });

  it('createShoppingItem records a category when provided, omits the key when blank', () => {
    const tagged = createShoppingItem('Milk', { category: 'Groceries' });
    expect(tagged.category).toBe('Groceries');

    const trimmed = createShoppingItem('Milk', { category: '  Groceries  ' });
    expect(trimmed.category).toBe('Groceries');

    const blank = createShoppingItem('Milk', { category: '   ' });
    expect('category' in blank).toBe(false);

    const none = createShoppingItem('Milk');
    expect('category' in none).toBe(false);
  });

  it('addItems threads category onto every item in the batch', () => {
    const next = addItems(null, ['a', 'b'], { category: 'Hardware' });
    expect(next.items.map((i) => i.category)).toEqual(['Hardware', 'Hardware']);
  });

  it('stampNeedId marks the published item and needIdOf reads it back', () => {
    const list = addItems(null, ['flour', 'eggs']);
    const [flour, eggs] = list.items;
    const stamped = stampNeedId(list, flour.id, 'need-1');
    const stampedFlour = stamped?.items.find((i) => i.id === flour.id);
    expect(needIdOf(stampedFlour)).toBe('need-1');
    expect(needIdOf(stamped?.items.find((i) => i.id === eggs.id))).toBeNull();
    // Input untouched, numeric/string id comparison tolerant.
    expect(needIdOf(list.items[0])).toBeNull();
    expect(stampNeedId(list, String(flour.id), 'need-2')?.items[0].needId).toBe('need-2');
  });

  it('stampNeedId returns null for a missing item or checklist', () => {
    expect(stampNeedId(null, '1', 'need-1')).toBeNull();
    expect(stampNeedId(addItems(null, ['a']), 'nope', 'need-1')).toBeNull();
  });

  it('isShoppingDoc recognises the container by key, id, or type', () => {
    expect(isShoppingDoc({ type: 'shopping' })).toBe(true);
    expect(isShoppingDoc({ id: 'shopping' })).toBe(true);
    expect(isShoppingDoc({}, 'shopping')).toBe(true);
    expect(isShoppingDoc({ type: 'tasks' })).toBe(false);
    expect(isShoppingDoc(null)).toBe(false);
  });
});
