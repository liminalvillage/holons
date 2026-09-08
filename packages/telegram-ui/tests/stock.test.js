// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { i18next } from '../src/utilities.js';
import Stock, {
  buildBoard,
  fmtQty,
  parseQuantityLine,
  parseStockCommand,
  shelfStatus,
  splitItemAndNote,
} from '../src/Stock.js';

describe('parseStockCommand', () => {
  it('bare /stock is the shelf, an unknown word is help', () => {
    expect(parseStockCommand('/stock')).toEqual({ sub: 'shelf', rest: '' });
    expect(parseStockCommand('/stock@HolonsBot')).toEqual({
      sub: 'shelf',
      rest: '',
    });
    expect(parseStockCommand('/stock frobnicate 3').sub).toBe('help');
  });

  it('strips the bot mention and keeps the rest of the line', () => {
    expect(parseStockCommand('/stock@HolonsBot add 5kg flour')).toEqual({
      sub: 'add',
      rest: '5kg flour',
    });
  });

  it('accepts the Italian and Spanish verbs', () => {
    expect(parseStockCommand('/scorte usa 2 farina').sub).toBe('use');
    expect(parseStockCommand('/existencias objetivo 10 harina').sub).toBe(
      'target'
    );
  });

  it('reorder carries its buy flag', () => {
    expect(parseStockCommand('/stock reorder')).toEqual({
      sub: 'reorder',
      rest: '',
    });
    expect(parseStockCommand('/stock reorder BUY')).toEqual({
      sub: 'reorder',
      rest: '',
      flag: 'buy',
    });
  });
});

describe('parseQuantityLine', () => {
  it('reads glued and spaced units, decimal commas, and a note', () => {
    expect(parseQuantityLine('5kg flour')).toEqual({
      quantity: 5,
      unit: 'kg',
      item: 'flour',
    });
    expect(parseQuantityLine('2,5 l olive oil - from the mill')).toEqual({
      quantity: 2.5,
      unit: 'l',
      item: 'olive oil',
      note: 'from the mill',
    });
    expect(parseQuantityLine('12 pcs screws')).toEqual({
      quantity: 12,
      unit: 'one',
      item: 'screws',
    });
  });

  it('a word glued to the number that is not a unit stays part of the item', () => {
    expect(parseQuantityLine('2eggs')).toEqual({ quantity: 2, item: 'eggs' });
    expect(parseQuantityLine('2eggs of the farm')).toEqual({
      quantity: 2,
      item: 'eggs of the farm',
    });
  });

  it('uses known item names to split the note off', () => {
    expect(
      parseQuantityLine('3 olive oil for the kitchen', ['Olive oil', 'Flour'])
    ).toEqual({
      quantity: 3,
      item: 'olive oil',
      note: 'for the kitchen',
    });
  });

  it('returns null when no number leads or nothing follows it', () => {
    expect(parseQuantityLine('flour 5')).toBeNull();
    expect(parseQuantityLine('5')).toBeNull();
    expect(parseQuantityLine('')).toBeNull();
  });
});

describe('splitItemAndNote', () => {
  it('a quoted item wins over separators', () => {
    expect(splitItemAndNote('"olive oil - extra" first press')).toEqual({
      item: 'olive oil - extra',
      note: 'first press',
    });
  });
});

describe('formatting', () => {
  it('fmtQty mirrors the kiosk', () => {
    expect(fmtQty(2.5, 'kg')).toBe('2.5 kg');
    expect(fmtQty(60, 'one')).toBe('60×');
    expect(fmtQty(1.3333, 'l')).toBe('1.33 l');
  });

  it('shelfStatus: empty at zero, low under the floor or a quarter of the target', () => {
    expect(shelfStatus(0, { target: 10 })).toBe('empty');
    expect(shelfStatus(2, { target: 10 })).toBe('low');
    expect(shelfStatus(3, { min: 4 })).toBe('low');
    expect(shelfStatus(5, { target: 10, min: 4 })).toBe('ok');
  });
});

describe('buildBoard', () => {
  const H = '-100';
  const P = '-200';
  const produced = (holonId, itemId, qty) => ({
    id: `${holonId}-${itemId}`,
    eventType: 'stock:produced',
    holonId,
    context: { holonId },
    inScopeOf: holonId,
    resourceInventoriedAs: itemId,
    resourceQuantity: { hasNumericalValue: qty, hasUnit: 'kg' },
    status: 'confirmed',
    provider: { id: 1 },
    hasPointInTime: new Date().toISOString(),
  });
  const spec = (id, extra = {}) => ({
    type: 'stock-item',
    id,
    name: id,
    category: 'food',
    unit: 'kg',
    ...extra,
  });

  it('a need short here is covered from a partner surplus, one hop away', () => {
    const board = buildBoard({
      holonId: H,
      specs: [spec('flour', { target: 10 })],
      events: [produced(H, 'flour', 1)],
      needs: [
        {
          type: 'need',
          status: 'requested',
          category: 'food',
          stock: { itemId: 'flour', quantity: 3 },
        },
      ],
      federated: [P],
      partners: [
        {
          id: P,
          name: 'Mill',
          specs: [spec('flour', { min: 2 })],
          events: [produced(P, 'flour', 10)],
          federated: [H],
        },
      ],
    });
    expect(board.levels[0]).toMatchObject({
      itemId: 'flour',
      onhand: 1,
      reserved: 1,
    });
    expect(board.scarcity[0]).toMatchObject({ category: 'food', shortage: 2 });
    expect(board.reorder[0]).toMatchObject({ itemId: 'flour', quantity: 10 });
    expect(board.plan).toEqual([
      { from: P, to: H, category: 'food', quantity: 2, cost: 1 },
    ]);
  });
});

describe('Stock feature', () => {
  beforeAll(async () => {
    const en = JSON.parse(
      readFileSync(new URL('../data/locales/en.json', import.meta.url), 'utf8')
    );
    await i18next.init({ lng: 'en', fallbackLng: 'en', resources: { en } });
  });

  it('registers /stock with its aliases and the reorder action', () => {
    const bot = { command: vi.fn(), action: vi.fn() };
    const db = { get: vi.fn(), getAll: vi.fn(), put: vi.fn(), delete: vi.fn() };
    new Stock(bot, db, { getLanguage: async () => 'en' });
    expect(bot.command).toHaveBeenCalledWith(
      ['stock', 'inventory', 'scorte', 'existencias'],
      expect.any(Function)
    );
    expect(bot.action).toHaveBeenCalledWith(
      'stock_reorder_buy',
      expect.any(Function)
    );
  });

  it('replies with the empty hint when nothing is on the shelf', async () => {
    const bot = { command: vi.fn(), action: vi.fn() };
    const db = {
      get: vi.fn(),
      getAll: vi.fn(async () => []),
      put: vi.fn(),
      delete: vi.fn(),
    };
    const stock = new Stock(bot, db, { getLanguage: async () => 'en' });
    const reply = vi.fn(async () => {});
    await stock.handle({
      chat: { id: -1 },
      from: { id: 1 },
      message: { text: '/stock' },
      reply,
    });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][0]).toMatch(/shelf/i);
  });
});
