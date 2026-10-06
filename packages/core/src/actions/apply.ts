// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Committing approved changes. Each change is applied to the FRESH record —
// re-read at apply time, the staged operation re-applied on top — so an edit
// someone made by touch while the change sat in the drawer survives, and a
// stale preview is never written back. The ports are the only I/O: a
// consumer brings its own reader, its identity-aware writer, and optionally
// its completion flow and what it does once a roster write landed (the
// kiosk refreshes the current user's DM). The hologram in each added
// person's own holon is not a port: the write itself makes it.

import type { Quest, QuestParticipant } from '../tasks/types.js';
import { applyOp, creditedForCompletion, type Changeset, type PrivacyOp, type StagedChange } from './stage.js';

export interface ApplyPorts {
  get(holon: string, lens: string, key: string): Promise<Quest | null | undefined>;
  put(holon: string, lens: string, record: Quest): Promise<boolean>;
  /**
   * Complete a task with the consumer's full flow (REA accounting, expenses).
   * When absent the completion is a plain status write.
   */
  complete?(holon: string, task: Quest, completer: QuestParticipant): Promise<boolean>;
  /**
   * Lock, unlock, share or unshare a card (see `@holons/core/privacy`).
   * Absent → privacy changes fail with a clear message.
   */
  privacy?(holon: string, lens: string, key: string, op: PrivacyOp): Promise<boolean>;
  /** After a participant write landed — e.g. tell the person. */
  afterParticipants?(
    holon: string,
    updated: Quest,
    user: QuestParticipant,
    isNowParticipant: boolean,
  ): Promise<void>;
}

export interface ApplyOutcome {
  id: string;
  ok: boolean;
  error?: string;
  /** The record as written (or attempted). */
  record?: Quest;
}

const fail = (id: string, error: string): ApplyOutcome => ({ id, ok: false, error });

export async function applyChange(change: StagedChange, ports: ApplyPorts): Promise<ApplyOutcome> {
  const { id, holon, lens, key, op } = change;
  try {
    if (op.type === 'create') {
      const ok = await ports.put(holon, lens, op.task);
      return ok ? { id, ok, record: op.task } : fail(id, 'The write was denied.');
    }
    let fresh: Quest | null | undefined;
    try {
      fresh = await ports.get(holon, lens, key);
    } catch {
      fresh = null;
    }
    const base = fresh ?? change.before;
    if (!base) return fail(id, 'The task no longer exists.');
    if (base._deleted) return fail(id, 'The task was deleted in the meantime.');

    if (op.type === 'privacy') {
      if (!ports.privacy) return fail(id, 'This surface cannot change privacy.');
      const ok = await ports.privacy(holon, lens, key, op);
      return ok ? { id, ok, record: base } : fail(id, 'The privacy change was refused.');
    }

    if (op.type === 'complete') {
      if (base.status === 'completed') return fail(id, 'Already completed.');
      if (base.status === 'stopped') return fail(id, 'The task was stopped.');
      const credited = creditedForCompletion(base, op.completer);
      if (ports.complete) {
        const ok = await ports.complete(holon, credited, op.completer);
        return ok ? { id, ok, record: credited } : fail(id, 'Completion failed.');
      }
      const updated = applyOp(credited, op);
      const ok = await ports.put(holon, lens, updated);
      return ok ? { id, ok, record: updated } : fail(id, 'The write was denied.');
    }

    const updated = applyOp(base, op);
    const ok = await ports.put(holon, lens, updated);
    if (!ok) return fail(id, 'The write was denied.');
    if (op.type === 'participants' && ports.afterParticipants) {
      for (const o of op.ops) {
        await ports.afterParticipants(holon, updated, o.user, o.mode === 'add');
      }
    }
    return { id, ok, record: updated };
  } catch (err) {
    return fail(id, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Apply the selected changes in staged order (a participant added before a
 * completion is credited by it). A failure is reported per change and never
 * stops the rest.
 */
export async function applyChangeset(
  set: Changeset,
  selected: ReadonlySet<string> | null,
  ports: ApplyPorts,
): Promise<ApplyOutcome[]> {
  const out: ApplyOutcome[] = [];
  for (const c of set.changes) {
    if (selected && !selected.has(c.id)) continue;
    out.push(await applyChange(c, ports));
  }
  return out;
}
