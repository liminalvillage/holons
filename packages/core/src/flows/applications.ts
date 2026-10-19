// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Applications — a party asking a fund to seat it, as signed, append-only
 * entries on the FUND's own `flow_applications` log.
 *
 *   apply     — "seat this party". The applicant's word. Anyone may ask: an
 *               applicant is by definition not a member of the fund yet, so
 *               this log does NOT run the usual author rule.
 *   withdraw  — the applicant takes it back (signed by the same key, or by
 *               another key that speaks for the party).
 *   verdict   — an ADMIN of the fund attests (approved) or disputes
 *               (declined, with a reason). The latest admin word counts.
 *
 * Asking costs nothing and binds nobody: an application moves no value. What
 * moves value is the admin's own act of placing the party on a ring
 * (`approveApplication`), and that is guarded like every settings write.
 *
 * A key can ask for any party, so each entry says whether its signer was
 * seen to speak for the party (`verified`). An unverified ask is still
 * shown — the admin decides — because the worst a forged one can do is get
 * a party paid that did not ask.
 *
 * Only a party's LATEST ask counts: asking again after a decline reopens it.
 *
 * Pure: entries in, applications out. Reading and writing is
 * `applications-load.ts`.
 */

import {
  action,
  attestation,
  attestationTarget,
  attestationVerdict,
  isAction,
  isAttestation,
  type AcceptedActors,
  type Appendable,
  type AttestationRecord,
  type LogEvent,
} from '../protocol/index.js';
import { byLogOrder } from '../protocol/types.js';
import { lunationAt } from './lunation.js';

/** The append-only lens applications live in, on the fund. */
export const FLOW_APPLICATIONS_LENS = 'flow_applications';

export const APPLICATION_NOTE_MAX = 500;

export interface ApplyBody {
  t: 'action';
  kind: 'apply';
  /** The party asking to be seated: a holon id or a person's id. */
  party: string;
  /** How the party would like to be called, when the fund cannot know. */
  name?: string;
  note?: string;
  /** The lunar cycle it was asked in (`lunationAt().index`). */
  epoch: number;
}

export interface WithdrawBody {
  t: 'action';
  kind: 'withdraw';
  party: string;
}

export type ApplicationStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

export interface Application {
  /** The `apply` entry. */
  id: string;
  party: string;
  name?: string;
  note?: string;
  epoch: number;
  /** Unix seconds. */
  createdAt: number;
  pubkey: string;
  /** The signer was seen to speak for the party. */
  verified: boolean;
  status: ApplicationStatus;
  /** The admin's reason, when declined. */
  reason?: string;
  /** When the status was last set (unix seconds): the verdict or the withdrawal. */
  decidedAt?: number;
  /** The admin key that decided. */
  decidedBy?: string;
}

export interface FoldedApplications {
  /** Each party's latest application, newest first. */
  applications: Application[];
  /** Party → its latest application. */
  byParty: Record<string, Application>;
  pending: Application[];
}

const clip = (raw: unknown, max: number): string | undefined => {
  const s = String(raw ?? '').trim().slice(0, max);
  return s || undefined;
};

/** The `apply` action a party appends to the fund's log. */
export function buildApplication(input: { party: string; name?: string; note?: string; at?: number }): Appendable<ApplyBody> {
  const party = String(input.party ?? '').trim();
  if (!party) throw new Error('An application names the party asking');
  const body: Omit<ApplyBody, 't' | 'kind'> = {
    party,
    ...(clip(input.name, 120) ? { name: clip(input.name, 120) } : {}),
    ...(clip(input.note, APPLICATION_NOTE_MAX) ? { note: clip(input.note, APPLICATION_NOTE_MAX) } : {}),
    epoch: lunationAt(input.at ?? Date.now()).index,
  };
  return action('apply', body as Record<string, unknown>) as unknown as Appendable<ApplyBody>;
}

/** The `withdraw` a party appends to take its application back. */
export function buildWithdrawal(input: { applicationId: string; party: string }): Appendable<WithdrawBody> {
  const party = String(input.party ?? '').trim();
  if (!party || !input.applicationId) throw new Error('A withdrawal names the application and its party');
  return action('withdraw', { party }, { basis: [input.applicationId] }) as unknown as Appendable<WithdrawBody>;
}

