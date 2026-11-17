// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The quest board — quests that need resourcing before they can happen, as
 * signed, append-only entries on the log of a BOARD holon (the Pot, or an
 * event's holon): `quest_board`.
 *
 * A quest is a goal, a list of needs (each a quantity, in its own unit), what
 * it yields when it happens (optional, the same shape, nothing is covered),
 * and a time box. Needs are its inputs, yields its outputs — the same two
 * sides a project has (`flows/ventures.ts`). People say how they are in, pledge to cover a need, or add a
 * need nobody thought of. When every need is covered the quest is ASSEMBLED:
 * from then on it stays assembled and the pledges are due. When the time box
 * ends first it LAPSES and the pledges are released. The proposer (or an
 * admin of the board) closes it as done or cancelled.
 *
 *   propose   — the quest itself; its id is the entry's id. Needs are `n1…`.
 *   join      — "I'm in" or "curious", one standing per party: the latest.
 *   leave     — drop that standing.
 *   pledge    — cover part of one need. A need in `people` is covered by
 *               the count of who is in, not by pledges.
 *   unpledge  — take a pledge back: only its own signer.
 *   need      — a need added later, by anyone. Its id is the entry's id.
 *   close     — done or cancelled: the proposer or a board admin.
 *
 * Anyone may append: whoever proposes, joins or pledges is by definition not
 * a member of the board, so this log does NOT run the usual author rule (as
 * `flows/project-claims.ts`). Every entry names its quest in its body, never
 * in `basis` — a basis is consumed, and many people join the same quest.
 *
 * A folded quest keeps the tasks `Quest` shape (`id`, `title`,
 * `description`, `type: 'quest'`, `initiator: {id}`, `participants`, `ends`), so
 * the helpers that read quests read these too.
 *
 * Pure: entries in, quests out. Reading and writing is `board-load.ts`.
 */

import { action, isAction, type AcceptedActors, type Appendable, type LogEvent } from '../protocol/index.js';
import { byLogOrder } from '../protocol/types.js';
import type { Quest, QuestInitiator, QuestParticipant } from './types.js';

/** The append-only lens quests live in, on the board holon. */
export const QUEST_BOARD_LENS = 'quest_board';

/** The unit a need is counted in when it is a headcount. */
export const PEOPLE_UNIT = 'people';

export const QUEST_TITLE_MAX = 120;
export const QUEST_SUMMARY_MAX = 1000;
export const QUEST_NOTE_MAX = 300;
export const QUEST_NEEDS_MAX = 20;
export const QUEST_YIELDS_MAX = 20;
const LABEL_MAX = 120;
const UNIT_MAX = 24;
const NAME_MAX = 80;
const QUANTITY_MAX = 1_000_000_000;

export type QuestJoinLevel = 'in' | 'curious';
export type QuestOutcome = 'done' | 'cancelled';
export type QuestState = 'open' | 'assembled' | 'lapsed' | 'done' | 'cancelled';

export interface QuestNeedInput {
  label: string;
  quantity: number;
  unit?: string;
}

export interface QuestNeed {
  id: string;
  label: string;
  quantity: number;
  unit?: string;
  /** How much is covered, capped at `quantity`. */
  covered: number;
  /** Who covers it: the parties pledging, or who is in for a headcount. */
  by: string[];
  /** Who added it, when it was added after the proposal. */
  addedBy?: string;
}

/** What a quest gives back when it happens: an output, in its own unit. */
export interface QuestYield {
  label: string;
  /** How much, when the proposer says. */
  quantity?: number;
  unit?: string;
}

export interface QuestPledge {
  /** The `pledge` entry. */
  id: string;
  need: string;
  party: string;
  pubkey: string;
  quantity: number;
  note?: string;
  /** Unix seconds. */
  createdAt: number;
  /** The quest lapsed or was cancelled: nothing is owed. */
  released: boolean;
}

export interface BoardQuest extends Quest {
  id: string;
  type: 'quest';
  title: string;
  description?: string;
  /** The party that proposed it. */
  proposer: string;
  /** The same, in the tasks shape. */
  initiator: QuestInitiator;
  /** The key that signed the proposal. */
  pubkey: string;
  /** The holon it is proposed for (a project, a fund), when it names one. */
  holon?: string;
  /** ISO time it was proposed. */
  created: string;
  /** Unix seconds it was proposed. */
  createdAt: number;
  /** End of the time box, ms. */
  until: number;
  /** The same, as ISO — the tasks `ends`. */
  ends: string;
  needs: QuestNeed[];
  /** Its outputs, as proposed. */
  yields: QuestYield[];
  pledges: QuestPledge[];
  /** Who is in. */
  participants: QuestParticipant[];
  /** Who is curious. */
  curious: string[];
  /** Mean of each need's covered share, 0…1. */
  coverage: number;
  /** Unix seconds every need was first covered. */
  assembledAt?: number;
  /** Unix seconds it was closed. */
  closedAt?: number;
  state: QuestState;
  /** Unix seconds of the last entry that moved it. */
  lastActivity: number;
  /** Party → the name it last gave itself here. */
  names: Record<string, string>;
  /** The board holon it is on — set by a reader watching several (a quest is filed under a fund). */
  board?: string;
}

export interface FoldedQuestBoard {
  /** Newest first. */
  quests: BoardQuest[];
  byId: Record<string, BoardQuest>;
}

const clip = (raw: unknown, max: number): string | undefined => {
  const s = String(raw ?? '').trim().slice(0, max);
  return s || undefined;
};

/** A positive amount, rounded to cents; anything else is null. */
export function cleanQuantity(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(QUANTITY_MAX, Math.round(n * 100) / 100);
}

function cleanNeed(raw: unknown): QuestNeedInput | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const label = clip(r.label, LABEL_MAX);
  const quantity = cleanQuantity(r.quantity);
  if (!label || quantity == null) return null;
  const unit = clip(r.unit, UNIT_MAX)?.toLowerCase();
  return { label, quantity, ...(unit ? { unit } : {}) };
}

