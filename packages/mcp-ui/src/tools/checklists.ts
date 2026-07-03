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
  createChecklistObject,
  getChecklist,
  migrateLegacyChecklistType,
  removeItemAt,
  toggleItem,
  type Checklist,
  type ChecklistStore,
  type ChecklistType,
} from '@holons/core/checklists';
import { saveTaskToHolon, type Quest } from '@holons/core/tasks';
import type { ToolDeps } from './index.js';

const CHECKLIST_TYPE_VALUES = Object.values(CHECKLIST_TYPES) as ChecklistType[];

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

  // subtask_add — append a single item to a checklist, resolving through the
  // task when given a quest id (the common case for LLM/voice callers).
  server.registerTool(
    'subtask_add',
    {
      description:
        'Append a subtask (ChecklistItem) to a checklist. Accepts a checklist id OR a task/quest id: given a task id, the task\'s linked checklist is used, and when the task has none a checklist is created and linked to it (quest.checklistId) automatically. Wraps @holons/core/checklists addItemsToChecklist with a single item.',
      inputSchema: {
        holon: z.string(),
        checklistId: z
          .string()
          .describe('Checklist id, or a task/quest id to resolve its checklist.'),
        title: z.string().min(1).describe('Subtask text.'),
      },
    },
    async (args) => {
      try {
        const hs = (await deps.getHoloSphere()) as ChecklistStore;
        let checklistId = args.checklistId;
        let checklist = await getChecklist(hs, args.holon, checklistId);

        if (!checklist) {
          // Not a checklist id — try it as a quest id.
          const quest = (await hs.get(args.holon, 'quests', args.checklistId)) as
            | Quest
            | null;

          if (quest) {
            if (quest.checklistId) {
              checklist = await getChecklist(hs, args.holon, String(quest.checklistId));
            }
            if (!checklist) {
              // Adopt an existing checklist for this quest (a previous caller
              // may have created one without writing quest.checklistId back).
              const title = `${String(quest.title ?? quest.id)} checklist`
                .replace(/_/g, ' ')
                .trim();
              const all = ((await hs.getAll(args.holon, 'checklists')) ??
                []) as Checklist[];
              checklist =
                all.find(
                  (c) => String((c as { questId?: unknown }).questId) === String(quest.id),
                ) ??
                all.find((c) => c.id === title) ??
                null;
            }
            if (!checklist) {
              // No checklist anywhere — create one.
              const actor = deps.resolveActor();
              const title = `${String(quest.title ?? quest.id)} checklist`
                .replace(/_/g, ' ')
                .trim();
              const created = await createChecklist(hs, args.holon, title, {
                creator: actor.id,
                type: CHECKLIST_TYPES.QUEST,
                questId: String(quest.id),
                parentTitle: String(quest.title ?? title),
                holonId: args.holon,
              });
              if (!created.ok) {
                return fail(`Cannot create checklist for task: ${created.reason}`, {
                  reason: created.reason,
                });
              }
              checklist = created.checklist;
            }
            checklistId = checklist.id;
            if (quest.checklistId !== checklist.id) {
              quest.checklistId = checklist.id;
              await saveTaskToHolon(
                hs as Parameters<typeof saveTaskToHolon>[0],
                args.holon,
                quest,
              );
            }
          }
        }

        if (!checklist) {
          return fail('Cannot add subtask: not_found', { reason: 'not_found' });
        }

        const result = await addItemsToChecklist(
          hs,
          args.holon,
          checklistId,
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

  // checklist_get — fetch a single checklist by id.
  server.registerTool(
    'checklist_get',
    {
      description:
        'Fetch a single checklist (with items) by id. Wraps @holons/core/checklists getChecklist. Returns null in the `checklist` field if the record does not exist; legacy records are migrated to the typed shape transparently.',
      inputSchema: {
        holon: z.string().describe('Holon id.'),
        checklistId: z.string().describe('Existing checklist id.'),
      },
    },
    async (args) => {
      try {
        const hs = (await deps.getHoloSphere()) as ChecklistStore;
        const checklist = await getChecklist(hs, args.holon, args.checklistId);
        return ok({ success: true, checklist });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // checklist_migrate_legacy_type — pure migration helper.
  server.registerTool(
    'checklist_migrate_legacy_type',
    {
      description:
        'Pure helper that infers the `type` field of a legacy checklist record (pre-typed-shape). Accepts a JSON string of a single checklist and returns the migrated checklist. Wraps @holons/core/checklists migrateLegacyChecklistType. No storage I/O.',
      inputSchema: {
        checklist: z
          .string()
          .describe('JSON-encoded Checklist record to migrate.'),
      },
    },
    async (args) => {
      try {
        let parsed: Checklist;
        try {
          parsed = JSON.parse(args.checklist) as Checklist;
        } catch (parseErr) {
          return fail(`invalid_json: ${(parseErr as Error).message}`);
        }
        const migrated = migrateLegacyChecklistType(parsed);
        return ok({ success: true, checklist: migrated });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // checklist_build_object — pure factory for a checklist record (no I/O).
  // Distinct from `checklist_create`: this only builds the in-memory record
  // (createChecklistObject), while `checklist_create` persists with a
  // collision check (createChecklist). Useful when the caller wants to
  // construct + inspect the record without committing it.
  server.registerTool(
    'checklist_build_object',
    {
      description:
        'Pure helper that builds a checklist record with the right type-specific fields. Wraps @holons/core/checklists createChecklistObject — does NOT persist. Use `checklist_create` if you want to save it.',
      inputSchema: {
        id: z.string().describe('Checklist id (also used as name).'),
        type: z
          .enum(CHECKLIST_TYPE_VALUES as [ChecklistType, ...ChecklistType[]])
          .describe('Checklist type (checklist|agenda|shopping|quest|role).'),
        creator: z
          .string()
          .optional()
          .describe('Creator id (optional). Falls back to resolved actor id.'),
        questId: z.string().optional(),
        roleId: z.string().optional(),
        parentTitle: z.string().optional(),
        holonId: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const actor = deps.resolveActor();
        const checklist = createChecklistObject(args.id, args.type, {
          creator: args.creator ?? actor.id,
          questId: args.questId,
          roleId: args.roleId,
          parentTitle: args.parentTitle,
          holonId: args.holonId,
        });
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
