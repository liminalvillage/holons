// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A holon's rules, as signed records.
 *
 * A policy is itself an entry of the `_policy` log: an admin appends one per
 * lens, the newest by an admin-at-the-time wins, and a holon that never
 * wrote one behaves by `DEFAULT_POLICY`. Same event universe, different
 * validity functions — the rule is data the reader folds, not code.
 */

import { POLICY_LENS, isPolicy, type PolicyRecord } from './events.js';
import { byLogOrder, type AcceptedActors, type Appendable, type LogEvent, type Policy, type Role } from './types.js';

const ROLES: readonly Role[] = ['admin', 'member'];

/** Members act, admins attest, nothing needs a quorum, the first spend wins. */
export const DEFAULT_POLICY: Policy = Object.freeze({
  authors: ['admin', 'member'],
  attesters: ['admin'],
  quorum: 0,
  conflict: 'earliest',
}) as Policy;

const roles = (v: unknown, fallback: Role[]): Role[] => {
  if (!Array.isArray(v)) return [...fallback];
  const out = v.filter((r): r is Role => ROLES.includes(r as Role));
  return out.length ? [...new Set(out)] : [...fallback];
};

/** A complete policy from a partial one; unknown values fall back to the default. */
export function normalizePolicy(partial?: Partial<Policy> | null): Policy {
  const p = partial ?? {};
  const quorum = Number(p.quorum);
  return {
    authors: roles(p.authors, DEFAULT_POLICY.authors),
    attesters: roles(p.attesters, DEFAULT_POLICY.attesters),
    quorum: Number.isFinite(quorum) && quorum >= 0 ? Math.floor(quorum) : DEFAULT_POLICY.quorum,
    conflict: p.conflict === 'quorum' ? 'quorum' : 'earliest',
  };
}

/** The record an admin appends to `_policy` to set a lens's rule. */
export function policyRecord(lens: string, partial?: Partial<Policy> | null): Appendable<PolicyRecord> {
  return { item: { t: 'policy', lens: String(lens), ...normalizePolicy(partial) } };
}

/**
 * Fold `_policy` entries into one rule per lens: only an admin as of the
 * entry's time may set it, and the latest such entry wins.
 */
export function foldPolicies(entries: Iterable<LogEvent<unknown>>, actors: AcceptedActors): Map<string, Policy> {
  const out = new Map<string, Policy>();
  const ordered = [...entries].sort(byLogOrder);
  for (const e of ordered) {
    if (!isPolicy(e.item)) continue;
    if (actors.roleAt(e.pubkey, e.created_at) !== 'admin') continue;
    out.set(e.item.lens, normalizePolicy(e.item));
  }
  return out;
}

/** The rule for a lens, or the default. */
export function policyFor(policies: Map<string, Policy> | null | undefined, lens: string): Policy {
  return policies?.get(String(lens)) ?? { ...DEFAULT_POLICY };
}

export { POLICY_LENS };
