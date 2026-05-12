// Thin MCP wrappers around @holons/core/checklists.
//
// Mapping note: the unit-8 brief calls these "subtasks", but @holons/core
// models a checklist as { id, items: ChecklistItem[] } where ChecklistItem
// is { text, checked } addressed by INDEX (no per-item stable id). We expose
// the brief's tool names verbatim (`subtask_add` / `subtask_toggle` /
// `subtask_delete`) and resolve `subtaskId` to a numeric index — either
// directly (numeric string) or by matching the item's `text` field.
//
// `checklist_create` accepts an optional `taskId` to link the checklist to a
// quest (core stores this as questId + type='quest').
//
// All tools route persistence through deps.getHoloSphere() — HoloSphere
// already satisfies the ChecklistStore shape (get/getAll/put/delete).

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CHECKLIST_TYPES,
  addItemsToChecklist,
  createChecklist,
  getChecklist,
  removeItemAt,
  toggleItem,
  type ChecklistStore,
} from '@holons/core/checklists';
import type { ToolDeps } from './index.js';

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

/** Resolve a `subtaskId` (numeric index OR item text) to a numeric index. */
async function resolveItemIndex(
  store: ChecklistStore,
  holon: string,
  checklistId: string,
  subtaskId: string,
): Promise<{ index: number } | { error: string }> {
  // Numeric path — accept "0", "3", etc.
  if (/^\d+$/.test(subtaskId)) {
    return { index: parseInt(subtaskId, 10) };
  }
  // Text path — look up the checklist and match item.text.
  const cl = await getChecklist(store, holon, checklistId);
  if (!cl) return { error: 'checklist_not_found' };
  const idx = cl.items.findIndex((i) => i.text === subtaskId);
  if (idx === -1) return { error: 'subtask_not_found' };
  return { index: idx };
}

// --- registration --------------------------------------------------------

export function registerChecklistsTools(server: McpServer, deps: ToolDeps): void {
  // checklist_create — create a checklist (optionally quest-linked via taskId).
  server.registerTool(
    'checklist_create',
    {
      description:
        'Create a new checklist for a holon. Wraps @holons/core/checklists createChecklist. Pass taskId to link the checklist to a quest (stored as questId, type="quest"). The `title` is used as the checklist id (underscores not allowed).',
      inputSchema: {
        holon: z
          .string()
          .describe('Holon id (e.g. Telegram chat id, Discord channel id).'),
        title: z
          .string()
          .min(1)
          .describe('Checklist name; becomes the checklist id. Must not contain underscores.'),
        taskId: z
          .string()
          .optional()
          .describe('If set, link this checklist to a quest (stored as questId, type="quest").'),
      },
    },
    async (args) => {
      try {
        const hs = (await deps.getHoloSphere()) as ChecklistStore;
        const actor = deps.resolveActor();
        const result = await createChecklist(hs, args.holon, args.title, {
          creator: actor.id,
          ...(args.taskId
            ? {
                type: CHECKLIST_TYPES.QUEST,
                questId: args.taskId,
                parentTitle: args.title,
                holonId: args.holon,
              }
            : {}),
        });
        if (!result.ok) {
          return fail(`Cannot create checklist: ${result.reason}`, {
            reason: result.reason,
          });
        }
        return ok({ success: true, checklist: result.checklist });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // subtask_add — append a single item to an existing checklist.
  server.registerTool(
    'subtask_add',
    {
      description:
        'Append a subtask (ChecklistItem) to an existing checklist. Wraps @holons/core/checklists addItemsToChecklist with a single item.',
      inputSchema: {
        holon: z.string(),
        checklistId: z.string().describe('Existing checklist id.'),
        title: z.string().min(1).describe('Subtask text.'),
      },
    },
    async (args) => {
      try {
        const hs = (await deps.getHoloSphere()) as ChecklistStore;
        const result = await addItemsToChecklist(
          hs,
          args.holon,
          args.checklistId,
          args.title,
        );
        if (!result.ok) {
          return fail(`Cannot add subtask: ${result.reason}`, {
            reason: result.reason,
          });
        }
        return ok({
          success: true,
          checklist: result.checklist,
          added: result.added,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // subtask_toggle — flip the `checked` flag on one item.
  server.registerTool(
    'subtask_toggle',
    {
      description:
        'Toggle the checked state of a subtask. `subtaskId` is either a numeric index ("0", "3") or the subtask text. Wraps @holons/core/checklists toggleItem.',
      inputSchema: {
        holon: z.string(),
        checklistId: z.string(),
        subtaskId: z
          .string()
          .describe('Numeric item index or exact subtask text.'),
      },
    },
    async (args) => {
      try {
        const hs = (await deps.getHoloSphere()) as ChecklistStore;
        const resolved = await resolveItemIndex(
          hs,
          args.holon,
          args.checklistId,
          args.subtaskId,
        );
        if ('error' in resolved) return fail(resolved.error);
        const checklist = await toggleItem(
          hs,
          args.holon,
          args.checklistId,
          resolved.index,
        );
        if (!checklist) {
          return fail('subtask_not_found', { reason: 'subtask_not_found' });
        }
        return ok({ success: true, checklist });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // subtask_delete — remove one item.
  server.registerTool(
    'subtask_delete',
    {
      description:
        'Delete a subtask from a checklist. `subtaskId` is either a numeric index ("0", "3") or the subtask text. Wraps @holons/core/checklists removeItemAt.',
      inputSchema: {
        holon: z.string(),
        checklistId: z.string(),
        subtaskId: z
          .string()
          .describe('Numeric item index or exact subtask text.'),
      },
    },
    async (args) => {
      try {
        const hs = (await deps.getHoloSphere()) as ChecklistStore;
        const resolved = await resolveItemIndex(
          hs,
          args.holon,
          args.checklistId,
          args.subtaskId,
        );
        if ('error' in resolved) return fail(resolved.error);
        const result = await removeItemAt(
          hs,
          args.holon,
          args.checklistId,
          resolved.index,
        );
        if (!result) {
          return fail('subtask_not_found', { reason: 'subtask_not_found' });
        }
        return ok({
          success: true,
          checklist: result.checklist,
          removed: result.removed,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
