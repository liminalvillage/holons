// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { applyGiven, applyReceived, createAppreciation } from './operations.js';

describe('appreciation/operations', () => {
  it('createAppreciation clamps amount and defaults reason', () => {
    const a = createAppreciation({
      id: '1',
      from: { id: 1 },
      to: { id: 2 },
      date: 100,
      holonId: 'H',
    });
    expect(a.amount).toBe(1);
    expect(a.reason).toBe('General appreciation');
    const b = createAppreciation({
      id: '2',
      from: { id: 1 },
      to: { id: 2 },
      amount: 0,
      reason: '  thanks  ',
      date: 100,
      holonId: 'H',
    });
    expect(b.amount).toBe(1); // clamped up from 0
    expect(b.reason).toBe('thanks');
  });

  it('applyReceived / applyGiven accumulate', () => {
    let to = applyReceived({ id: 2 }, 3);
    expect(to.appreciationReceived).toBe(3);
    to = applyReceived(to, 2);
    expect(to.appreciationReceived).toBe(5);
    const from = applyGiven({ id: 1, appreciationGiven: 4 }, 1);
    expect(from.appreciationGiven).toBe(5);
  });
});
