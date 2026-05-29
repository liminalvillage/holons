// Creation helpers for tasks/quests. Pure (no I/O), so both the web UI and
// the Telegram bot can call them and produce identical records.

import type { Quest } from './types.js';

// ---------------------------------------------------------------------------
// User-initiated task record (used by the Telegram bot's /task, /quest, ...
// commands). Returns a record with all the bot's expected default fields so
// the bot side becomes a thin wrapper that just attaches its own ids and
// transient UI state on top.
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  holonId: string | number;
  initiator: Quest['initiator'];
  title: string;
  type?: Quest['type'];
  category?: string;
  picture?: string | null;
  messageThreadId?: number | null;
  /** Ids of tasks this one depends on (its predecessors). */
  dependencies?: string[];
  /** Override the creation timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

/**
 * Build a fresh user-initiated task record with the Telegram bot's full
 * default-field set. The id is left empty — the caller assigns the platform
 * message id (Telegram message_id / Discord id) once the message is sent.
 */
export function createTask(input: CreateTaskInput): Quest {
  const now = input.now ?? Date.now();
  // Canonical dependency field, read by every UI (web + bot).
  const deps = input.dependencies ?? [];
  return {
    id: '',
    version: '0.1',
    holon: input.holonId,
    message_thread_id: input.messageThreadId ?? null,
    initiator: input.initiator,
    title: input.title,
    picture: input.picture ?? null,
    type: input.type ?? 'task',
    status: 'ongoing',
    // Canonical creation timestamp. Was historically `date: number (ms)`
    // on the bot side; unified on `created: ISO string` so every UI reads
    // one field. Use `taskCreatedAtMs(quest)` to read — it still falls
    // back to the legacy `date` for pre-unification records.
    created: new Date(now).toISOString(),
    participants: [],
    appreciation: [],
    stoppers: [],
    dependencies: deps,
    frequency: null,
    recurringTaskId: null,
    timeTracking: {},
    checklistId: null,
    reminderId: null,
    activeHolograms: [],
    category: input.category ?? '',
    document: '',
    where: { latitude: '', longitude: '' },
    when: '',
    until: '',
    completed: '',
  };
}
