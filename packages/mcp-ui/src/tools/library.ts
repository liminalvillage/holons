import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  addItem,
  borrowItem,
  detectItemType,
  getItem,
  getLibraryStats,
  listItems,
  recordBorrowAccounting,
  recordReturnAccounting,
  removeItem,
  returnItem,
  setItemValue,
  type AccountingDeps,
  type BorrowActor,
  type CreateLibraryItemOptions,
  type LibraryDB,
  type LibraryItem,
  type LibraryItemType,
  type REAEventFactoryLike,
  type REAEventStoreLike,
} from '@holons/core/library';
import type { ToolDeps } from './index.js';

// MCP-side accounting helpers: the REA event store and factory live in
// telegram-ui today. The MCP server has no transport for those domain
// services, so we plug in no-op stubs that satisfy the core interface while
// still letting `recordBorrow/ReturnAccounting` persist the credit-denominated
// expense bookkeeping (which only needs the HoloSphere `db`).
const NOOP_EVENT_STORE: REAEventStoreLike = {
  async put() {
    return undefined;
  },
};

const NOOP_EVENT_FACTORY: REAEventFactoryLike = {
  itemBorrowed() {
    return [];
  },
  itemReturned() {
    return [];
  },
};

type JsonResult = {
  content: Array<{ type: 'text'; text: string }>;
};

function ok(payload: Record<string, unknown>): JsonResult {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ success: true, ...payload }, null, 2) },
    ],
  };
}

function fail(error: string, extra: Record<string, unknown> = {}): JsonResult {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ success: false, error, ...extra }, null, 2) },
    ],
  };
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type ActorOverride = Partial<{
  id: string | number;
  first_name: string;
  last_name: string;
  username: string;
}>;

function buildBorrowActor(deps: ToolDeps, override: ActorOverride): BorrowActor {
  const resolved = deps.resolveActor(override);
  return {
    id: resolved.id,
    username: resolved.username,
    first_name: resolved.first_name,
    last_name: override.last_name,
  };
}

