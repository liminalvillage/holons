// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Thin MCP wrappers around @holons/core/needs — the geolocated needs network.
// A need's canonical record lives at (holon, 'quests', needId); hex-cell map
// projections live under (cell, 'needs') as holograms. See
// docs/needs-offers-network.md.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  needFromShoppingItem,
  normalizeNeed,
  respondToNeed,
  closeNeed,
  publishNeedNearby,
  refreshPublishedNeed,
  NEED_RECORD_LENS,
  NEEDS_LENS,
} from '@holons/core/needs';
import {
  normalizeChecklist,
  stampNeedId,
  CHECKLISTS_COLLECTION,
  SHOPPING_KEY,
} from '@holons/core/shopping';
import type { ToolDeps } from './index.js';

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

async function loadNeed(hs: any, holon: string, needId: string) {
  if (typeof hs.get !== 'function') return null;
  const raw = await hs.get(holon, NEED_RECORD_LENS, needId);
  return normalizeNeed(raw);
}

export function registerNeedsTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'need_publish_from_shopping_item',
    {
      description:
        "Publish a shopping-list item as a geolocated need. Builds the need (type:'need', status:'requested') from the item, persists it at (holon, 'quests'), publishes copies to federation partners (toPartners, default true) and/or a live hologram at the holon's settings.hex cell under the 'needs' lens (toHex, default false), and stamps the shopping item with the needId so checking it off can close the need.",
      inputSchema: {
        holon: z.string().describe('Holon id owning the shopping list.'),
        itemId: z
          .union([z.string(), z.number()])
          .describe('Shopping item id to publish (compared via String()).'),
        toPartners: z
          .boolean()
          .optional()
          .describe('Publish standalone copies to federation partners. Default true.'),
        toHex: z
          .boolean()
          .optional()
          .describe(
            "Publish a hologram to the holon's settings.hex cell so the map's Local Needs layer lights. Requires a valid hex address in settings. Default false.",
          ),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const raw = await hs.get(args.holon, CHECKLISTS_COLLECTION, SHOPPING_KEY);
        const list = normalizeChecklist(raw);
        if (!list) return fail('No shopping checklist exists for this holon.');
        const target = String(args.itemId);
        const item = list.items.find((i) => String(i.id) === target);
        if (!item) {
          return fail(`Item ${args.itemId} not found in checklist.`, {
            itemIds: list.items.map((i) => i.id),
          });
        }

        const actor = deps.resolveActor();
        const need = needFromShoppingItem(item, {
          holonId: args.holon,
          initiator: { id: actor.id, username: actor.username },
        });
        const outcome = await publishNeedNearby(hs, args.holon, need, {
          toPartners: args.toPartners !== false,
          toHex: args.toHex === true,
        });

        const stamped = stampNeedId(list, item.id, String(need.id));
        if (stamped) await hs.put(args.holon, CHECKLISTS_COLLECTION, stamped);

        return ok({
          success: true,
          need: outcome.need,
          publishedToPartners: outcome.partners?.publishedTo ?? 0,
          publishedToHex: outcome.hexCell?.destinations ?? [],
          errors: outcome.errors,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'need_respond',
    {
      description:
        "Respond to a published need as a provider: appends a response (message + optional price) on the need record and flips its status to 'offered'. Write goes to the holon that owns the need (pass the owner holon id — for a foreign need use its _federation.origin / _hologram source).",
      inputSchema: {
        holon: z.string().describe('Holon id that OWNS the need record.'),
        needId: z.string().describe("Need id under (holon, 'quests')."),
        message: z.string().optional().describe('What the provider can supply, and when.'),
        price: z.number().optional().describe('Offered price (market price).'),
        currency: z.string().optional().describe("Currency code for the price, e.g. 'EUR'."),
        responderHolon: z
          .string()
          .optional()
          .describe("The provider's own holon id, for follow-up."),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const need = await loadNeed(hs, args.holon, args.needId);
        if (!need) return fail(`Need ${args.needId} not found on holon ${args.holon}.`);

        const actor = deps.resolveActor();
        const result = respondToNeed(need, {
          responder: {
            id: actor.id,
            name: actor.username,
            ...(args.responderHolon ? { holonId: args.responderHolon } : {}),
          },
          message: args.message,
          price: args.price,
          currency: args.currency,
        });
        if (!result.ok) {
          return fail(`Cannot respond: ${result.reason}`, { status: need.status });
        }
        await hs.put(args.holon, NEED_RECORD_LENS, result.need);
        return ok({ success: true, need: result.need, response: result.response });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'need_close',
    {
      description:
        "Close a published need: outcome 'fulfilled' (the underlying want was met) or 'cancelled' (retracted). Persists locally and re-publishes to federation partners the need was previously shared with; a hex hologram updates automatically.",
      inputSchema: {
        holon: z.string().describe('Holon id that owns the need record.'),
        needId: z.string(),
        outcome: z.enum(['fulfilled', 'cancelled']),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const need = await loadNeed(hs, args.holon, args.needId);
        if (!need) return fail(`Need ${args.needId} not found on holon ${args.holon}.`);

        const result = closeNeed(need, args.outcome);
        if (!result.ok) {
          return fail(`Cannot close: ${result.reason}`, { status: need.status });
        }
        const refreshed = await refreshPublishedNeed(hs, args.holon, result.need);
        return ok({ success: true, need: refreshed.need, errors: refreshed.errors });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'needs_list_at_hex',
    {
      description:
        "List the needs visible at an H3 cell — what the map's Local Needs layer shows there. Reads (cell, 'needs'); records are holograms resolved live from their owner holons. Closed needs (fulfilled/cancelled) are filtered out unless includeClosed is true.",
      inputSchema: {
        cell: z.string().describe('H3 cell id (e.g. 8928308280fffff).'),
        includeClosed: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        if (typeof hs.getAll !== 'function') return fail('HoloSphere getAll unavailable.');
        const raw: unknown[] = (await hs.getAll(args.cell, NEEDS_LENS)) ?? [];
        const needs = raw
          .map((r) => normalizeNeed(r))
          .filter((n): n is NonNullable<typeof n> => n != null)
          .filter(
            (n) =>
              args.includeClosed === true ||
              (n.status !== 'fulfilled' && n.status !== 'cancelled'),
          );
        return ok({ success: true, cell: args.cell, count: needs.length, needs });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
