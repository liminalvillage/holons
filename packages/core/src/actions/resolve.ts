// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// From a loose, spoken-style action call to real records. The model says
// "add Marco to it, and move it to two" — this module decides which task "it"
// is, which Marco, and which day "two" falls on, deterministically and from
// context, so the same utterance resolves the same way on every surface and
// the LLM never has to guess an id.
//
// Rules, in order of trust:
//   task    exact id (cross-checked against the utterance, because a valid id
//           can still be the wrong task) → title as spoken → the task in focus
//           (the last one staged this session, else the card open on screen)
//           when the utterance names nothing by title.
//   person  exact id → handle / name against the holon roster → the speaker.
//   time    a bare time keeps the task's day (or today); a bare date keeps the
//           task's clock; either shift keeps the task's duration.
//
// Pure: everything it needs comes in the context.

import type { Quest, QuestParticipant } from '../tasks/types.js';
import { createTask } from '../tasks/creation.js';
import {
  buildScheduleFields,
  scheduleToFields,
  shiftSchedule,
  type QuestScheduleFields,
} from '../tasks/schedule.js';
import { localFieldsToStored } from '../datetime/index.js';
import {
  fuzzyFindByTitle,
  matchPerson,
  namesAnItem,
  personLabel,
  titleMismatch,
  type PersonLike,
} from './match.js';

export interface ActionCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ResolveContext {
  /** The holon the user is operating in — where new records go. */
  holonId: string;
  /** What the user said this turn; grounds title and pronoun resolution. */
  utterance: string;
  /** The tasks as the user currently sees them (projected through pending changes). */
  quests: Quest[];
  /** The holon's member roster (`users` lens rows). */
  users: PersonLike[];
  /** The speaker, as a participant record. */
  actor: QuestParticipant;
  /** What "it" may refer to. */
  focus?: { lastStagedTaskId?: string | null; openTaskId?: string | null };
  /** Now — relative dates resolve against it. Defaults to the wall clock. */
  now?: Date;
}

export type ResolvedAction =
  | { name: 'task_create'; holon: string; task: Quest }
  | { name: 'task_update'; holon: string; quest: Quest; patch: Partial<Quest> }
  | {
      name: 'task_add_participant' | 'task_remove_participant' | 'task_toggle_participant';
      holon: string;
      quest: Quest;
      user: QuestParticipant;
    }
  | { name: 'task_complete'; holon: string; quest: Quest; completer: QuestParticipant };

export type ResolveOutcome =
  | { kind: 'ok'; resolved: ResolvedAction; warnings: string[] }
  | {
      kind: 'ambiguous';
      field: 'task' | 'user';
      candidates: Array<{ id: string; title: string }>;
      message: string;
    }
  | { kind: 'not_found'; field: 'task' | 'user'; message: string }
  | { kind: 'invalid'; message: string };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

/** A participant record in the stored (snake_case, no-undefined) shape. */
export function participantRecord(p: PersonLike): QuestParticipant {
  const rec: QuestParticipant = { id: String(p.id) };
  const username = p.username;
  const first = p.first_name ?? p.firstName;
  const last = p.last_name ?? p.lastName;
  if (username) rec.username = String(username).replace(/^@/, '');
  if (first) rec.first_name = String(first);
  if (last) rec.last_name = String(last);
  return rec;
}

function digest(quests: Quest[]): string {
  return quests
    .slice(0, 40)
    .map((q) => `"${q.title}" (id ${String(q.id ?? '')})`)
    .join(', ');
}

// ── Task ────────────────────────────────────────────────────────────────────

type TaskLookup = { quest: Quest; warnings: string[] } | ResolveOutcome;

function byId(quests: Quest[], id: string): Quest | undefined {
  return quests.find((q) => String(q.id ?? '') === id);
}

function fuzzyOutcome(needle: string, quests: Quest[]): TaskLookup | null {
  const found = fuzzyFindByTitle(needle, quests as Array<Record<string, unknown>>);
  if (!found) return null;
  if ('id' in found) {
    const quest = byId(quests, found.id);
    return quest ? { quest, warnings: [] } : null;
  }
  return {
    kind: 'ambiguous',
    field: 'task',
    candidates: found.candidates,
    message:
      'Several tasks match: ' +
      found.candidates.map((c) => `"${c.title}"`).join(', ') +
      '. Ask the user which one.',
  };
}

