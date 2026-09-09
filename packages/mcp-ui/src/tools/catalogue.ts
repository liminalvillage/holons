// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The task tools' contract comes from @holons/core/actions — the same
// catalogue the kiosk's voice agent uses — so an MCP client and a spoken
// request share one vocabulary. This module derives the zod shape the MCP
// SDK wants from a core action spec, and runs a call through core's
// resolve → stage → apply so an MCP write and a kiosk-approved change take
// the same path to the graph.

import { z, type ZodTypeAny } from 'zod';
import {
  applyChange,
  resolveAction,
  stageAction,
  type ActionSpec,
  type ApplyPorts,
  type FieldSpec,
  type ResolveContext,
  type StagedChange,
} from '@holons/core/actions';
import { saveTaskToHolon, type Quest, type QuestParticipant } from '@holons/core/tasks';
import { toLocalDateField, toLocalTimeField } from '@holons/core/datetime';
import type { ToolDeps } from './index.js';

function fieldZod(f: FieldSpec): ZodTypeAny {
  let t: ZodTypeAny;
  switch (f.type) {
    case 'number':
      t = z.number();
      break;
    case 'boolean':
      t = z.boolean();
      break;
    case 'object':
      t = z.object(shapeOf(f.fields ?? [])).passthrough();
      break;
    default:
      t = f.enum ? z.enum([...f.enum] as [string, ...string[]]) : z.string();
  }
  t = t.describe(f.description);
  return f.required ? t : t.optional();
}

function shapeOf(fields: readonly FieldSpec[]): Record<string, ZodTypeAny> {
  return Object.fromEntries(fields.map((f) => [f.name, fieldZod(f)]));
}

/**
 * The zod raw shape for a core action. `holon` is required here: an MCP
 * client has no holon on screen to default to. `extras` adds MCP-only
 * options (legacy ISO `when`/`until`, `persist`, …) on top.
 */
export function toZod(
  spec: ActionSpec,
  extras: Record<string, ZodTypeAny> = {},
): Record<string, ZodTypeAny> {
  const shape = shapeOf(spec.fields);
  shape.holon = z.string().describe('Holon id.');
  return { ...shape, ...extras };
}

/** Legacy ISO `when`/`until` → the catalogue's local date/time fields. */
export function legacyScheduleToFields(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  const when = typeof args.when === 'string' ? args.when : '';
  const until = typeof args.until === 'string' ? args.until : '';
  if (when && !args.date) {
    out.date = toLocalDateField(when);
    if (/T\d\d:/.test(when) && !args.time) out.time = toLocalTimeField(when);
  }
  if (until && !args.endDate) {
    out.endDate = toLocalDateField(until);
    if (/T\d\d:/.test(until) && !args.endTime) out.endTime = toLocalTimeField(until);
  }
  delete out.when;
  delete out.until;
  return out;
}

function actorAsParticipant(actor: { id: string | number; first_name?: string; username?: string }): QuestParticipant {
  const p: QuestParticipant = { id: String(actor.id) };
  if (actor.username) p.username = actor.username;
  if (actor.first_name) p.first_name = actor.first_name;
  return p;
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v ? Object.values(v) : []);

/** Core's resolution context, from the holon's live lenses. */
export async function resolveContext(
  deps: ToolDeps,
  holon: string,
  utterance = '',
): Promise<ResolveContext> {
  const hs = await deps.getHoloSphere();
  const quests = asList(await hs.getAll(holon, 'quests')).filter(
    (q) => q && !(q as Quest)._deleted,
  ) as Quest[];
  const users = asList(await hs.getAll(holon, 'users')) as ResolveContext['users'];
  return { holonId: holon, utterance, quests, users, actor: actorAsParticipant(deps.resolveActor()) };
}

export function ports(deps: ToolDeps): ApplyPorts {
  return {
    get: async (holon, lens, key) => {
      const hs = await deps.getHoloSphere();
      return ((await hs.get(holon, lens, key)) as Quest | null) ?? null;
    },
    put: async (holon, _lens, record) => {
      const hs = await deps.getHoloSphere();
      return saveTaskToHolon(hs, holon, record);
    },
  };
}

export type StagedRun =
  | { ok: true; change: StagedChange; task: Quest }
  | { ok: false; error: string; extra?: Record<string, unknown> };

/**
 * Resolve, stage and (unless `dryRun`) apply one catalogue action. Returns
 * the staged change either way — the preview is the tool's own receipt.
 */
export async function runAction(
  deps: ToolDeps,
  name: string,
  args: Record<string, unknown>,
  options: { dryRun?: boolean } = {},
): Promise<StagedRun> {
  const holon = String(args.holon ?? '');
  if (!holon) return { ok: false, error: 'holon is required.' };
  const input = legacyScheduleToFields(args);
  const ctx = await resolveContext(deps, holon, typeof args.taskRef === 'string' ? args.taskRef : '');
  const resolved = resolveAction({ name, input }, ctx);
  if (resolved.kind !== 'ok') {
    return {
      ok: false,
      error: resolved.message,
      ...(resolved.kind === 'ambiguous' ? { extra: { candidates: resolved.candidates } } : {}),
    };
  }
  const staged = stageAction(resolved.resolved, resolved.warnings);
  if ('error' in staged) return { ok: false, error: staged.error };
  if (options.dryRun) return { ok: true, change: staged.change, task: staged.change.after };
  const outcome = await applyChange(staged.change, ports(deps));
  if (!outcome.ok) return { ok: false, error: outcome.error ?? 'Save failed.', extra: { holon } };
  return { ok: true, change: staged.change, task: outcome.record ?? staged.change.after };
}
