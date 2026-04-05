#!/usr/bin/env node
/**
 * HolonsBot MCP Server
 * 
 * Exposes the holon network (GunDB/HoloSphere) to AI assistants via
 * the Model Context Protocol. Provides tools for reading and writing
 * quests, events, offers, shopping lists, roles, announcements, and
 * federation data across the decentralized holon network.
 * 
 * Usage:
 *   node mcp/server.js                        # stdio transport (default)
 *   node mcp/server.js --port 3100            # SSE transport on port
 *   HOLONS_PEER=https://gun.holons.io/gun node mcp/server.js
 */

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import http from 'http';

// ── HoloSphere setup ────────────────────────────────────────────────
const PEER = process.env.HOLONS_PEER || 'https://gun.holons.io/gun';
const APP  = process.env.HOLONS_APP  || 'Holons';

let hs;
async function getHoloSphere() {
  if (hs) return hs;
  const { HoloSphere } = await import('holosphere');
  hs = new HoloSphere(APP, false, null, { peers: [PEER] });
  // Give GunDB a moment to connect
  await new Promise(r => setTimeout(r, 1500));
  return hs;
}

// ── MCP Server ──────────────────────────────────────────────────────
const server = new McpServer({
  name: 'holonsbot',
  version: '1.0.0',
  description: 'Access the Holons decentralized network — read and write quests, events, offers, shopping lists, roles, announcements, settings, and federation data across holon spaces.',
});

// ── Lenses (data categories) ────────────────────────────────────────
const LENSES = [
  'quests', 'events', 'offers', 'shopping', 'roles',
  'announcements', 'checklists', 'users', 'settings',
  'expenses', 'badges', 'participants'
];

// ── Tools ───────────────────────────────────────────────────────────

// 1. List holons
server.tool(
  'list_holons',
  'List known holons (spaces/groups) in the network with their names',
  { limit: z.number().optional().describe('Max holons to return (default 50)') },
  async ({ limit = 50 }) => {
    const h = await getHoloSphere();
    const holons = [];
    
    await new Promise((resolve) => {
      let timer;
      const reset = () => { clearTimeout(timer); timer = setTimeout(resolve, 3000); };
      reset();
      h.gun.get(APP).map().once((data, key) => {
        if (key && key !== '_' && !key.startsWith('federation') && !key.startsWith('cell')) {
          holons.push(key);
          reset();
        }
      });
    });

    // Resolve names for first N
    const results = [];
    const subset = holons.slice(0, limit);
    for (const id of subset) {
      let name = id;
      try {
        const settings = await h.getAll(id, 'settings');
        const s = Array.isArray(settings) ? settings[0] : null;
        if (s?.name || s?.title) name = s.name || s.title;
      } catch {}
      results.push({ id, name });
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ total: holons.length, holons: results }, null, 2)
      }]
    };
  }
);

// 2. Get items from a lens
server.tool(
  'get_lens',
  'Get all items from a holon lens (quests, events, offers, shopping, roles, announcements, etc.)',
  {
    holon: z.string().describe('Holon ID (e.g. "-1002352632800" or "235114395")'),
    lens: z.enum(LENSES).describe('Lens/category to read'),
  },
  async ({ holon, lens }) => {
    const h = await getHoloSphere();
    const items = await h.getAll(holon, lens);
    const arr = Array.isArray(items) ? items : [];
    
    // Strip _nostr metadata for cleaner output
    const clean = arr.map(item => {
      const { _nostr, ...rest } = item;
      return rest;
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ holon, lens, count: clean.length, items: clean }, null, 2)
      }]
    };
  }
);

// 3. Get a single item
server.tool(
  'get_item',
  'Get a specific item from a holon lens by ID',
  {
    holon: z.string().describe('Holon ID'),
    lens: z.enum(LENSES).describe('Lens/category'),
    id: z.string().describe('Item ID'),
  },
  async ({ holon, lens, id }) => {
    const h = await getHoloSphere();
    const item = await h.get(holon, lens, id);
    if (!item) {
      return { content: [{ type: 'text', text: `Item ${id} not found in ${holon}/${lens}` }] };
    }
    const { _nostr, ...clean } = item;
    return {
      content: [{ type: 'text', text: JSON.stringify(clean, null, 2) }]
    };
  }
);

