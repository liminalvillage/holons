// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Project claims against the store: reading a seating holon's
 * `flow_project_claims` log, asking, taking back, and the master keys' two
 * answers.
 *
 * Approving is four writes, in the order that leaves the least behind if
 * one fails: seat the claimant's key as an admin of the project, mark the
 * seat claimed in place on the seating holon, consume the project's claim
 * codes (nobody else may now take it by code), then say so on the log. Each
 * is skipped when it already holds, so approving twice — or after a failed
 * step — is safe.
 *
 * The approver must be an admin of BOTH holons: of the seating one to
 * answer, of the project to seat anyone in it. The importer seats its
 * `--admins` as admins of everything it founds, which is what makes them
 * master keys.
 *
 * Eventually consistent: a lens that has not arrived reads as empty.
 */

import { isHolonAdmin, resolveHolonAuthority } from '../holosphere/authority.js';
import { syncMembersLog } from '../protocol/index.js';
import {
  FLOW_PROJECT_CLAIMS_LENS,
  buildProjectClaim,
  buildProjectClaimVerdict,
  buildProjectClaimWithdrawal,
  foldProjectClaims,
  type BuildProjectClaimInput,
  type FoldedProjectClaims,
  type ProjectClaim,
} from './project-claims.js';
import {
  parseSeatClaim,
  readAllocationAliases,
  readAllocationBuckets,
  readAllocationClaimWindow,
  readAllocationClaimed,
  readAllocationCodes,
  readInteriorShares,
  readZoneAssignments,
  saveAllocationClaimed,
  saveAllocationCodes,
} from './settings.js';

const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.then((v) => v ?? fallback).catch(() => fallback);

/** Where a project stands in the holon that seats it. */
export type ProjectSeatState = 'open' | 'claimed' | 'closed' | 'unseated';

export interface ProjectClaimsContext extends FoldedProjectClaims {
  /** Project → how its seat here stands, for every project this holon seats. */
  seats: Record<string, ProjectSeatState>;
}

/** Does this key speak for this party, as far as this instance can see? */
function speaksFor(holosphere: any) {
  const cache = new Map<string, ReturnType<typeof resolveHolonAuthority>['actors']>();
  return (pubkey: string, party: string, at: number): boolean => {
    const key = String(pubkey).toLowerCase();
    if (key === String(party).toLowerCase()) return true;
    if (!cache.has(party)) cache.set(party, resolveHolonAuthority(holosphere, party).actors);
    return !!cache.get(party)?.isAcceptedAt(key, at);
  };
}

/** Every seat a holon's split names, and how each stands: claimed (aliased or in place), closed (the window lapsed), or open. */
export function projectSeats(settings: unknown, now = Date.now()): Record<string, ProjectSeatState> {
  const buckets = readAllocationBuckets(settings);
  const seats = new Set<string>(Object.keys(readZoneAssignments(settings)));
  if (buckets.length) for (const b of buckets) for (const id of Object.keys(b.shares ?? {})) seats.add(id);
  else for (const id of Object.keys(readInteriorShares(settings))) seats.add(id);
  const aliases = readAllocationAliases(settings);
  const claimed = new Set(readAllocationClaimed(settings));
  const window = readAllocationClaimWindow(settings);
  const keep = new Set(window?.keep ?? []);
  const closed = !!window && window.until > 0 && now >= window.until;
  const out: Record<string, ProjectSeatState> = {};
  for (const id of seats) {
    if (keep.has(id)) continue; // a fund stands without a claim: nothing to claim
    out[id] = aliases[id] || claimed.has(id) ? 'claimed' : closed ? 'closed' : 'open';
  }
  return out;
}

/** A seating holon's project claims, folded, and how each of its seats stands. */
export async function loadProjectClaims(holosphere: any, holderId: string, opts: { now?: number } = {}): Promise<ProjectClaimsContext> {
  const holder = String(holderId ?? '');
  // Pull the lens before reading the log off the local store.
  await quiet(holosphere.getAll(holder, FLOW_PROJECT_CLAIMS_LENS), []);
  const [entries, settings] = await Promise.all([
    quiet<any[]>(Promise.resolve().then(() => holosphere.getLog(holder, FLOW_PROJECT_CLAIMS_LENS)), []),
    quiet<any>(holosphere.get(holder, 'settings', holder), null),
  ]);
  const folded = foldProjectClaims({
    entries,
    actors: resolveHolonAuthority(holosphere, holder).actors,
    actsFor: speaksFor(holosphere),
  });
  return { ...folded, seats: projectSeats(settings, opts.now) };
}

/**
 * Ask to take over `input.project`, seated in `holderId`. Refused when the
 * holon does not seat it, when it is already claimed or its window closed,
 * and when this party already has a request waiting for it.
 */