function cleanYield(raw: unknown): QuestYield | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const label = clip(r.label, LABEL_MAX);
  if (!label) return null;
  const quantity = r.quantity == null || r.quantity === '' ? null : cleanQuantity(r.quantity);
  const unit = clip(r.unit, UNIT_MAX)?.toLowerCase();
  return { label, ...(quantity != null ? { quantity } : {}), ...(unit ? { unit } : {}) };
}

const isPeople = (n: { unit?: string }) => n.unit === PEOPLE_UNIT;

export interface QuestProposalBody {
  t: 'action';
  kind: 'propose';
  party: string;
  title: string;
  summary?: string;
  /** End of the time box, ms. */
  until: number;
  needs: QuestNeedInput[];
  yields?: QuestYield[];
  holon?: string;
  name?: string;
}

export interface QuestJoinBody {
  t: 'action';
  kind: 'join';
  quest: string;
  party: string;
  level: QuestJoinLevel;
  name?: string;
}

export interface QuestLeaveBody {
  t: 'action';
  kind: 'leave';
  quest: string;
  party: string;
}

export interface QuestPledgeBody {
  t: 'action';
  kind: 'pledge';
  quest: string;
  need: string;
  party: string;
  quantity: number;
  note?: string;
  name?: string;
}

export interface QuestUnpledgeBody {
  t: 'action';
  kind: 'unpledge';
  pledge: string;
  party: string;
}

export interface QuestNeedBody {
  t: 'action';
  kind: 'need';
  quest: string;
  party: string;
  label: string;
  quantity: number;
  unit?: string;
}

export interface QuestCloseBody {
  t: 'action';
  kind: 'close';
  quest: string;
  party: string;
  outcome: QuestOutcome;
}

const party = (raw: unknown, what = 'who'): string => {
  const p = String(raw ?? '').trim();
  if (!p) throw new Error(`A quest entry names ${what}`);
  return p;
};

export interface BuildQuestProposalInput {
  party: string;
  title: string;
  summary?: string;
  /** End of the time box, ms. */
  until: number;
  needs: QuestNeedInput[];
  /** What it gives back: optional. */
  yields?: QuestYield[];
  holon?: string;
  /** How the proposer would like to be called. */
  name?: string;
  /** Now, ms: the time box must end after it. */
  at?: number;
}

