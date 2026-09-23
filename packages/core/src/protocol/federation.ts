// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Federation over the log: importing a partner's accepted entries.
 *
 * Two holons share the one event space but derive their own realities. A
 * partner's log is readable by anyone (its `h` tag names the partner); what
 * this module decides is which of those entries a holon lets into its own
 * fold, and as whom:
 *
 *   1. trust is data — the importer's policy pins the partner's genesis
 *      pubkey (`policy.partners[holon]`, an admin-signed `_policy` entry).
 *      A partner whose membership log was not founded by that key folds
 *      with the pinned key alone, and the result says so (`bootstrap`);
 *   2. the partner's own rules decide what it ACCEPTED — its signers as of
 *      each entry's time, its policy for the lens (`importPartnerLog`);
 *   3. the importer re-judges those entries under ITS OWN policy, together
 *      with its own log, in one deterministic collapse — every partner key
 *      counts as a `member` acting for the partner holon, never as an
 *      attester of the importer's entries (`federatedActors`).
 *
 * Nothing is copied: the partner's entries keep their ids, so a checkpoint
 * over the importer's accepted set covers them, and two importers with the
 * same pins and the same entries derive the same state.
 */

import type { HoloSphere } from 'holosphere';
import { MEMBERS_LENS, POLICY_LENS } from './events.js';
import { bootstrapActors, readMembersLog, resolveAcceptedActors, type MembershipEnvelope } from './membership.js';
import { foldPolicies, normalizePolicy, policyFor } from './policy.js';
import { collapse } from './reduce.js';
import type { AcceptedActors, LogEvent, Policy, Role } from './types.js';

/** A partner's log as read from the relays, with the key the importer pinned. */
export interface PartnerLog {
  /** The partner holon id. */
  holon: string;
  /** The genesis pubkey the importer's policy pins for this partner. */
  genesis: string;
  /** The partner's entries of the imported lens. */
  entries: Iterable<LogEvent<unknown>>;
  /** The partner's signed `_members` envelopes, when it is founded. */
  membersLog?: MembershipEnvelope[] | null;
  /** The partner's `_policy` log. */
  policyEntries?: Iterable<LogEvent<unknown>> | null;
}

/** What a partner accepted, by its own rules. */
export interface PartnerImport {
  holon: string;
  genesis: string;
  /** The partner's signers, as of time when its log is founded by the pinned key. */
  actors: AcceptedActors;
  /** The partner's rule for the lens. */
  policy: Policy;
  /** The entries the partner's own fold accepts, in log order. */
  accepted: LogEvent<unknown>[];
  pending: number;
  rejected: number;
  /** `log` when the partner's membership log is founded by the pinned key; `bootstrap` when only that key counts. */
  source: AcceptedActors['source'];
}

/**
 * The partner's own reduce over its log of `lens`: its signers (the pinned
 * genesis, its membership log), its policy, no domain rule — what the
 * partner itself would call accepted. The domain's own validation runs on
 * the importer's side, over the merged log.
 */
export function importPartnerLog(partner: PartnerLog, lens: string): PartnerImport {
  const genesis = String(partner.genesis).toLowerCase();
  const actors = resolveAcceptedActors({
    membersLog: partner.membersLog,
    genesis,
    bootstrap: { members: [genesis], admins: [genesis], genesis },
  });
  const policy = policyFor(foldPolicies(partner.policyEntries ?? [], actors), lens);
  const result = collapse<unknown, null>({
    entries: partner.entries,
    actors,
    policy,
    initial: null,
    fold: (s) => s,
  });
  return {
    holon: String(partner.holon),
    genesis,
    actors,
    policy,
    accepted: result.accepted,
    pending: result.pending.length,
    rejected: result.rejected.length,
    source: actors.source,
  };
}

/** The importer's signers, extended with every partner's — and which partner a key acts for. */
export interface FederatedActors extends AcceptedActors {
  /** The partner holon a key counts through, or null when it is the importer's own signer (or nobody's). */
  originOf(pubkey: string, at: number): string | null;
  /** The partners folded in, in policy order. */
  partners: readonly string[];
}

/**
 * One signer set over the importer's own actors and its partners': the
 * importer's word wins for a key it knows; a key a partner accepts counts as
 * a `member` acting for that partner — a partner admin does not attest the
 * importer's entries, whatever the importer's policy names as attesters.
 */
export function federatedActors(own: AcceptedActors, imports: Iterable<Pick<PartnerImport, 'holon' | 'actors'>>): FederatedActors {
  const partners = [...imports].map((p) => ({ holon: String(p.holon), actors: p.actors }));
  const originOf = (pubkey: string, at: number): string | null => {
    if (own.isAcceptedAt(pubkey, at)) return null;
    for (const p of partners) if (p.actors.isAcceptedAt(pubkey, at)) return p.holon;
    return null;
  };
  return {
    source: own.source,
    genesis: own.genesis,
    partners: partners.map((p) => p.holon),
    isAcceptedAt: (pubkey, at) => own.isAcceptedAt(pubkey, at) || originOf(pubkey, at) !== null,
    roleAt: (pubkey, at): Role | null => {
      if (own.isAcceptedAt(pubkey, at)) return own.roleAt(pubkey, at);
      return originOf(pubkey, at) ? 'member' : null;
    },
    originOf,
  };
}

/** The partners a policy pins, as `[holon, genesis]` pairs. */
export function pinnedPartners(policy: Partial<Policy> | null | undefined): Array<[string, string]> {
  return Object.entries(normalizePolicy(policy).partners);
}

/**
 * Read every pinned partner's log of `lens` from the instance (the relays
 * are caught up per holon and lens on the way). A partner that cannot be
 * read folds as an empty log rather than failing the importer's fold.
 */
export async function readPartnerLogs(
  hs: HoloSphere,
  lens: string,
  partners: Iterable<readonly [string, string]>,
): Promise<PartnerLog[]> {
  const out: PartnerLog[] = [];
  for (const [holon, genesis] of partners) {
    const h = String(holon);
    let entries: LogEvent<unknown>[] = [];
    let policyEntries: LogEvent<unknown>[] = [];
    let membersLog: MembershipEnvelope[] = [];
    try {
      entries = (await hs.getLog(h, lens)) as LogEvent<unknown>[];
    } catch {
      entries = [];
    }
    try {
      policyEntries = (await hs.getLog(h, POLICY_LENS)) as LogEvent<unknown>[];
    } catch {
      policyEntries = [];
    }
    try {
      await hs.getAll(h, MEMBERS_LENS);
      membersLog = await readMembersLog(hs, h);
    } catch {
      membersLog = [];
    }
    out.push({ holon: h, genesis: String(genesis), entries, policyEntries, membersLog });
  }
  return out;
}

/** Import every pinned partner's log: read (`readPartnerLogs`) then judge (`importPartnerLog`). */
export async function importPartnerLogs(hs: HoloSphere, lens: string, policy: Partial<Policy> | null | undefined): Promise<PartnerImport[]> {
  const logs = await readPartnerLogs(hs, lens, pinnedPartners(policy));
  return logs.map((p) => importPartnerLog(p, lens));
}

/** A time-blind partner from a bare key, for callers without its membership log. */
export function partnerFromKey(holon: string, genesis: string): Pick<PartnerImport, 'holon' | 'actors'> {
  const g = String(genesis).toLowerCase();
  return { holon: String(holon), actors: bootstrapActors({ members: [g], admins: [g], genesis: g }) };
}
