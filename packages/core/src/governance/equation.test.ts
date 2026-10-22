// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  MIN_OPEN_MS,
  applyEquationPatch,
  equationChanges,
  equationClosesAt,
  foldEquation,
  sanitizeEquationPatch,
} from './equation.js';
import { lunationAt } from '../flows/lunation.js';
import { DEFAULT_EQUATION, migrateEquation } from '../scoring/index.js';
import type { EquationPatch } from './equation.js';
import type { EquationEntry } from './votes.js';

describe('sanitizeEquationPatch', () => {
  it('keeps known finite weights and lowercased currency weights', () => {
    expect(
      sanitizeEquationPatch({ participation: 2, completed: '1.5', currencies: { Euro: 0.1 } })
    ).toEqual({ participation: 2, completed: 1.5, currencies: { euro: 0.1 } });
  });

  it('drops unknown keys and junk values instead of zeroing them', () => {
    expect(
      sanitizeEquationPatch({ participation: 'banana', hours: 3, id: 'x', activity: NaN, sent: null })
    ).toBeNull();
    expect(sanitizeEquationPatch({ sent: 0 })).toEqual({ sent: 0 });
  });

  it('refuses non-objects and empty patches', () => {
    expect(sanitizeEquationPatch(null)).toBeNull();
    expect(sanitizeEquationPatch([1])).toBeNull();
    expect(sanitizeEquationPatch('participation=2')).toBeNull();
    expect(sanitizeEquationPatch({ currencies: {} })).toBeNull();
  });
});

describe('applyEquationPatch', () => {
  it('lays the patch over the current equation, merging currencies', () => {
    const current = { ...DEFAULT_EQUATION, completed: 1, currencies: { hour: 1, euro: 0.5 } };
    const next = applyEquationPatch(current, { participation: 2, currencies: { hour: 3 } });
    expect(next.completed).toBe(1);
    expect(next.participation).toBe(2);
    expect(next.currencies).toEqual({ hour: 3, euro: 0.5 });
  });

  it('reads legacy shapes through migrateEquation', () => {
    const next = applyEquationPatch({ hours: 4, completed: 1 }, { sent: 1 });
    expect(next.currencies.hour).toBe(4);
    expect(next).not.toHaveProperty('hours');
    expect(next.sent).toBe(1);
  });
});

describe('equationChanges', () => {
  it('lists only the weights that would move', () => {
    const current = { ...DEFAULT_EQUATION, completed: 1 };
    expect(
      equationChanges(current, { completed: 1, participation: 2, currencies: { hour: 0, euro: 1 } })
    ).toEqual([
      { key: 'participation', from: 0, to: 2 },
      { key: 'currencies.euro', from: 0, to: 1 },
    ]);
    expect(equationChanges(current, { completed: 1 })).toEqual([]);
  });
});

describe('equationClosesAt', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('closes at the next new moon', () => {
    const created = Date.UTC(2026, 9, 22, 12);
    const close = equationClosesAt(created);
    expect(close).toBe(lunationAt(created).to + 1);
    expect(close - created).toBeGreaterThanOrEqual(MIN_OPEN_MS);
    expect(close - created).toBeLessThanOrEqual(30 * DAY);
  });

  it('skips a moon fewer than three days away', () => {
    const moon = lunationAt(Date.UTC(2026, 9, 22)).to + 1;
    const created = moon - DAY;
    const close = equationClosesAt(created);
    expect(close).toBe(lunationAt(moon).to + 1);
    expect(close - created).toBeGreaterThan(MIN_OPEN_MS);
  });
});

describe('foldEquation', () => {
  const created = Date.UTC(2026, 9, 22, 12);
  const close = equationClosesAt(created);
  const proposal = (id: string, patch: EquationPatch, at = created, from?: object): EquationEntry => ({
    id,
    entryId: `e-${id}`,
    party: 'a',
    pubkey: 'pk',
    patch,
    ...(from ? { from: migrateEquation(from) } : {}),
    createdAt: at,
    closesAt: equationClosesAt(at),
  });
  const base = { ...DEFAULT_EQUATION, completed: 1 };
  const members = ['a', 'b', 'c'];

  it('changes nothing while the vote is open, and says what it would change', () => {
    const res = foldEquation({
      base,
      proposals: [proposal('p1', { participation: 2 })],
      ballots: { p1: { a: 'yes', b: 'yes', c: 'yes' } },
      memberIds: members,
      now: close - 1,
    });
    expect(res.equation.participation).toBe(0);
    expect(res.proposals[0]).toMatchObject({ closed: false, passed: false });
    expect(res.proposals[0]!.changes).toEqual([{ key: 'participation', from: 0, to: 2 }]);
    expect(res.nextCloseAt).toBe(close);
  });

  it('applies a passed proposal at the moon, and not a failed one', () => {
    const res = foldEquation({
      base,
      proposals: [proposal('p1', { participation: 2 }), proposal('p2', { sent: 5 })],
      ballots: { p1: { a: 'yes', b: 'yes' }, p2: { a: 'yes', b: 'no', c: 'no' } },
      memberIds: members,
      now: close,
    });
    expect(res.equation).toMatchObject({ completed: 1, participation: 2, sent: 0 });
    expect(res.proposals.map((p) => [p.id, p.passed])).toEqual([
      ['p1', true],
      ['p2', false],
    ]);
    expect(res.nextCloseAt).toBeNull();
  });

  it('lays passed proposals on in closing order: the later close wins', () => {
    const later = equationClosesAt(close + 1);
    const res = foldEquation({
      base,
      proposals: [proposal('late', { participation: 4 }, close + 1), proposal('early', { participation: 2 })],
      ballots: { early: { a: 'yes', b: 'yes' }, late: { a: 'yes', b: 'yes' } },
      memberIds: members,
      now: later,
    });
    expect(res.equation.participation).toBe(4);
    expect(res.proposals.map((p) => p.id)).toEqual(['early', 'late']);
  });

  it('a majority of the room is not enough: silence counts against', () => {
    const res = foldEquation({
      base,
      proposals: [proposal('p1', { participation: 2 })],
      ballots: { p1: { a: 'yes' } },
      memberIds: members,
      now: close,
    });
    expect(res.proposals[0]!.passed).toBe(false);
    expect(res.equation.participation).toBe(0);
  });

  it('once a proposal has passed, editing settings no longer moves the equation', () => {
    const passed = [proposal('p1', { participation: 2 }, created, base)];
    const ballots = { p1: { a: 'yes' as const, b: 'yes' as const } };
    const before = foldEquation({ base, proposals: passed, ballots, memberIds: members, now: close });
    // An admin rewrites the base afterwards — a weight nobody voted on.
    const edited = { ...base, completed: 9, sent: 7 };
    const after = foldEquation({ base: edited, proposals: passed, ballots, memberIds: members, now: close });
    expect(after.equation).toEqual(before.equation);
    expect(after.equation).toMatchObject({ completed: 1, sent: 0, participation: 2 });
  });

  it('the first pass starts from what its ballot showed, every difference listed', () => {
    const from = { ...base, sent: 3 };
    const res = foldEquation({
      base,
      proposals: [proposal('p1', { participation: 2 }, created, from)],
      ballots: { p1: { a: 'yes', b: 'yes' } },
      memberIds: members,
      now: close - 1,
    });
    // The ballot shows the sent change too: nothing about `from` is hidden.
    expect(res.proposals[0]!.changes).toEqual([
      { key: 'sent', from: 0, to: 3 },
      { key: 'participation', from: 0, to: 2 },
    ]);
  });
});
