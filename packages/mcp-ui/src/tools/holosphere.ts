import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApp } from '../holosphere.js';
import type { ToolDeps } from './index.js';

/**
 * Strip GunDB / Nostr metadata that is noisy in tool output.
 */
function clean<T extends Record<string, any>>(item: T): Omit<T, '_nostr'> {
  const { _nostr, ...rest } = item;
  return rest;
}

export function registerHolosphereTools(server: McpServer, deps: ToolDeps): void {
  // 1. List known holons in the network.
  server.tool(
    'holon_list',
    'List known holons (spaces/groups) in the network with their names',
    {
      limit: z.number().optional().describe('Max holons to return (default 50)'),
    },
    async ({ limit = 50 }) => {
      const h = await deps.getHoloSphere();
      const app = getApp();
      const holons: string[] = [];

      await new Promise<void>((resolve) => {
        let timer: NodeJS.Timeout | undefined;
        const reset = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => resolve(), 3000);
        };
        reset();
        h.gun.get(app).map().once((_data: any, key: string) => {
          if (
            key &&
            key !== '_' &&
            !key.startsWith('federation') &&
            !key.startsWith('cell')
          ) {
            holons.push(key);
            reset();
          }
        });
      });

      const subset = holons.slice(0, limit);
      const results = await Promise.all(
        subset.map(async (id) => {
          try {
            const settings = await h.getAll(id, 'settings');
            const s = Array.isArray(settings) ? settings[0] : null;
            const name = s?.name || s?.title || id;
            return { id, name };
          } catch {
            return { id, name: id };
          }
        }),
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ total: holons.length, holons: results }, null, 2),
          },
        ],
      };
    },
  );

  // 2. Get all items from a lens.
  server.tool(
    'lens_get_all',
    'Get all items from a holon lens (quests, events, offers, shopping, roles, announcements, etc.)',
    {
      holon: z.string().describe('Holon ID'),
      lens: z.string().describe('Lens/category to read'),
    },
    async ({ holon, lens }) => {
      const h = await deps.getHoloSphere();
      const items = await h.getAll(holon, lens);
      const arr = Array.isArray(items) ? items : [];
      const cleaned = arr.map(clean);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { holon, lens, count: cleaned.length, items: cleaned },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 3. Get a single item by id.
  server.tool(
    'lens_get',
    'Get a specific item from a holon lens by ID',
    {
      holon: z.string().describe('Holon ID'),
      lens: z.string().describe('Lens/category'),
      id: z.string().describe('Item ID'),
    },
    async ({ holon, lens, id }) => {
      const h = await deps.getHoloSphere();
      const item = await h.get(holon, lens, id);
      if (!item) {
        return {
          content: [{ type: 'text', text: `Item ${id} not found in ${holon}/${lens}` }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(clean(item), null, 2) }],
      };
    },
  );

  // 4. Create / update an item.
  server.tool(
    'lens_put',
    'Create or update an item in a holon lens. Data must be a JSON string; include "id" or one will be assigned by HoloSphere.',
    {
      holon: z.string().describe('Holon ID'),
      lens: z.string().describe('Lens/category'),
      data: z.string().describe('JSON string of the item data'),
    },
    async ({ holon, lens, data }) => {
      const h = await deps.getHoloSphere();
      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        return {
          content: [{ type: 'text', text: 'Error: invalid JSON in data field' }],
          isError: true,
        };
      }
      const result = await h.put(holon, lens, parsed);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: true, holon, lens, id: parsed.id, result },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 5. Delete an item.
  server.tool(
    'lens_delete',
    'Delete an item from a holon lens',
    {
      holon: z.string().describe('Holon ID'),
      lens: z.string().describe('Lens/category'),
      id: z.string().describe('Item ID to delete'),
    },
    async ({ holon, lens, id }) => {
      const h = await deps.getHoloSphere();
      await h.delete(holon, lens, id);
      return {
        content: [{ type: 'text', text: `Deleted ${id} from ${holon}/${lens}` }],
      };
    },
  );

  // 6. Get holon settings + summary counts.
  server.tool(
    'holon_info',
    'Get settings and summary for a holon (name, description, member count, quest count, etc.)',
    {
      holon: z.string().describe('Holon ID'),
    },
    async ({ holon }) => {
      const h = await deps.getHoloSphere();
      const [settings, users, quests, events, roles] = await Promise.all([
        h.getAll(holon, 'settings').catch(() => []),
        h.getAll(holon, 'users').catch(() => []),
        h.getAll(holon, 'quests').catch(() => []),
        h.getAll(holon, 'events').catch(() => []),
        h.getAll(holon, 'roles').catch(() => []),
      ]);
      const s = Array.isArray(settings) && settings[0] ? settings[0] : {};

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: holon,
                name: s.name || s.title || holon,
                description: s.description || '',
                language: s.language || 'en',
                settings: s,
                counts: {
                  users: Array.isArray(users) ? users.length : 0,
                  quests: Array.isArray(quests) ? quests.length : 0,
                  events: Array.isArray(events) ? events.length : 0,
                  roles: Array.isArray(roles) ? roles.length : 0,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 7. Keyword search across lenses in a holon.
  server.tool(
    'holon_search',
    'Search for items across one or more lenses in a holon by keyword',
    {
      holon: z.string().describe('Holon ID'),
      query: z.string().describe('Search keyword'),
      lenses: z
        .array(z.string())
        .optional()
        .describe('Lenses to search (default: quests, events, offers, announcements)'),
    },
    async ({ holon, query, lenses }) => {
      const h = await deps.getHoloSphere();
      const searchLenses = lenses && lenses.length
        ? lenses
        : ['quests', 'events', 'offers', 'announcements'];
      const q = query.toLowerCase();
      const perLens = await Promise.all(
        searchLenses.map(async (lens) => {
          try {
            const items = await h.getAll(holon, lens);
            if (!Array.isArray(items)) return [];
            return items
              .filter((item) => JSON.stringify(item).toLowerCase().includes(q))
              .map((item) => ({ lens, ...clean(item) }));
          } catch {
            return [];
          }
        }),
      );
      const results = perLens.flat();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { holon, query, matches: results.length, results },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 8. Global (non-holon-scoped) data.
  server.tool(
    'global_get',
    'Read global (non-holon-specific) data by table and key',
    {
      table: z.string().describe('Global table name (e.g. "federation", "cell")'),
      key: z.string().describe('Key within the table'),
    },
    async ({ table, key }) => {
      const h = await deps.getHoloSphere();
      const data = await h.getGlobal(table, key);
      return {
        content: [
          {
            type: 'text',
            text: data ? JSON.stringify(data, null, 2) : `No data at ${table}/${key}`,
          },
        ],
      };
    },
  );
}
