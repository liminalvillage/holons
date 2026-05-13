// Thin MCP wrappers around @holons/core/tasks. `task_get` is the only tool
// that isn't a direct re-export — core has no read helper, so we go through
// HoloSphere.get directly.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  applyTaskCompletion,
  createTaskRecord,
  executeCompletionPlan,
  planTaskCompletion,
  saveTaskToHolon,
  saveTasksToHolon,
  addParticipant,
  removeParticipant,
  toggleParticipant,
  addAppreciation,
  removeAppreciation,
  toggleAppreciation,
  type Quest,
  type QuestParticipant,
} from '@holons/core/tasks';
import { REAEventStore } from '@holons/core/rea';
import { DEFAULT_EQUATION, loadEquation } from '@holons/core/scoring';
import type { ToolDeps } from './index.js';

const TASK_TYPE = z.enum(['task', 'quest', 'proposal', 'bounty']);

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
  // task_create — build a Quest via createTaskRecord, optionally persist.
  server.registerTool(
    'task_create',
    {
      description:
        'Create a new task/quest record for a holon. Wraps @holons/core/tasks createTaskRecord. A short id is generated automatically if `id` is omitted. Pass persist:true to write it to HoloSphere under the "quests" bucket.',
      inputSchema: {
        holon: z.string().describe('Holon id (e.g. Telegram chat id, Discord channel id).'),
        title: z.string().min(1),
        description: z.string().optional(),
        orderIndex: z.number().int().optional(),
        id: z.string().optional().describe('Override the auto-generated short id.'),
        type: TASK_TYPE.optional(),
        category: z.string().optional(),
        when: z.string().optional(),
        until: z.string().optional(),
        persist: z.boolean().optional().describe('If true, write the new Quest to HoloSphere under (holon, "quests").'),
      },
    },
    async (args) => {
      try {
        const actor = deps.resolveActor();
        const task = createTaskRecord({
          holonId: args.holon,
          initiator: actorAsInitiator(actor),
          title: args.title,
          type: args.type,
          category: args.category,
        });
        task.id = args.id ?? shortTaskId();
        if (args.description !== undefined) task.description = args.description;
        if (args.orderIndex !== undefined) task.orderIndex = args.orderIndex;
        if (args.when !== undefined) task.when = args.when;
        if (args.until !== undefined) task.until = args.until;

        let persisted = false;
        if (args.persist) {
          const hs = await deps.getHoloSphere();
          persisted = await saveTaskToHolon(hs, args.holon, task);
        }
        return ok({ success: true, persisted, task });
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

  // task_add_participant — add a user to the participants array.
  server.registerTool(
    'task_add_participant',
    {
      description:
        'Add a user to a task\'s participants. Defaults to the configured actor when `user` is omitted. No-op if the user is already a participant.',
      inputSchema: {
        holon: z.string(),
        taskId: z.string(),
        user: userSchema.optional(),
      },
    },
    async (args) => {
      try {
        const user = normalizeParticipant(args.user ?? actorAsParticipant(deps.resolveActor()));
        return await mutateAndSave(deps, args.holon, args.taskId, (t) =>
          addParticipant(t, user),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // task_remove_participant — remove a user from the participants array.
  server.registerTool(
    'task_remove_participant',
    {
      description: 'Remove a user from a task\'s participants by id.',
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
          removeParticipant(t, userId),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // task_toggle_participant — toggle a user in the participants array.
  server.registerTool(
    'task_toggle_participant',
    {
      description:
        'Toggle a user\'s membership in a task\'s participants. Defaults to the configured actor when `user` is omitted.',
      inputSchema: {
        holon: z.string(),
        taskId: z.string(),
        user: userSchema.optional(),
      },
    },
    async (args) => {
      try {
        const user = normalizeParticipant(args.user ?? actorAsParticipant(deps.resolveActor()));
        return await mutateAndSave(deps, args.holon, args.taskId, (t) =>
          toggleParticipant(t, user),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
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
        const user = normalizeParticipant(args.user ?? actorAsParticipant(deps.resolveActor()));
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
        const user = normalizeParticipant(args.user ?? actorAsParticipant(deps.resolveActor()));
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
      inputSchema: {
        holon: z.string(),
        taskId: z.string(),
        completerId: z
          .union([z.string(), z.number()])
          .optional()
          .describe('User id of the completer. Defaults to the configured actor.'),
        isAdmin: z
          .boolean()
          .optional()
          .describe('Set true to bypass initiator/participant check (caller has resolved admin rights elsewhere).'),
      },
    },
    async (args) => {
      try {
        const completerId = args.completerId ?? deps.resolveActor().id;
        const hs = await deps.getHoloSphere();
        const existing = await hs.get(args.holon, 'quests', args.taskId);
        if (!existing) {
          return fail('Task not found.', { holon: args.holon, taskId: args.taskId });
        }
        const result = applyTaskCompletion(existing as Quest, completerId, {
          isAdmin: args.isAdmin,
        });
        if (!result.ok) {
          return fail(`Cannot complete task: ${result.reason}.`, {
            holon: args.holon,
            taskId: args.taskId,
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
            taskId: args.taskId,
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