/** The `propose` entry: the quest. */
export function buildQuestProposal(input: BuildQuestProposalInput): Appendable<QuestProposalBody> {
  const who = party(input.party);
  const title = clip(input.title, QUEST_TITLE_MAX);
  if (!title) throw new Error('A quest has a title');
  const until = Number(input.until);
  if (!Number.isFinite(until) || until <= (input.at ?? Date.now())) throw new Error('A quest ends in the future');
  const needs = (input.needs ?? []).map(cleanNeed);
  if (!needs.length) throw new Error('A quest needs something');
  if (needs.some((n) => !n)) throw new Error('Every need has a label and a positive quantity');
  if (needs.length > QUEST_NEEDS_MAX) throw new Error(`A quest has at most ${QUEST_NEEDS_MAX} needs`);
  const yields = (input.yields ?? []).map(cleanYield);
  if (yields.some((y) => !y)) throw new Error('Every yield has a label');
  if (yields.length > QUEST_YIELDS_MAX) throw new Error(`A quest has at most ${QUEST_YIELDS_MAX} yields`);
  const summary = clip(input.summary, QUEST_SUMMARY_MAX);
  const holon = clip(input.holon, 200);
  const name = clip(input.name, NAME_MAX);
  return action('propose', {
    party: who,
    title,
    ...(summary ? { summary } : {}),
    until: Math.round(until),
    needs: needs as QuestNeedInput[],
    ...(yields.length ? { yields: yields as QuestYield[] } : {}),
    ...(holon ? { holon } : {}),
    ...(name ? { name } : {}),
  }) as unknown as Appendable<QuestProposalBody>;
}

export function buildQuestJoin(input: { quest: string; party: string; level?: QuestJoinLevel; name?: string }): Appendable<QuestJoinBody> {
  const level: QuestJoinLevel = input.level === 'curious' ? 'curious' : 'in';
  const name = clip(input.name, NAME_MAX);
  return action('join', { quest: party(input.quest, 'its quest'), party: party(input.party), level, ...(name ? { name } : {}) }) as unknown as Appendable<QuestJoinBody>;
}

export function buildQuestLeave(input: { quest: string; party: string }): Appendable<QuestLeaveBody> {
  return action('leave', { quest: party(input.quest, 'its quest'), party: party(input.party) }) as unknown as Appendable<QuestLeaveBody>;
}

export function buildQuestPledge(input: { quest: string; need: string; party: string; quantity: number; note?: string; name?: string }): Appendable<QuestPledgeBody> {
  const quantity = cleanQuantity(input.quantity);
  if (quantity == null) throw new Error('A pledge is a positive quantity');
  const note = clip(input.note, QUEST_NOTE_MAX);
  const name = clip(input.name, NAME_MAX);
  return action('pledge', {
    quest: party(input.quest, 'its quest'),
    need: party(input.need, 'its need'),
    party: party(input.party),
    quantity,
    ...(note ? { note } : {}),
    ...(name ? { name } : {}),
  }) as unknown as Appendable<QuestPledgeBody>;
}

export function buildQuestUnpledge(input: { pledge: string; party: string }): Appendable<QuestUnpledgeBody> {
  return action('unpledge', { pledge: party(input.pledge, 'its pledge'), party: party(input.party) }) as unknown as Appendable<QuestUnpledgeBody>;
}

export function buildQuestNeed(input: { quest: string; party: string } & QuestNeedInput): Appendable<QuestNeedBody> {
  const need = cleanNeed(input);
  if (!need) throw new Error('A need has a label and a positive quantity');
  return action('need', { quest: party(input.quest, 'its quest'), party: party(input.party), ...need }) as unknown as Appendable<QuestNeedBody>;
}

export function buildQuestClose(input: { quest: string; party: string; outcome: QuestOutcome }): Appendable<QuestCloseBody> {
  const outcome: QuestOutcome = input.outcome === 'cancelled' ? 'cancelled' : 'done';
  return action('close', { quest: party(input.quest, 'its quest'), party: party(input.party), outcome }) as unknown as Appendable<QuestCloseBody>;
}

const isKind = <T>(kind: string) => (item: unknown): item is T => isAction(item) && item.kind === kind;
export const isQuestProposal = isKind<QuestProposalBody>('propose');
const isJoin = isKind<QuestJoinBody>('join');
const isLeave = isKind<QuestLeaveBody>('leave');
const isPledge = isKind<QuestPledgeBody>('pledge');
const isUnpledge = isKind<QuestUnpledgeBody>('unpledge');
const isNeed = isKind<QuestNeedBody>('need');
const isClose = isKind<QuestCloseBody>('close');

