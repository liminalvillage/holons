// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Read the governed equation straight from a holon: the one call a surface
 * makes instead of reading `settings.valueEquation`, so the bot, the web
 * dashboard, MCP and the kiosk all score with the same votes-decided
 * weights. It reads what the fold needs — settings, the votes log (which
 * holds the proposals too) with its policy, membership and pinned
 * partners, delegations — and runs
 * `foldVotesFromLenses` + `foldEquation` (equation.ts).
 *
 * One-shot; a live surface re-reads when a lens it watches changes and at
 * `nextCloseAt`, when a vote closes and the equation may move on its own.
 */

import type { HoloSphere } from 'holosphere';
import { MEMBERS_LENS, POLICY_LENS, importPartnerLogs, lensContext, readMembersLog } from '../protocol/index.js';
import { SHIFT_IDENTITY_LENS, attestationsFrom } from '../shifts/index.js';
import { DELEGATIONS_LENS, foldDelegations } from './delegation.js';
import { EQUATION_GOVERNED_MESSAGE, foldEquation, type GovernedEquation } from './equation.js';
import { GOVERNANCE_VOTES_LENS, foldVotesFromLenses } from './votes.js';

const orEmpty = <T>(p: Promise<T[]> | undefined): Promise<T[]> =>
  (p ?? Promise.resolve([] as T[])).then((v) => v ?? []).catch(() => [] as T[]);

/** The equation in force for `holon` at `now`, with every proposal judged. */
export async function loadGovernedEquation(
  hs: HoloSphere,
  holon: string,
  opts: { now?: number } = {}
): Promise<GovernedEquation> {
  const [settings, users, entries, policy, dir, delegations] = await Promise.all([
    hs.get(holon, 'settings', holon).catch(() => null) as Promise<Record<string, unknown> | null>,
    orEmpty(hs.getAll(holon, 'users')),
    orEmpty(hs.getLog(holon, GOVERNANCE_VOTES_LENS)),
    orEmpty(hs.getLog(holon, POLICY_LENS)),
    orEmpty(hs.getAllGlobal?.(SHIFT_IDENTITY_LENS)),
    orEmpty(hs.getAll(holon, DELEGATIONS_LENS)),
  ]);
  // Warm the members lens before the log read, as every fold's reader does.
  await orEmpty(hs.getAll(holon, MEMBERS_LENS));
  const membersLog = await readMembersLog(hs, holon);
  const base = {
    holonId: holon,
    policyEntries: policy as never[],
    membersLog,
    settings,
    users: users as never[],
    attestations: attestationsFrom(dir as never[]),
  };
  const rule = lensContext(base).policyFor(GOVERNANCE_VOTES_LENS);
  const imports = await importPartnerLogs(hs, GOVERNANCE_VOTES_LENS, rule);
  const ctx = foldVotesFromLenses({
    ...base,
    entries: entries as never[],
    imports,
  });
  const memberIds = (users as Array<{ id?: unknown }>)
    .map((u) => (u?.id == null ? '' : String(u.id)))
    .filter(Boolean);
  return foldEquation({
    base: settings?.valueEquation ?? settings?.equation,
    proposals: ctx.folded.equations,
    ballots: ctx.folded.ballots,
    memberIds,
    tally: { delegations: foldDelegations(delegations as never[]) },
    now: opts.now,
  });
}

/**
 * Throws when the holon's votes have taken its equation over, so an editor
 * of `settings.valueEquation` says so instead of saving into silence: once a
 * proposal has passed, every reader ignores that field. The readers are what
 * enforce it, so a log that cannot be read lets the save through.
 */
export async function assertEquationEditable(hs: HoloSphere, holon: string): Promise<void> {
  const governed = await loadGovernedEquation(hs, holon).then(
    (g) => g.governed,
    () => false
  );
  if (governed) throw new Error(EQUATION_GOVERNED_MESSAGE);
}
