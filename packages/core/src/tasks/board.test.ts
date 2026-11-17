// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { signedEntry, testKey } from '../protocol/testing.js';
import type { AcceptedActors } from '../protocol/types.js';
import {
  QUEST_BOARD_LENS,
  buildQuestClose,
  buildQuestJoin,
  buildQuestLeave,
  buildQuestNeed,
  buildQuestPledge,
  buildQuestProposal,
  buildQuestUnpledge,
  foldQuestBoard,
  needRemaining,
  questStanding,
} from './board.js';

const T0 = 1_760_000_000;
const NOW = T0 * 1000;
const UNTIL = NOW + 7 * 86_400_000;

const ana = testKey();
const ben = testKey();
const cai = testKey();
const admin = testKey();

const entry = (sk: Uint8Array, a: { item: unknown; refs?: any }, at: number) =>
  signedEntry({ sk, item: a.item as never, refs: a.refs, created_at: at, holon: 'board', lens: QUEST_BOARD_LENS });

const propose = (at = T0) =>
  entry(
    ana.sk,
    buildQuestProposal({
      party: 'ana',
      title: 'Pick-up basketball',
      summary: 'Saturday at the court',
      until: UNTIL,
      needs: [
        { label: 'Players', quantity: 2, unit: 'people' },
        { label: 'Ball', quantity: 1 },
      ],
      at: NOW,
    }),
    at,
  );

const adminActors = { roleAt: (pk: string) => (pk === admin.pk ? 'admin' : null), isAcceptedAt: () => false } as unknown as AcceptedActors;

describe('buildQuestProposal', () => {
  it('refuses a quest with no title, no needs, a bad need or a past time box', () => {
    const base = { party: 'ana', title: 'x', until: UNTIL, needs: [{ label: 'a', quantity: 1 }], at: NOW };
    expect(() => buildQuestProposal({ ...base, title: ' ' })).toThrow(/title/);
    expect(() => buildQuestProposal({ ...base, needs: [] })).toThrow(/needs something/);
    expect(() => buildQuestProposal({ ...base, needs: [{ label: 'a', quantity: 0 }] })).toThrow(/positive/);
    expect(() => buildQuestProposal({ ...base, until: NOW - 1 })).toThrow(/future/);
  });

  it('clips text and lower-cases units', () => {
    const p = buildQuestProposal({ party: 'ana', title: 'T'.repeat(500), until: UNTIL, needs: [{ label: 'Chairs', quantity: 3.333, unit: 'Pieces' }], at: NOW });
    expect(p.item.title).toHaveLength(120);
    expect(p.item.needs).toEqual([{ label: 'Chairs', quantity: 3.33, unit: 'pieces' }]);
  });
});

