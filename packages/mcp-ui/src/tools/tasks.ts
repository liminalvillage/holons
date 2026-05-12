// Thin MCP wrappers around @holons/core/tasks. `task_get` is the only tool
// that isn't a direct re-export — core has no read helper, so we go through
// HoloSphere.get directly.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createTaskRecord,
  saveTaskToHolon,
  saveTasksToHolon,
  type Quest,
} from '@holons/core/tasks';
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

// --- registration --------------------------------------------------------

export function registerTasksTools(server: McpServer, deps: ToolDeps): void {
  // task_create — build a Quest via createTaskRecord, optionally persist.
  server.registerTool(
    'task_create',
    {
      description:
        'Create a new task/quest record for a holon. Wraps @holons/core/tasks createTaskRecord. Pass persist:true to write it to HoloSphere under the "quests" bucket.',
      inputSchema: {
        holon: z.string().describe('Holon id (e.g. Telegram chat id, Discord channel id).'),
        title: z.string().min(1),
        description: z.string().optional(),
        orderIndex: z.number().int().optional(),
        id: z.string().optional().describe('Override the generated id (createTaskRecord leaves it empty by default).'),
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
        if (args.id !== undefined) task.id = args.id;
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
}
