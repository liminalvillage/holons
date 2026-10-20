// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Project claims — a person asking to take over a project the importer
 * seated, as signed, append-only entries on the log of the holon that SEATS
 * the project (the Pot, or a fund): `flow_project_claims`.
 *
 * The Telegram path claims a project with a code (`/claimproject`). This one
 * needs no code: someone presses "Claim this project", says who they are and
 * points at public evidence, and the onboarding team — the seating holon's
 * admins, the master keys — checks it and answers.
 *
 *   request   — "I speak for this project". The claimant's word, signed by
 *               the key that will be seated. Anyone may ask: a claimant is
 *               by definition not a member yet, so this log does NOT run the
 *               usual author rule (as `applications.ts`).
 *   withdraw  — the claimant takes it back (the same key, or one that speaks
 *               for the party).
 *   verdict   — an ADMIN of the seating holon attests (approved) or disputes
 *               (declined, with a reason). The latest admin word counts.
 *
 * Asking moves nothing. What hands the project over is the admin's own act
 * (`approveProjectClaim`): the SIGNER of the request is seated as an admin
 * of the project holon and the seat is marked claimed in place, so it
 * stands past the claim window. The key seated is always the one that
 * signed — a request cannot name someone else's key into a project.
 *
 * Everything on the log is public: evidence is a link anyone may follow,
 * never a phone number or an address.
 *
 * Only a claimant's LATEST request per project counts: asking again after a
 * decline reopens it.
 *
 * Pure: entries in, claims out. Reading and writing is
 * `project-claims-load.ts`.
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

/** The append-only lens project claims live in, on the seating holon. */
export const FLOW_PROJECT_CLAIMS_LENS = 'flow_project_claims';

export const PROJECT_CLAIM_NOTE_MAX = 500;
export const PROJECT_CLAIM_EVIDENCE_MAX = 300;

export interface ProjectClaimRequestBody {
  t: 'action';
  kind: 'request';
  /** The project holon asked for. */
  project: string;
  /** Who asks: a person's id (a Telegram id, or a pubkey). */
  party: string;
  /** How the claimant would like to be called. */
  name?: string;
  /** Their role in the project, in their words. */
  role?: string;
  /** A public link the team can check: the project's site or a post from its account. */
  evidence?: string;
  note?: string;
  /** The lunar cycle it was asked in (`lunationAt().index`). */
  epoch: number;
}

export interface ProjectClaimWithdrawBody {
  t: 'action';
  kind: 'withdraw';
  party: string;
}

export type ProjectClaimStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

export interface ProjectClaim {
  /** The `request` entry. */
  id: string;
  project: string;
  party: string;
  name?: string;
  role?: string;
  evidence?: string;
  note?: string;
  epoch: number;
  /** Unix seconds. */
  createdAt: number;
  /** The signer: the key approval seats as the project's admin. */
  pubkey: string;
  /** The signer was seen to speak for the party. */
  verified: boolean;
  status: ProjectClaimStatus;
  /** The admin's reason, when declined. */
  reason?: string;
  /** When the status was last set (unix seconds). */
  decidedAt?: number;
  /** The admin key that decided. */
  decidedBy?: string;
}

export interface FoldedProjectClaims {
  /** Each claimant's latest request per project, newest first. */
  claims: ProjectClaim[];
  pending: ProjectClaim[];
  /** Project → the latest approved claim. */
  approved: Record<string, ProjectClaim>;
}

const clip = (raw: unknown, max: number): string | undefined => {
  const s = String(raw ?? '').trim().slice(0, max);
  return s || undefined;
};

