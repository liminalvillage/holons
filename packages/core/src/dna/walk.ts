// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The walk: before asking to join, a person goes through every gene that
// asks for an acknowledgement, one at a time — `read` ones they say they
// read, `agree` ones they agree to. Pure: the surface keeps the state (the
// kiosk and web in localStorage, Telegram in its session) and asks here
// where the person stands.
//
// The state remembers, per gene, the geneHash the person acknowledged. A
// gene edited since then is STALE: shown again, never counted as done. The
// walk only yields the DNA hash to sign when every step is done against the
// genes as they are now — a UI convenience: the real check is the holon's
// own when it reads the request.

import { sortGenes } from './genes.js';
import type { Gene, GeneKind } from './types.js';
import { geneHash } from './version.js';

/** One screen of the walk: a gene that asks for an acknowledgement. */
export interface WalkStep {
  gene: string;
  /** geneHash of the gene as it is now: what acknowledging this step records. */
  hash: string;
  kind: GeneKind;
  title: string;
  ack: 'read' | 'agree';
}

/** What a person acknowledged so far: gene id → the geneHash they acknowledged. */
export interface WalkState {
  acks: Record<string, string>;
}

export interface WalkProgress {
  /** The first step not done (stale ones included), or null when every step is. */
  current: string | null;
  /** Steps acknowledged as they are now, in walk order. */
  done: string[];
  /** Steps acknowledged in an earlier version, changed since: walk them again. */
  stale: string[];
  complete: boolean;
  /** The DNA hash to sign into the request — only once `complete`, else null. */
  hash: string | null;
}

/** The steps of a holon's walk: its genes with `ack` other than `none`, in front-page order. */
export function walkSteps(genes: readonly Gene[]): WalkStep[] {
  return sortGenes([...genes])
    .filter((g): g is Gene & { ack: 'read' | 'agree' } => g.ack !== 'none')
    .map((g) => ({ gene: g.id, hash: geneHash(g), kind: g.kind, title: g.title, ack: g.ack }));
}

/** A walk nobody started. */
export function emptyWalkState(): WalkState {
  return { acks: {} };
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Whatever a device kept (parsed JSON, or nothing) → a usable state. Unknown shapes start over. */
export function normalizeWalkState(raw: unknown): WalkState {
  const acks: Record<string, string> = {};
  const src = raw && typeof raw === 'object' ? (raw as { acks?: unknown }).acks : undefined;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const [gene, hash] of Object.entries(src as Record<string, unknown>)) {
      if (typeof hash === 'string' && HEX64.test(hash)) acks[gene] = hash;
    }
  }
  return { acks };
}

/** The state after acknowledging `step` as it is now. Returns a new state. */
export function acknowledgeStep(state: WalkState, step: Pick<WalkStep, 'gene' | 'hash'>): WalkState {
  return { acks: { ...state.acks, [step.gene]: step.hash } };
}

/** The state after forgetting `step` (the person stepped back and unticked it). Returns a new state. */
export function unacknowledgeStep(state: WalkState, step: Pick<WalkStep, 'gene'>): WalkState {
  const acks = { ...state.acks };
  delete acks[step.gene];
  return { acks };
}

/**
 * Where a person stands on the walk. `dnaHash` is the holon's current DNA
 * hash (`dnaHash(genes)`, or the front's `dna.hash`); it is handed back as
 * `hash` only when every step is done as the genes are now.
 */
export function walkProgress(steps: readonly WalkStep[], state: WalkState | null | undefined, dnaHash: string | null): WalkProgress {
  const acks = state?.acks ?? {};
  const done: string[] = [];
  const stale: string[] = [];
  let current: string | null = null;
  for (const s of steps) {
    const acked = acks[s.gene];
    if (acked === s.hash) {
      done.push(s.gene);
      continue;
    }
    if (acked) stale.push(s.gene);
    if (current === null) current = s.gene;
  }
  const complete = current === null;
  return { current, done, stale, complete, hash: complete ? dnaHash : null };
}
