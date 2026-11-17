// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createHoloSphere } from '../holosphere/factory.js';
import { signedEntry, testKey } from '../protocol/testing.js';
import { QUEST_BOARD_LENS, buildQuestJoin } from './board.js';
import { addQuestNeed, closeQuest, joinQuest, leaveQuest, loadQuestBoard, pledgeToQuest, proposeQuest, watchQuestBoard, watchQuestBoards, withdrawPledge } from './board-load.js';
import type { FoldedQuestBoard } from './board.js';

const APP = 'quest-board-load-test';
const BOARD = 'holon_board';
const T0 = Math.floor(Date.now() / 1000);
const UNTIL = Date.now() + 7 * 86_400_000;

async function instance(sk = testKey().sk) {
  const hs: any = createHoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } });
  await hs.ready();
  return hs;
}

/** An entry signed by someone else, as it arrives from a relay. */
const arrive = (hs: any, sk: Uint8Array, item: unknown, at: number) => {
  const e = signedEntry({ sk, item: item as never, created_at: at, holon: BOARD, lens: QUEST_BOARD_LENS, app: APP });
  hs.store.apply(e.event, { origin: 'remote' });
  return e.id;
};

const needs = [
  { label: 'Players', quantity: 2, unit: 'people' },
  { label: 'Ball', quantity: 1 },
];

describe('quest board against the store', () => {
  it('proposes, joins, pledges and assembles; then the proposer closes it', async () => {
    const ana = testKey();
    const hs = await instance(ana.sk);
    const { id } = await proposeQuest(hs, BOARD, { party: ana.pk, title: 'Pick-up basketball', until: UNTIL, needs });
    let board = await loadQuestBoard(hs, BOARD);
    expect(board.quests.map((q) => q.id)).toEqual([id]);
    expect(board.byId[id].proposer).toBe(ana.pk);

    await joinQuest(hs, BOARD, { quest: id, party: ana.pk });
    // Someone who is no member of the board joins: an open log takes it.
    const ben = testKey();
    arrive(hs, ben.sk, buildQuestJoin({ quest: id, party: ben.pk }).item, T0 + 5);
    await pledgeToQuest(hs, BOARD, { quest: id, need: 'n2', party: ana.pk, quantity: 1 });
    board = await loadQuestBoard(hs, BOARD);
    expect(board.byId[id].state).toBe('assembled');
    expect(board.byId[id].participants.map((p) => p.id).sort()).toEqual([ana.pk, ben.pk].sort());

    await closeQuest(hs, BOARD, { quest: id, party: ana.pk, outcome: 'done' });
    board = await loadQuestBoard(hs, BOARD);
    expect(board.byId[id].state).toBe('done');
    await expect(joinQuest(hs, BOARD, { quest: id, party: ana.pk })).rejects.toThrow(/closed/);
  });

  it('refuses what the fold would not count', async () => {
    const ana = testKey();
    const hs = await instance(ana.sk);
    const { id } = await proposeQuest(hs, BOARD, { party: ana.pk, title: 'Garden day', until: UNTIL, needs });
    await expect(pledgeToQuest(hs, BOARD, { quest: id, need: 'n1', party: ana.pk, quantity: 1 })).rejects.toThrow(/headcount/);
    await expect(pledgeToQuest(hs, BOARD, { quest: id, need: 'n9', party: ana.pk, quantity: 1 })).rejects.toThrow(/no such need/);
    await expect(joinQuest(hs, BOARD, { quest: 'nope', party: ana.pk })).rejects.toThrow(/not on this board/);
    await expect(leaveQuest(hs, BOARD, { quest: id, party: ana.pk })).rejects.toThrow(/not on that quest/);
    await expect(closeQuest(hs, BOARD, { quest: id, party: 'someone-else', outcome: 'done' })).rejects.toThrow(/Only who proposed/);
  });

  it('adds a need, takes a pledge back and leaves', async () => {
    const ana = testKey();
    const hs = await instance(ana.sk);
    const { id } = await proposeQuest(hs, BOARD, { party: ana.pk, title: 'Repair café', until: UNTIL, needs });
    await addQuestNeed(hs, BOARD, { quest: id, party: ana.pk, label: 'Soldering iron', quantity: 2 });
    await joinQuest(hs, BOARD, { quest: id, party: ana.pk, level: 'curious' });
    const pledge = await pledgeToQuest(hs, BOARD, { quest: id, need: 'n2', party: ana.pk, quantity: 1 });
    let q = (await loadQuestBoard(hs, BOARD)).byId[id];
    expect(q.needs).toHaveLength(3);
    expect(q.curious).toEqual([ana.pk]);
    expect(q.pledges.map((p) => p.id)).toEqual([pledge.id]);

    await withdrawPledge(hs, BOARD, { quest: id, pledge: pledge.id, party: ana.pk });
    await leaveQuest(hs, BOARD, { quest: id, party: ana.pk });
    q = (await loadQuestBoard(hs, BOARD)).byId[id];
    expect(q.pledges).toEqual([]);
    expect(q.curious).toEqual([]);
  });

  it('watches a board: folds what is held, then again as entries land', async () => {
    const ana = testKey();
    const hs = await instance(ana.sk);
    const seen: FoldedQuestBoard[] = [];
    const stop = watchQuestBoard(hs, BOARD, (b) => seen.push(b), { tickMs: 0 });
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.at(-1)?.quests).toEqual([]);

    const { id } = await proposeQuest(hs, BOARD, { party: ana.pk, title: 'Watched', until: UNTIL, needs: [{ label: 'Hosts', quantity: 1, unit: 'people' }] });
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.at(-1)?.byId[id]?.state).toBe('open');

    // A join from someone else arrives from a relay; the writer checks against the watched board.
    const ben = testKey();
    arrive(hs, ben.sk, buildQuestJoin({ quest: id, party: ben.pk }).item, T0 + 5);
    await new Promise((r) => setTimeout(r, 60));
    const held = seen.at(-1)!;
    expect(held.byId[id].state).toBe('assembled');
    await expect(pledgeToQuest(hs, BOARD, { quest: id, need: 'n1', party: ana.pk, quantity: 1 }, { board: held })).rejects.toThrow(/headcount/);

    stop();
    const count = seen.length;
    await proposeQuest(hs, BOARD, { party: ana.pk, title: 'After stop', until: UNTIL, needs });
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.length).toBe(count);
  });

  it('watches several boards as one, each quest naming its board', async () => {
    const ana = testKey();
    const hs = await instance(ana.sk);
    const a = await proposeQuest(hs, 'holon_fund_a', { party: ana.pk, title: 'In A', until: UNTIL, needs });
    const b = await proposeQuest(hs, 'holon_fund_b', { party: ana.pk, title: 'In B', until: UNTIL, needs });
    const seen: FoldedQuestBoard[] = [];
    const stop = watchQuestBoards(hs, ['holon_fund_a', 'holon_fund_b', 'holon_fund_a'], (m) => seen.push(m), { tickMs: 0 });
    await new Promise((r) => setTimeout(r, 80));
    const last = seen.at(-1)!;
    expect(last.quests).toHaveLength(2);
    expect(last.byId[a.id].board).toBe('holon_fund_a');
    expect(last.byId[b.id].board).toBe('holon_fund_b');
    stop();
  });

  it('reads an empty board as nothing', async () => {
    const hs = await instance();
    expect(await loadQuestBoard(hs, 'holon_empty')).toEqual({ quests: [], byId: {} });
    expect(await loadQuestBoard(hs, '')).toEqual({ quests: [], byId: {} });
  });
});
