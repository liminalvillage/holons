// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Split proposals — a holon's way out changed by its admins together, not by
 * any one key: signed, append-only entries on the holon's own
 * `flow_split_proposals` log.
 *
 *   propose   — an admin puts a whole split forward (`SplitSave`: keep,
 *               rings, slope, who sits where) with the split it was drafted
 *               against (`base`, a hash of the split as stored). Proposing
 *               is the proposer's yes.
 *   verdict   — an admin's yes (attest) or no (dispute, with a reason). Each
 *               admin's latest word counts.
 *   withdraw  — the proposer takes it back.
 *   applied   — the split was written: an admin saved it after it passed.
 *
 * It PASSES when more than half the holon's admins said yes, and is
 * REJECTED once enough said no that it no longer can. A holon with one
 * admin passes what that admin proposes: the same as saving, recorded.
 *
 * Only a passed proposal is applied, and only onto the split it was drafted
 * against: if the split moved meanwhile, it is STALE and has to be proposed
 * again (`split-proposals-load.ts` checks `base` when applying). Settings
 * stay last-writer-wins underneath — this is the rule every surface follows
 * and the record everyone can read, not a lock on the store.
 *
 * Pure: entries in, proposals out.
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
import type { SplitSave } from './split-draft.js';

/** The append-only lens split proposals live in, on the holon whose split it is. */
export const FLOW_SPLIT_PROPOSALS_LENS = 'flow_split_proposals';

export const SPLIT_PROPOSAL_NOTE_MAX = 500;

export interface SplitProposeBody {
  t: 'action';
  kind: 'propose';
  split: SplitSave;
  /** `splitSaveHash` of the split as stored when this was drafted. */
  base: string;
  note?: string;
}

export interface SplitProposalMarkBody {
  t: 'action';
  kind: 'withdraw' | 'applied';
}

export type SplitProposalStatus = 'pending' | 'passed' | 'rejected' | 'withdrawn' | 'applied';

export interface SplitProposal {
  /** The `propose` entry. */
  id: string;
  split: SplitSave;
  base: string;
  note?: string;
  /** The proposer's key. */
  pubkey: string;
  /** Unix seconds. */
  createdAt: number;
  /** Admin keys saying yes (the proposer included) and no. */
  yes: string[];
  no: string[];
  /** The no-sayers' reasons, by key. */
  reasons: Record<string, string>;
  /** Yeses it takes to pass. */
  needed: number;
  status: SplitProposalStatus;
  /** When it was applied (unix seconds). */
  appliedAt?: number;
}

export interface FoldedSplitProposals {
  /** Newest first. */
  proposals: SplitProposal[];
  /** Still open: pending or passed and not yet applied. */
  open: SplitProposal[];
}

const clip = (raw: unknown, max: number): string | undefined => {
  const s = String(raw ?? '').trim().slice(0, max);
  return s || undefined;
};

/** Yeses a holon with `admins` admins needs: more than half, and at least one. */
export const splitQuorum = (admins: number): number => Math.floor(Math.max(1, Math.floor(admins)) / 2) + 1;

/** A stable text for a split: the same split, the same text, however its keys were ordered. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** A short fingerprint of a split (FNV-1a over its canonical text): what `base` holds. */
export function splitSaveHash(save: SplitSave): string {
  const text = canonical({ config: save.config ?? {}, zones: save.zones ?? {}, people: save.people ?? {} });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The split as stored, in the shape a proposal carries: what `base` is taken over. */
export function storedSplit(input: {
  config?: { interiorPercent?: number; steepness?: number; nzones?: number; resourced?: number } | null;
  zones?: Record<string, number> | null;
  people?: Record<string, number> | null;
}): SplitSave {
  const c = input.config ?? {};
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    config: {
      ...(num(c.interiorPercent) != null ? { interiorPercent: num(c.interiorPercent) } : {}),
      ...(num(c.steepness) != null ? { steepness: num(c.steepness) } : {}),
      ...(num(c.nzones) != null ? { nzones: num(c.nzones) } : {}),
      resourced: num(c.resourced) ?? 0,
    },
    zones: { ...(input.zones ?? {}) },
    people: { ...(input.people ?? {}) },
  };
}

