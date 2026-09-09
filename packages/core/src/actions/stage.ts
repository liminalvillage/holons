// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A staged change: what an action WOULD do, computed without writing, so a
// person can look at it before it lands. Modelled on the task-completion
// plan/execute split next door — a serialisable description now, the write
// later (apply.ts), and never the stale preview itself: the change carries
// its operation, which is re-applied to the fresh record at apply time.
//
// A changeset accumulates the staged changes of a session and merges them
// deterministically: a second schedule for the same task replaces the first
// ("two… actually three"), an add and a remove of the same person cancel, an
// edit to a task that is itself still staged folds into its creation. The
// model just emits calls; the merge is not its decision.

import type { Quest, QuestParticipant } from '../tasks/types.js';
import {
  addParticipant,
  removeParticipant,
} from '../tasks/participants.js';
import { applyTaskCompletion } from '../tasks/completion.js';
import { sourceRef } from '../holosphere/provenance.js';
import { toLocalDateField, toLocalTimeField } from '../datetime/index.js';
import { personLabel } from './match.js';
import type { ResolvedAction } from './resolve.js';

export type ChangeKind = 'create' | 'update' | 'participants' | 'complete';

export interface ParticipantOp {
  mode: 'add' | 'remove';
  user: QuestParticipant;
}

export type ChangeOp =
  | { type: 'create'; task: Quest }
  | { type: 'patch'; fields: Partial<Quest> }
  | { type: 'participants'; ops: ParticipantOp[] }
  | { type: 'complete'; completer: QuestParticipant };

export interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface StagedChange {
  id: string;
  /** The action that produced it (`task_update`, …). */
  action: string;
  /** Where the write lands — the owner holon for a federated record. */
  holon: string;
  /** The record key in that holon. */
  key: string;
  /** The id the record has in the user's own list (differs for holograms). */
  localId: string;
  lens: string;
  kind: ChangeKind;
  title: string;
  op: ChangeOp;
  /** The record as it was when first staged (null for a creation). */
  before: Quest | null;
  /** The record as it would be after the change. */
  after: Quest;
  diff: FieldDiff[];
  warnings: string[];
}

export interface Changeset {
  changes: StagedChange[];
}

export const emptyChangeset = (): Changeset => ({ changes: [] });