function resolveTask(input: Record<string, unknown>, ctx: ResolveContext): TaskLookup {
  const quests = ctx.quests;
  const taskId = str(input.taskId);
  const taskRef = str(input.taskRef);
  const items = quests as Array<Record<string, unknown>>;

  if (taskId) {
    const quest = byId(quests, taskId);
    if (quest) {
      const other = titleMismatch(ctx.utterance, { id: taskId, title: quest.title }, items);
      if (other) {
        const swapped = byId(quests, other.id);
        if (swapped) {
          return {
            quest: swapped,
            warnings: [
              `The id given was "${quest.title}" but the request names "${swapped.title}"; using the named one.`,
            ],
          };
        }
      }
      return { quest, warnings: [] };
    }
  }

  // No usable id: by title. The reference alone first (it may pick one task out
  // of several the utterance mentions), then with the utterance for coverage.
  const needles = [taskRef, [taskRef, taskId, ctx.utterance].filter(Boolean).join(' ')].filter(
    Boolean,
  );
  for (const needle of needles) {
    const r = fuzzyOutcome(needle, quests);
    if (r) {
      if ('quest' in r && !taskId) return r;
      if ('quest' in r) return { quest: r.quest, warnings: [`No task has id "${taskId}"; matched "${r.quest.title}" by title.`] };
      return r;
    }
  }

  // Nothing named: a pronoun-only follow-up means the task in focus.
  if (!taskRef && !taskId && !namesAnItem(ctx.utterance, items)) {
    const focusId = ctx.focus?.lastStagedTaskId || ctx.focus?.openTaskId || '';
    const quest = focusId ? byId(quests, focusId) : undefined;
    if (quest) return { quest, warnings: [] };
  }
  // The utterance may name the task even when the model passed no reference.
  if (!taskRef && !taskId) {
    const r = fuzzyOutcome(ctx.utterance, quests);
    if (r) return r;
  }

  return {
    kind: 'not_found',
    field: 'task',
    message:
      `No task matches ${taskRef ? `"${taskRef}"` : taskId ? `id "${taskId}"` : 'the request'}. ` +
      `Real tasks: ${digest(quests)}. Ask the user which one they mean if unclear.`,
  };
}

// ── Person ──────────────────────────────────────────────────────────────────

const SELF = new Set(['me', 'myself', 'i', 'io', 'yo', 'mi']);

type PersonLookup = { user: QuestParticipant; warnings: string[] } | ResolveOutcome;

function resolvePerson(input: Record<string, unknown>, ctx: ResolveContext): PersonLookup {
  const raw = input.user;
  if (raw == null || typeof raw !== 'object') return { user: ctx.actor, warnings: [] };
  const u = raw as Record<string, unknown>;
  const id = str(u.id);
  const username = str(u.username).replace(/^@/, '');
  const name = str(u.name) || str(u.firstName) || str(u.first_name);

  if (id) {
    const profile = ctx.users.find((p) => String(p.id) === id);
    if (profile) return { user: participantRecord(profile), warnings: [] };
    if (String(ctx.actor.id) === id) return { user: ctx.actor, warnings: [] };
  }
  const ref = [name, username].filter(Boolean).join(' ');
  if (ref && SELF.has(ref.toLowerCase())) return { user: ctx.actor, warnings: [] };
  if (ref) {
    const r = matchPerson(ref, ctx.users);
    if (r && 'match' in r) return { user: participantRecord(r.match.person), warnings: [] };
    if (r && 'candidates' in r) {
      return {
        kind: 'ambiguous',
        field: 'user',
        candidates: r.candidates.map((c) => ({ id: c.id, title: c.name })),
        message:
          'Several members match: ' +
          r.candidates.map((c) => c.name).join(', ') +
          '. Ask the user which one.',
      };
    }
  }
  if (id) {
    // An id nobody in the roster carries — honour it, but say so.
    const rec: QuestParticipant = { id };
    if (username) rec.username = username;
    if (name) rec.first_name = name;
    return { user: rec, warnings: [`User id "${id}" is not in this holon's member list.`] };
  }
  return {
    kind: 'not_found',
    field: 'user',
    message:
      `No member matches "${ref}". Members: ` +
      ctx.users
        .slice(0, 40)
        .map((p) => personLabel(p))
        .join(', ') +
      '. Ask the user who they mean if unclear.',
  };
}

