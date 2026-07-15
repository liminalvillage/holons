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
 * The deck in dealing order: the (already search-filtered, user-ordered)
 * backlog minus the cards this session has dealt with. Tasks the user already
 * joined stay in — they show a JOINED ribbon and a right-swipe is a no-op.
 */
export function deckTasks(
  tasks: BacklogTask[],
  dismissed: ReadonlySet<string>,
): BacklogTask[] {
  return tasks.filter((t) => !dismissed.has(t.id));
}