// 4. Create/update an item
server.tool(
  'put_item',
  'Create or update an item in a holon lens. Data must include an "id" field. Omit "id" to auto-generate.',
  {
    holon: z.string().describe('Holon ID'),
    lens: z.enum(LENSES).describe('Lens/category'),
    data: z.string().describe('JSON string of the item data'),
  },
  async ({ holon, lens, data }) => {
    const h = await getHoloSphere();
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return { content: [{ type: 'text', text: 'Error: invalid JSON in data field' }], isError: true };
    }

    const result = await h.put(holon, lens, parsed);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, holon, lens, id: parsed.id, result }, null, 2)
      }]
    };
  }
);

// 5. Delete an item
server.tool(
  'delete_item',
  'Delete an item from a holon lens',
  {
    holon: z.string().describe('Holon ID'),
    lens: z.enum(LENSES).describe('Lens/category'),
    id: z.string().describe('Item ID to delete'),
  },
  async ({ holon, lens, id }) => {
    const h = await getHoloSphere();
    await h.delete(holon, lens, id);
    return {
      content: [{ type: 'text', text: `Deleted ${id} from ${holon}/${lens}` }]
    };
  }
);

// 6. Get holon settings / info
server.tool(
  'get_holon_info',
  'Get settings and summary for a holon (name, description, member count, quest count, etc.)',
  {
    holon: z.string().describe('Holon ID'),
  },
  async ({ holon }) => {
    const h = await getHoloSphere();
    
    const [settings, users, quests, events, roles] = await Promise.all([
      h.getAll(holon, 'settings').catch(() => []),
      h.getAll(holon, 'users').catch(() => []),
      h.getAll(holon, 'quests').catch(() => []),
      h.getAll(holon, 'events').catch(() => []),
      h.getAll(holon, 'roles').catch(() => []),
    ]);

    const s = Array.isArray(settings) && settings[0] ? settings[0] : {};
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
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
          }
        }, null, 2)
      }]
    };
  }
);

// 7. Get federation data
server.tool(
  'get_federation',
  'Get federation links for a holon — shows which other holons it is connected to',
  {
    holon: z.string().describe('Holon ID'),
  },
  async ({ holon }) => {
    const h = await getHoloSphere();
    const fed = await h.getGlobal('federation', holon);
    return {
      content: [{
        type: 'text',
        text: fed
          ? JSON.stringify(fed, null, 2)
          : `No federation data for holon ${holon}`
      }]
    };
  }
);

// 8. Search across a holon
server.tool(
  'search_holon',
  'Search for items across all lenses in a holon by keyword',
  {
    holon: z.string().describe('Holon ID'),
    query: z.string().describe('Search keyword'),
    lenses: z.array(z.string()).optional().describe('Lenses to search (default: quests, events, offers, announcements)'),
  },
  async ({ holon, query, lenses }) => {
    const h = await getHoloSphere();
    const searchLenses = lenses || ['quests', 'events', 'offers', 'announcements'];
    const q = query.toLowerCase();
    const results = [];

    for (const lens of searchLenses) {
      try {
        const items = await h.getAll(holon, lens);
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const text = JSON.stringify(item).toLowerCase();
          if (text.includes(q)) {
            const { _nostr, ...clean } = item;
            results.push({ lens, ...clean });
          }
        }
      } catch {}
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ holon, query, matches: results.length, results }, null, 2)
      }]
    };
  }
);

