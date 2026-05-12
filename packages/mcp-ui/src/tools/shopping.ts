// Thin MCP wrappers around @holons/core/shopping. Persistence layout matches
// telegram-ui Shopping.ts: a single container doc at (holon, 'checklists') with
// id 'shopping' holding all items. We always write the *whole list* back since
// that is the shape the web and telegram UIs expect.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createShoppingItem,
  toggleItem,
  removeItem,
  normalizeChecklist,
  createEmptyChecklist,
  addItems,
  CHECKLISTS_COLLECTION,
  SHOPPING_KEY,
  type ShoppingChecklist,
  type ShoppingItem,
} from '@holons/core/shopping';
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

/**
 * Load the current shopping checklist for a holon, falling back to a fresh
 * empty container when nothing is stored yet. Returns `null` if the HoloSphere
 * instance lacks `get` (mostly relevant in unit-test environments).
 */
async function loadList(
  hs: any,
  holon: string,
): Promise<ShoppingChecklist | null> {
  if (typeof hs.get !== 'function') return null;
  const raw = await hs.get(holon, CHECKLISTS_COLLECTION, SHOPPING_KEY);
  return normalizeChecklist(raw) ?? createEmptyChecklist();
}

/**
 * Persist a checklist back under (holon, 'checklists'). Web + telegram both
 * call `put(holon, 'checklists', list)` — the list's own `id: 'shopping'`
 * disambiguates it from other checklist docs.
 */
async function saveList(
  hs: any,
  holon: string,
  list: ShoppingChecklist,
): Promise<boolean> {
  if (typeof hs.put !== 'function') return false;
  await hs.put(holon, CHECKLISTS_COLLECTION, list);
  return true;
}

/** Parse the `item` arg, which may be a JSON string or a raw text string. */
function parseItemArg(raw: string): { text: string; opts: Parameters<typeof createShoppingItem>[1] } {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
    try {
      const decoded = JSON.parse(trimmed);
      if (typeof decoded === 'string') return { text: decoded, opts: {} };
      if (decoded && typeof decoded === 'object') {
        const { text, id, createdBy, checked } = decoded as Record<string, unknown>;
        return {
          text: String(text ?? ''),
          opts: {
            ...(id !== undefined ? { id: id as string | number } : {}),
            ...(createdBy !== undefined ? { createdBy: createdBy as string | number } : {}),
            ...(checked !== undefined ? { checked: Boolean(checked) } : {}),
          },
        };
      }
    } catch {
      // Fall through to treating it as a plain string.
    }
  }
  return { text: trimmed, opts: {} };
}

// --- registration --------------------------------------------------------

