// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The quest board against the store: reading a board holon's `quest_board`
 * log, and every word a person says on it.
 *
 * Each writer reads the board first and refuses what the fold would ignore
 * anyway — a pledge to a quest that lapsed, a close by someone who did not
 * propose — so a person is told no instead of writing an entry nobody will
 * count. The fold stays the judge: two people writing at once still land
 * where the log order puts them.
 *
 * A screen watches the board instead of reading it once (`watchQuestBoard`):
 * what this device already holds folds at once, and every entry that lands
 * from a relay folds again — so a quest turns assembled on the screen of
 * everyone who follows it, as it happens. A writer given that folded board
 * (`opts.board`) checks against it instead of waiting on a relay.
 *
 * Eventually consistent: a lens that has not arrived reads as empty.
 */

import { resolveHolonAuthority } from '../holosphere/authority.js';
import {
  PEOPLE_UNIT,
  QUEST_BOARD_LENS,
  buildQuestClose,
  buildQuestJoin,
  buildQuestLeave,
  buildQuestNeed,
  buildQuestPledge,
  buildQuestProposal,
  buildQuestUnpledge,
  foldQuestBoard,
  type BoardQuest,
  type BuildQuestProposalInput,
  type FoldedQuestBoard,
  type QuestJoinLevel,
  type QuestNeedInput,
  type QuestOutcome,
} from './board.js';

const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.then((v) => v ?? fallback).catch(() => fallback);

/** Does this key speak for this party, as far as this instance can see? */
function speaksFor(holosphere: any) {
  const cache = new Map<string, ReturnType<typeof resolveHolonAuthority>['actors']>();
  return (pubkey: string, party: string, at: number): boolean => {
    const key = String(pubkey).toLowerCase();
    if (key === String(party).toLowerCase()) return true;
    if (!cache.has(party)) cache.set(party, resolveHolonAuthority(holosphere, party).actors);
    return !!cache.get(party)?.isAcceptedAt(key, at);
  };
}

/** A board's quests, folded. */
export async function loadQuestBoard(holosphere: any, boardId: string, opts: { now?: number } = {}): Promise<FoldedQuestBoard> {
  const board = String(boardId ?? '');
  if (!board) return { quests: [], byId: {} };
  // Pull the lens before reading the log off the local store.
  await quiet(holosphere.getAll(board, QUEST_BOARD_LENS), []);
  const entries = await quiet<any[]>(Promise.resolve().then(() => holosphere.getLog(board, QUEST_BOARD_LENS)), []);
  return foldQuestBoard({
    entries,
    actors: resolveHolonAuthority(holosphere, board).actors,
    actsFor: speaksFor(holosphere),
    now: opts.now,
  });
}

export interface WatchQuestBoardOptions {
  /** Fold again this often (ms) so a time box that ends lapses on screen. Default one minute; 0 never. */
  tickMs?: number;
}

/**
 * Watch a board: `onChange` gets the folded board now (from what this
 * device holds), again whenever an entry lands, and every `tickMs`. Returns
 * the stop function.
 */
export function watchQuestBoard(
  holosphere: any,
  boardId: string,
  onChange: (board: FoldedQuestBoard) => void,
  opts: WatchQuestBoardOptions = {},
): () => void {
  const board = String(boardId ?? '');
  const entries = new Map<string, any>();
  const actsFor = speaksFor(holosphere);
  let pending: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const emit = () => {
    pending = null;
    if (stopped) return;
    onChange(foldQuestBoard({ entries: entries.values(), actors: resolveHolonAuthority(holosphere, board).actors, actsFor }));
  };
  // Entries arrive in bursts (a replay, a relay page): fold once per burst.
  const soon = () => {
    if (!pending) pending = setTimeout(emit, 30);
  };
  if (!board) {
    queueMicrotask(emit);
    return () => void (stopped = true);
  }
  let off: () => void = () => {};
  try {
    off = holosphere.subscribeLog(board, QUEST_BOARD_LENS, (e: any) => {
      entries.set(e.id, e);
      soon();
    });
  } catch {
    /* not an append lens on this instance: an empty board */
  }
  // Fold even when nothing is held yet, so the screen stops "reading".
  soon();
  const tick = opts.tickMs ?? 60_000;
  const timer = tick > 0 ? setInterval(emit, tick) : null;
  return () => {
    stopped = true;
    off();
    if (pending) clearTimeout(pending);
    if (timer) clearInterval(timer);
  };
}

/**
 * Watch several boards as one — every fund a person follows: each quest
 * carries the `board` it is filed under, newest first across them all.
 * Returns the stop function.
 */
export function watchQuestBoards(
  holosphere: any,
  boardIds: string[],
  onChange: (merged: FoldedQuestBoard) => void,
  opts: WatchQuestBoardOptions = {},
): () => void {
  const boards = [...new Set(boardIds.map((b) => String(b ?? '').trim()).filter(Boolean))];
  const each = new Map<string, FoldedQuestBoard>();
  const emit = () => {
    const quests = [...each.entries()]
      .flatMap(([board, folded]) => folded.quests.map((q) => ({ ...q, board })))
      .sort((a, z) => z.createdAt - a.createdAt || (a.id < z.id ? -1 : 1));
    const byId: Record<string, BoardQuest> = {};
    for (const q of quests) byId[q.id] = q;
    onChange({ quests, byId });
  };
  if (!boards.length) {
    queueMicrotask(emit);
    return () => {};
  }
  const stops = boards.map((board) =>
    watchQuestBoard(
      holosphere,
      board,
      (folded) => {
        each.set(board, folded);
        // Wait for every board's first fold, so the deck is not dealt from half of them.
        if (each.size === boards.length) emit();
      },
      opts,
    ),
  );
  return () => stops.forEach((stop) => stop());
}