export async function requestProjectClaim(
  holosphere: any,
  holderId: string,
  input: Omit<BuildProjectClaimInput, 'at'>,
  opts: { now?: number } = {},
): Promise<{ id: string }> {
  const holder = String(holderId ?? '');
  const project = String(input.project ?? '').trim();
  const party = String(input.party ?? '').trim();
  if (!holder || !project || !party) throw new Error('A project claim names the holon, the project and who asks');
  const ctx = await loadProjectClaims(holosphere, holder, opts);
  const seat = ctx.seats[project];
  if (!seat) throw new Error('This holon does not seat that project');
  if (seat === 'claimed' || ctx.approved[project]) throw new Error('That project is already claimed');
  if (seat === 'closed') throw new Error('The claim window for that project has closed');
  if (ctx.pending.some((c) => c.project === project && c.party === party)) throw new Error('A claim is already waiting');
  const c = buildProjectClaim({ ...input, project, party });
  const event = await holosphere.append(holder, FLOW_PROJECT_CLAIMS_LENS, c.item, { refs: c.refs });
  return { id: event.id };
}

/** Take a waiting request back. */
export async function withdrawProjectClaim(holosphere: any, holderId: string, claimId: string): Promise<{ id: string }> {
  const ctx = await loadProjectClaims(holosphere, holderId);
  const open = ctx.claims.find((c) => c.id === claimId);
  if (!open || open.status !== 'pending') throw new Error('There is no waiting claim to take back');
  const w = buildProjectClaimWithdrawal({ claimId: open.id, party: open.party });
  const event = await holosphere.append(String(holderId), FLOW_PROJECT_CLAIMS_LENS, w.item, { refs: w.refs });
  return { id: event.id };
}

async function decidable(holosphere: any, holderId: string, claimId: string): Promise<ProjectClaim> {
  if (!(await isHolonAdmin(holosphere, holderId))) throw new Error('Only an admin of the holon answers its project claims');
  const ctx = await loadProjectClaims(holosphere, holderId);
  const found = ctx.claims.find((c) => c.id === claimId);
  if (!found) throw new Error('That claim is not on this holon');
  if (found.status === 'withdrawn') throw new Error('That claim was taken back');
  return found;
}

export interface ApprovedProjectClaim {
  project: string;
  /** The key now seated as the project's admin. */
  key: string;
  /** The key was seated by this call (false: it already was). */
  seated: boolean;
  /** Claim codes this call consumed. */
  codes: number;
}

/**
 * Approve: seat the claimant's key as an admin of the project, mark the seat
 * claimed in place, consume the project's claim codes, and attest the claim.
 */
export async function approveProjectClaim(holosphere: any, holderId: string, claimId: string): Promise<ApprovedProjectClaim> {
  const holder = String(holderId ?? '');
  const claim = await decidable(holosphere, holder, claimId);
  const project = claim.project;
  const key = claim.pubkey.toLowerCase();
  if (!(await isHolonAdmin(holosphere, project))) throw new Error('This key is not an admin of the project, so it cannot seat anyone in it');

  // Never found the project here: a holon nobody founded reads unenforced,
  // and a genesis planted by this key would compete with the importer's.
  const sync = await syncMembersLog(holosphere, project, new Map([[key, 'admin']]), { prune: false, founding: false });
  const seated = sync.added.includes(key) || sync.changed.includes(key);
  holosphere._readAuthority?.invalidate?.(project);
  if ((await holosphere.getMembers(project)).get(key) !== 'admin') throw new Error('The project has no member log to seat the claimant in');

  const holderSettings = await quiet<any>(holosphere.get(holder, 'settings', holder), null);
  if (!readAllocationClaimed(holderSettings).includes(project)) await saveAllocationClaimed(holosphere, holder, project);

  // A code is a second door into the same seat: close it.
  let codes = 0;
  const consume = async (holon: string, claims: (target: string) => boolean) => {
    const settings = await quiet<any>(holosphere.get(holon, 'settings', holon), null);
    const patch: Record<string, null> = {};
    for (const [hash, target] of Object.entries(readAllocationCodes(settings))) if (claims(target)) patch[hash] = null;
    if (!Object.keys(patch).length) return;
    await saveAllocationCodes(holosphere, holon, patch);
    codes += Object.keys(patch).length;
  };
  await consume(project, (target) => parseSeatClaim(target) === holder);
  await consume(holder, (target) => target === project);

  if (claim.status !== 'approved') {
    const v = buildProjectClaimVerdict(claim.id, 'attest');
    await holosphere.append(holder, FLOW_PROJECT_CLAIMS_LENS, v.item, { refs: v.refs });
  }
  return { project, key, seated, codes };
}

/** Decline, with the reason the claimant will read. Seats nobody. */
export async function declineProjectClaim(holosphere: any, holderId: string, claimId: string, reason: string): Promise<{ id: string }> {
  const why = String(reason ?? '').trim();
  if (!why) throw new Error('A decline says why');
  const claim = await decidable(holosphere, String(holderId), claimId);
  const v = buildProjectClaimVerdict(claim.id, 'dispute', why);
  const event = await holosphere.append(String(holderId), FLOW_PROJECT_CLAIMS_LENS, v.item, { refs: v.refs });
  return { id: event.id };
}
