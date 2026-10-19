// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A holon's claims log, judged the way every board judges it — read off the
 * store in one call, for the surfaces that hold no board of their own.
 *
 * Folded twice: once for its shape (who drew what, uncapped), then again
 * under the ceilings that shape, the pot and the usage give
 * (`loadClaimCeilings`), so a claim past a right is held as `over` here as
 * it is everywhere else.
 *
 * Eventually consistent: a lens that has not arrived reads as empty.
 */

import { MEMBERS_LENS, POLICY_LENS, importPartnerLogs, lensContext, readMembersLog } from '../protocol/index.js';
import { SHIFT_IDENTITY_LENS, attestationsFrom } from '../shifts/wire.js';
import { claimHeadroom, type ClaimCeilings } from './ceiling.js';
import { loadClaimCeilings, type LoadClaimCeilingsOptions } from './ceiling-load.js';
import { FLOW_CLAIMS_LENS, claimTotalsOf, foldClaimsFromLenses, type ClaimsContext, type ClaimTotals, type RightsLookup } from './claims.js';

export interface JudgedClaims {
  ctx: ClaimsContext;
  ceilings: ClaimCeilings;
  /** Unit → pot. */
  pots: Record<string, number>;
  /** Units held in the holon's Pot: collected on chain, never through this log. */
  held: string[];
  truncated: boolean;
}

/** Everything `loadClaimCeilings` takes, except the fold it is handed here. */
export type LoadJudgedClaimsOptions = Omit<LoadClaimCeilingsOptions, 'claims'>;

/** Read and judge `holonId`'s `flow_claims` log. */
export async function loadJudgedClaims(holosphere: any, holonId: string, opts: LoadJudgedClaimsOptions = {}): Promise<JudgedClaims> {
  const holon = String(holonId ?? '');
  const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.then((v) => v ?? fallback).catch(() => fallback);
  // Pull the lens before reading the log off the local store.
  await quiet(holosphere.getAll(holon, FLOW_CLAIMS_LENS), []);
  const [entries, policyEntries, settings, users, dir] = await Promise.all([
    quiet<any[]>(Promise.resolve().then(() => holosphere.getLog(holon, FLOW_CLAIMS_LENS)), []),
    quiet<any[]>(Promise.resolve().then(() => holosphere.getLog(holon, POLICY_LENS)), []),
    quiet<any>(holosphere.get(holon, 'settings', holon), null),
    quiet<any[]>(holosphere.getAll(holon, 'users'), []),
    quiet<any[]>(Promise.resolve().then(() => holosphere.getAllGlobal(SHIFT_IDENTITY_LENS)), []),
  ]);
  await quiet(holosphere.getAll(holon, MEMBERS_LENS), []);
  const membersLog = await quiet(readMembersLog(holosphere, holon), []);
  const base = { holonId: holon, policyEntries, membersLog, settings, users, attestations: attestationsFrom(dir || []) };
  // The partners the policy pins claim in their own logs; read them by
  // their own rules, then fold them in under this holon's.
  const imports = await quiet(importPartnerLogs(holosphere, FLOW_CLAIMS_LENS, lensContext(base).policyFor(FLOW_CLAIMS_LENS)), []);

  const shape = foldClaimsFromLenses({ ...base, entries, imports });
  const loaded = await loadClaimCeilings(holosphere, holon, { ...opts, claims: shape.folded });
  const ctx = foldClaimsFromLenses({ ...base, entries, imports, rights: loaded.ceilings as RightsLookup });
  return { ctx, ceilings: loaded.ceilings, pots: loaded.pots, held: loaded.held, truncated: loaded.truncated };
}

export interface PartyStanding {
  unit: string;
  /** What the party may still claim; null when no ceiling is known. */
  headroom: number | null;
  totals: ClaimTotals;
}

/** One party's position in every unit the holon's fund or its log knows them in. */
export function partyStandings(judged: Pick<JudgedClaims, 'ctx' | 'ceilings'>, party: string): PartyStanding[] {
  const id = String(party ?? '');
  const units = new Set<string>([
    ...Object.keys(judged.ceilings[id] ?? {}),
    ...Object.keys(judged.ctx.folded.byParty[id] ?? {}),
  ]);
  return [...units].sort().map((unit) => ({
    unit,
    headroom: claimHeadroom(judged.ceilings, judged.ctx.folded, id, unit),
    totals: claimTotalsOf(judged.ctx.folded, id, unit),
  }));
}