describe('foldQuestBoard', () => {
  it('reads a fresh proposal as an open quest in the tasks Quest shape', () => {
    const p = propose();
    const { quests, byId } = foldQuestBoard({ entries: [p], now: NOW });
    expect(quests).toHaveLength(1);
    const q = byId[p.id];
    expect(q).toMatchObject({ id: p.id, type: 'quest', title: 'Pick-up basketball', description: 'Saturday at the court', proposer: 'ana', state: 'open', status: 'ongoing', coverage: 0 });
    expect(q.ends).toBe(new Date(UNTIL).toISOString());
    expect(q.needs.map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  it('covers a headcount by who is in, an item by pledges, and assembles when all are met', () => {
    const p = propose();
    const entries = [
      p,
      entry(ben.sk, buildQuestJoin({ quest: p.id, party: 'ben', name: 'Ben' }), T0 + 1),
      entry(cai.sk, buildQuestJoin({ quest: p.id, party: 'cai', level: 'curious' }), T0 + 2),
    ];
    let q = foldQuestBoard({ entries, now: NOW }).byId[p.id];
    expect(q.needs[0]).toMatchObject({ covered: 1, by: ['ben'] });
    expect(q.curious).toEqual(['cai']);
    expect(q.names).toEqual({ ben: 'Ben' });
    expect(q.coverage).toBe(0.25);
    expect(q.state).toBe('open');

    entries.push(entry(cai.sk, buildQuestJoin({ quest: p.id, party: 'cai' }), T0 + 3));
    const pledge = entry(ben.sk, buildQuestPledge({ quest: p.id, need: 'n2', party: 'ben', quantity: 1, note: 'mine is orange' }), T0 + 4);
    entries.push(pledge);
    q = foldQuestBoard({ entries, now: NOW }).byId[p.id];
    expect(q.state).toBe('assembled');
    expect(q.assembledAt).toBe(T0 + 4);
    expect(q.coverage).toBe(1);
    expect(q.participants.map((x) => x.id)).toEqual(['ben', 'cai']);
    expect(q.pledges).toEqual([expect.objectContaining({ id: pledge.id, party: 'ben', quantity: 1, note: 'mine is orange', released: false })]);
    expect(questStanding(q, 'ben')).toMatchObject({ proposer: false, level: 'in' });
    expect(questStanding(q, 'ana').proposer).toBe(true);

    // Assembled sticks: someone leaving afterwards does not undo it.
    entries.push(entry(cai.sk, buildQuestLeave({ quest: p.id, party: 'cai' }), T0 + 5));
    q = foldQuestBoard({ entries, now: NOW }).byId[p.id];
    expect(q.state).toBe('assembled');
    expect(needRemaining(q.needs[0])).toBe(1);
  });

  it('ignores a pledge to a headcount and caps cover at the need', () => {
    const p = propose();
    const q = foldQuestBoard({
      entries: [
        p,
        entry(ben.sk, buildQuestPledge({ quest: p.id, need: 'n1', party: 'ben', quantity: 5 }), T0 + 1),
        entry(ben.sk, buildQuestPledge({ quest: p.id, need: 'n2', party: 'ben', quantity: 3 }), T0 + 2),
      ],
      now: NOW,
    }).byId[p.id];
    expect(q.needs[0].covered).toBe(0);
    expect(q.needs[1].covered).toBe(1);
  });

  it('lets only the pledge’s own signer take it back', () => {
    const p = propose();
    const pledge = entry(ben.sk, buildQuestPledge({ quest: p.id, need: 'n2', party: 'ben', quantity: 1 }), T0 + 1);
    const forged = entry(cai.sk, buildQuestUnpledge({ pledge: pledge.id, party: 'ben' }), T0 + 2);
    let q = foldQuestBoard({ entries: [p, pledge, forged], now: NOW }).byId[p.id];
    expect(q.pledges).toHaveLength(1);
    const own = entry(ben.sk, buildQuestUnpledge({ pledge: pledge.id, party: 'ben' }), T0 + 3);
    q = foldQuestBoard({ entries: [p, pledge, forged, own], now: NOW }).byId[p.id];
    expect(q.pledges).toHaveLength(0);
  });

  it('keeps a party’s standing with the first key that spoke for it', () => {
    const p = propose();
    const q = foldQuestBoard({
      entries: [p, entry(ben.sk, buildQuestJoin({ quest: p.id, party: 'ben' }), T0 + 1), entry(cai.sk, buildQuestLeave({ quest: p.id, party: 'ben' }), T0 + 2)],
      now: NOW,
    }).byId[p.id];
    expect(q.participants.map((x) => x.id)).toEqual(['ben']);
  });

  it('accepts a linked key through actsFor', () => {
    const p = propose();
    const q = foldQuestBoard({
      entries: [p, entry(ben.sk, buildQuestJoin({ quest: p.id, party: 'ben' }), T0 + 1), entry(cai.sk, buildQuestLeave({ quest: p.id, party: 'ben' }), T0 + 2)],
      actsFor: (pk, who) => pk === cai.pk && who === 'ben',
      now: NOW,
    }).byId[p.id];
    expect(q.participants).toEqual([]);
  });

  it('adds needs from anyone, which un-assembles nothing but must be met to assemble', () => {
    const p = propose();
    const entries = [
      p,
      entry(cai.sk, buildQuestNeed({ quest: p.id, party: 'cai', label: 'Water', quantity: 6, unit: 'bottles' }), T0 + 1),
      entry(ben.sk, buildQuestJoin({ quest: p.id, party: 'ben' }), T0 + 2),
      entry(cai.sk, buildQuestJoin({ quest: p.id, party: 'cai' }), T0 + 3),
      entry(ben.sk, buildQuestPledge({ quest: p.id, need: 'n2', party: 'ben', quantity: 1 }), T0 + 4),
    ];
    let q = foldQuestBoard({ entries, now: NOW }).byId[p.id];
    expect(q.needs).toHaveLength(3);
    expect(q.needs[2]).toMatchObject({ label: 'Water', unit: 'bottles', addedBy: 'cai' });
    expect(q.state).toBe('open');
    entries.push(entry(cai.sk, buildQuestPledge({ quest: p.id, need: q.needs[2].id, party: 'cai', quantity: 6 }), T0 + 5));
    q = foldQuestBoard({ entries, now: NOW }).byId[p.id];
    expect(q.state).toBe('assembled');
  });

  it('lapses past the time box, releases pledges and ignores late words', () => {
    const p = propose();
    const late = UNTIL / 1000 + 10;
    const entries = [
      p,
      entry(ben.sk, buildQuestPledge({ quest: p.id, need: 'n2', party: 'ben', quantity: 1 }), T0 + 1),
      entry(cai.sk, buildQuestJoin({ quest: p.id, party: 'cai' }), late),
    ];
    const q = foldQuestBoard({ entries, now: UNTIL + 60_000 }).byId[p.id];
    expect(q.state).toBe('lapsed');
    expect(q.status).toBe('cancelled');
    expect(q.participants).toEqual([]);
    expect(q.pledges[0].released).toBe(true);
  });

  it('closes only by the proposer or a board admin, and a closed quest stops moving', () => {
    const p = propose();
    const byBen = entry(ben.sk, buildQuestClose({ quest: p.id, party: 'ana', outcome: 'done' }), T0 + 1);
    expect(foldQuestBoard({ entries: [p, byBen], now: NOW }).byId[p.id].state).toBe('open');

    const byAdmin = entry(admin.sk, buildQuestClose({ quest: p.id, party: 'admin', outcome: 'cancelled' }), T0 + 1);
    expect(foldQuestBoard({ entries: [p, byAdmin], actors: adminActors, now: NOW }).byId[p.id].state).toBe('cancelled');

    const byAna = entry(ana.sk, buildQuestClose({ quest: p.id, party: 'ana', outcome: 'done' }), T0 + 2);
    const after = entry(ben.sk, buildQuestJoin({ quest: p.id, party: 'ben' }), T0 + 3);
    const q = foldQuestBoard({ entries: [p, byAna, after], now: NOW }).byId[p.id];
    expect(q).toMatchObject({ state: 'done', status: 'completed', closedAt: T0 + 2 });
    expect(q.participants).toEqual([]);
  });

  it('lists quests newest first and skips malformed proposals', () => {
    const a = propose(T0);
    const b = propose(T0 + 50);
    const junk = signedEntry({ sk: ana.sk, item: { t: 'action', kind: 'propose', party: 'ana', title: '', until: UNTIL, needs: [] } as never, created_at: T0 + 60 });
    const { quests } = foldQuestBoard({ entries: [a, b, junk], now: NOW });
    expect(quests.map((q) => q.id)).toEqual([b.id, a.id]);
  });
});

describe('quest yields', () => {
  it('keeps what a quest gives back, cleaned, and refuses a yield with no label', () => {
    const base = { party: 'ana', title: 'Mural', until: UNTIL, needs: [{ label: 'Paint', quantity: 10, unit: 'L' }], at: NOW };
    expect(() => buildQuestProposal({ ...base, yields: [{ label: ' ' }] })).toThrow(/yield/);
    const e = entry(ana.sk, buildQuestProposal({ ...base, yields: [{ label: 'A wall', quantity: 1, unit: 'Wall' }, { label: 'Workshop' }] }), T0);
    const q = foldQuestBoard({ entries: [e], now: NOW }).quests[0];
    expect(q.yields).toEqual([{ label: 'A wall', quantity: 1, unit: 'wall' }, { label: 'Workshop' }]);
  });

  it('reads an older proposal without yields as yielding nothing', () => {
    const q = foldQuestBoard({ entries: [propose()], now: NOW }).quests[0];
    expect(q.yields).toEqual([]);
  });
});
