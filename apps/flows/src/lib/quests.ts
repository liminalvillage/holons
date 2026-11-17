// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Quests on the board — the rules are core's (`@holons/core/tasks` quest
// board): anyone signed in may propose, join, pledge or add a need, on the
// open log of a board holon. Every quest is filed under a FUND — nothing
// comes straight from the Pot — and a person watches the funds they follow
// at once; an event's holon given as `?board=` is a board of its own. The
// screen watches, so every word anyone says shows as it lands; a board that
// has not arrived yet has no quests.

import {
  addQuestNeed,
  closeQuest,
  joinQuest,
  leaveQuest,
  pledgeToQuest,
  proposeQuest,
  watchQuestBoards,
  withdrawPledge,
  type BoardQuest,
  type FoldedQuestBoard,
  type QuestJoinLevel,
  type QuestNeedInput,
  type QuestOutcome,
  type QuestYield,
} from "@holons/core/tasks";
import { potFunds } from "@holons/core/flows";
import { get, readable, writable, type Readable } from "svelte/store";
import { resolvePot } from "./config";
import { getHolosphere } from "./holosphere";

/** An event's board asked for with `?board=`, or null: the funds one follows. */
export function eventBoard(): string | null {
  try {
    return new URL(location.href).searchParams.get("board")?.trim() || null;
  } catch {
    return null;
  }
}

export interface BoardView extends FoldedQuestBoard {
  /** The boards watched: the followed funds, or one event. */
  boards: string[];
  loaded: boolean;
}

const EMPTY = (boards: string[]): BoardView => ({
  boards,
  quests: [],
  byId: {},
  loaded: false,
});

export const questBoard = writable<BoardView>(EMPTY([]));

/**
 * The quests, settled: a burst of entries from a relay arrives as one
 * change, not one per entry. What redraws a whole scene reads this.
 */
export const questsSettled: Readable<BoardView["quests"]> = (() => {
  const SETTLE_MS = 400;
  return readable<BoardView["quests"]>([], (set) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = true;
    const stop = questBoard.subscribe((v) => {
      if (first) {
        first = false;
        set(v.quests);
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => set(v.quests), SETTLE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  });
})();

/**
 * Watch these boards until the returned stop is called: what this device
 * holds shows at once, then each entry as it lands from a relay.
 */
export function watchBoards(boards: string[]): () => void {
  // Widening the watch keeps what is on screen until the merge lands:
  // emptying first would draw every quest away and back.
  const was = get(questBoard);
  const widening = was.boards.every((b) => boards.includes(b));
  questBoard.set(widening ? { ...was, boards } : EMPTY(boards));
  let stop: (() => void) | null = null;
  let stopped = false;
  void getHolosphere()
    .then((hs) => {
      if (stopped) return;
      stop = watchQuestBoards(hs, boards, (merged) =>
        questBoard.set({ ...merged, boards, loaded: true }),
      );
    })
    .catch(() => questBoard.set({ ...EMPTY(boards), loaded: true }));
  return () => {
    stopped = true;
    stop?.();
  };
}

/** What the writers check against: the watched boards, when this one is among them. */
function held(board: string): { board?: FoldedQuestBoard } {
  const v = get(questBoard);
  return v.loaded && v.boards.includes(board) ? { board: v } : {};
}

export async function propose(
  board: string,
  input: {
    party: string;
    name?: string;
    title: string;
    summary?: string;
    until: number;
    needs: QuestNeedInput[];
    yields?: QuestYield[];
    /** The holon it is proposed for (a project, a fund), when it names one. */
    holon?: string;
  },
): Promise<{ id: string }> {
  return proposeQuest(await getHolosphere(), board, input);
}

export async function join(
  board: string,
  quest: string,
  party: string,
  level: QuestJoinLevel,
  name?: string,
) {
  return joinQuest(
    await getHolosphere(),
    board,
    { quest, party, level, name },
    held(board),
  );
}

export async function leave(board: string, quest: string, party: string) {
  return leaveQuest(
    await getHolosphere(),
    board,
    { quest, party },
    held(board),
  );
}

export async function pledge(
  board: string,
  input: {
    quest: string;
    need: string;
    party: string;
    quantity: number;
    note?: string;
    name?: string;
  },
) {
  return pledgeToQuest(await getHolosphere(), board, input, held(board));
}

export async function unpledge(
  board: string,
  quest: string,
  pledgeId: string,
  party: string,
) {
  return withdrawPledge(
    await getHolosphere(),
    board,
    { quest, pledge: pledgeId, party },
    held(board),
  );
}

export async function addNeed(
  board: string,
  input: { quest: string; party: string } & QuestNeedInput,
) {
  return addQuestNeed(await getHolosphere(), board, input, held(board));
}

export async function close(
  board: string,
  quest: string,
  party: string,
  outcome: QuestOutcome,
) {
  return closeQuest(
    await getHolosphere(),
    board,
    { quest, party, outcome },
    held(board),
  );
}

/** A party as people read it: the name it gave on this quest, else a short id. */
export function partyName(q: BoardQuest, party: string): string {
  const named = q.names?.[party];
  if (named) return named;
  const s = String(party);
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

/** Is `party` anywhere on this quest — proposer, in, curious, pledging? */
export function isOnQuest(q: BoardQuest, party: string | null): boolean {
  if (!party) return false;
  return (
    q.proposer === party ||
    q.participants.some((p) => String(p.id) === party) ||
    q.curious.includes(party) ||
    q.pledges.some((p) => p.party === party)
  );
}

/** A fund one may follow, as the picker lists it. */
export interface FundEntry {
  id: string;
  label: string;
  /** How much of the Pot it holds (a share, or the Pot's raw weight). */
  weight: number;
}

/**
 * The Pot's funds read straight off its split — the directory when the map
 * snapshot has not loaded. Names arrive as each fund's settings are read.
 */
export const potFundList = writable<FundEntry[] | null>(null);
let potFundsAsked = false;

export async function loadPotFunds(): Promise<void> {
  if (potFundsAsked) return;
  potFundsAsked = true;
  const pot = resolvePot();
  if (!pot) return potFundList.set([]);
  try {
    const hs: any = await getHolosphere();
    const seats = potFunds(await hs.get(pot, "settings", pot));
    const list: FundEntry[] = seats.map((f) => ({
      id: f.id,
      label: f.id,
      weight: f.weight,
    }));
    potFundList.set(list);
    // Names, a few at a time, heaviest first.
    for (let i = 0; i < list.length; i += 8) {
      await Promise.all(
        list.slice(i, i + 8).map(async (f) => {
          const doc = await hs.get(f.id, "settings", f.id).catch(() => null);
          if (doc?.name) f.label = String(doc.name);
        }),
      );
      potFundList.set([...list]);
    }
  } catch {
    potFundList.set([]);
  }
}
