// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The reduce: from a log of signed entries to one holon's reality.
 *
 *     verified entries              (holosphere: signature checked on apply)
 *       ∩ accepted signers, as of each entry's time     (AcceptedActors)
 *       ∩ the lens's rule                               (Policy)
 *       → attestations counted, disputes honoured
 *       → chains checked (`prev`), consumption checked (`basis`)
 *       → the domain's own validation, over the running state
 *       → fold
 *
 * Deterministic and order-free: entries are sorted by (created_at, id)
 * first, so two readers holding the same set derive the same state and the
 * same accepted list — which is what a checkpoint compares. Nothing is
 * deleted: an entry that does not count is reported with why, so a UI can
 * show it as pending, and it counts retroactively the moment the reason
 * goes away (a key added, a quorum reached, a dispute withdrawn).
 *
 * Nostr gives no order and no double-spend protection. The rules here are
 * the ones a holon's bookkeeping needs — a spend names what it consumes, a
 * second consumer is a conflict, the policy says whether the first wins or a
 * human decides — not a global consensus. Scarce assets settle elsewhere.
 */

import { attestationTarget, isAttestation } from './events.js';
import { normalizePolicy } from './policy.js';
import { byLogOrder, type AcceptedActors, type LogEvent, type Policy } from './types.js';

export type RejectReason = 'unaccepted-signer' | 'role' | 'fork' | 'double-consume' | 'invalid';
export type HoldReason = 'quorum' | 'disputed' | 'conflict' | 'held';
export type EntryStatus = 'accepted' | 'pending' | 'rejected';

/** What a domain's `validate` may say about an entry. */
export interface Verdict {
  status: 'pending' | 'rejected';
  /** In the domain's words (`over-right`, `unknown-party` …). */
  reason: string;
}

export interface Judged<T> {
  entry: LogEvent<T>;
  status: EntryStatus;
  reason: RejectReason | HoldReason | null;
  /** The domain's reason, when `validate` decided. */
  detail?: string;
  /** Attesters (as of their attestation's time) whose latest word is attest / dispute. */
  attests: number;
  disputes: number;
}

export interface CollapseInput<T, S> {
  entries: Iterable<LogEvent<T>>;
  actors: AcceptedActors;
  policy?: Partial<Policy> | null;
  initial: S;
  /** Fold one accepted action into the state. Pure. */
  fold: (state: S, entry: LogEvent<T>) => S;
  /**
   * The domain's rule, seen with the state folded so far. A string is a
   * rejection reason; a `Verdict` chooses pending vs rejected; nothing means
   * the entry is fine.
   */
  validate?: (entry: LogEvent<T>, state: S) => Verdict | string | null | undefined;
}

export interface CollapseResult<T, S> {
  state: S;
  source: AcceptedActors['source'];
  policy: Policy;
  /** The actions that count, in log order. */
  accepted: LogEvent<T>[];
  pending: Judged<T>[];
  rejected: Judged<T>[];
  /** Every action's verdict by id. Attestations are not judged: they judge. */
  judged: Map<string, Judged<T>>;
}

export function collapse<T, S>(input: CollapseInput<T, S>): CollapseResult<T, S> {
  const policy = normalizePolicy(input.policy);
  const actors = input.actors;
  const authorRoles = new Set(policy.authors);
  const attesterRoles = new Set(policy.attesters);
  const ordered = [...input.entries].sort(byLogOrder);

  // Attestations first: the latest word of each accepted attester on each target.
  const verdicts = new Map<string, Map<string, 'attest' | 'dispute'>>();
  const actions: LogEvent<T>[] = [];
  for (const e of ordered) {
    if (!isAttestation(e.item)) {
      actions.push(e);
      continue;
    }
    const target = attestationTarget(e);
    if (!target) continue;
    const role = actors.isAcceptedAt(e.pubkey, e.created_at) ? actors.roleAt(e.pubkey, e.created_at) : null;
    if (!role || !attesterRoles.has(role)) continue;
    let byAttester = verdicts.get(target);
    if (!byAttester) verdicts.set(target, (byAttester = new Map()));
    byAttester.set(e.pubkey, e.item.verdict);
  }
  const tally = (id: string) => {
    let attests = 0;
    let disputes = 0;
    for (const v of verdicts.get(id)?.values() ?? []) {
      if (v === 'attest') attests++;
      else disputes++;
    }
    return { attests, disputes };
  };

  let state = input.initial;
  const consumed = new Set<string>();
  const heads = new Map<string, string>();
  const accepted: LogEvent<T>[] = [];
  const pending: Judged<T>[] = [];
  const rejected: Judged<T>[] = [];
  const judged = new Map<string, Judged<T>>();
  const judge = (entry: LogEvent<T>, status: EntryStatus, reason: Judged<T>['reason'], detail?: string) => {
    const counts = tally(entry.id);
    const role = actors.roleAt(entry.pubkey, entry.created_at);
    if (role && attesterRoles.has(role) && !verdicts.get(entry.id)?.has(entry.pubkey)) counts.attests++;
    const j: Judged<T> = { entry, status, reason, ...(detail ? { detail } : {}), ...counts };
    judged.set(entry.id, j);
    if (status === 'pending') pending.push(j);
    else if (status === 'rejected') rejected.push(j);
    return j;
  };

  for (const e of actions) {
    if (!actors.isAcceptedAt(e.pubkey, e.created_at)) {
      judge(e, 'rejected', 'unaccepted-signer');
      continue;
    }
    const role = actors.roleAt(e.pubkey, e.created_at);
    if (!role || !authorRoles.has(role)) {
      judge(e, 'rejected', 'role');
      continue;
    }
    // A chained entry must follow the author's last entry that counted or is
    // still held; anything else is a second branch, and history is not
    // rewritten by branching from it.
    if (e.refs.prev.length && e.refs.prev[0] !== (heads.get(e.pubkey) ?? null)) {
      judge(e, 'rejected', 'fork');
      continue;
    }

    let status: EntryStatus = 'accepted';
    let reason: Judged<T>['reason'] = null;
    let detail: string | undefined;
    const v = input.validate?.(e, state);
    if (v) {
      const verdict: Verdict = typeof v === 'string' ? { status: 'rejected', reason: v } : v;
      status = verdict.status;
      reason = verdict.status === 'rejected' ? 'invalid' : 'held';
      detail = verdict.reason;
    } else {
      let { attests, disputes } = tally(e.id);
      // An attester's signature on their own action is their attestation of
      // it: a treasurer's payout under quorum 1 needs nobody else, a member's
      // claim still does. An explicit later word from them replaces it.
      if (attesterRoles.has(role) && !verdicts.get(e.id)?.has(e.pubkey)) attests++;
      if (disputes > 0) {
        status = 'pending';
        reason = 'disputed';
      } else if (attests < policy.quorum) {
        status = 'pending';
        reason = 'quorum';
      }
    }
    if (status === 'accepted' && e.refs.basis.some((b) => consumed.has(b))) {
      if (policy.conflict === 'earliest') {
        status = 'rejected';
        reason = 'double-consume';
      } else {
        status = 'pending';
        reason = 'conflict';
      }
    }
    if (status !== 'rejected') heads.set(e.pubkey, e.id);
    judge(e, status, reason, detail);
    if (status !== 'accepted') continue;
    for (const b of e.refs.basis) consumed.add(b);
    state = input.fold(state, e);
    accepted.push(e);
  }

  return { state, source: actors.source, policy, accepted, pending, rejected, judged };
}
