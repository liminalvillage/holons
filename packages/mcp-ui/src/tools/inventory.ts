// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// MCP tools wrapping @holons/core/inventory: fungible stock folded from the
// REA stream, the reorder list, scarcity against open needs, and the
// federation rebalance plan.
//
// Thin shims, like the other tool files: parse args, call core, return JSON.
// Levels are never stored — every read folds `rea_events` on the spot.
import { z } from 'zod';
import {
  STOCK_LENS,
  buildStockEvent,
  buildStockTransfer,
  correctionKind,
  createStockItemSpec,
  demandsOf,
  federationCost,
  foldStock,
  positions,
  readCellStock,
  readStockItemSpecs,
  rebalancePlan,
  reorderList,
  reserve,
  scarcity,
  stockItemId,
  syncReorderToShopping,
  updateStockItemSpec,
  publishStockAggregate,
  type StockEventLike,
  type StockItemSpecRecord,
  type StockLevel,
  type StockPosition,
} from '@holons/core/inventory';
import { getFederationSnapshot } from '@holons/core/federation';
import { REAEventStore } from '@holons/core/rea';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './index.js';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, ...payload }, null, 2) }],
  };
}

function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }, null, 2) }],
    isError: true,
  };
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const asArray = (raw: unknown): unknown[] =>
  Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];

async function readSpecs(h: any, holon: string): Promise<StockItemSpecRecord[]> {
  return readStockItemSpecs(asArray(await h.getAll(holon, STOCK_LENS)));
}

async function readEvents(h: any, holon: string): Promise<StockEventLike[]> {
  return asArray(await h.getAll(holon, 'rea_events')) as StockEventLike[];
}

async function readNeeds(h: any, holon: string): Promise<unknown[]> {
  return asArray(await h.getAll(holon, 'quests')).filter(
    (q) => (q as { type?: string } | null)?.type === 'need'
  );
}

/** Our levels net of open needs, plus the specs and demands they came from. */
async function shelf(h: any, holon: string) {
  const [specs, events, needs] = await Promise.all([
    readSpecs(h, holon),
    readEvents(h, holon),
    readNeeds(h, holon),
  ]);
  const demands = demandsOf(needs as Parameters<typeof demandsOf>[0], holon);
  const levels = reserve(foldStock(events, holon), demands);
  return { specs, events, demands, levels };
}

function findSpec(specs: StockItemSpecRecord[], item: string): StockItemSpecRecord | null {
  const id = stockItemId(item);
  return specs.find((s) => s.id === id || s.id === item) ?? null;
}