export interface FoldQuestBoardInput {
  entries: Iterable<LogEvent<unknown>>;
  /** The BOARD holon's accepted signers: its admins may close any quest. */
  actors?: AcceptedActors | null;
  /** Does this key speak for this party? Absent: the key itself, or the first key heard for it. */
  actsFor?: (pubkey: string, party: string, at: number) => boolean;
  /** Now, ms: for lapsing. */
  now?: number;
}

interface Working {
  quest: BoardQuest;
  /** party → standing. */
  joins: Map<string, QuestJoinLevel>;
  /** pledge id → pledge (live only). */
  pledges: Map<string, QuestPledge>;
  /** party → the first key that spoke for it on this quest. */
  keys: Map<string, string>;
}

/** Every need's coverage from the live standings and pledges. */
function cover(w: Working): void {
  const q = w.quest;
  const inParties = [...w.joins].filter(([, l]) => l === 'in').map(([p]) => p);
  for (const n of q.needs) {
    if (isPeople(n)) {
      n.covered = Math.min(n.quantity, inParties.length);
      n.by = inParties;
      continue;
    }
    const mine = [...w.pledges.values()].filter((p) => p.need === n.id);
    n.covered = Math.min(n.quantity, Math.round(mine.reduce((s, p) => s + p.quantity, 0) * 100) / 100);
    n.by = [...new Set(mine.map((p) => p.party))];
  }
  q.participants = inParties.map((id) => ({ id }));
  q.curious = [...w.joins].filter(([, l]) => l === 'curious').map(([p]) => p);
  q.coverage = q.needs.length ? q.needs.reduce((s, n) => s + n.covered / n.quantity, 0) / q.needs.length : 0;
}

