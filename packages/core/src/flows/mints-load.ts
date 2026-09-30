// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading a holon's mints off the store — the same lenses every fold reads
 * (`lensContext`), so the kiosk, the web, the bot, the MCP and the inbound
 * walk all arrive at one statement. Eventually consistent: a lens that has
 * not arrived reads as empty, never as an error.
 */

import { MEMBERS_LENS, POLICY_LENS, readMembersLog } from '../protocol/index.js';
import { SHIFT_IDENTITY_LENS, attestationsFrom } from '../shifts/wire.js';
import { FLOW_MINTS_LENS, foldMintsFromLenses, type MintsContext } from './mints.js';

/** Fold a holon's `flow_mints` log with everything the fold needs, read from the store. */
export async function loadMints(holosphere: any, holonId: string): Promise<MintsContext> {
  const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.then((v) => v ?? fallback).catch(() => fallback);
  const [entries, policyEntries, settings, users, dir] = await Promise.all([
    quiet<any[]>(holosphere.getLog(holonId, FLOW_MINTS_LENS), []),
    quiet<any[]>(holosphere.getLog(holonId, POLICY_LENS), []),
    quiet<any>(holosphere.get(holonId, 'settings', holonId), null),
    quiet<any[]>(holosphere.getAll(holonId, 'users'), []),
    quiet<any[]>(holosphere.getAllGlobal(SHIFT_IDENTITY_LENS), []),
  ]);
  await quiet(holosphere.getAll(holonId, MEMBERS_LENS), []); // catches the lens up from the relays
  const membersLog = await quiet(readMembersLog(holosphere, holonId), []);
  return foldMintsFromLenses({
    holonId,
    entries,
    policyEntries,
    membersLog,
    settings,
    users,
    attestations: attestationsFrom(dir || []),
  });
}