let seq = 0;
const changeId = (): string => `chg-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const participants = (q: Quest | null | undefined): QuestParticipant[] =>
  Array.isArray(q?.participants) ? q!.participants : [];

const hasParticipant = (q: Quest, id: unknown): boolean =>
  participants(q).some((p) => p?.id != null && String(p.id) === String(id));

/** The record an op yields from a base record. Shared by preview and apply. */
export function applyOp(base: Quest | null, op: ChangeOp): Quest {
  switch (op.type) {
    case 'create':
      return op.task;
    case 'patch':
      return { ...(base as Quest), ...op.fields };
    case 'participants': {
      let q = base as Quest;
      for (const o of op.ops) {
        q = o.mode === 'add' ? addParticipant(q, o.user) : removeParticipant(q, o.user.id ?? '');
      }
      return q;
    }
    case 'complete': {
      const q = creditedForCompletion(base as Quest, op.completer);
      const r = applyTaskCompletion(q, String(op.completer.id ?? ''), { isAdmin: true });
      return r.ok ? r.task : q;
    }
  }
}

/** Who a completion credits: the participants, or the completer when nobody joined. */
export function creditedForCompletion(quest: Quest, completer: QuestParticipant): Quest {
  return participants(quest).length ? quest : addParticipant(quest, completer);
}

function scheduleLabel(q: Quest | null | undefined): string {
  const when = q?.when;
  if (!when) return '';
  const d = toLocalDateField(when);
  const t = /T\d\d:/.test(String(when)) ? toLocalTimeField(when) : '';
  const ends = q?.ends;
  let end = '';
  if (ends) {
    const ed = toLocalDateField(ends);
    const et = /T\d\d:/.test(String(ends)) ? toLocalTimeField(ends) : '';
    end = ed === d ? et : `${ed}${et ? ' ' + et : ''}`;
  }
  return `${d}${t ? ' ' + t : ''}${end ? '–' + end : ''}`;
}

const names = (q: Quest | null): string[] => participants(q).map((p) => personLabel(p));

function diffOf(kind: ChangeKind, before: Quest | null, after: Quest): FieldDiff[] {
  const out: FieldDiff[] = [];
  if (kind === 'create') {
    out.push({ field: 'title', before: null, after: after.title });
    if (after.description) out.push({ field: 'description', before: null, after: after.description });
    if (after.category) out.push({ field: 'category', before: null, after: after.category });
    if (after.when) out.push({ field: 'schedule', before: null, after: scheduleLabel(after) });
    const people = names(after);
    if (people.length) out.push({ field: 'participants', before: [], after: people });
    return out;
  }
  const b = before as Quest;
  for (const f of ['title', 'description', 'category'] as const) {
    if ((b[f] ?? '') !== (after[f] ?? '')) out.push({ field: f, before: b[f] ?? '', after: after[f] ?? '' });
  }
  const sb = scheduleLabel(b);
  const sa = scheduleLabel(after);
  if (sb !== sa) out.push({ field: 'schedule', before: sb, after: sa });
  const pb = names(b);
  const pa = names(after);
  if (pb.join('|') !== pa.join('|')) out.push({ field: 'participants', before: pb, after: pa });
  if ((b.status ?? '') !== (after.status ?? '')) out.push({ field: 'status', before: b.status ?? '', after: after.status ?? '' });
  return out;
}

/** The record fields an op reads or writes — what a drift check compares. */
export function touchedFields(op: ChangeOp): string[] {
  switch (op.type) {
    case 'create':
      return [];
    case 'patch':
      return Object.keys(op.fields);
    case 'participants':
      return ['participants'];
    case 'complete':
      return ['status', 'participants'];
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Whether the live record moved, in the fields this change touches, since
 * the change was previewed. Other fields may differ freely — the preview is
 * built on the projected record, and unrelated edits are re-applied over.
 */
export function hasDrifted(change: StagedChange, live: Quest | null | undefined): boolean {
  if (!change.before || !live) return false;
  return touchedFields(change.op).some((f) => !same(change.before![f], live[f]));
}

/** Recompute preview fields from `before` + `op`. */
function withPreview(c: StagedChange): StagedChange {
  const after = applyOp(c.before, c.op);
  return { ...c, after, title: after.title ?? c.title, diff: diffOf(c.kind, c.before, after) };
}

export type StageOutcome = { change: StagedChange } | { error: string };

/**
 * Stage a resolved action against the record as the user currently sees it
 * (already projected through earlier staged changes).
 */
export function stageAction(resolved: ResolvedAction, warnings: string[] = []): StageOutcome {
  const base = {
    id: changeId(),
    lens: 'quests',
    warnings: [...warnings],
    diff: [] as FieldDiff[],
  };
  if (resolved.name === 'task_create') {
    const key = String(resolved.task.id ?? '');
    return {
      change: withPreview({
        ...base,
        action: resolved.name,
        holon: resolved.holon,
        key,
        localId: key,
        kind: 'create',
        title: resolved.task.title,
        op: { type: 'create', task: resolved.task },
        before: null,
        after: resolved.task,
      }),
    };
  }

  const quest = resolved.quest;
  const localId = String(quest.id ?? '');
  const ref = sourceRef(quest, localId);
  const holon = ref?.holon ?? resolved.holon;
  const key = ref?.key ?? localId;
  const common = { ...base, holon, key, localId, title: quest.title, before: quest, after: quest };

  switch (resolved.name) {
    case 'task_update': {
      const change = withPreview({
        ...common,
        action: resolved.name,
        kind: 'update',
        op: { type: 'patch', fields: resolved.patch },
      });
      if (change.diff.length === 0) {
        return { error: `"${quest.title}" is already like that — nothing to change.` };
      }
      return { change };
    }
    case 'task_add_participant':
    case 'task_remove_participant':
    case 'task_toggle_participant': {
      const has = hasParticipant(quest, resolved.user.id);
      const mode: ParticipantOp['mode'] =
        resolved.name === 'task_add_participant'
          ? 'add'
          : resolved.name === 'task_remove_participant'
            ? 'remove'
            : has
              ? 'remove'
              : 'add';
      if (mode === 'add' && has) {
        return { error: `${personLabel(resolved.user)} already takes part in "${quest.title}".` };
      }
      if (mode === 'remove' && !has) {
        return { error: `${personLabel(resolved.user)} is not on "${quest.title}".` };
      }
      return {
        change: withPreview({
          ...common,
          action: resolved.name,
          kind: 'participants',
          op: { type: 'participants', ops: [{ mode, user: resolved.user }] },
        }),
      };
    }
    case 'task_complete': {
      if (quest.status === 'completed') return { error: `"${quest.title}" is already completed.` };
      if (quest.status === 'stopped') return { error: `"${quest.title}" was stopped and cannot be completed.` };
      return {
        change: withPreview({
          ...common,
          action: resolved.name,
          kind: 'complete',
          op: { type: 'complete', completer: resolved.completer },
        }),
      };
    }
  }
}

// ── Changeset ───────────────────────────────────────────────────────────────

const sameTarget = (a: StagedChange, b: StagedChange): boolean =>
  a.holon === b.holon && a.key === b.key;

function mergeParticipantOps(existing: ParticipantOp[], incoming: ParticipantOp[]): ParticipantOp[] {
  const ops = [...existing];
  for (const o of incoming) {
    const idx = ops.findIndex((e) => String(e.user.id) === String(o.user.id));
    if (idx < 0) {
      ops.push(o);
    } else if (ops[idx].mode === o.mode) {
      /* idempotent */
    } else {
      ops.splice(idx, 1); // add + remove cancel out
    }
  }
  return ops;
}

/**
 * Merge a newly staged change into the set. Returns the new set; the change
 * may have been folded into an earlier one or cancelled out entirely.
 */
export function mergeChange(set: Changeset, change: StagedChange): Changeset {
  const changes = [...set.changes];

  // An edit to a task that is itself still staged folds into its creation.
  const creation = changes.findIndex((c) => c.kind === 'create' && sameTarget(c, change));
  if (creation >= 0 && change.kind !== 'complete') {
    const c = changes[creation];
    const task = applyOp((c.op as { task: Quest }).task, change.op);
    changes[creation] = withPreview({
      ...c,
      op: { type: 'create', task },
      warnings: [...c.warnings, ...change.warnings],
    });
    return { changes };
  }

  const idx = changes.findIndex((c) => c.kind === change.kind && sameTarget(c, change));
  if (idx < 0) return { changes: [...changes, change] };
  const prev = changes[idx];
  const warnings = [...prev.warnings, ...change.warnings];
  switch (change.kind) {
    case 'update': {
      const fields = {
        ...(prev.op as { fields: Partial<Quest> }).fields,
        ...(change.op as { fields: Partial<Quest> }).fields,
      };
      changes[idx] = withPreview({ ...prev, op: { type: 'patch', fields }, warnings });
      return { changes };
    }
    case 'participants': {
      const ops = mergeParticipantOps(
        (prev.op as { ops: ParticipantOp[] }).ops,
        (change.op as { ops: ParticipantOp[] }).ops,
      );
      if (ops.length === 0) {
        changes.splice(idx, 1);
        return { changes };
      }
      changes[idx] = withPreview({ ...prev, op: { type: 'participants', ops }, warnings });
      return { changes };
    }
    default:
      changes[idx] = { ...change, before: prev.before, warnings };
      changes[idx] = withPreview(changes[idx]);
      return { changes };
  }
}

export function removeChange(set: Changeset, id: string): Changeset {
  return { changes: set.changes.filter((c) => c.id !== id) };
}

/**
 * The tasks as they would look with the set applied — what the next action
 * resolves against, so "create X, then add Marco to it" composes.
 */
export function projectQuests(quests: Quest[], set: Changeset): Quest[] {
  let out = [...quests];
  for (const c of set.changes) {
    const i = out.findIndex((q) => String(q.id ?? '') === c.localId);
    if (i < 0) {
      if (c.kind === 'create') out.push(c.after);
      continue;
    }
    // Re-apply onto the projected record so several changes to one task stack.
    out[i] = applyOp(out[i], c.op);
  }
  return out;
}

/** One human line per change, for the tool result and the spoken summary. */
export function describeChange(c: StagedChange): string {
  const t = `"${c.title}"`;
  switch (c.kind) {
    case 'create': {
      const when = scheduleLabel(c.after);
      const people = names(c.after);
      return (
        `Create task ${t}` +
        (when ? ` on ${when}` : '') +
        (people.length ? ` with ${people.join(', ')}` : '')
      );
    }
    case 'update':
      return (
        `Change ${t}: ` +
        c.diff
          .map((d) =>
            d.field === 'schedule'
              ? `schedule ${d.before || 'unscheduled'} → ${d.after || 'unscheduled'}`
              : `${d.field} "${String(d.before ?? '')}" → "${String(d.after ?? '')}"`,
          )
          .join('; ')
      );
    case 'participants': {
      const ops = (c.op as { ops: ParticipantOp[] }).ops;
      const adds = ops.filter((o) => o.mode === 'add').map((o) => personLabel(o.user));
      const removes = ops.filter((o) => o.mode === 'remove').map((o) => personLabel(o.user));
      return [
        adds.length ? `Add ${adds.join(', ')} to ${t}` : '',
        removes.length ? `Remove ${removes.join(', ')} from ${t}` : '',
      ]
        .filter(Boolean)
        .join('; ');
    }
    case 'complete':
      return `Complete ${t} (credits ${names(c.after).join(', ') || 'nobody'})`;
  }
}

export function describeChangeset(set: Changeset): string {
  return set.changes.map((c, i) => `${i + 1}. ${describeChange(c)}`).join('\n');
}