export function buildSplitProposal(input: { split: SplitSave; base: string; note?: string }): Appendable<SplitProposeBody> {
  if (!input.split || typeof input.split !== 'object') throw new Error('A proposal carries the split it proposes');
  if (!input.base) throw new Error('A proposal names the split it was drafted against');
  const note = clip(input.note, SPLIT_PROPOSAL_NOTE_MAX);
  const split: SplitSave = { config: { ...input.split.config }, zones: { ...input.split.zones }, people: { ...input.split.people } };
  return action('propose', { split, base: String(input.base), ...(note ? { note } : {}) }) as unknown as Appendable<SplitProposeBody>;
}

export function buildSplitVerdict(proposalId: string, verdict: 'attest' | 'dispute', reason?: string): Appendable<AttestationRecord> {
  return attestation(proposalId, verdict, clip(reason, SPLIT_PROPOSAL_NOTE_MAX));
}

export function buildSplitMark(proposalId: string, kind: 'withdraw' | 'applied'): Appendable<SplitProposalMarkBody> {
  if (!proposalId) throw new Error('A mark names its proposal');
  return action(kind, {}, { basis: [proposalId] }) as unknown as Appendable<SplitProposalMarkBody>;
}

const isPropose = (item: unknown): item is SplitProposeBody => isAction(item) && item.kind === 'propose';
const isMark = (item: unknown): item is SplitProposalMarkBody => isAction(item) && (item.kind === 'withdraw' || item.kind === 'applied');

export interface FoldSplitProposalsInput {
  entries: Iterable<LogEvent<unknown>>;
  /** The holon's accepted signers: only its admins propose and decide. Null: a holon nobody is defined for, where every key counts. */
  actors: AcceptedActors | null | undefined;
  /** How many admins the holon has now: the quorum is taken over them. */
  admins: number;
}

/** Fold the `flow_split_proposals` log into each proposal's standing. */
export function foldSplitProposals(input: FoldSplitProposalsInput): FoldedSplitProposals {
  const ordered = [...input.entries].sort(byLogOrder);
  const needed = splitQuorum(input.admins);
  const isAdmin = (e: LogEvent<unknown>) => (input.actors ? input.actors.roleAt(e.pubkey, e.created_at) === 'admin' : true);

  const out = new Map<string, SplitProposal>();
  const words = new Map<string, Map<string, { verdict: 'attest' | 'dispute'; reason?: string }>>();
  for (const e of ordered) {
    if (isPropose(e.item)) {
      if (!isAdmin(e) || !e.item.split || !e.item.base) continue;
      const note = clip(e.item.note, SPLIT_PROPOSAL_NOTE_MAX);
      out.set(e.id, {
        id: e.id,
        split: e.item.split,
        base: String(e.item.base),
        ...(note ? { note } : {}),
        pubkey: e.pubkey,
        createdAt: e.created_at,
        yes: [],
        no: [],
        reasons: {},
        needed,
        status: 'pending',
      });
      words.set(e.id, new Map([[e.pubkey, { verdict: 'attest' }]]));
      continue;
    }
    if (isMark(e.item)) {
      const target = out.get(e.refs.basis[0] ?? '');
      if (!target || e.created_at < target.createdAt) continue;
      if (e.item.kind === 'withdraw' && e.pubkey === target.pubkey && target.status !== 'applied') target.status = 'withdrawn';
      if (e.item.kind === 'applied' && isAdmin(e) && target.status !== 'withdrawn') {
        target.status = 'applied';
        target.appliedAt = e.created_at;
      }
      continue;
    }
    if (!isAttestation(e.item)) continue;
    const id = attestationTarget(e) ?? '';
    const target = out.get(id);
    const verdict = attestationVerdict(e);
    if (!target || !verdict || !isAdmin(e)) continue;
    const reason = clip(e.item.reason, SPLIT_PROPOSAL_NOTE_MAX);
    words.get(id)!.set(e.pubkey, { verdict, ...(reason ? { reason } : {}) });
  }

  for (const p of out.values()) {
    for (const [key, w] of words.get(p.id) ?? []) {
      if (w.verdict === 'attest') p.yes.push(key);
      else {
        p.no.push(key);
        if (w.reason) p.reasons[key] = w.reason;
      }
    }
    if (p.status !== 'pending') continue;
    if (p.yes.length >= needed) p.status = 'passed';
    else if (Math.max(input.admins, p.yes.length + p.no.length) - p.no.length < needed) p.status = 'rejected';
  }

  const proposals = [...out.values()].sort((a, z) => z.createdAt - a.createdAt || (a.id < z.id ? -1 : 1));
  return { proposals, open: proposals.filter((p) => p.status === 'pending' || p.status === 'passed') };
}
