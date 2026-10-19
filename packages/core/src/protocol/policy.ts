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

/** Members act, admins attest, nothing needs a quorum, the first spend wins, nothing is imported. */
export const DEFAULT_POLICY: Policy = Object.freeze({
  authors: ['admin', 'member'],
  attesters: ['admin'],
  quorum: 0,
  conflict: 'earliest',
  partners: Object.freeze({}) as Record<string, string>,
}) as Policy;

/** The roles a policy may name, in the order a UI lists them. */
export const POLICY_ROLES: readonly Role[] = ROLES;

const HEX64 = /^[0-9a-f]{64}$/i;

/** Partner holon → genesis pubkey; a partner without a well-formed key is dropped. */
const partners = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [holon, key] of Object.entries(v as Record<string, unknown>)) {
    const h = String(holon).trim();
    if (h && typeof key === 'string' && HEX64.test(key)) out[h] = key.toLowerCase();
  }
  return out;
};

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
    partners: partners(p.partners),
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

/**
 * What a lens behaves by when no admin has set its rule. The fund logs are
 * the exception to "nothing needs a quorum": a claim, a give or a mint moves
 * value, so a member's word alone does not count — an attester's does (an
 * attester's own action self-attests, so a treasurer still works alone).
 */
export const LENS_DEFAULT_POLICIES: Readonly<Record<string, Partial<Policy>>> = Object.freeze({
  flow_claims: { quorum: 1 },
  flow_mints: { quorum: 1 },
  // An exit is the party's own word; being in need is a claim on the others.
  flow_exits: { quorum: 0 },
  flow_needs: { quorum: 1 },
});

/** The default rule for a lens: `DEFAULT_POLICY`, tightened for the lenses that move value. */
export function defaultPolicyFor(lens: string): Policy {
  return normalizePolicy(LENS_DEFAULT_POLICIES[String(lens)] ?? null);
}

/** The rule for a lens, or its default. */
export function policyFor(policies: Map<string, Policy> | null | undefined, lens: string): Policy {
  return policies?.get(String(lens)) ?? defaultPolicyFor(lens);
}

/** True when two rules would judge a log the same way. */
export function samePolicy(a: Partial<Policy> | null | undefined, b: Partial<Policy> | null | undefined): boolean {
  const x = normalizePolicy(a);
  const y = normalizePolicy(b);
  const same = (p: Role[], q: Role[]) => p.length === q.length && p.every((r) => q.includes(r));
  const px = Object.entries(x.partners).sort();
  const py = Object.entries(y.partners).sort();
  return (
    same(x.authors, y.authors) &&
    same(x.attesters, y.attesters) &&
    x.quorum === y.quorum &&
    x.conflict === y.conflict &&
    px.length === py.length &&
    px.every(([h, k], i) => py[i][0] === h && py[i][1] === k)
  );
}

export { POLICY_LENS };
