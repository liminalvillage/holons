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

import type { HistoryMessage } from '@holons/ai-ui';

export interface ToolAudit {
  name: string;
  ok: boolean;
}

/** Tool names that mutate state (vs. read/compute). */
const WRITE_NAME =
  /(create|add|remove|delete|toggle|save|complete|update|set|join|leave|borrow|return|publish|seed|rsvp|clear|apply|put|migrate|normalize)/;

export function isWriteTool(name: string): boolean {
  if (name.startsWith('lens_get')) return false;
  return WRITE_NAME.test(name);
}

export function hasSuccessfulWrite(audit: ToolAudit[]): boolean {
  return audit.some((a) => a.ok && isWriteTool(a.name));
}

/**
 * Whether a spoken reply asserts that an action was carried out ("I've added
 * …", "the task has been deleted"). Deliberately requires a claim-of-agency
 * construction, not just a past-tense verb, so answers that merely describe
 * state ("the task marked done is …") don't trigger a correction pass.
 */
const CLAIM =
  /\b(i(?:'ve| have| already)?|has been|have been|is now|are now|successfully|it's been)\b[^.!?]{0,80}\b(deleted|removed|created|added|completed|marked|saved|updated|renamed|assigned|joined|borrowed|returned|cleared|cancell?ed|done)\b/i;

export function claimsCompletedAction(reply: string): boolean {
  return CLAIM.test(reply);
}

/**
 * Whether the user's utterance asks for something to be DONE (vs. asked).
 * Used to enforce that such turns end in at least one attempted write: a
 * "sure, done!" with zero write calls is exactly the failure mode small
 * models fall into.
 */
const ACTION_REQUEST =
  /\b(add|create|make|new|delete|remove|complete|finish|mark|schedule|move|reschedule|rename|change|update|set|assign|join|leave|borrow|return|cancel|clear|put)\b/i;

export function looksLikeActionRequest(text: string): boolean {
  return ACTION_REQUEST.test(text);
}

export function hasWriteAttempt(audit: ToolAudit[]): boolean {
  return audit.some((a) => isWriteTool(a.name));
}

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

const normTokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .split(' ')
    .filter(Boolean);

export type FuzzyResult =
  | { id: string; title: string }
  | { candidates: Array<{ id: string; title: string }> }
  | null;

/**
 * Find the item whose title is best covered by the needle (the bogus id plus
 * the user's utterance). Coverage = fraction of the title's words present in
 * the needle; a clear winner is returned, close calls come back as
 * candidates, and no plausible match is null.
 */
export function fuzzyFindByTitle(
  needle: string,
  items: Array<Record<string, unknown>>,
): FuzzyResult {
  const bag = new Set(normTokens(needle));
  const scored = items
    .map((it) => {
      const title = String(it?.title ?? '');
      const words = normTokens(title);
      const score =
        it?.id == null || words.length === 0
          ? 0
          : words.filter((w) => bag.has(w)).length / words.length;
      return { id: String(it?.id), title, score };
    })
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  if (scored.length === 1 || scored[0].score - scored[1].score >= 0.25) {
    return { id: scored[0].id, title: scored[0].title };
  }
  return { candidates: scored.slice(0, 3).map(({ id, title }) => ({ id, title })) };
}

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

/**
 * The corrective user-role message injected when the reply claimed an action
 * no successful write tool backs. Sent with the failed exchange in history so
 * the model sees exactly what it said.
 */
export function correctionPrompt(
  audit: ToolAudit[],
  reason: 'claimed' | 'no_write' = 'claimed',
): string {
  const called =
    audit.length === 0
      ? 'no tools at all'
      : audit.map((a) => `${a.name} (${a.ok ? 'ok' : 'FAILED'})`).join(', ');
  const opening =
    reason === 'claimed'
      ? 'Your last reply claimed an action was completed,'
      : 'The user asked for an action to be performed,'
  return (
    `SYSTEM CHECK — not the user speaking. ${opening} but this turn you ` +
    `called ${called}: no write succeeded, so NOTHING was actually changed. ` +
    'Fulfill the original request now with the proper tool calls, or reply ' +
    'honestly that it was not done and why. Never claim success without a ' +
    'successful tool call.'
  );
}

/** History entries representing the rejected exchange, for the retry pass. */
export function correctionHistory(
  history: HistoryMessage[],
  userText: string,
  badReply: string,
): HistoryMessage[] {
  return [
    ...history,
    { role: 'user', content: userText },
    { role: 'assistant', content: badReply },
  ];
}
