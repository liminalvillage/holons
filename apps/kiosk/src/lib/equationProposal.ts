// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The value equation, put to the holon instead of set by hand.
//
// Nobody edits the equation directly: whoever retunes the editor is drafting.
// The draft becomes an `equation` entry in the signed votes log — only the
// weights they moved, signed as them, never rewritable — plus a
// `type:'proposal'` quest with the same id, so it has a card to open and talk
// on. The holon votes on it like any proposal, and at the new moon its vote
// closes, `foldEquation` lays it over the equation if it passed — no apply
// step, nobody holding the switch. Meaning lives in `@holons/core/governance`;
// this file only diffs the draft and writes it.

import {
  EQUATION_WEIGHT_KEYS,
  GOVERNANCE_VOTES_LENS,
  buildEquationProposal,
  sanitizeEquationPatch,
  type EquationPatch,
  type FundableProposal,
} from "@holons/core/governance";
import type { ScoreEquation } from "@holons/core/scoring";
import { getHolosphere, getLensStore } from "$lib/holosphere";
import { recordLogEntry } from "$lib/flowsClaims";

/**
 * What the draft moves away from the live equation, as a proposal patch, or
 * null when it moves nothing. Weights are compared after the editor's own
 * rounding, so float dust is never proposed.
 */
export function draftPatch(
  live: ScoreEquation,
  draft: ScoreEquation,
): EquationPatch | null {
  const round = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  const patch: Record<string, unknown> = {};
  for (const key of EQUATION_WEIGHT_KEYS) {
    const to = round(draft[key]);
    if (to !== round(live[key])) patch[key] = to;
  }
  const currencies: Record<string, number> = {};
  for (const code of Object.keys(draft.currencies ?? {})) {
    const to = round(draft.currencies[code]);
    if (
      to !== round(live.currencies?.[code]) ||
      !(code in (live.currencies ?? {}))
    )
      currencies[code] = to;
  }
  if (Object.keys(currencies).length) patch.currencies = currencies;
  return sanitizeEquationPatch(patch);
}

export interface ProposalAuthor {
  id: string | number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * The quest that shows a proposal. It carries no patch: what the holon votes
 * on is the log entry with the same id, which nobody can edit.
 */
export function equationProposal(
  holon: string,
  author: ProposalAuthor,
  title: string,
  now = Date.now(),
): FundableProposal {
  return {
    id: `prop-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: "proposal",
    holon,
    title,
    status: "ongoing",
    initiator: {
      id: author.id,
      username: author.username,
      firstName: author.first_name,
      lastName: author.last_name,
    } as FundableProposal["initiator"],
    participants: [],
    created: new Date(now).toISOString(),
  };
}

/** Put the draft on the table. Resolves to the proposal, or null if empty. */
export async function proposeEquation(
  holon: string,
  author: ProposalAuthor,
  title: string,
  live: ScoreEquation,
  draft: ScoreEquation,
): Promise<FundableProposal | null> {
  const patch = draftPatch(live, draft);
  if (!patch) return null;
  const proposal = equationProposal(holon, author, title);
  // The signed entry first: it is the proposal. The quest is only its card.
  await recordLogEntry(
    await getHolosphere(),
    holon,
    GOVERNANCE_VOTES_LENS,
    buildEquationProposal({
      proposal: String(proposal.id),
      party: String(author.id),
      patch,
      from: live,
      title,
    }) as never,
  );
  const store = await getLensStore();
  await store.put(holon, "quests", proposal);
  return proposal;
}
