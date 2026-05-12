// Pure task-completion transform shared by all UIs and the MCP server.
//
// What this owns:
//   - Permission check (initiator OR participant OR caller-supplied isAdmin).
//   - Status guard (cannot complete a 'stopped' quest).
//   - Stamping `status: 'completed'` + `completed_at` + clearing `activeHolograms`.
//
// What this DOES NOT own (UI/persistence layers do their own):
//   - REA action events for initiator/participants/appreciation (bot's
//     `Quests.recordCompletionActions`, web's per-user `actions[]` writes).
//   - Time-tracking → expense docs (depends on holosphere shape).
//   - Telegram message editing, reminder cancellation, federation propagation.
//
// Both bot and web should call this for the task-shape transform; the
// scoring/expense side-effects can be unified in a follow-up.

import type { Quest } from './types.js';

export interface CompleteTaskOptions {
  /** ISO timestamp for `completed_at`. Defaults to new Date().toISOString(). */
  now?: string;
  /** Set true to bypass initiator/participant check (e.g. when caller has
   *  resolved holon-admin rights elsewhere). */
  isAdmin?: boolean;
}

export type CompleteTaskResult =
  | { ok: true; task: Quest; releasedHolograms: unknown[] }
  | { ok: false; reason: 'already-completed' | 'stopped' | 'forbidden' };

function isParticipant(task: Quest, userId: string | number): boolean {
  return task.participants.some((p) => p?.id != null && String(p.id) === String(userId));
}

function isInitiator(task: Quest, userId: string | number): boolean {
  const id = task.initiator?.id;
  return id != null && String(id) === String(userId);
}

export function applyTaskCompletion(
  task: Quest,
  completerId: string | number,
  options: CompleteTaskOptions = {},
): CompleteTaskResult {
  if (task.status === 'completed') return { ok: false, reason: 'already-completed' };
  if (task.status === 'stopped') return { ok: false, reason: 'stopped' };

  const allowed = options.isAdmin === true
    || isInitiator(task, completerId)
    || isParticipant(task, completerId);
  if (!allowed) return { ok: false, reason: 'forbidden' };

  const releasedHolograms = (task as any).activeHolograms ?? [];
  const updated: Quest = {
    ...task,
    status: 'completed',
    completed_at: options.now ?? new Date().toISOString(),
    activeHolograms: [],
  } as Quest;

  return { ok: true, task: updated, releasedHolograms };
}
