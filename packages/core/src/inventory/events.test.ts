// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { economicEventProblems } from '../rea/valueflows.js';
import { buildStockEvent, buildStockTransfer, correctionKind } from './events.js';
import { foldStock, isStockEvent } from './fold.js';

const actor = { id: 7, username: 'ada' };

describe('buildStockEvent', () => {
  it('builds a valid ValueFlows event that folds with the right sign', () => {
    const produced = buildStockEvent({ holonId: 'h', kind: 'stock:produced', itemId: 'flour', quantity: 5, unit: 'kg', actor });
    const consumed = buildStockEvent({ holonId: 'h', kind: 'stock:consumed', itemId: 'flour', quantity: 2, unit: 'kg', actor });
    const lowered = buildStockEvent({ holonId: 'h', kind: 'stock:lowered', itemId: 'flour', quantity: 1, unit: 'kg', actor });
    for (const e of [produced, consumed, lowered]) {
      expect(economicEventProblems(e)).toEqual([]);
      expect(isStockEvent(e)).toBe(true);
    }
    expect(produced.action).toBe('produce');
    expect(produced.receiver.id).toBe('h');
    expect(consumed.provider.id).toBe('h');
    const [flour] = foldStock([produced, consumed, lowered], 'h');
    expect(flour.onhand).toBe(2);
    expect(flour.unit).toBe('kg');
  });

  it('refuses a non-positive quantity', () => {
    expect(() => buildStockEvent({ holonId: 'h', kind: 'stock:produced', itemId: 'x', quantity: 0, unit: 'kg', actor })).toThrow();
  });

  it('picks the correction kind from the sign', () => {
    expect(correctionKind(3)).toBe('stock:raised');
    expect(correctionKind(-3)).toBe('stock:lowered');
  });
});

describe('buildStockTransfer', () => {
  it('folds out of the sender and into the receiver from the same event', () => {
    const t = buildStockTransfer({ fromHolonId: 'a', toHolonId: 'b', itemId: 'flour', quantity: 4, unit: 'kg', actor, status: 'pending' });
    expect(economicEventProblems(t)).toEqual([]);
    expect(t.action).toBe('transfer');
    expect(foldStock([t], 'a')[0].pending).toBe(-4);
    const [inbound] = foldStock([t], 'b');
    expect(inbound.confirmed).toBe(0);
    expect(inbound.pending).toBe(4);
    expect(inbound.incoming).toBe(4);
  });

  it('needs two different holons', () => {
    expect(() => buildStockTransfer({ fromHolonId: 'a', toHolonId: 'a', itemId: 'x', quantity: 1, unit: 'kg', actor })).toThrow();
  });
});
