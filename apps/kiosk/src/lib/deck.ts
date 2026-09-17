// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure geometry + ordering for the Tasks swipe deck (Tinder-style): given a
// drag offset, decide which action the gesture commits to, how strongly each
// direction badge shows, and how the card tracks the finger. No Svelte, no
// Holosphere — TaskSwipeView renders these, membership.ts writes the outcome.

import type { BacklogTask } from "./data";

/** Where a committed swipe went: left = skip, right = join, up = like. */
export type SwipeDirection = "left" | "right" | "up";

/** How much the card leans per pixel of horizontal drag. */
const ROTATE_DEG_PER_PX = 0.08;

/**
 * The action a released drag commits to, or null to spring back. Up wins a
 * diagonal only while the lift dominates the horizontal pull (so a flick to a
 * corner still reads as left/right); a downward drag never commits.
 */
export function swipeDecision(
  dx: number,
  dy: number,
  threshold: number,
): SwipeDirection | null {
  const lift = -dy;
  if (lift > threshold && lift > Math.abs(dx)) return "up";
  if (Math.abs(dx) > threshold) return dx > 0 ? "right" : "left";
  return null;
}

/**
 * Per-direction badge strength for the current drag, each clamped 0…1 and
 * reaching 1 exactly at the commit threshold. The dominant axis leads on
 * diagonals, mirroring {@link swipeDecision}.
 */
export function badgeOpacity(
  dx: number,
  dy: number,
  threshold: number,
): { join: number; skip: number; like: number } {
  const clamp = (v: number) => Math.max(0, Math.min(1, v / threshold));
  return {
    join: clamp(dx),
    skip: clamp(-dx),
    like: clamp(-dy),
  };
}

/** The top card's transform while it tracks the finger. */
export function cardTransform(dx: number, dy: number): string {
  const deg = dx * ROTATE_DEG_PER_PX;
  return `translate(${dx}px, ${dy}px) rotate(${deg}deg)`;
}

/**
 * One person's progress through one hub's deck. A deck is personal: what
 * someone skipped, and the order their cards were dealt in, must never leak
 * to the next person at a shared screen, to another hub (quest ids are
 * Telegram message ids and collide across chats), or follow other people's
 * likes (the wall's "most loved" sort re-ranks live; a deck does not).
 */
export interface DeckState {
  /** Card ids this person has dealt with — skipped, joined, or liked. */
  dismissed: ReadonlySet<string>;
  /**
   * Every card id in the order it was first dealt. Frozen: later re-ranks of
   * the backlog don't move a card, new cards join at the back, and an id that
   * is momentarily absent (search filter, a live update in flight) keeps its
   * place for when it returns.
   */
  order: readonly string[];
}

export const EMPTY_DECK: DeckState = { dismissed: new Set(), order: [] };

/** Deck owner when nobody is logged in (skipping needs no login). */
const ANON = "anon";

/** Joins hub and person in a deck key; a space never occurs in either id. */
const SEP = " ";

/** The key a deck is kept under: one per hub, per person (or the anonymous visitor). */
export function deckKey(
  holon: string | null | undefined,
  uid: string | number | null | undefined,
): string {
  return `${holon ?? ""}${SEP}${uid ?? ANON}`;
}

/** Whether `key` belongs to `uid` (null = the anonymous visitor). */
function ownedBy(
  key: string,
  uid: string | number | null | undefined,
): boolean {
  return key.slice(key.indexOf(SEP) + 1) === String(uid ?? ANON);
}

/**
 * The decks that survive a change of who is at the screen: only the new
 * person's own. Logging out ends the previous person's session, so their
 * skipped cards return next time — and nobody inherits anybody's deck.
 */
export function decksFor<T>(
  all: ReadonlyMap<string, T>,
  uid: string | number | null | undefined,
): Map<string, T> {
  return new Map([...all].filter(([key]) => ownedBy(key, uid)));
}

/**
 * The frozen dealing order extended with any card not dealt yet. Returns
 * `prev` itself when nothing is new, so callers can skip a store write.
 */
export function dealOrder(
  prev: readonly string[],
  tasks: readonly BacklogTask[],
): readonly string[] {
  const seen = new Set(prev);
  const added = tasks.map((t) => t.id).filter((id) => !seen.has(id));
  return added.length ? [...prev, ...added] : prev;
}

/**
 * The deck in dealing order: the (already search-filtered) backlog in this
 * person's frozen `order`, minus the cards they have dealt with, and minus
 * tasks still blocked by open dependencies — the deck is "where should focus
 * go now", so it deals only the graph's current leaves. Tasks the user
 * already joined stay in — they show a JOINED ribbon and a right-swipe is a
 * no-op. A card not in `order` yet is dealt last, in backlog order.
 */
export function deckTasks(
  tasks: BacklogTask[],
  dismissed: ReadonlySet<string>,
  order: readonly string[] = [],
): BacklogTask[] {
  const open = tasks.filter((t) => t.unmetDeps === 0 && !dismissed.has(t.id));
  if (!order.length) return open;
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const at = (t: BacklogTask) => rank.get(t.id) ?? Number.MAX_SAFE_INTEGER;
  // Array.prototype.sort is stable, so undealt cards keep their backlog order.
  return [...open].sort((a, b) => at(a) - at(b));
}
