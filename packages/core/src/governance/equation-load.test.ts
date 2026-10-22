// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import type { HoloSphere } from 'holosphere';
import { DEFAULT_EQUATION, loadEquation, saveEquation } from '../scoring/index.js';
import { assertEquationEditable, loadGovernedEquation } from './equation-load.js';
import { EQUATION_GOVERNED_MESSAGE, equationClosesAt } from './equation.js';
import { signedEntry, testKey } from '../protocol/testing.js';
import { buildEquationProposal, buildVote } from './votes.js';

describe('loadGovernedEquation', () => {
  const created = Date.UTC(2026, 9, 22, 12);
  const at = Math.floor(created / 1000);
  const holonKey = testKey();
  const log = (item: unknown, t: number) =>
    signedEntry({ sk: holonKey.sk, item: item as Record<string, unknown>, created_at: t, holon: 'h', lens: 'governance_votes' });
  const entries = [
    log(buildEquationProposal({ proposal: 'p1', party: 'a', patch: { participation: 2 }, onBehalfOf: 'a' }).item, at),
    log(buildVote({ proposal: 'p1', choice: 'yes', party: 'a', onBehalfOf: 'a' }).item, at + 1),
    log(buildVote({ proposal: 'p1', choice: 'yes', party: 'b', onBehalfOf: 'b' }).item, at + 2),
  ];
  const lenses: Record<string, unknown[]> = {
    // A quest saying something else is display only: the log decides.
    quests: [{ id: 'p1', type: 'proposal', created: new Date(created).toISOString(), newEquation: { participation: 50 } }],
    users: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  };
  const hs = {
    ready: async () => {},
    store: { listEventIds: () => [], getEvents: () => [] },
    get: async (_h: string, lens: string) =>
      lens === 'settings' ? { holonPubkey: holonKey.pk, valueEquation: { completed: 1 } } : null,
    getAll: async (_h: string, lens: string) => lenses[lens] ?? [],
    getLog: async (_h: string, lens: string) => (lens === 'governance_votes' ? entries : []),
    getAllGlobal: async () => [],
  } as unknown as HoloSphere;

  it('folds the base with the proposals the log holds, judged at now', async () => {
    const open = await loadGovernedEquation(hs, 'h', { now: created + 1000 });
    expect(open.equation).toMatchObject({ completed: 1, participation: 0 });
    expect(open.proposals[0]).toMatchObject({ id: 'p1', closed: false, patch: { participation: 2 } });

    const res = await loadGovernedEquation(hs, 'h', { now: equationClosesAt(created) });
    expect(res.proposals[0]).toMatchObject({ id: 'p1', closed: true, passed: true });
    expect(res.equation).toMatchObject({ completed: 1, participation: 2 });
  });
});

describe('the equation once a vote has passed', () => {
  const created = Date.UTC(2026, 9, 22, 12);
  const at = Math.floor(created / 1000);
  const holonKey = testKey();
  const log = (item: unknown, t: number) =>
    signedEntry({ sk: holonKey.sk, item: item as Record<string, unknown>, created_at: t, holon: 'h', lens: 'governance_votes' });
  const entries = [
    log(buildEquationProposal({ proposal: 'p1', party: 'a', patch: { participation: 2 }, from: { completed: 1 }, onBehalfOf: 'a' }).item, at),
    log(buildVote({ proposal: 'p1', choice: 'yes', party: 'a', onBehalfOf: 'a' }).item, at + 1),
    log(buildVote({ proposal: 'p1', choice: 'yes', party: 'b', onBehalfOf: 'b' }).item, at + 2),
  ];
  let settings: Record<string, unknown> = { holonPubkey: holonKey.pk, valueEquation: { completed: 1 } };
  const puts: unknown[] = [];
  const hs = {
    ready: async () => {},
    store: { listEventIds: () => [], getEvents: () => [] },
    get: async (_h: string, lens: string) => (lens === 'settings' ? settings : null),
    getAll: async (_h: string, lens: string) => (lens === 'users' ? [{ id: 'a' }, { id: 'b' }, { id: 'c' }] : []),
    getLog: async (_h: string, lens: string) => (lens === 'governance_votes' ? entries : []),
    getAllGlobal: async () => [],
    put: async (_h: string, _l: string, item: unknown) => void puts.push(item),
  } as unknown as HoloSphere;

  it('ignores an admin editing settings, and refuses the editor', async () => {
    vi.useFakeTimers({ now: equationClosesAt(created) + 1000 });
    try {
      settings = { ...settings, valueEquation: { completed: 9, sent: 7 } };
      const { equation, governed } = await loadGovernedEquation(hs, 'h');
      expect(governed).toBe(true);
      expect(equation).toMatchObject({ completed: 1, sent: 0, participation: 2 });
      expect(await loadEquation(hs, 'h')).toMatchObject({ completed: 1, participation: 2 });
      await expect(assertEquationEditable(hs, 'h')).rejects.toThrow(EQUATION_GOVERNED_MESSAGE);
      await expect(saveEquation(hs, 'h', { ...DEFAULT_EQUATION, sent: 7 })).rejects.toThrow(EQUATION_GOVERNED_MESSAGE);
      expect(puts).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets admins set the starting equation until then', async () => {
    vi.useFakeTimers({ now: created + 1000 });
    try {
      await expect(assertEquationEditable(hs, 'h')).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