export function registerLibraryTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'library_item_add',
    'Add a new item to a holon library. options JSON must include `id` plus optional CreateLibraryItemOptions (category, description, value, createdBy, createdByUsername).',
    {
      holon: z.string(),
      options: z
        .string()
        .describe(
          'JSON-encoded object: { id: string, category?: string, description?: string, value?: number, createdBy?: number|string, createdByUsername?: string }'
        ),
      actor: z.string().optional().describe('JSON-encoded Actor override.'),
    },
    async ({ holon, options, actor }) => {
      const parsed = parseJson<CreateLibraryItemOptions & { id?: string; itemId?: string }>(
        options,
        {}
      );
      const itemId = parsed.id ?? parsed.itemId;
      if (!itemId) return fail('options.id is required');

      const resolved = deps.resolveActor(parseJson<ActorOverride>(actor, {}));
      const opts: CreateLibraryItemOptions = {
        createdBy: parsed.createdBy ?? resolved.id,
        createdByUsername: parsed.createdByUsername ?? resolved.username,
        category: parsed.category,
        description: parsed.description,
        value: parsed.value,
      };

      const db = (await deps.getHoloSphere()) as LibraryDB;
      const result = await addItem(db, holon, itemId, opts);
      if (!result.ok) return fail(result.reason ?? 'add_failed', { itemId });
      return ok({ item: result.item });
    }
  );

  server.tool(
    'library_item_remove',
    'Remove an item from a holon library by id.',
    {
      holon: z.string(),
      itemId: z.string(),
    },
    async ({ holon, itemId }) => {
      const db = (await deps.getHoloSphere()) as LibraryDB;
      await removeItem(db, holon, itemId);
      return ok({ itemId });
    }
  );

  // The core helper requires a return date; default to 7 days when omitted
  // (matches the existing bot flow).
  server.tool(
    'library_borrow',
    'Borrow a library item. Optional borrower JSON overrides the configured actor. Optional `returnBy` ISO date inside borrower JSON defaults to +7 days.',
    {
      holon: z.string(),
      itemId: z.string(),
      borrower: z
        .string()
        .optional()
        .describe(
          'JSON-encoded BorrowActor + optional returnBy ISO string: { id, username?, first_name?, last_name?, returnBy? }'
        ),
    },
    async ({ holon, itemId, borrower }) => {
      const override = parseJson<ActorOverride & { returnBy?: string }>(borrower, {});
      const actor = buildBorrowActor(deps, override);
      const returnBy = override.returnBy
        ? new Date(override.returnBy)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const db = (await deps.getHoloSphere()) as LibraryDB;
      const result = await borrowItem(db, holon, itemId, actor, returnBy);
      if (!result.ok) return fail(result.reason ?? 'borrow_failed', { itemId });
      return ok({ item: result.item, isOwner: result.isOwner });
    }
  );

  server.tool(
    'library_return',
    'Return a borrowed library item. Defaults the returner to the configured actor.',
    {
      holon: z.string(),
      itemId: z.string(),
      actor: z
        .string()
        .optional()
        .describe('JSON-encoded BorrowActor override for the returner.'),
    },
    async ({ holon, itemId, actor }) => {
      const returner = buildBorrowActor(deps, parseJson<ActorOverride>(actor, {}));
      const db = (await deps.getHoloSphere()) as LibraryDB;
      const result = await returnItem(db, holon, itemId, returner);
      if (!result.ok) return fail(result.reason ?? 'return_failed', { item: result.item });
      return ok({ item: result.item, isOwner: result.isOwner });
    }
  );

  server.tool(
    'library_set_value',
    "Set an item's credit value. Only the item's createdBy user may change it.",
    {
      holon: z.string(),
      itemId: z.string(),
      value: z.number(),
      actor: z.string().optional().describe('JSON-encoded Actor override for the requesting user.'),
    },
    async ({ holon, itemId, value, actor }) => {
      const resolved = deps.resolveActor(parseJson<ActorOverride>(actor, {}));
      const db = (await deps.getHoloSphere()) as LibraryDB;
      const result = await setItemValue(db, holon, itemId, value, resolved.id);
      if (!result.ok) return fail(result.reason ?? 'set_value_failed', { itemId });
      return ok({ item: result.item });
    }
  );

  server.tool(
    'library_list',
    'List library items for a holon. Optional `type` filters to one of tool|book|equipment|other.',
    {
      holon: z.string(),
      type: z.string().optional(),
    },
    async ({ holon, type }) => {
      const db = (await deps.getHoloSphere()) as LibraryDB;
      const all = await listItems(db, holon);
      const items = type ? all.filter((i) => i.type === (type as LibraryItemType)) : all;
      return ok({ count: items.length, items });
    }
  );

  server.tool(
    'library_stats',
    'Aggregate library stats for a holon: totals, borrowed/available counts, and byType breakdown.',
    {
      holon: z.string(),
    },
    async ({ holon }) => {
      const db = (await deps.getHoloSphere()) as LibraryDB;
      const items = await listItems(db, holon);
      const stats = getLibraryStats(items);
      return ok({ stats });
    }
  );

  server.tool(
    'library_item_get',
    'Fetch a single library item by id from a holon. Returns null when absent.',
    {
      holon: z.string(),
      itemId: z.string(),
    },
    async ({ holon, itemId }) => {
      const db = (await deps.getHoloSphere()) as LibraryDB;
      const item = await getItem(db, holon, itemId);
      return ok({ item });
    }
  );

  server.tool(
    'library_borrow_accounting_record',
    'Record borrow-side bookkeeping for a library item (credit-denominated expense + REA events). Skipped when the borrower owns the item or the item has no value. REA events are no-ops in the MCP context — the expense entry is still persisted.',
    {
      holon: z.string(),
      borrower: z
        .string()
        .optional()
        .describe('JSON-encoded BorrowActor override: { id, username?, first_name?, last_name? }'),
      item: z.string().describe('JSON-encoded LibraryItem snapshot to bill against.'),
    },
    async ({ holon, borrower, item }) => {
      const actor = buildBorrowActor(deps, parseJson<ActorOverride>(borrower, {}));
      const parsedItem = parseJson<LibraryItem | null>(item, null);
      if (!parsedItem) return fail('item is required');

      const db = (await deps.getHoloSphere()) as LibraryDB;
      const accountingDeps: AccountingDeps = {
        db,
        eventStore: NOOP_EVENT_STORE,
        eventFactory: NOOP_EVENT_FACTORY,
      };
      await recordBorrowAccounting(accountingDeps, holon, actor, parsedItem);
      return ok({ itemId: parsedItem.id });
    }
  );

  server.tool(
    'library_return_accounting_record',
    'Record return-side bookkeeping for a library item (refund expense + REA events). Skipped when the returner owns the item or the item has no value. REA events are no-ops in the MCP context — the refund expense is still persisted.',
    {
      holon: z.string(),
      returner: z
        .string()
        .optional()
        .describe('JSON-encoded BorrowActor override for the returner.'),
      item: z.string().describe('JSON-encoded LibraryItem snapshot being returned.'),
    },
    async ({ holon, returner, item }) => {
      const actor = buildBorrowActor(deps, parseJson<ActorOverride>(returner, {}));
      const parsedItem = parseJson<LibraryItem | null>(item, null);
      if (!parsedItem) return fail('item is required');

      const db = (await deps.getHoloSphere()) as LibraryDB;
      const accountingDeps: AccountingDeps = {
        db,
        eventStore: NOOP_EVENT_STORE,
        eventFactory: NOOP_EVENT_FACTORY,
      };
      await recordReturnAccounting(accountingDeps, holon, actor, parsedItem);
      return ok({ itemId: parsedItem.id });
    }
  );

  server.tool(
    'library_detect_item_type',
    'Infer a likely library item category (tool|book|equipment|other) from free text.',
    {
      text: z.string(),
    },
    async ({ text }) => {
      return ok({ type: detectItemType(text) });
    }
  );
}
