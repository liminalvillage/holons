// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Checkpoints: a signer's word on what a lens folded to.
 *
 * A reader derives a lens's accepted entries on their own; a checkpoint lets
 * them compare that with what a recognized signer (the holon key, an admin)
 * derived at the close of an epoch — one lunar cycle, the same `lunationAt`
 * the flows use, so an epoch has one name everywhere. Agreement is a merkle
 * root over the accepted entry ids. A mismatch is surfaced, never silently
 * resolved: the reader keeps their own fold and shows the divergence.
 *
 * Anchoring a root elsewhere (a chain, OpenTimestamps) is the checkpoint
 * entry's `root` published wherever it needs to be; nothing here depends on it.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { lunationAt } from '../flows/lunation.js';
import { CHECKPOINTS_LENS, isCheckpoint, type CheckpointRecord } from './events.js';
import { byLogOrder, type AcceptedActors, type Appendable, type LogEvent, type Role } from './types.js';

/** The root of nothing. */
export const EMPTY_ROOT = '0'.repeat(64);

const hash = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));

/**
 * Merkle root over ids: sorted, deduplicated leaves (`sha256(id)`), pairs
 * hashed as `sha256(left + right)`, an odd tail duplicated. Order-free by
 * construction, so two readers with the same accepted set get the same root.
 */
export function merkleRoot(ids: Iterable<string>): string {
  let layer = [...new Set([...ids].map(String))].sort().map(hash);
  if (!layer.length) return EMPTY_ROOT;
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left;
      next.push(hash(left + right));
    }
    layer = next;
  }
  return layer[0];
}

/** The epoch (lunar cycle number) an entry's time falls in. */
export function epochOf(createdAtSec: number): number {
  return lunationAt(createdAtSec * 1000).index;
}

/** The accepted entries of one epoch, in log order. */
export function entriesInEpoch<T>(accepted: Iterable<LogEvent<T>>, epoch: number): LogEvent<T>[] {
  return [...accepted].filter((e) => epochOf(e.created_at) === epoch).sort(byLogOrder);
}

/** The checkpoint record for a lens's accepted entries in one epoch. */
export function buildCheckpoint(input: { lens: string; epoch: number; accepted: Iterable<LogEvent<unknown>> }): Appendable<CheckpointRecord> {
  const inEpoch = entriesInEpoch(input.accepted, input.epoch);
  const ids = inEpoch.map((e) => e.id);
  return {
    item: {
      t: 'checkpoint',
      lens: String(input.lens),
      epoch: input.epoch,
      root: merkleRoot(ids),
      count: ids.length,
      head: ids.length ? ids[ids.length - 1] : null,
    },
  };
}

export interface CheckpointVerdict {
  ok: boolean;
  /** The root this reader derives for the same lens and epoch. */
  derived: string;
  derivedCount: number;
}

/** Does this reader's accepted set fold to the checkpoint's root? */
export function verifyCheckpoint(checkpoint: CheckpointRecord, accepted: Iterable<LogEvent<unknown>>): CheckpointVerdict {
  const ids = entriesInEpoch(accepted, checkpoint.epoch).map((e) => e.id);
  const derived = merkleRoot(ids);
  return { ok: derived === checkpoint.root && ids.length === checkpoint.count, derived, derivedCount: ids.length };
}

/**
 * The latest checkpoint per (lens, epoch) from signers the holon recognizes
 * (`signers` roles; default admins), keyed `lens|epoch`.
 */
export function foldCheckpoints(
  entries: Iterable<LogEvent<unknown>>,
  actors: AcceptedActors,
  opts: { signers?: Role[] } = {},
): Map<string, LogEvent<CheckpointRecord>> {
  const roles = new Set<Role>(opts.signers ?? ['admin']);
  const out = new Map<string, LogEvent<CheckpointRecord>>();
  for (const e of [...entries].sort(byLogOrder)) {
    if (!isCheckpoint(e.item)) continue;
    const role = actors.roleAt(e.pubkey, e.created_at);
    if (!role || !roles.has(role)) continue;
    out.set(`${e.item.lens}|${e.item.epoch}`, e as LogEvent<CheckpointRecord>);
  }
  return out;
}

export const checkpointKey = (lens: string, epoch: number) => `${lens}|${epoch}`;

export { CHECKPOINTS_LENS };
