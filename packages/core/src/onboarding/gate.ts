// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// What a holon's page shows the person looking at it: its board, its front
// page (the DNA), the walk before asking to join, or their onboarding. One
// rule for every surface that has a board (the kiosk today), pure.

/** The page segments that are not tabs: `/<holon>/dna`, `/<holon>/apply`, `/<holon>/onboarding`. */
export type JoinPage = 'dna' | 'apply' | 'onboarding';

export type JoinGate = 'board' | 'front' | 'apply' | 'onboarding';

export interface JoinGateInput {
  /** The page the URL names, if any. */
  explicit?: JoinPage | null;
  /** The logged-in key on this screen; none on a wall display nobody logged into. */
  sessionKey?: string | null;
  /** That key's standing in the holon (`writeAcceptance`). */
  standing?: 'accepted' | 'held' | 'open' | null;
  /** That key has a request in, waiting (its `joinrequests` record is pending). */
  pending?: boolean;
  /** What the holon has to show a newcomer: genes (a DNA), an onboarding switched on. */
  front?: { genes: boolean; onboarding: boolean } | null;
}

/**
 * The page to show:
 *   • `/dna` → the front page and `/apply` → the walk, for anyone, logged in or not;
 *   • `/onboarding` → the onboarding while the key is not linked;
 *   • nobody logged in → the board (a wall display keeps its board);
 *   • a linked key → the board;
 *   • a key with a request in → its onboarding;
 *   • a key not linked to a holon that has a DNA or an onboarding → the front page;
 *   • anything else → the board.
 */
export function joinGate(input: JoinGateInput): JoinGate {
  if (input.explicit === 'dna') return 'front';
  if (input.explicit === 'apply') return 'apply';
  const linked = input.standing === 'accepted';
  if (input.explicit === 'onboarding') return linked ? 'board' : 'onboarding';
  if (!input.sessionKey || linked) return 'board';
  if (input.pending) return 'onboarding';
  if (input.front?.genes || input.front?.onboarding) return 'front';
  return 'board';
}
