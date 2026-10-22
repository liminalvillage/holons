// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turn harness: deterministic guards around the agent loop so a weak local
// model can't fake or fumble actions.
//
// 1. Snapshot — before each turn the server fetches the context holon's real
//    state (tasks, members) and injects it into the system prompt, so the
//    model works from actual ids instead of guessing or skipping the lookup.
// 2. Audit — every dispatched tool call is recorded with its outcome.
// 3. Claim check — if the spoken reply claims a completed action but no write
//    tool succeeded this turn, the server runs one corrective pass instead of
//    letting the hallucinated success reach the user.
//
// The provider-neutral guards (audit, claim/write checks, corrective prompt)
// live in @holons/ai-ui and are re-exported here — the kiosk's in-browser
// direct pipeline enforces the same contract with the same code. This module
// keeps only the server-side extras: id resolution against live lenses,
// snapshot digests, and the local-clock helper.

export {
  claimsCompletedAction,
  correctionHistory,
  correctionPrompt,
  hasSuccessfulWrite,
  hasWriteAttempt,
  isWriteTool,
  looksLikeActionRequest,
  type ToolAudit,
} from '@holons/ai-ui';

// ── Id resolution ──────────────────────────────────────────────────────────
//
// Small models routinely pass invented ids ("100", "wash_the_van") to write
// tools. Before dispatch, the server verifies the id exists in its lens; when
// it doesn't, the given value plus the user's utterance is fuzzy-matched
// against the real items' titles and the call is rewritten with the true id.

export interface IdSpec {
  /** The input field carrying the record id. */
  field: string;
  /** Lenses the id may legitimately live in; the first is fuzzy-matched. */
  lenses: string[];
}

/** Which tool calls carry a record id worth verifying, and where it lives. */
export function idSpecFor(name: string, input: Record<string, unknown>): IdSpec | null {
  if (name.startsWith('subtask') && typeof input.checklistId === 'string') {
    // subtask_add resolves quest ids itself, so accept ids from either lens.
    return { field: 'checklistId', lenses: ['quests', 'checklists'] };
  }
  if (name.startsWith('task_') && name !== 'task_create' && typeof input.taskId === 'string') {
    return { field: 'taskId', lenses: ['quests'] };
  }
  if (
    (name === 'lens_delete' || name === 'lens_get') &&
    input.lens === 'quests' &&
    typeof input.id === 'string'
  ) {
    return { field: 'id', lenses: ['quests'] };
  }
  return null;
}

// Title matching lives in core (@holons/core/actions) so the kiosk's
// in-browser pipeline and the MCP tools resolve spoken references with the
// same rules; re-exported here for the server's id-resolution wrapper.
export { fuzzyFindByTitle, titleMismatch, type FuzzyResult } from '@holons/core/actions';

/** Compact digest rows from a lens_get_all / users_list result payload. */
function rows(
  content: string,
  key: 'items' | 'users',
  pick: (r: Record<string, unknown>) => Record<string, unknown>,
): string | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const list = parsed[key];
    if (!Array.isArray(list)) return null;
    // 60 rows ≈ well past any hub's live task count; a truncated snapshot
    // makes the model fall back to inventing ids for the missing tail.
    return JSON.stringify(list.slice(0, 60).map((r) => pick(r as Record<string, unknown>)));
  } catch {
    return null;
  }
}

const trim = (v: unknown) => String(v ?? '').slice(0, 60);

export function digestQuests(content: string): string | null {
  return rows(content, 'items', (r) => ({
    id: r.id,
    title: trim(r.title),
    status: r.status,
    ...(r.when ? { when: trim(r.when) } : {}),
  }));
}

export function digestUsers(content: string): string | null {
  return rows(content, 'users', (r) => ({
    id: r.id ?? r.userId,
    name: trim(r.name ?? r.username ?? r.first_name),
  }));
}

/**
 * Naive local ISO timestamp (YYYY-MM-DDTHH:mm:ss) for a moment in a given
 * IANA timezone — the format quest when/until fields use. Falls back to the
 * server's local time when the timezone is missing or invalid.
 */
export function localIso(date: Date, timeZone?: string): { iso: string; zone: string } {
  const fmt = (tz?: string) =>
    new Intl.DateTimeFormat('en-CA', {
      ...(tz ? { timeZone: tz } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'long',
    }).formatToParts(date);
  let parts: Intl.DateTimeFormatPart[];
  let zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    parts = fmt(timeZone);
  } catch {
    parts = fmt(undefined);
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return {
    iso: `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`,
    zone: `${zone} (${p.weekday})`,
  };
}

/** System-prompt suffix carrying the holon's live state for this turn. */
export function buildSnapshot(
  holon: string,
  quests: string | null,
  users: string | null,
): string {
  if (!quests && !users) return '';
  return (
    `\n\nLive state of holon ${holon}, fetched just now — use these exact ids, ` +
    'do not invent others:' +
    (quests ? ` tasks: ${quests}.` : '') +
    (users ? ` members: ${users}.` : '') +
    ' If what you need is not listed here, look it up with a read tool before acting.'
  );
}