/** What a writer checks against: the board the caller holds, else a fresh read. */
export interface QuestWriteOptions {
  now?: number;
  board?: FoldedQuestBoard;
}

const boardFor = (holosphere: any, board: string, opts: QuestWriteOptions) =>
  opts.board ? Promise.resolve(opts.board) : loadQuestBoard(holosphere, board, { now: opts.now });

async function append(holosphere: any, board: string, a: { item: unknown; refs?: unknown }): Promise<{ id: string }> {
  const event = await holosphere.append(board, QUEST_BOARD_LENS, a.item, a.refs ? { refs: a.refs } : undefined);
  return { id: event.id };
}

async function openQuest(holosphere: any, board: string, questId: string, opts: QuestWriteOptions): Promise<BoardQuest> {
  const { byId } = await boardFor(holosphere, board, opts);
  const q = byId[String(questId ?? '')];
  if (!q) throw new Error('That quest is not on this board');
  if (q.state === 'done' || q.state === 'cancelled') throw new Error('That quest is closed');
  if (q.state === 'lapsed') throw new Error('That quest lapsed');
  return q;
}

/** Put a quest on the board. */
export async function proposeQuest(holosphere: any, boardId: string, input: Omit<BuildQuestProposalInput, 'at'>, opts: QuestWriteOptions = {}): Promise<{ id: string }> {
  const board = String(boardId ?? '');
  if (!board) throw new Error('A quest goes on a board');
  return append(holosphere, board, buildQuestProposal({ ...input, at: opts.now }));
}

/** Say you are in, or curious. */
export async function joinQuest(holosphere: any, boardId: string, input: { quest: string; party: string; level?: QuestJoinLevel; name?: string }, opts: QuestWriteOptions = {}) {
  await openQuest(holosphere, boardId, input.quest, opts);
  return append(holosphere, boardId, buildQuestJoin(input));
}

/** Drop your standing on a quest. */
export async function leaveQuest(holosphere: any, boardId: string, input: { quest: string; party: string }, opts: QuestWriteOptions = {}) {
  const q = await openQuest(holosphere, boardId, input.quest, opts);
  const who = String(input.party);
  if (!q.participants.some((p) => String(p.id) === who) && !q.curious.includes(who)) throw new Error('You are not on that quest');
  return append(holosphere, boardId, buildQuestLeave(input));
}

/** Cover part of one need. */
export async function pledgeToQuest(
  holosphere: any,
  boardId: string,
  input: { quest: string; need: string; party: string; quantity: number; note?: string; name?: string },
  opts: QuestWriteOptions = {},
) {
  const q = await openQuest(holosphere, boardId, input.quest, opts);
  const need = q.needs.find((n) => n.id === input.need);
  if (!need) throw new Error('That quest has no such need');
  if (need.unit === PEOPLE_UNIT) throw new Error('A headcount is covered by joining, not pledging');
  return append(holosphere, boardId, buildQuestPledge(input));
}

/** Take a pledge back. */
export async function withdrawPledge(holosphere: any, boardId: string, input: { quest: string; pledge: string; party: string }, opts: QuestWriteOptions = {}) {
  const q = await openQuest(holosphere, boardId, input.quest, opts);
  if (!q.pledges.some((p) => p.id === input.pledge && p.party === input.party)) throw new Error('There is no such pledge to take back');
  return append(holosphere, boardId, buildQuestUnpledge({ pledge: input.pledge, party: input.party }));
}

/** Add a need the quest did not list. */
export async function addQuestNeed(holosphere: any, boardId: string, input: { quest: string; party: string } & QuestNeedInput, opts: QuestWriteOptions = {}) {
  await openQuest(holosphere, boardId, input.quest, opts);
  return append(holosphere, boardId, buildQuestNeed(input));
}

/** Close a quest as done or cancelled: the proposer, or an admin of the board. */
export async function closeQuest(holosphere: any, boardId: string, input: { quest: string; party: string; outcome: QuestOutcome }, opts: QuestWriteOptions = {}) {
  const { byId } = await boardFor(holosphere, boardId, opts);
  const q = byId[String(input.quest ?? '')];
  if (!q) throw new Error('That quest is not on this board');
  if (q.state === 'done' || q.state === 'cancelled') throw new Error('That quest is closed');
  // The fold's rule: the proposer, or a key the board's own roster names admin.
  const me = String(holosphere.currentPubkey ?? '').toLowerCase();
  const admin = !!me && resolveHolonAuthority(holosphere, boardId).actors?.roleAt(me, Math.floor((opts.now ?? Date.now()) / 1000)) === 'admin';
  if (q.proposer !== input.party && !admin) throw new Error('Only who proposed a quest closes it');
  return append(holosphere, boardId, buildQuestClose(input));
}
