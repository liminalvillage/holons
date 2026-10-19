// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading a holon's standing — exits and needs flags — off the store, with
 * the same lenses every fold reads (`lensContext`), so the cut, the boards,
 * the bot and the MCP all see the same seats. Eventually consistent: a lens
 * that has not arrived reads as empty, never as an error.
 */

import { MEMBERS_LENS, POLICY_LENS, readMembersLog } from '../protocol/index.js';
import { SHIFT_IDENTITY_LENS, attestationsFrom } from '../shifts/wire.js';
import { FLOW_EXITS_LENS, FLOW_NEEDS_LENS, foldStandingFromLenses, type Standing, type StandingContext } from './standing.js';

/** Fold a holon's `flow_exits` and `flow_needs` logs with everything the fold needs, read from the store. */
export async function loadStanding(holosphere: any, holonId: string): Promise<StandingContext> {
  const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.then((v) => v ?? fallback).catch(() => fallback);
  await Promise.all([quiet(holosphere.getAll(holonId, FLOW_EXITS_LENS), []), quiet(holosphere.getAll(holonId, FLOW_NEEDS_LENS), [])]);
  const [exits, needs, policyEntries, settings, users, dir] = await Promise.all([
    quiet<any[]>(holosphere.getLog(holonId, FLOW_EXITS_LENS), []),
    quiet<any[]>(holosphere.getLog(holonId, FLOW_NEEDS_LENS), []),
    quiet<any[]>(holosphere.getLog(holonId, POLICY_LENS), []),
    quiet<any>(holosphere.get(holonId, 'settings', holonId), null),
    quiet<any[]>(holosphere.getAll(holonId, 'users'), []),
    quiet<any[]>(holosphere.getAllGlobal(SHIFT_IDENTITY_LENS), []),
  ]);
  await quiet(holosphere.getAll(holonId, MEMBERS_LENS), []);
  const membersLog = await quiet(readMembersLog(holosphere, holonId), []);
  return foldStandingFromLenses({
    holonId,
    exits,
    needs,
    policyEntries,
    membersLog,
    settings,
    users,
    attestations: attestationsFrom(dir || []),
  });
}

/** The standing lookup a cascade or a cut injects: one read per holon, quiet. */
export const standingOf =
  (holosphere: any) =>
  async (holonId: string): Promise<Standing> =>
    (await loadStanding(holosphere, holonId)).standing;
