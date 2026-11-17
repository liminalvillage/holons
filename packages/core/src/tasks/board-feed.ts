// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The order a person meets quests in, one card at a time.
 *
 * What is close to tipping comes first: a quest most of whose needs are
 * met, with people already in, is the one a yes is most likely to tip. A
 * quest with many unmet needs that nobody has moved is the likeliest
 * distraction, so after a week without movement it sinks to the end. People
 * the viewer said they would work with again lift what they propose or are
 * in. Newer quests break the rest.
 *
 * Only open quests are dealt, and never one the viewer already decided on.
 * Everything here runs on the viewer's own device: their yes and no, and
 * who they would work with again, never leave it.
 *
 * Pure.
 */

import type { BoardQuest } from './board.js';

export const STALE_AFTER_MS = 7 * 86_400_000;

export interface RankQuestsOptions {
  /** Now, ms. */
  now?: number;
  /** Quest ids the viewer already said yes or no to. */
  decided?: ReadonlySet<string>;
  /** Parties the viewer would work with again. */
  liked?: ReadonlySet<string>;
  /** Parties the viewer would rather not work with again. */
  avoided?: ReadonlySet<string>;
}

/** How strongly a quest should be dealt to this viewer: higher first. */
export function questScore(q: BoardQuest, opts: RankQuestsOptions = {}): number {
  const now = opts.now ?? Date.now();
  const liked = opts.liked ?? new Set<string>();
  const avoided = opts.avoided ?? new Set<string>();
  const people = [q.proposer, ...q.participants.map((p) => String(p.id))];
  const friends = people.filter((p) => liked.has(p)).length;
  const avoid = avoided.has(q.proposer) ? 1 : 0;
  const stale = q.coverage === 0 && q.participants.length === 0 && now - q.lastActivity * 1000 > STALE_AFTER_MS;
  const ageDays = Math.max(0, (now - q.createdAt * 1000) / 86_400_000);
  return (
    (stale ? -100 : 0) +
    q.coverage * 10 +
    Math.min(q.participants.length, 10) * 0.5 +
    Math.min(friends, 3) * 3 -
    avoid * 6 +
    // Fresher is a little better: a tie-break over two weeks.
    Math.max(0, 1 - ageDays / 14)
  );
}

/** The open quests the viewer has not decided on, best first. */
export function rankQuests(quests: Iterable<BoardQuest>, opts: RankQuestsOptions = {}): BoardQuest[] {
  const decided = opts.decided ?? new Set<string>();
  const now = opts.now ?? Date.now();
  return [...quests]
    .filter((q) => q.state === 'open' && q.until > now && !decided.has(q.id))
    .map((q) => ({ q, s: questScore(q, { ...opts, now }) }))
    .sort((a, z) => z.s - a.s || z.q.createdAt - a.q.createdAt || (a.q.id < z.q.id ? -1 : 1))
    .map(({ q }) => q);
}

/** Order for the quests a person follows: what needs them now first. */
const STATE_ORDER = { assembled: 0, open: 1, done: 2, lapsed: 3, cancelled: 4 } as const;

export function sortFollowed(quests: Iterable<BoardQuest>): BoardQuest[] {
  return [...quests].sort((a, z) => STATE_ORDER[a.state] - STATE_ORDER[z.state] || z.lastActivity - a.lastActivity || (a.id < z.id ? -1 : 1));
}