/** A link the team can open, or nothing: only http(s). */
export function cleanEvidence(raw: unknown): string | undefined {
  const s = clip(raw, PROJECT_CLAIM_EVIDENCE_MAX);
  if (!s) return undefined;
  try {
    const url = new URL(s);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export interface BuildProjectClaimInput {
  project: string;
  party: string;
  name?: string;
  role?: string;
  evidence?: string;
  note?: string;
  at?: number;
}

/** The `request` a claimant appends to the seating holon's log. */
export function buildProjectClaim(input: BuildProjectClaimInput): Appendable<ProjectClaimRequestBody> {
  const project = String(input.project ?? '').trim();
  const party = String(input.party ?? '').trim();
  if (!project || !party) throw new Error('A project claim names the project and who asks');
  if (project === party) throw new Error('A project does not claim itself');
  if (input.evidence != null && String(input.evidence).trim() && !cleanEvidence(input.evidence)) throw new Error('Evidence is a web link');
  const evidence = cleanEvidence(input.evidence);
  const body: Omit<ProjectClaimRequestBody, 't' | 'kind'> = {
    project,
    party,
    ...(clip(input.name, 120) ? { name: clip(input.name, 120) } : {}),
    ...(clip(input.role, 120) ? { role: clip(input.role, 120) } : {}),
    ...(evidence ? { evidence } : {}),
    ...(clip(input.note, PROJECT_CLAIM_NOTE_MAX) ? { note: clip(input.note, PROJECT_CLAIM_NOTE_MAX) } : {}),
    epoch: lunationAt(input.at ?? Date.now()).index,
  };
  return action('request', body as Record<string, unknown>) as unknown as Appendable<ProjectClaimRequestBody>;
}

/** The `withdraw` a claimant appends to take a request back. */
export function buildProjectClaimWithdrawal(input: { claimId: string; party: string }): Appendable<ProjectClaimWithdrawBody> {
  const party = String(input.party ?? '').trim();
  if (!party || !input.claimId) throw new Error('A withdrawal names the claim and its party');
  return action('withdraw', { party }, { basis: [input.claimId] }) as unknown as Appendable<ProjectClaimWithdrawBody>;
}

/** An admin's word on a claim. */
export function buildProjectClaimVerdict(claimId: string, verdict: 'attest' | 'dispute', reason?: string): Appendable<AttestationRecord> {
  return attestation(claimId, verdict, clip(reason, PROJECT_CLAIM_NOTE_MAX));
}

export const isProjectClaimRequest = (item: unknown): item is ProjectClaimRequestBody => isAction(item) && item.kind === 'request';
export const isProjectClaimWithdrawal = (item: unknown): item is ProjectClaimWithdrawBody => isAction(item) && item.kind === 'withdraw';

export interface FoldProjectClaimsInput {
  entries: Iterable<LogEvent<unknown>>;
  /** The SEATING holon's accepted signers: only its admins decide. */
  actors: AcceptedActors | null | undefined;
  /** Does this key speak for this party? Absent: nobody is verified. */
  actsFor?: (pubkey: string, party: string, at: number) => boolean;
}

/** Fold the `flow_project_claims` log into each claimant's standing per project. */
export function foldProjectClaims(input: FoldProjectClaimsInput): FoldedProjectClaims {
  const ordered = [...input.entries].sort(byLogOrder);
  const actsFor = (pubkey: string, party: string, at: number) => {
    try {
      return !!input.actsFor?.(pubkey, party, at);
    } catch {
      return false;
    }
  };
  const isAdmin = (e: LogEvent<unknown>) => input.actors?.roleAt(e.pubkey, e.created_at) === 'admin';

  // Each claimant's latest request per project.
  const latest = new Map<string, LogEvent<ProjectClaimRequestBody>>();
  for (const e of ordered) {
    if (!isProjectClaimRequest(e.item)) continue;
    const project = String(e.item.project ?? '').trim();
    const party = String(e.item.party ?? '').trim();
    if (!project || !party || project === party) continue;
    latest.set(`${project}\u0000${party}`, e as LogEvent<ProjectClaimRequestBody>);
  }

  const out = new Map<string, ProjectClaim>();
  for (const e of latest.values()) {
    const party = String(e.item.party).trim();
    const evidence = cleanEvidence(e.item.evidence);
    out.set(e.id, {
      id: e.id,
      project: String(e.item.project).trim(),
      party,
      ...(clip(e.item.name, 120) ? { name: clip(e.item.name, 120) } : {}),
      ...(clip(e.item.role, 120) ? { role: clip(e.item.role, 120) } : {}),
      ...(evidence ? { evidence } : {}),
      ...(clip(e.item.note, PROJECT_CLAIM_NOTE_MAX) ? { note: clip(e.item.note, PROJECT_CLAIM_NOTE_MAX) } : {}),
      epoch: Number(e.item.epoch) || 0,
      createdAt: e.created_at,
      pubkey: e.pubkey,
      verified: actsFor(e.pubkey, party, e.created_at),
      status: 'pending',
    });
  }

  // Then every word said about a latest request, in log order: the last one stands.
  for (const e of ordered) {
    if (isProjectClaimWithdrawal(e.item)) {
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
    // A withdrawn request is closed: the claimant must ask again.
    if (!target || target.status === 'withdrawn' || !isAdmin(e)) continue;
    const verdict = attestationVerdict(e);
    if (!verdict) continue;
    target.status = verdict === 'attest' ? 'approved' : 'declined';
    target.decidedAt = e.created_at;
    target.decidedBy = e.pubkey;
    if (verdict === 'dispute' && clip(e.item.reason, PROJECT_CLAIM_NOTE_MAX)) target.reason = clip(e.item.reason, PROJECT_CLAIM_NOTE_MAX);
    else delete target.reason;
  }

  const claims = [...out.values()].sort((a, z) => z.createdAt - a.createdAt || (a.id < z.id ? -1 : 1));
  const approved: Record<string, ProjectClaim> = {};
  for (const c of claims) if (c.status === 'approved' && (!approved[c.project] || (approved[c.project].decidedAt ?? 0) < (c.decidedAt ?? 0))) approved[c.project] = c;
  return {
    claims,
    pending: claims.filter((c) => c.status === 'pending'),
    approved,
  };
}