// ── Schedule ────────────────────────────────────────────────────────────────

function today(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * The schedule fields an update means, or null when the call carries no
 * schedule at all. A bare time keeps the task's day; a bare date keeps its
 * clock; the end moves with the start unless an end was given explicitly.
 */
export function resolveSchedule(
  input: Record<string, unknown>,
  quest: Quest | null,
  now: Date,
): QuestScheduleFields | null | { error: string } {
  const date = str(input.date);
  const time = str(input.time);
  const endDate = str(input.endDate);
  const endTime = str(input.endTime);
  if (!date && !time && !endDate && !endTime) return null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: `Bad date "${date}" — use YYYY-MM-DD.` };
  if (time && !/^\d{1,2}:\d{2}$/.test(time)) return { error: `Bad time "${time}" — use HH:MM.` };

  const current = scheduleToFields(quest);
  const startDate = date || current.startDate || today(now);
  const startTime = time || (date ? current.startTime : current.startTime);
  if (endDate || endTime || !quest) {
    return buildScheduleFields({
      startDate,
      startTime,
      endDate: endDate || (quest ? current.endDate : ''),
      endTime: endTime || (quest ? current.endTime : ''),
    });
  }
  const newWhen = localFieldsToStored(startDate, startTime);
  if (!newWhen) return { error: 'Could not build a schedule from the given date/time.' };
  return shiftSchedule(quest, newWhen);
}

// ── Entry point ─────────────────────────────────────────────────────────────

function tempId(now: Date): string {
  return now.getTime().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function resolveAction(call: ActionCall, ctx: ResolveContext): ResolveOutcome {
  const input = call.input ?? {};
  const now = ctx.now ?? new Date();
  const holon = str(input.holon) || ctx.holonId;

  if (call.name === 'task_create') {
    const title = str(input.title);
    if (!title) return { kind: 'invalid', message: 'A title is required.' };
    const task = createTask({
      holonId: holon,
      initiator: {
        id: ctx.actor.id ?? '',
        username: ctx.actor.username,
        firstName: ctx.actor.first_name ?? ctx.actor.firstName,
        lastName: ctx.actor.last_name ?? ctx.actor.lastName,
      },
      title,
      category: str(input.category) || undefined,
      now: now.getTime(),
    });
    task.id = tempId(now);
    if (str(input.description)) task.description = str(input.description);
    const schedule = resolveSchedule(input, null, now);
    if (schedule && 'error' in schedule) return { kind: 'invalid', message: schedule.error };
    if (schedule) Object.assign(task, schedule);
    return { kind: 'ok', resolved: { name: 'task_create', holon, task }, warnings: [] };
  }

  const found = resolveTask(input, ctx);
  if (!('quest' in found)) return found;
  const { quest } = found;
  const warnings = [...found.warnings];

  switch (call.name) {
    case 'task_update': {
      const patch: Partial<Quest> = {};
      if (str(input.title)) patch.title = str(input.title);
      if (str(input.description)) patch.description = str(input.description);
      if (str(input.category)) patch.category = str(input.category);
      const schedule = resolveSchedule(input, quest, now);
      if (schedule && 'error' in schedule) return { kind: 'invalid', message: schedule.error };
      if (schedule) Object.assign(patch, schedule);
      if (Object.keys(patch).length === 0) {
        return { kind: 'invalid', message: 'Nothing to change — pass at least one field.' };
      }
      return { kind: 'ok', resolved: { name: 'task_update', holon, quest, patch }, warnings };
    }
    case 'task_add_participant':
    case 'task_remove_participant':
    case 'task_toggle_participant': {
      const person = resolvePerson(input, ctx);
      if (!('user' in person)) return person;
      warnings.push(...person.warnings);
      return {
        kind: 'ok',
        resolved: { name: call.name, holon, quest, user: person.user },
        warnings,
      };
    }
    case 'task_complete': {
      const completerId = str(input.completerId);
      const profile = completerId ? ctx.users.find((p) => String(p.id) === completerId) : undefined;
      const completer = profile
        ? participantRecord(profile)
        : completerId && completerId !== String(ctx.actor.id ?? '')
          ? { id: completerId }
          : ctx.actor;
      return { kind: 'ok', resolved: { name: 'task_complete', holon, quest, completer }, warnings };
    }
    default:
      return { kind: 'invalid', message: `Unknown action "${call.name}".` };
  }
}
