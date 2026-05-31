// Thin MCP wrappers around @holons/core/scheduler. Reminders live under the
// `reminders` lens; the scheduling math (cadence advance, due filtering) is
// owned by core. Delivery is a UI concern and is not handled here.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  FREQUENCIES,
  deleteReminder,
  dueReminders,
  listReminders,
  saveReminder,
  type Frequency,
  type Reminder,
  type SchedulerDB,
} from '@holons/core/scheduler';
import type { ToolDeps } from './index.js';

function ok(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function fail(message: string) {
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: JSON.stringify({ success: false, error: message }, null, 2) },
    ],
  };
}

async function db(deps: ToolDeps): Promise<SchedulerDB> {
  return (await deps.getHoloSphere()) as unknown as SchedulerDB;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export function registerSchedulerTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'reminder_create',
    {
      description:
        'Schedule a reminder for a holon. Wraps @holons/core/scheduler saveReminder (lens "reminders"). One-shot unless `frequency` is given.',
      inputSchema: {
        holon: z.string(),
        text: z.string().describe('Reminder text.'),
        fireAt: z.string().describe('ISO timestamp of the (first) fire.'),
        frequency: z
          .enum(FREQUENCIES as [Frequency, ...Frequency[]])
          .optional()
          .describe('Recurrence cadence; omit for a one-shot.'),
        channelId: z.string().optional().describe('UI delivery target (e.g. Discord channel id).'),
      },
    },
    async (args) => {
      try {
        const actor = deps.resolveActor();
        const reminder: Reminder = {
          id: genId(),
          holonId: args.holon,
          text: args.text,
          fireAt: new Date(args.fireAt).toISOString(),
          createdBy: actor.id,
          frequency: args.frequency ?? null,
          ...(args.channelId ? { channelId: args.channelId } : {}),
          created: new Date().toISOString(),
        };
        await saveReminder(await db(deps), reminder);
        return ok({ success: true, reminder });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'reminder_list',
    {
      description: 'List a holon\'s reminders (soonest first). Wraps listReminders.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const reminders = await listReminders(await db(deps), args.holon);
        return ok({ success: true, count: reminders.length, reminders });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'reminder_delete',
    {
      description: 'Delete a reminder by id. Wraps deleteReminder.',
      inputSchema: { holon: z.string(), reminderId: z.string() },
    },
    async (args) => {
      try {
        await deleteReminder(await db(deps), args.holon, args.reminderId);
        return ok({ success: true, removed: args.reminderId });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'reminder_due',
    {
      description:
        'List a holon\'s reminders that are due now (fireAt <= now). Wraps listReminders + dueReminders.',
      inputSchema: {
        holon: z.string(),
        now: z.string().optional().describe('ISO "now" override; defaults to the current time.'),
      },
    },
    async (args) => {
      try {
        const reminders = await listReminders(await db(deps), args.holon);
        const nowIso = args.now ? new Date(args.now).toISOString() : new Date().toISOString();
        const due = dueReminders(reminders, nowIso);
        return ok({ success: true, now: nowIso, count: due.length, due });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
