// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The five record types a protocol log carries, and the lenses that hold the
 * holon-level ones.
 *
 *   Action       — something a member says happened or should happen; the
 *                  domain gives it a `kind` and a body.
 *   Attestation  — a signer's verdict on one action (`attests` / `disputes`
 *                  ref). Quorum and disputes are counted at reduce time.
 *   Membership   — holosphere's own signed `_members` log (genesis, add,
 *                  remove). Not a log lens: the shape is holosphere's and the
 *                  fold is `buildTimeline`; core wraps it in membership.ts.
 *   Policy       — the holon's rule for a lens, admin-signed, as-of-time.
 *   Checkpoint   — a merkle root over the accepted entries of a lens in one
 *                  epoch, so readers can compare their fold with a signer's.
 */

import { HOLOSPHERE_LOG_KIND } from 'holosphere/nostr-events.js';
import type { SignableTemplate } from '../holosphere/signers.js';
import type { Appendable, LogEvent, Policy, RefsInput } from './types.js';

/** The kind every log entry rides (regular, never replaced). */
export const LOG_KIND: number = HOLOSPHERE_LOG_KIND;

export interface LogTemplateInput<T = Record<string, unknown>> extends Appendable<T> {
  holon: string;
  lens: string;
  /** The app namespace (`appName`), so the store accepts it. */
  appName: string;
  /** Unix seconds; default now. */
  created_at?: number;
}

/**
 * The unsigned log entry, for a `NostrSigner` that holds the key elsewhere
 * (a host signing as one of its members). Same tag layout as holosphere's
 * `buildLogEvent`: `h`, `l`, one `e` per ref with its marker, `n`. Hand the
 * signed event to `holosphere.appendSigned`.
 */
export function logTemplate<T extends Record<string, unknown>>(input: LogTemplateInput<T>): SignableTemplate {
  const { id: _id, _log: _meta, ...body } = input.item as Record<string, unknown>;
  const tags: string[][] = [['h', String(input.holon)], ['l', String(input.lens)]];
  for (const [marker, v] of Object.entries(input.refs ?? {})) {
    for (const id of Array.isArray(v) ? v : [v]) if (id) tags.push(['e', String(id), '', marker]);
  }
  tags.push(['n', String(input.appName)]);
  return {
    kind: HOLOSPHERE_LOG_KIND,
    created_at: input.created_at ?? Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(body),
  };
}

/** Holosphere's signed membership log (replaceable envelope, not a log lens). */
export const MEMBERS_LENS = '_members';
/** Admin-signed policy records, one log lens per holon. */
export const POLICY_LENS = '_policy';
/** Checkpoints over every log lens of the holon. */
export const CHECKPOINTS_LENS = '_checkpoints';
/** The append-only lenses every instance carries for the protocol itself. */
export const PROTOCOL_LENSES: readonly string[] = [POLICY_LENS, CHECKPOINTS_LENS];

export type RecordType = 'action' | 'attestation' | 'policy' | 'checkpoint';

export interface ActionRecord {
  t: 'action';
  /** What kind of action, in the domain's vocabulary (`claim`, `payout`, `vote` …). */
  kind: string;
  [field: string]: unknown;
}

export interface AttestationRecord {
  t: 'attestation';
  verdict: 'attest' | 'dispute';
  reason?: string;
}

export interface PolicyRecord extends Policy {
  t: 'policy';
  /** The log lens this rule governs. */
  lens: string;
}

export interface CheckpointRecord {
  t: 'checkpoint';
  lens: string;
  /** The lunar cycle (`lunationAt().index`) the accepted entries fall in. */
  epoch: number;
  /** Merkle root over the accepted entry ids, hex. */
  root: string;
  count: number;
  /** The last accepted entry, or null for an empty epoch. */
  head: string | null;
}

export type ProtocolRecord = ActionRecord | AttestationRecord | PolicyRecord | CheckpointRecord;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function isAction(item: unknown): item is ActionRecord {
  return isObj(item) && item.t === 'action' && typeof item.kind === 'string';
}
export function isAttestation(item: unknown): item is AttestationRecord {
  return isObj(item) && item.t === 'attestation' && (item.verdict === 'attest' || item.verdict === 'dispute');
}
export function isPolicy(item: unknown): item is PolicyRecord {
  return isObj(item) && item.t === 'policy' && typeof item.lens === 'string';
}
export function isCheckpoint(item: unknown): item is CheckpointRecord {
  return isObj(item) && item.t === 'checkpoint' && typeof item.lens === 'string' && typeof item.root === 'string';
}

/** An action of `kind` with `body`, optionally chained (`prev`) or consuming (`basis`). */
export function action<B extends Record<string, unknown>>(
  kind: string,
  body: B,
  refs?: Pick<RefsInput, 'prev' | 'basis'>,
): Appendable<ActionRecord & B> {
  const { t: _t, kind: _k, ...rest } = body as Record<string, unknown>;
  return { item: { ...(rest as B), t: 'action', kind }, ...(refs ? { refs } : {}) };
}

/** A verdict on `targetId`. The ref marker carries the verdict too, so a reader can filter by tag. */
export function attestation(targetId: string, verdict: 'attest' | 'dispute', reason?: string): Appendable<AttestationRecord> {
  return {
    item: { t: 'attestation', verdict, ...(reason ? { reason } : {}) },
    refs: verdict === 'attest' ? { attests: [targetId] } : { disputes: [targetId] },
  };
}

/** The entry an attestation judges, read from its refs (the marker is the source of truth). */
export function attestationTarget(entry: LogEvent<unknown>): string | null {
  return entry.refs.attests[0] ?? entry.refs.disputes[0] ?? null;
}

/** The verdict an attestation entry carries, from its refs first, its body second. */
export function attestationVerdict(entry: LogEvent<unknown>): 'attest' | 'dispute' | null {
  if (entry.refs.attests.length) return 'attest';
  if (entry.refs.disputes.length) return 'dispute';
  return isAttestation(entry.item) ? entry.item.verdict : null;
}

export function recordType(item: unknown): RecordType | null {
  if (isAction(item)) return 'action';
  if (isAttestation(item)) return 'attestation';
  if (isPolicy(item)) return 'policy';
  if (isCheckpoint(item)) return 'checkpoint';
  return null;
}
