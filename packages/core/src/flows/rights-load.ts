// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading the rights log off the store with everything its fold needs — for
 * the surfaces with no board holding the lenses in memory (the MCP, the bot).
 * Same lenses as `mints-load.ts`, same fold as the kiosk runs.
 */

import { MEMBERS_LENS, POLICY_LENS, readMembersLog, type AcceptedActors, type LogEvent, type Policy } from '../protocol/index.js';
import { SHIFT_IDENTITY_LENS, attestationsFrom } from '../shifts/wire.js';
import { loadPotRecord, type PotRecord } from './bundle.js';
import { FLOW_RIGHTS_LENS, foldRightsFromLenses, latestRights, rootSignatures, type FoldedRights, type PublishedRights } from './rights-log.js';

export interface RightsContext {
  folded: FoldedRights;
  actors: AcceptedActors;
  policy: Policy;
  /** The raw log, for the signatures riding on attestations. */
  entries: LogEvent<unknown>[];
  pot: PotRecord | null;
  /** The latest accepted table for the holon's Pot, when it has one. */
  latest: PublishedRights | null;
  /** The wallet signatures the log holds for `latest`. */
  signatures: Array<{ signer: string; signature: string; pubkey: string }>;
}

/** The rights log folded with the signer set the lenses give. */
export async function loadRights(holosphere: any, holonId: string): Promise<RightsContext> {
  const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.then((v) => v ?? fallback).catch(() => fallback);
  await quiet(holosphere.getAll(holonId, FLOW_RIGHTS_LENS), []);
  const [entries, policyEntries, settings, users, dir, pot] = await Promise.all([
    quiet<LogEvent<unknown>[]>(holosphere.getLog(holonId, FLOW_RIGHTS_LENS), []),
    quiet<any[]>(holosphere.getLog(holonId, POLICY_LENS), []),
    quiet<any>(holosphere.get(holonId, 'settings', holonId), null),
    quiet<any[]>(holosphere.getAll(holonId, 'users'), []),
    quiet<any[]>(holosphere.getAllGlobal(SHIFT_IDENTITY_LENS), []),
    loadPotRecord(holosphere, holonId),
  ]);
  await quiet(holosphere.getAll(holonId, MEMBERS_LENS), []);
  const membersLog = await quiet(readMembersLog(holosphere, holonId), []);
  const ctx = foldRightsFromLenses({ holonId, entries, policyEntries, membersLog, settings, users, attestations: attestationsFrom(dir || []) });
  const latest = pot ? latestRights(ctx.folded, pot.chainId, pot.address) : null;
  return {
    ...ctx,
    entries,
    pot,
    latest,
    signatures: latest ? rootSignatures(entries, latest.id) : [],
  };
}