export function registerShoppingTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'shopping_item_create',
    {
      description:
        'Create a shopping item record for a holon. Wraps @holons/core/shopping createShoppingItem. Pass persist:true to append it to the holon\'s checklist under (holon, "checklists", "shopping").',
      inputSchema: {
        holon: z.string().describe('Holon id (e.g. Telegram chat id, Discord channel id).'),
        item: z
          .string()
          .describe(
            'JSON-encoded item. Either a plain string (treated as text) or an object {text, id?, createdBy?, checked?}.',
          ),
        persist: z
          .boolean()
          .optional()
          .describe('If true, write the updated checklist to HoloSphere under (holon, "checklists").'),
      },
    },
    async (args) => {
      try {
        const actor = deps.resolveActor();
        const { text, opts } = parseItemArg(args.item);
        if (!text) return fail("'item' must decode to a non-empty text or { text } object.");

        const item: ShoppingItem = createShoppingItem(text, {
          createdBy: actor.id,
          ...opts,
        });

        let persisted = false;
        let list: ShoppingChecklist | null = null;
        if (args.persist) {
          const hs = await deps.getHoloSphere();
          list = (await loadList(hs, args.holon)) ?? createEmptyChecklist();
          list = { ...list, items: [...list.items, item] };
          persisted = await saveList(hs, args.holon, list);
        }
        return ok({ success: true, persisted, item, list });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'shopping_item_toggle',
    {
      description:
        'Toggle the `checked` flag on one shopping item. Wraps @holons/core/shopping toggleItem and writes the result back to HoloSphere.',
      inputSchema: {
        holon: z.string(),
        itemId: z
          .union([z.string(), z.number()])
          .describe('The id of the item to toggle (compared via String()).'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const list = await loadList(hs, args.holon);
        if (!list) return fail('No shopping checklist exists for this holon.');

        const target = String(args.itemId);
        if (!list.items.some((i) => String(i.id) === target)) {
          return fail(`Item ${args.itemId} not found in checklist.`, {
            itemIds: list.items.map((i) => i.id),
          });
        }

        const updated = toggleItem(list, args.itemId)!;
        const persisted = await saveList(hs, args.holon, updated);
        return ok({ success: true, persisted, list: updated });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // Tool id `_delete` maps to core's `removeItem` — they are the same operation.
  server.registerTool(
    'shopping_item_delete',
    {
      description:
        'Delete one shopping item from a holon\'s checklist by id. Wraps @holons/core/shopping removeItem and writes the result back to HoloSphere.',
      inputSchema: {
        holon: z.string(),
        itemId: z.union([z.string(), z.number()]),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const list = await loadList(hs, args.holon);
        if (!list) return fail('No shopping checklist exists for this holon.');

        const updated = removeItem(list, args.itemId)!;
        if (updated.items.length === list.items.length) {
          return fail(`Item ${args.itemId} not found in checklist.`, {
            itemIds: list.items.map((i) => i.id),
          });
        }

        const persisted = await saveList(hs, args.holon, updated);
        return ok({ success: true, persisted, removedId: args.itemId, list: updated });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // --- pure helpers (no I/O) ---------------------------------------------
  // These mirror @holons/core/shopping exports 1:1 so callers can compose
  // checklist updates client-side without round-tripping through HoloSphere.

  server.registerTool(
    'shopping_checklist_create_empty',
    {
      description:
        'Build a fresh empty shopping checklist container. Pure wrapper around @holons/core/shopping createEmptyChecklist — does not touch HoloSphere. Returns the new container (id: "shopping", type: "shopping", items: []).',
      inputSchema: {
        holon: z
          .string()
          .describe('Holon id for context (echoed in the response; not written to storage).'),
      },
    },
    async (args) => {
      try {
        const checklist = createEmptyChecklist();
        return ok({ success: true, holon: args.holon, checklist });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'shopping_normalize_checklist',
    {
      description:
        'Coerce a raw shopping document (e.g. from gun/HoloSphere) into a normalized ShoppingChecklist, or null if the doc is deleted/absent. Pure wrapper around @holons/core/shopping normalizeChecklist.',
      inputSchema: {
        raw: z
          .string()
          .describe('JSON-encoded raw document to normalize.'),
      },
    },
    async (args) => {
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(args.raw);
        } catch {
          return fail("'raw' must be a JSON-encoded value.");
        }
        const checklist = normalizeChecklist(parsed);
        return ok({ success: true, checklist });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'shopping_items_add_batch',
    {
      description:
        'Append multiple items to a shopping checklist in one call. Pure wrapper around @holons/core/shopping addItems — blanks are dropped, input is not mutated. Pass `checklist` as null/JSON-null to seed from an empty container.',
      inputSchema: {
        checklist: z
          .string()
          .describe('JSON-encoded ShoppingChecklist (or "null" to start from an empty container).'),
        items: z
          .string()
          .describe('JSON-encoded array of item text strings (e.g. ["milk","bread"]).'),
      },
    },
    async (args) => {
      try {
        let parsedChecklist: unknown;
        let parsedItems: unknown;
        try {
          parsedChecklist = JSON.parse(args.checklist);
        } catch {
          return fail("'checklist' must be a JSON-encoded ShoppingChecklist or null.");
        }
        try {
          parsedItems = JSON.parse(args.items);
        } catch {
          return fail("'items' must be a JSON-encoded array of strings.");
        }
        if (!Array.isArray(parsedItems)) {
          return fail("'items' must decode to an array.");
        }
        const texts = parsedItems.map((t) => String(t));
        const base =
          parsedChecklist == null
            ? null
            : normalizeChecklist(parsedChecklist);
        const actor = deps.resolveActor();
        const updated = addItems(base, texts, { createdBy: actor.id });
        return ok({ success: true, checklist: updated });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