// 9. Create a quest (convenience wrapper)
server.tool(
  'create_quest',
  'Create a new quest/task in a holon',
  {
    holon: z.string().describe('Holon ID'),
    title: z.string().describe('Quest title'),
    description: z.string().optional().describe('Quest description'),
    type: z.enum(['quest', 'task', 'proposal', 'bounty']).optional().describe('Quest type (default: task)'),
    category: z.string().optional().describe('Category'),
    when: z.string().optional().describe('Scheduled date (ISO string)'),
    until: z.string().optional().describe('End date (ISO string)'),
  },
  async ({ holon, title, description, type, category, when, until }) => {
    const h = await getHoloSphere();
    const quest = {
      id: h.generateId(),
      version: '0.1',
      holon,
      title,
      description: description || '',
      type: type || 'task',
      status: 'ongoing',
      date: Date.now(),
      participants: [],
      appreciation: [],
      category: category || '',
      when: when || '',
      until: until || '',
    };

    await h.put(holon, 'quests', quest);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, quest }, null, 2)
      }]
    };
  }
);

// 10. Global data
server.tool(
  'get_global',
  'Read global (non-holon-specific) data by table and key',
  {
    table: z.string().describe('Global table name (e.g. "federation", "cell")'),
    key: z.string().describe('Key within the table'),
  },
  async ({ table, key }) => {
    const h = await getHoloSphere();
    const data = await h.getGlobal(table, key);
    return {
      content: [{
        type: 'text',
        text: data ? JSON.stringify(data, null, 2) : `No data at ${table}/${key}`
      }]
    };
  }
);

// ── Resources ───────────────────────────────────────────────────────

server.resource(
  'network-info',
  'holons://network',
  async () => ({
    contents: [{
      uri: 'holons://network',
      mimeType: 'application/json',
      text: JSON.stringify({
        app: APP,
        peer: PEER,
        lenses: LENSES,
        description: 'Holons is a decentralized network of collaborative spaces (holons). Each holon has lenses (data categories) like quests, events, offers, roles. Data is stored in GunDB and synced via HoloSphere.',
        knownHolons: {
          '-1002352632800': 'Holonic Technology',
          '-1002282981272': 'Holonic DAO',
          '-1002490801907': 'Holonic Funding',
          '235114395': 'Roberto Valenti (personal)',
        }
      }, null, 2)
    }]
  })
);

// ── Start ───────────────────────────────────────────────────────────
async function main() {
  const portArg = process.argv.indexOf('--port');
  
  if (portArg !== -1 && process.argv[portArg + 1]) {
    // SSE transport for remote access
    const port = parseInt(process.argv[portArg + 1]);
    let sseTransport;
    
    const TOOL_NAMES = [
      'list_holons', 'get_lens', 'get_item', 'put_item', 'delete_item',
      'get_holon_info', 'get_federation', 'search_holon', 'create_quest', 'get_global'
    ];

    // Direct REST tool caller — dispatches to toolHandlers map
    async function callToolREST(toolName, args) {
      const handler = toolHandlers[toolName];
      if (!handler) throw new Error(`Unknown tool: ${toolName}. Available: ${TOOL_NAMES.join(', ')}`);
      return await handler(args);
    }

    const httpServer = http.createServer(async (req, res) => {
      // REST endpoint: POST /tool/<toolName> with JSON body as arguments
      const toolMatch = req.method === 'POST' && req.url?.match(/^\/tool\/([a-z_]+)$/);
      if (toolMatch) {
        const toolName = toolMatch[1];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const args = JSON.parse(body || '{}');
            const result = await callToolREST(toolName, args);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      if (req.method === 'GET' && req.url === '/sse') {
        sseTransport = new SSEServerTransport('/messages', res);
        await server.connect(sseTransport);
      } else if (req.method === 'POST' && req.url === '/messages') {
        if (sseTransport) {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            await sseTransport.handlePostMessage(req, res, body);
          });
        } else {
          res.writeHead(400);
          res.end('No SSE connection');
        }
      } else if (req.method === 'GET' && req.url === '/tools') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tools: TOOL_NAMES }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: 'holonsbot-mcp',
          version: '1.0.0',
          description: 'HolonsBot MCP Server — /sse for MCP protocol, POST /tool/<name> for REST'
        }));
      }
    });
    
    httpServer.listen(port, () => {
      console.error(`HolonsBot MCP server listening on port ${port} (SSE)`);
    });
  } else {
    // Stdio transport (default)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('HolonsBot MCP server running on stdio');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