export function registerInventoryTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'stock_shelf',
    'What a holon keeps: every stock item spec with its level folded from REA events (on hand, confirmed/pending, reserved for open needs, incoming), plus the reorder list.',
    { holon: z.string().describe('Holon id.') },
    async ({ holon }) => {
      try {
        const h = await deps.getHoloSphere();
        const { specs, levels, demands } = await shelf(h, holon);
        const byItem = new Map(levels.map((l) => [l.itemId, l]));
        return ok({
          holon,
          items: specs.map((spec) => ({ spec, level: byItem.get(spec.id) ?? null })),
          reorder: reorderList(levels, specs),
          scarcity: scarcity(levels, demands, specs),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'stock_item_upsert',
    'Create or update a stock item spec on the `stock` lens: name, category, unit (one|kg|l|m|pack|…), restock target and keep-back minimum. Null target/min clears them.',
    {
      holon: z.string().describe('Holon id.'),
      name: z.string().describe('Item name; the id is its slug (e.g. "Olive Oil" → olive-oil).'),
      category: z.string().optional().describe('Grouping shared with needs and shopping.'),
      unit: z.string().optional().describe('Unit of measure; "one" for a plain count.'),
      target: z.number().nullable().optional().describe('Level to restock up to.'),
      min: z.number().nullable().optional().describe('Level kept back from partners.'),
      actor: z.string().optional().describe('JSON actor override { id, username?, first_name? }.'),
    },
    async ({ holon, name, category, unit, target, min, actor }) => {
      try {
        const h = await deps.getHoloSphere();
        const who = deps.resolveActor(parseJson(actor, {}));
        const specs = await readSpecs(h, holon);
        const existing = findSpec(specs, name);
        const record = existing
          ? updateStockItemSpec(existing, { name, category, unit, target, min })
          : createStockItemSpec({
              name,
              category,
              unit,
              target: target ?? undefined,
              min: min ?? undefined,
              createdBy: who.id,
            });
        await h.put(holon, STOCK_LENS, record);
        return ok({ holon, item: record, created: !existing });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'stock_item_remove',
    'Remove a stock item spec from the shelf. Its movement history stays in the REA stream.',
    { holon: z.string().describe('Holon id.'), item: z.string().describe('Item name or id.') },
    async ({ holon, item }) => {
      try {
        const h = await deps.getHoloSphere();
        const spec = findSpec(await readSpecs(h, holon), item);
        if (!spec) return fail(`Unknown stock item "${item}"`);
        await h.delete(holon, STOCK_LENS, spec.id);
        return ok({ holon, removed: spec.id });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'stock_record',
    'Record a stock movement as a REA event: kind "add" (produced), "use" (consumed) or "count" (a correction to the given on-hand level → raised/lowered by the difference). Re-publishes the holon\'s totals to its home hex cell when it has one.',
    {
      holon: z.string().describe('Holon id.'),
      item: z.string().describe('Item name or id (must exist on the shelf).'),
      kind: z.enum(['add', 'use', 'count']).describe('add = came in, use = went out, count = what is on the shelf now.'),
      quantity: z.number().describe('Units, in the item\'s unit. For "count", the level observed.'),
      note: z.string().optional(),
      actor: z.string().optional().describe('JSON actor override { id, username?, first_name? }.'),
    },
    async ({ holon, item, kind, quantity, note, actor }) => {
      try {
        const h = await deps.getHoloSphere();
        const who = deps.resolveActor(parseJson(actor, {}));
        const { specs, levels } = await shelf(h, holon);
        const spec = findSpec(specs, item);
        if (!spec) return fail(`Unknown stock item "${item}"; create it with stock_item_upsert`);
        const level: StockLevel | undefined = levels.find((l) => l.itemId === spec.id);
        let eventKind: 'stock:produced' | 'stock:consumed' | 'stock:raised' | 'stock:lowered';
        let amount = quantity;
        if (kind === 'add') eventKind = 'stock:produced';
        else if (kind === 'use') eventKind = 'stock:consumed';
        else {
          const delta = quantity - (level?.onhand ?? 0);
          if (Math.abs(delta) < 0.0005) return ok({ holon, item: spec.id, unchanged: true, onhand: level?.onhand ?? 0 });
          eventKind = correctionKind(delta);
          amount = Math.abs(delta);
        }
        const event = buildStockEvent({
          holonId: holon,
          kind: eventKind,
          itemId: spec.id,
          quantity: amount,
          unit: spec.unit,
          actor: who,
          note: note ?? null,
        });
        await new REAEventStore(h).put(holon, event);
        const levelsAfter = foldStock(await readEvents(h, holon), holon);
        const after = levelsAfter.find((l) => l.itemId === spec.id);
        const published = await publishStockAggregate(h, { holonId: holon, levels: levelsAfter, specs }).catch(
          () => ({ ok: false as const, reason: 'no_hex' as const })
        );
        return ok({ holon, event, onhand: after?.onhand ?? null, cellPublished: published.ok });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'stock_reorder_to_shopping',
    'Write the reorder list (what to buy to reach every restock target) into the holon\'s shopping checklist, replacing earlier rows for the same items.',
    {
      holon: z.string().describe('Holon id.'),
      actor: z.string().optional().describe('JSON actor override { id, username?, first_name? }.'),
    },
    async ({ holon, actor }) => {
      try {
        const h = await deps.getHoloSphere();
        const who = deps.resolveActor(parseJson(actor, {}));
        const { specs, levels } = await shelf(h, holon);
        const lines = reorderList(levels, specs);
        const changed = await syncReorderToShopping(h, holon, lines, { creator: who.id });
        return ok({ holon, lines, rowsChanged: changed });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'stock_moves',
    'Shortages against open needs and the federation rebalance plan: which partner could move what to whom, nearest partnership first (core\'s transport plan). Reads each partner\'s stock and REA events directly — stock is public to the federation.',
    { holon: z.string().describe('Holon id.') },
    async ({ holon }) => {
      try {
        const h = await deps.getHoloSphere();
        const { specs, levels, demands } = await shelf(h, holon);
        const snapshot = await getFederationSnapshot(h, holon);
        const partners = (snapshot.federated ?? []).filter((id) => id && id !== holon);
        const all: StockPosition[] = positions(levels, demands, specs);
        const graph: Record<string, string[]> = { [holon]: partners };
        const partnerLevels: Record<string, StockLevel[]> = {};
        await Promise.all(
          partners.map(async (id) => {
            const [pSpecs, pEvents] = await Promise.all([readSpecs(h, id), readEvents(h, id)]);
            const pl = foldStock(pEvents, id);
            partnerLevels[id] = pl;
            all.push(...positions(pl, [], pSpecs));
            try {
              graph[id] = (await getFederationSnapshot(h, id)).federated ?? [];
            } catch {
              graph[id] = [holon];
            }
          })
        );
        return ok({
          holon,
          shortages: scarcity(levels, demands, specs).filter((s) => s.shortage > 0),
          positions: all,
          plan: rebalancePlan(all, federationCost(graph)),
          partnerNames: snapshot.partnerNames ?? {},
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'stock_transfer',
    'Record a transfer of stock between two holons (both must be readable; the event is stored on both under one id). Use for a leg of stock_moves\' plan.',
    {
      from: z.string().describe('Sending holon id.'),
      to: z.string().describe('Receiving holon id.'),
      item: z.string().describe('Item name or id, as kept by the receiver (falls back to the sender).'),
      quantity: z.number().describe('Units to move.'),
      note: z.string().optional(),
      actor: z.string().optional().describe('JSON actor override { id, username?, first_name? }.'),
    },
    async ({ from, to, item, quantity, note, actor }) => {
      try {
        const h = await deps.getHoloSphere();
        const who = deps.resolveActor(parseJson(actor, {}));
        const spec = findSpec(await readSpecs(h, to), item) ?? findSpec(await readSpecs(h, from), item);
        if (!spec) return fail(`Unknown stock item "${item}" on either holon`);
        const event = buildStockTransfer({
          fromHolonId: from,
          toHolonId: to,
          itemId: spec.id,
          quantity,
          unit: spec.unit,
          actor: who,
          note: note ?? null,
        });
        const store = new REAEventStore(h);
        await store.put(from, event);
        let both = true;
        try {
          await store.put(to, event);
        } catch {
          both = false;
        }
        return ok({ event, storedOn: both ? [from, to] : [from] });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'stock_cell',
    'What a hex cell holds: the per-category sum of every holon whose stock aggregate reached it (holons publish to their home cell and up the parents).',
    { cell: z.string().describe('H3 cell id.') },
    async ({ cell }) => {
      try {
        const h = await deps.getHoloSphere();
        return ok({ ...(await readCellStock(h, cell)) });
      } catch (err) {
        return fail(err);
      }
    }
  );
}
