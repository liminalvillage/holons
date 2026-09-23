// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Votes on the kiosk: the `governance_votes` log with everything the fold
// reads, and recording a ballot signed as the logged-in person.
//
// A vote is a signed, append-only entry; who it counts for and whether it
// counts is decided by `@holons/core/governance` `foldVotesFromLenses` —
// the same fold every other surface runs. Recording goes the way claims do
// (see $lib/flowsClaims): a Telegram login is signed server-side under the
// member's derived key, a key login signs here with the adopted key.

import type { HoloSphere } from "holosphere";
import {
  GOVERNANCE_VOTES_LENS,
  buildVote,
  foldDelegations,
  foldVotesFromLenses,
  tallyBallots,
  type BallotTally,
  type VoteChoice,
  type VotesContext,
} from "@holons/core/governance";
import { DELEGATIONS_LENS } from "@holons/core/governance";
import {
  recordLogEntry,
  watchLogLens,
  type ClaimsLogs as VotesLogs,
} from "./flowsClaims";

export type { VotesLogs };
export { claimSigner as voteSigner } from "./flowsClaims";

/** Watch the votes log and everything its fold reads. */
export function watchVotesLogs(
  hs: HoloSphere,
  holon: string,
  onChange: (logs: VotesLogs) => void,
): () => void {
  return watchLogLens(hs, holon, GOVERNANCE_VOTES_LENS, onChange);
}

/** What the tally needs besides the log: the roster and the delegations. */
export interface VotesRoster {
  settings: Record<string, unknown> | null;
  users: Array<{ id?: string | number | null; [k: string]: unknown }>;
  delegations: Record<string, string>;
}

/** Read the roster once; the modal is short-lived, so no subscription. */
export async function loadVotesRoster(
  hs: HoloSphere,
  holon: string,
): Promise<VotesRoster> {
  const [settings, users, delegations] = await Promise.all([
    hs
      .get(holon, "settings", holon)
      .then((d) => (d as Record<string, unknown>) ?? null)
      .catch(() => null),
    hs
      .getAll(holon, "users")
      .then((u) => (u as VotesRoster["users"]) ?? [])
      .catch(() => [] as VotesRoster["users"]),
    hs
      .getAll(holon, DELEGATIONS_LENS)
      .then((d) => foldDelegations((d as unknown[]) ?? []))
      .catch(() => ({}) as Record<string, string>),
  ]);
  return { settings, users, delegations };
}

/** Fold the log with the roster, the way every surface does. */
export function foldVotesContext(
  holon: string,
  logs: VotesLogs,
  roster: VotesRoster,
): VotesContext {
  return foldVotesFromLenses({
    holonId: holon,
    entries: logs.entries,
    policyEntries: logs.policy,
    membersLog: logs.members,
    settings: roster.settings,
    users: roster.users,
    attestations: logs.attestations,
    imports: logs.imports,
  });
}

/** Count one proposal: every member weighs one, delegations followed. */
export function tallyFor(
  ctx: VotesContext,
  roster: VotesRoster,
  proposal: string,
): BallotTally {
  const memberIds = roster.users
    .map((u) => (u?.id == null ? "" : String(u.id)))
    .filter(Boolean);
  return tallyBallots(ctx.folded.ballots[proposal] ?? {}, memberIds, {
    delegations: roster.delegations,
  });
}

/** Cast a ballot as the logged-in person. */
export function recordVote(
  hs: HoloSphere,
  holon: string,
  input: { proposal: string; party: string; choice: VoteChoice; memo?: string },
) {
  return recordLogEntry(
    hs,
    holon,
    GOVERNANCE_VOTES_LENS,
    buildVote(input) as never,
  );
}
