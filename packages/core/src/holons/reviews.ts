// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A join request as a task on an admin's own board.
//
// A holon with no chat of its own (founded from a screen) has nowhere to
// say "someone is asking to be linked". Its admins do have a place they
// look at every day: their own holon. So whoever answers for the holon
// deals each admin one ordinary card there — "Link Kamala to Solstice" —
// and closes it once the person is linked. It is a reminder, not the
// decision: the seat is still given in the holon itself, by an admin's key
// (`approveJoin`); ticking the card by hand only puts it away.
//
// The card's id is one per holon and asking key, so dealing is idempotent
// from any surface and a newer ask from the same key never deals a second.

import type { HoloSphere } from 'holosphere';
import { applyTaskCompletion } from '../tasks/completion.js';
import { createTask } from '../tasks/creation.js';
import type { Quest } from '../tasks/types.js';
import type { JoinRequest } from './index.js';

/** The lens the review cards live in: the admin's ordinary tasks. */
export const JOIN_REVIEW_LENS = 'quests';

/** What tags a card as the review of one key's ask to one holon. */
export interface JoinReviewTag {
  holon: string;
  pubkey: string;
  /** The request it was dealt for. */
  eventId: string;
}

/** The card's id in an admin's holon: one per holon and asking key. */
export function joinReviewId(holon: string, pubkey: string): string {
  return `joinreview-${String(holon).replace(/[^A-Za-z0-9_-]/g, '_')}-${String(pubkey).toLowerCase().slice(0, 16)}`;
}

export interface JoinReviewOptions {
  /** The card's title, in the admin's language (default: English). */
  title?: string;
  description?: string;
  /** Where the admin answers: the holon's board. */
  link?: string;
  /** The applicant's name, for the default title. */
  name?: string;
  holonName?: string;
  now?: number;
}

/** A Telegram id is a number on the wire; a key stays a string. */
const person = (home: string): string | number => (/^\d{1,20}$/.test(home) ? Number(home) : home);

/** The review card for `home` (an admin's own holon), as a record. Pure. */
export function joinReviewCard(holon: string, home: string, request: Pick<JoinRequest, 'pubkey' | 'eventId'>, opts: JoinReviewOptions = {}): Quest {
  const holonName = opts.holonName || holon;
  const title = opts.title || `Link ${opts.name || 'a newcomer'} to ${holonName}`;
  const base = createTask({ holonId: home, initiator: { id: holon, ...(opts.holonName ? { username: opts.holonName } : {}) }, title, now: opts.now });
  const tag: JoinReviewTag = { holon, pubkey: request.pubkey.toLowerCase(), eventId: request.eventId };
  return {
    ...base,
    id: joinReviewId(holon, request.pubkey),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.link ? { link: opts.link } : {}),
    category: 'membership',
    participants: [{ id: person(home) }],
    joinReview: tag,
  };
}

const live = (rec: unknown): rec is Quest => !!rec && typeof rec === 'object' && (rec as { _deleted?: boolean })._deleted !== true;

async function current(hs: HoloSphere, home: string, id: string): Promise<Quest | null> {
  try {
    const rec = await hs.get(home, JOIN_REVIEW_LENS, id);
    return live(rec) ? rec : null;
  } catch {
    return null;
  }
}

/**
 * Deal the review card into an admin's holon unless it already holds one
 * for this key (open or put away — an admin who ticked it is not asked
 * again). True when written. Only a key that counts in that holon should
 * deal — the caller checks (`writeAcceptance`).
 */
export async function dealJoinReview(hs: HoloSphere, holon: string, home: string, request: Pick<JoinRequest, 'pubkey' | 'eventId'>, opts: JoinReviewOptions = {}): Promise<boolean> {
  const card = joinReviewCard(holon, home, request, opts);
  if (await current(hs, home, String(card.id))) return false;
  await hs.put(home, JOIN_REVIEW_LENS, card);
  return true;
}

/**
 * The ask was answered (the key is linked): close the admin's card. True
 * when this call completed it; false when there is none or it was closed.
 */
export async function settleJoinReview(hs: HoloSphere, holon: string, home: string, pubkey: string, opts: { now?: string } = {}): Promise<boolean> {
  const cur = await current(hs, home, joinReviewId(holon, pubkey));
  if (!cur) return false;
  const done = applyTaskCompletion(cur, person(home), { now: opts.now });
  if (!done.ok) return false;
  await hs.put(home, JOIN_REVIEW_LENS, done.task);
  return true;
}
