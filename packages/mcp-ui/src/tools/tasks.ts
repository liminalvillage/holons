// Thin MCP wrappers around @holons/core/tasks. `task_get` is the only tool
// that isn't a direct re-export — core has no read helper, so we go through
// HoloSphere.get directly.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  applyTaskCompletion,
  createTask,
  createMarketItem,
  findDependencyCycle,
  executeCompletionPlan,
  planTaskCompletion,
  saveTaskToHolon,
  saveTasksToHolon,
  addAppreciation,
  removeAppreciation,
  toggleAppreciation,
  type Quest,
  type QuestParticipant,
  type MarketItemKind,
} from '@holons/core/tasks';
import { REAEventStore } from '@holons/core/rea';
import { DEFAULT_EQUATION, loadEquation } from '@holons/core/scoring';
import {
  TASK_ADD_PARTICIPANT,
  TASK_COMPLETE,
  TASK_CREATE,
  TASK_REMOVE_PARTICIPANT,
  TASK_TOGGLE_PARTICIPANT,
  TASK_UPDATE,
  describeChange,
  fuzzyFindByTitle,
} from '@holons/core/actions';
import { buildScheduleFields } from '@holons/core/tasks';
import type { ToolDeps } from './index.js';
import { legacyScheduleToFields, runAction, toZod } from './catalogue.js';

const TASK_TYPE = z.enum(['task', 'quest', 'bounty']);

// --- helpers -------------------------------------------------------------

function ok(payload: unknown) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

function fail(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { success: false, error: message, ...(extra ?? {}) },
          null,
          2,
        ),
      },
    ],
  };
}

function actorAsInitiator(actor: { id: string | number; first_name?: string; username?: string }): Quest['initiator'] {
  return {
    id: actor.id,
    username: actor.username,
    firstName: actor.first_name,
  };
}

function actorAsParticipant(actor: { id: string | number; first_name?: string; username?: string }): QuestParticipant {
  return {
    id: actor.id != null ? String(actor.id) : undefined,
    username: actor.username,
    firstName: actor.first_name,
  };
}

// Telegram-native data carries numeric ids; MCP callers may pass them as
// strings. Coerce to string at the write boundary so participant/appreciation
// lookups in the web UI (which match by `String(id) === String(other)`) stay
// consistent regardless of source.
function normalizeParticipant(user: QuestParticipant): QuestParticipant {
  if (user.id == null) return user;
  return { ...user, id: String(user.id) };
}

/**
 * Build the canonical participant record the UIs expect —
 * { id, username, firstName, lastName } — from whatever the caller passed
 * (often just an id or a username). Missing fields are filled from the
 * holon's `users` lens, whose profiles carry snake_case first_name/last_name.
 */
async function resolveParticipant(
  deps: ToolDeps,
  holon: string,
  user: QuestParticipant,
): Promise<QuestParticipant> {
  const out = normalizeParticipant(user);
  const complete =
    out.id && out.username && out.firstName !== undefined && out.lastName !== undefined;
  if (complete) return out;

  const hs = await deps.getHoloSphere();
  const profiles = ((await hs.getAll(holon, 'users')) ?? []) as Array<
    Record<string, unknown>
  >;
  const match = profiles.find(
    (p) =>
      (out.id != null && String(p.id) === String(out.id)) ||
      (out.username &&
        String(p.username ?? '').toLowerCase() === String(out.username).toLowerCase()),
  );
  if (!match) return out;
  return {
    ...out,
    id: String(out.id ?? match.id),
    username: out.username ?? (match.username as string | undefined),
    firstName: out.firstName ?? (match.first_name as string | undefined) ?? '',
    lastName: out.lastName ?? (match.last_name as string | undefined) ?? '',
  };
}

// Match the web UI's generateId() exactly: base36 ms + 3 base36 random chars,
// NO underscores. The Telegram bot parses callback_data by splitting on `_`,
// so any underscore in a task id makes the bot misroute or drop it (which
// also hides the task from the web UI's task lists indirectly).
// See apps/web/src/components/Tasks.svelte:480.
function shortTaskId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

const userSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    username: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    role: z.string().optional(),
  })
  .passthrough();

// Mutate-then-save helper used by add/remove/toggle tools.
async function mutateAndSave(
  deps: ToolDeps,
  holon: string,
  taskId: string,
  mutate: (task: Quest) => Quest,
) {
  const hs = await deps.getHoloSphere();
  const existing = await hs.get(holon, 'quests', taskId);
  if (!existing) return fail('Task not found.', { holon, taskId });
  const updated = mutate(existing as Quest);
  const saved = await saveTaskToHolon(hs, holon, updated);
  if (!saved) return fail('Save failed.', { holon, taskId });
  return ok({ success: true, task: updated });
}

// --- registration --------------------------------------------------------

export function registerTasksTools(server: McpServer, deps: ToolDeps): void {
  // task_create — build a Quest via createTask, optionally persist. The
  // argument shape is the shared catalogue's (local date/time fields) plus
  // the MCP extras: an explicit id, type, dependencies, ISO when/until,
  // and `persist`.
  server.registerTool(
    'task_create',
    {
      description:
        'Create a new task/quest record for a holon. Wraps @holons/core/tasks createTask. A short id is generated automatically if `id` is omitted. Pass persist:true to write it to HoloSphere under the "quests" bucket.',
      inputSchema: toZod(TASK_CREATE, {
        orderIndex: z.number().int().optional(),
        id: z.string().optional().describe('Override the auto-generated short id.'),
        type: TASK_TYPE.optional(),
        when: z.string().optional().describe('Scheduled start, ISO 8601 (alternative to date/time).'),
        until: z.string().optional().describe('Scheduled end, ISO 8601 (alternative to endDate/endTime).'),
        dependencies: z
          .array(z.string())
          .optional()
          .describe('Ids of tasks this one depends on (predecessors). Pass an explicit `id` per task so dependents can reference them.'),
        persist: z.boolean().optional().describe('If true, write the new Quest to HoloSphere under (holon, "quests").'),
      }),
    },
    async (args) => {
      try {
        const actor = deps.resolveActor();
        const task = createTask({
          holonId: args.holon,
          initiator: actorAsInitiator(actor),
          title: args.title,
          type: args.type,
          category: args.category,
          dependencies: args.dependencies,
        });
        task.id = args.id ?? shortTaskId();
        if (args.description !== undefined) task.description = args.description;
        if (args.orderIndex !== undefined) task.orderIndex = args.orderIndex;
        const fields = legacyScheduleToFields(args as Record<string, unknown>);
        if (fields.date) {
          Object.assign(
            task,
            buildScheduleFields({
              startDate: String(fields.date),
              startTime: fields.time ? String(fields.time) : '',
              endDate: fields.endDate ? String(fields.endDate) : '',
              endTime: fields.endTime ? String(fields.endTime) : '',
            }),
          );
        } else {
          if (args.when !== undefined) task.when = args.when;
          if (args.until !== undefined) task.until = args.until;
        }

        const hs = await deps.getHoloSphere();

        // Keep the dependency graph acyclic so it stays a top→bottom sequence.
        if (args.dependencies && args.dependencies.length > 0) {
          let existing: Quest[] = [];
          if (typeof hs.getAll === 'function') {
            existing = ((await hs.getAll(args.holon, 'quests')) ?? []) as Quest[];
          }
          const graph = [
            ...existing.filter((q) => String(q?.id) !== String(task.id)),
            task,
          ];
          const cycle = findDependencyCycle(graph);
          if (cycle && cycle.includes(String(task.id))) {
            return fail(
              'Refusing to create task: its dependencies would form a cycle.',
              { holon: args.holon, taskId: task.id, cycle },
            );
          }
        }

        let persisted = false;
        if (args.persist) {
          persisted = await saveTaskToHolon(hs, args.holon, task);
        }
        return ok({ success: true, persisted, task });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // tasks_create_batch — build many tasks/quests in one call, cycle-checked.
  server.registerTool(
    'tasks_create_batch',
    {
      description:
        'Create multiple tasks/quests in one call. Accepts a JSON-encoded array of task inputs; each is built via @holons/core/tasks createTask with the configured actor as initiator. Ids are auto-generated when omitted — pass an explicit `id` for any task that others depend on. The whole batch (plus existing persisted quests when persist=true) is checked for dependency cycles and rejected atomically if a new task would form one. Pass persist:true to write them under (holon, "quests").',
      inputSchema: {
        holon: z.string().describe('Holon id.'),
        tasks: z
          .string()
          .describe(
            'JSON-encoded array of task inputs: [{ title, id?, description?, type?("task"|"quest"|"bounty"), category?, when?, until?, orderIndex?, dependencies?: string[] }].',
          ),
        persist: z
          .boolean()
          .optional()
          .describe('If true, write each new Quest under (holon, "quests").'),
      },
    },
    async (args) => {
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(args.tasks);
        } catch (err) {
          return fail(`Invalid JSON for 'tasks': ${(err as Error).message}`);
        }
        if (!Array.isArray(parsed)) {
          return fail("'tasks' must decode to a JSON array of task inputs.");
        }
        if (parsed.length === 0) return fail("'tasks' is empty.");

        const initiator = actorAsInitiator(deps.resolveActor());
        const allowedTypes = ['task', 'quest', 'bounty'];
        const built: Quest[] = parsed.map((raw) => {
          const t = (raw ?? {}) as Record<string, unknown>;
          const title = String(t.title ?? '').trim();
          if (!title) throw new Error('Every task needs a non-empty title.');
          const type =
            typeof t.type === 'string' && allowedTypes.includes(t.type)
              ? (t.type as Quest['type'])
              : undefined;
          const task = createTask({
            holonId: args.holon,
            initiator,
            title,
            type,
            category: typeof t.category === 'string' ? t.category : undefined,
            dependencies: Array.isArray(t.dependencies)
              ? t.dependencies.map(String)
              : undefined,
          });
          task.id = typeof t.id === 'string' && t.id ? t.id : shortTaskId();
          if (typeof t.description === 'string') task.description = t.description;
          if (typeof t.orderIndex === 'number') task.orderIndex = t.orderIndex;
          if (typeof t.when === 'string') task.when = t.when;
          if (typeof t.until === 'string') task.until = t.until;
          return task;
        });

        const ids = built.map((t) => String(t.id));
        const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
        if (dupes.length > 0) {
          return fail(`Duplicate task ids in batch: ${dupes.join(', ')}.`);
        }

        const hs = await deps.getHoloSphere();
        // Cycle-check against existing persisted quests too, so the batch can't
        // close a loop through tasks already in the holon.
        let existing: Quest[] = [];
        if (args.persist && typeof hs.getAll === 'function') {
          const newIds = new Set(ids);
          existing = (((await hs.getAll(args.holon, 'quests')) ?? []) as Quest[]).filter(
            (q) => q?.id != null && !newIds.has(String(q.id)),
          );
        }
        const cycle = findDependencyCycle([...existing, ...built]);
        if (cycle && cycle.some((id) => ids.includes(id))) {
          return fail('Refusing to create batch: dependencies would form a cycle.', {
            cycle,
          });
        }

        let persisted = 0;
        if (args.persist) {
          persisted = await saveTasksToHolon(hs, args.holon, built);
        }
        return ok({ success: true, requested: built.length, persisted, tasks: built });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // marketplace_items_create_batch — create offers / requests / needs in bulk.
  server.registerTool(
    'marketplace_items_create_batch',
    {
      description:
        'Create multiple marketplace items (offers / requests / needs) in one call. Each is built via @holons/core/tasks createMarketItem and shares the "quests" lens with tasks. Pass persist:true to write them under (holon, "quests").',
      inputSchema: {
        holon: z.string().describe('Holon id.'),
        items: z
          .string()
          .describe(
            'JSON-encoded array: [{ kind:("offer"|"request"|"need"), title, id?, description?, itemType?("good"|"service"), transactionTypes?: string[], tags?: string[], expiresAt?: number(ms epoch), category? }].',
          ),
        persist: z
          .boolean()
          .optional()
          .describe('If true, write each new item under (holon, "quests").'),
      },
    },
    async (args) => {
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(args.items);
        } catch (err) {
          return fail(`Invalid JSON for 'items': ${(err as Error).message}`);
        }
        if (!Array.isArray(parsed)) {
          return fail("'items' must decode to a JSON array.");
        }
        if (parsed.length === 0) return fail("'items' is empty.");

        const initiator = actorAsInitiator(deps.resolveActor());
        const kinds = ['offer', 'request', 'need'];
        const built: Quest[] = parsed.map((raw) => {
          const m = (raw ?? {}) as Record<string, unknown>;
          const title = String(m.title ?? '').trim();
          if (!title) throw new Error('Every marketplace item needs a non-empty title.');
          const kind = String(m.kind ?? '');
          if (!kinds.includes(kind)) {
            throw new Error(`Invalid kind "${kind}" — expected offer | request | need.`);
          }
          const item = createMarketItem({
            holonId: args.holon,
            initiator,
            kind: kind as MarketItemKind,
            title,
            description: typeof m.description === 'string' ? m.description : undefined,
            itemType:
              m.itemType === 'good' || m.itemType === 'service' ? m.itemType : undefined,
            transactionTypes: Array.isArray(m.transactionTypes)
              ? m.transactionTypes.map(String)
              : undefined,
            tags: Array.isArray(m.tags) ? m.tags.map(String) : undefined,
            expiresAt: typeof m.expiresAt === 'number' ? m.expiresAt : undefined,
            category: typeof m.category === 'string' ? m.category : undefined,
          });
          item.id = typeof m.id === 'string' && m.id ? m.id : shortTaskId();
          return item;
        });

        let persisted = 0;
        if (args.persist) {
          const hs = await deps.getHoloSphere();
          persisted = await saveTasksToHolon(hs, args.holon, built);
        }
        return ok({ success: true, requested: built.length, persisted, items: built });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // task_update — through the shared catalogue: resolve (id, or title as
  // spoken), stage the change, apply it to the fresh record. Legacy ISO
  // when/until are accepted and translated to the local date/time fields.
  server.registerTool(
    'task_update',
    {
      description:
        'Update fields of an existing task/quest and persist it: title, description, category, schedule (date/time local fields, or ISO when/until). A bare time keeps the task on its day; the end moves with the start. Name the task by exact taskId, or by taskRef (its title as spoken). Only the fields passed are changed.',
      inputSchema: toZod(TASK_UPDATE, {
        when: z.string().optional().describe('New scheduled start, ISO 8601 (alternative to date/time).'),
        until: z.string().optional().describe('New scheduled end, ISO 8601 (alternative to endDate/endTime).'),
        orderIndex: z.number().int().optional(),
      }),
    },
    async (args) => {
      try {
        const { orderIndex, ...rest } = args;
        const run = await runAction(deps, 'task_update', rest as Record<string, unknown>);
        if (!run.ok) return fail(run.error, run.extra);
        let task = run.task;
        if (orderIndex !== undefined) {
          const hs = await deps.getHoloSphere();
          task = { ...task, orderIndex };
          if (!(await saveTaskToHolon(hs, args.holon, task))) return fail('Save failed.');
        }
        return ok({ success: true, change: describeChange(run.change), task });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // task_get — fetch a single Quest by id from HoloSphere.
  server.registerTool(
    'task_get',
    {
      description:
        'Fetch a single task/quest by id from HoloSphere via get(holon, "quests", taskId).',
      inputSchema: {
        holon: z.string(),
        taskId: z.string(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        if (typeof hs.get !== 'function') {
          return fail('HoloSphere instance does not expose a `get` method.');
        }
        const task = await hs.get(args.holon, 'quests', args.taskId);
        return ok({ success: true, task: task ?? null });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // tasks_save — persist a batch of Quests via saveTasksToHolon.
  server.registerTool(
    'tasks_save',
    {
      description:
        'Persist a batch of tasks to a holon. Accepts a JSON-encoded array of Quest objects. Wraps @holons/core/tasks saveTasksToHolon.',
      inputSchema: {
        holon: z.string(),
        tasks: z
          .string()
          .describe('JSON-encoded array of Quest objects.'),
      },
    },
    async (args) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(args.tasks);
      } catch (err) {
        return fail(`Invalid JSON for 'tasks': ${(err as Error).message}`);
      }
      if (!Array.isArray(parsed)) {
        return fail("'tasks' must decode to a JSON array of Quest objects.");
      }
      try {
        const hs = await deps.getHoloSphere();
        const saved = await saveTasksToHolon(hs, args.holon, parsed as Quest[]);
        return ok({ success: true, requested: parsed.length, saved });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // Participants — through the shared catalogue. `user` may carry an exact
  // id, a handle, or a name as spoken (resolved against the holon's users
  // lens); omitted, it is the configured actor. Legacy camelCase
  // firstName/lastName and a bare `userId` are still accepted.
  const participantTool = (
    spec: typeof TASK_ADD_PARTICIPANT,
    description: string,
    legacy: boolean,
  ) =>
    server.registerTool(
      spec.name,
      {
        description,
        inputSchema: toZod(
          spec,
          legacy
            ? {
                userId: z
                  .union([z.string(), z.number()])
                  .optional()
                  .describe('Legacy: user id to remove. Prefer user.id.'),
              }
            : {},
        ),
      },
      async (args) => {
        try {
          const { userId, ...rest } = args as Record<string, unknown> & { userId?: string | number };
          const input = { ...rest } as Record<string, unknown>;
          if (userId != null && !input.user) input.user = { id: String(userId) };
          const run = await runAction(deps, spec.name, input);
          if (!run.ok) return fail(run.error, run.extra);
          return ok({ success: true, change: describeChange(run.change), task: run.task });
        } catch (err) {
          return fail((err as Error).message);
        }
      },
    );

  participantTool(
    TASK_ADD_PARTICIPANT,
    "Add a user to a task's participants. Defaults to the configured actor when `user` is omitted. Refuses if the user already takes part.",
    false,
  );
  participantTool(
    TASK_REMOVE_PARTICIPANT,
    "Remove a user from a task's participants (by user.id, user.username, or user.name).",
    true,
  );
  participantTool(
    TASK_TOGGLE_PARTICIPANT,
    "Toggle a user's membership in a task's participants. Defaults to the configured actor when `user` is omitted.",
    false,
  );

  // task_add_appreciation — add a user to the appreciation array.
  server.registerTool(
    'task_add_appreciation',
    {
      description:
        'Add a user to a task\'s appreciation list. Defaults to the configured actor when `user` is omitted. No-op if already present.',
      inputSchema: {
        holon: z.string(),
        taskId: z.string(),
        user: userSchema.optional(),
      },
    },
    async (args) => {
      try {
        const user = await resolveParticipant(deps, args.holon, args.user ?? actorAsParticipant(deps.resolveActor()));
        return await mutateAndSave(deps, args.holon, args.taskId, (t) =>
          addAppreciation(t, user),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // task_remove_appreciation — remove a user from the appreciation array.
  server.registerTool(
    'task_remove_appreciation',
    {
      description: 'Remove a user from a task\'s appreciation list by id.',
      inputSchema: {
        holon: z.string(),
        taskId: z.string(),
        userId: z.union([z.string(), z.number()]).optional()
          .describe('User id to remove. Defaults to the configured actor.'),
      },
    },
    async (args) => {
      try {
        const userId = args.userId ?? deps.resolveActor().id;
        return await mutateAndSave(deps, args.holon, args.taskId, (t) =>
          removeAppreciation(t, userId),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // task_toggle_appreciation — toggle a user in the appreciation array.
  server.registerTool(
    'task_toggle_appreciation',
    {
      description:
        'Toggle a user\'s presence in a task\'s appreciation list. Defaults to the configured actor when `user` is omitted.',
      inputSchema: {
        holon: z.string(),
        taskId: z.string(),
        user: userSchema.optional(),
      },
    },
    async (args) => {
      try {
        const user = await resolveParticipant(deps, args.holon, args.user ?? actorAsParticipant(deps.resolveActor()));
        return await mutateAndSave(deps, args.holon, args.taskId, (t) =>
          toggleAppreciation(t, user),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // task_complete — mark a task completed and run all canonical
  // side-effects through @holons/core: applyTaskCompletion (permission +
  // status guards), planTaskCompletion (derive REA actions + time-tracking
  // expenses from the equation), executeCompletionPlan (persist task,
  // events, and expenses). Bot/web/MCP all share this exact flow.
  server.registerTool(
    'task_complete',
    {
      description:
        'Mark a task/quest as completed. Permission rule: completer must be initiator OR participant (or pass isAdmin:true if the caller has verified admin rights). Refuses if the task is already completed or stopped. Also records REA events (quest:initiated/completed, appreciation pairs, quest:time_logged) and time-tracking expenses derived from the holon\'s value equation.',
      inputSchema: toZod(TASK_COMPLETE, {
        isAdmin: z
          .boolean()
          .optional()
          .describe('Set true to bypass initiator/participant check (caller has resolved admin rights elsewhere).'),
      }),
    },
    async (args) => {
      try {
        const completerId = args.completerId ?? deps.resolveActor().id;
        const hs = await deps.getHoloSphere();
        let taskId = args.taskId;
        if (!taskId && args.taskRef) {
          const all = ((await hs.getAll(args.holon, 'quests')) ?? []) as Array<Record<string, unknown>>;
          const found = fuzzyFindByTitle(args.taskRef, Array.isArray(all) ? all : Object.values(all));
          if (!found) return fail(`No task matches "${args.taskRef}".`, { holon: args.holon });
          if ('candidates' in found) {
            return fail('Several tasks match — pass taskId.', { candidates: found.candidates });
          }
          taskId = found.id;
        }
        if (!taskId) return fail('taskId or taskRef is required.');
        const existing = await hs.get(args.holon, 'quests', taskId);
        if (!existing) {
          return fail('Task not found.', { holon: args.holon, taskId });
        }
        const result = applyTaskCompletion(existing as Quest, completerId, {
          isAdmin: args.isAdmin,
        });
        if (!result.ok) {
          return fail(`Cannot complete task: ${result.reason}.`, {
            holon: args.holon,
            taskId,
            reason: result.reason,
          });
        }

        let equation = DEFAULT_EQUATION;
        try {
          equation = await loadEquation(hs, args.holon);
        } catch {
          // Falls back to DEFAULT_EQUATION when settings are unreadable.
        }

        const plan = planTaskCompletion(result.task, equation, {
          holonId: args.holon,
          now: Date.now(),
        });
        const eventStore = new REAEventStore(hs);
        const outcome = await executeCompletionPlan(hs, eventStore, args.holon, plan);

        if (!outcome.taskSaved) {
          return fail('Save failed.', {
            holon: args.holon,
            taskId,
            errors: outcome.errors,
          });
        }

        return ok({
          success: true,
          task: result.task,
          releasedHolograms: result.releasedHolograms,
          savedActions: outcome.savedActions,
          savedExpenses: outcome.savedExpenses,
          errors: outcome.errors,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