/** An admin's word on an application. */
export function buildApplicationVerdict(applicationId: string, verdict: 'attest' | 'dispute', reason?: string): Appendable<AttestationRecord> {
  return attestation(applicationId, verdict, clip(reason, APPLICATION_NOTE_MAX));
}

export const isApplication = (item: unknown): item is ApplyBody => isAction(item) && item.kind === 'apply';
export const isWithdrawal = (item: unknown): item is WithdrawBody => isAction(item) && item.kind === 'withdraw';

export interface FoldApplicationsInput {
  entries: Iterable<LogEvent<unknown>>;
  /** The FUND's accepted signers: only its admins decide. */
  actors: AcceptedActors | null | undefined;
  /** Does this key speak for this party? Absent: nobody is verified. */
  actsFor?: (pubkey: string, party: string, at: number) => boolean;
}

/** Fold the `flow_applications` log into each party's standing with the fund. */
export function foldApplications(input: FoldApplicationsInput): FoldedApplications {
  const ordered = [...input.entries].sort(byLogOrder);
  const actsFor = (pubkey: string, party: string, at: number) => {
    try {
      return !!input.actsFor?.(pubkey, party, at);
    } catch {
      return false;
    }
  };
  const isAdmin = (e: LogEvent<unknown>) => input.actors?.roleAt(e.pubkey, e.created_at) === 'admin';

  // Each party's latest ask.
  const latest = new Map<string, LogEvent<ApplyBody>>();
  const byId = new Map<string, LogEvent<ApplyBody>>();
  for (const e of ordered) {
    if (!isApplication(e.item)) continue;
    const party = String(e.item.party ?? '').trim();
    if (!party) continue;
    latest.set(party, e as LogEvent<ApplyBody>);
    byId.set(e.id, e as LogEvent<ApplyBody>);
  }

  const out = new Map<string, Application>();
  for (const [party, e] of latest) {
    out.set(e.id, {
      id: e.id,
      party,
      ...(clip(e.item.name, 120) ? { name: clip(e.item.name, 120) } : {}),
      ...(clip(e.item.note, APPLICATION_NOTE_MAX) ? { note: clip(e.item.note, APPLICATION_NOTE_MAX) } : {}),
      epoch: Number(e.item.epoch) || 0,
      createdAt: e.created_at,
      pubkey: e.pubkey,
      verified: actsFor(e.pubkey, party, e.created_at),
      status: 'pending',
    });
  }

  // Then every word said about a latest ask, in log order: the last one stands.
  for (const e of ordered) {
    if (isWithdrawal(e.item)) {
      const target = out.get(e.refs.basis[0] ?? '');
      if (!target || String(e.item.party ?? '').trim() !== target.party) continue;
      const own = e.pubkey === target.pubkey || actsFor(e.pubkey, target.party, e.created_at);
      if (!own || e.created_at < target.createdAt) continue;
      target.status = 'withdrawn';
      target.decidedAt = e.created_at;
      delete target.reason;
      delete target.decidedBy;
      continue;
    }
    if (!isAttestation(e.item)) continue;
    const target = out.get(attestationTarget(e) ?? '');
    // A withdrawn ask is closed: the applicant must ask again.
    if (!target || target.status === 'withdrawn' || !isAdmin(e)) continue;
    const verdict = attestationVerdict(e);
    if (!verdict) continue;
    target.status = verdict === 'attest' ? 'approved' : 'declined';
    target.decidedAt = e.created_at;
    target.decidedBy = e.pubkey;
    if (verdict === 'dispute' && clip(e.item.reason, APPLICATION_NOTE_MAX)) target.reason = clip(e.item.reason, APPLICATION_NOTE_MAX);
    else delete target.reason;
  }

  const applications = [...out.values()].sort((a, z) => z.createdAt - a.createdAt || (a.id < z.id ? -1 : 1));
  return {
    applications,
    byParty: Object.fromEntries(applications.map((a) => [a.party, a])),
    pending: applications.filter((a) => a.status === 'pending'),
  };
}