/** Fold the `quest_board` log into its quests. */
export function foldQuestBoard(input: FoldQuestBoardInput): FoldedQuestBoard {
  const now = input.now ?? Date.now();
  const ordered = [...input.entries].sort(byLogOrder);
  const speaks = (pubkey: string, who: string, at: number) => {
    if (pubkey.toLowerCase() === who.toLowerCase()) return true;
    try {
      return !!input.actsFor?.(pubkey, who, at);
    } catch {
      return false;
    }
  };
  const isAdmin = (e: LogEvent<unknown>) => input.actors?.roleAt(e.pubkey, e.created_at) === 'admin';

  const work = new Map<string, Working>();
  /** pledge id → quest id, for unpledges. */
  const pledgeOf = new Map<string, string>();

  for (const e of ordered) {
    const item = e.item;
    if (isQuestProposal(item)) {
      const initiator = clip(item.party, 200);
      const title = clip(item.title, QUEST_TITLE_MAX);
      const until = Number(item.until);
      const needs = (Array.isArray(item.needs) ? item.needs : []).slice(0, QUEST_NEEDS_MAX).map(cleanNeed);
      if (!initiator || !title || !Number.isFinite(until) || !needs.length || needs.some((n) => !n)) continue;
      const summary = clip(item.summary, QUEST_SUMMARY_MAX);
      const holon = clip(item.holon, 200);
      const yields = (Array.isArray(item.yields) ? item.yields : [])
        .slice(0, QUEST_YIELDS_MAX)
        .map(cleanYield)
        .filter((y): y is QuestYield => !!y);
      work.set(e.id, {
        quest: {
          id: e.id,
          type: 'quest',
          title,
          ...(summary ? { description: summary } : {}),
          status: 'ongoing',
          proposer: initiator,
          initiator: { id: initiator },
          pubkey: e.pubkey,
          ...(holon ? { holon } : {}),
          created: new Date(e.created_at * 1000).toISOString(),
          createdAt: e.created_at,
          until,
          ends: new Date(until).toISOString(),
          needs: (needs as QuestNeedInput[]).map((n, i) => ({ id: `n${i + 1}`, ...n, covered: 0, by: [] })),
          yields,
          pledges: [],
          participants: [],
          curious: [],
          coverage: 0,
          state: 'open',
          lastActivity: e.created_at,
          names: clip(item.name, NAME_MAX) ? { [initiator]: clip(item.name, NAME_MAX)! } : {},
        },
        joins: new Map(),
        pledges: new Map(),
        keys: new Map([[initiator, e.pubkey]]),
      });
      continue;
    }

    // Everything else moves an existing quest.
    const target = isUnpledge(item) ? pledgeOf.get(String(item.pledge ?? '')) : (item as { quest?: unknown })?.quest;
    const w = work.get(String(target ?? ''));
    if (!w) continue;
    const q = w.quest;
    if (q.state === 'done' || q.state === 'cancelled') continue;
    const who = clip((item as { party?: unknown })?.party, 200);
    if (!who) continue;
    // Past the time box only an assembled quest still moves.
    const late = e.created_at * 1000 >= q.until && q.assembledAt == null;

    if (isClose(item)) {
      const proposer = who === q.proposer && (e.pubkey === q.pubkey || speaks(e.pubkey, q.proposer, e.created_at));
      if (!proposer && !isAdmin(e)) continue;
      q.state = item.outcome === 'cancelled' ? 'cancelled' : 'done';
      q.closedAt = e.created_at;
      q.lastActivity = e.created_at;
      continue;
    }
    if (late) continue;
    // A party's word counts from the first key that spoke for it here, or
    // from a key seen to speak for it — nobody else moves its standing.
    const owner = w.keys.get(who);
    if (owner && owner !== e.pubkey && !speaks(e.pubkey, who, e.created_at)) continue;
    if (!owner) w.keys.set(who, e.pubkey);

    if (isJoin(item)) {
      w.joins.set(who, item.level === 'curious' ? 'curious' : 'in');
    } else if (isLeave(item)) {
      if (!w.joins.delete(who)) continue;
    } else if (isPledge(item)) {
      const need = q.needs.find((n) => n.id === String(item.need ?? ''));
      const quantity = cleanQuantity(item.quantity);
      if (!need || isPeople(need) || quantity == null) continue;
      const note = clip(item.note, QUEST_NOTE_MAX);
      w.pledges.set(e.id, {
        id: e.id,
        need: need.id,
        party: who,
        pubkey: e.pubkey,
        quantity,
        ...(note ? { note } : {}),
        createdAt: e.created_at,
        released: false,
      });
      pledgeOf.set(e.id, q.id);
    } else if (isUnpledge(item)) {
      const p = w.pledges.get(String(item.pledge));
      if (!p || p.pubkey !== e.pubkey) continue;
      w.pledges.delete(p.id);
    } else if (isNeed(item)) {
      const need = cleanNeed(item);
      if (!need || q.needs.length >= QUEST_NEEDS_MAX) continue;
      q.needs.push({ id: e.id, ...need, covered: 0, by: [], addedBy: who });
    } else continue;

    const name = clip((item as { name?: unknown }).name, NAME_MAX);
    if (name) q.names[who] = name;
    q.lastActivity = e.created_at;
    cover(w);
    if (q.assembledAt == null && q.needs.every((n) => n.covered >= n.quantity)) q.assembledAt = e.created_at;
  }

  const quests: BoardQuest[] = [];
  for (const w of work.values()) {
    const q = w.quest;
    cover(w);
    q.pledges = [...w.pledges.values()].sort(byLogOrder2);
    if (q.state === 'open') {
      if (q.assembledAt != null) q.state = 'assembled';
      else if (now >= q.until) q.state = 'lapsed';
    }
    const released = q.state === 'lapsed' || q.state === 'cancelled';
    for (const p of q.pledges) p.released = released;
    q.status = q.state === 'done' ? 'completed' : released ? 'cancelled' : 'ongoing';
    quests.push(q);
  }
  quests.sort((a, z) => z.createdAt - a.createdAt || (a.id < z.id ? -1 : 1));
  const byId: Record<string, BoardQuest> = {};
  for (const q of quests) byId[q.id] = q;
  return { quests, byId };
}

const byLogOrder2 = (a: QuestPledge, z: QuestPledge) => a.createdAt - z.createdAt || (a.id < z.id ? -1 : a.id > z.id ? 1 : 0);

/** What `party` has to do with a quest: proposed it, is in or curious, pledged. */
export function questStanding(q: BoardQuest, who: string): { proposer: boolean; level: QuestJoinLevel | null; pledges: QuestPledge[] } {
  const level: QuestJoinLevel | null = q.participants.some((p) => String(p.id) === who) ? 'in' : q.curious.includes(who) ? 'curious' : null;
  return { proposer: q.proposer === who, level, pledges: q.pledges.filter((p) => p.party === who) };
}

/** How much of a need is still open. */
export const needRemaining = (n: QuestNeed): number => Math.max(0, Math.round((n.quantity - n.covered) * 100) / 100);
