#!/usr/bin/env node
/**
 * HolonsBot MCP Server
 * 
 * Exposes the full HolonsBot feature set via MCP protocol (SSE + REST).
 * Connects to the running bot's HTTP API on port 3101.
 * 
 * Usage:
 *   node mcp/holons-mcp.js                  # stdio transport
 *   node mcp/holons-mcp.js --port 3100      # SSE + REST on port
 */
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import http from 'http';

const BOT_API = process.env.BOT_API_URL || 'http://localhost:3101';
const PEER = process.env.HOLONS_PEER || 'https://gun.holons.io/gun';
const APP = process.env.HOLONS_APP || 'Holons';

// ── HoloSphere (lazy init for read operations) ─────────────────────
let hs;
async function getHS() {
  if (hs) return hs;
  const { HoloSphere } = await import('holosphere');
  hs = new HoloSphere(APP, false, null, { peers: [PEER] });
  await new Promise(r => setTimeout(r, 2000));
  return hs;
}

// ── Bot API helper ──────────────────────────────────────────────────
async function botCall(endpoint, data) {
  const res = await fetch(`${BOT_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

// ── Known lenses ────────────────────────────────────────────────────
const LENSES = [
  'quests', 'events', 'offers', 'shopping', 'roles',
  'announcements', 'checklists', 'users', 'settings',
  'expenses', 'badges', 'participants'
];

// ── MCP Server ──────────────────────────────────────────────────────
const server = new McpServer({
  name: 'holons',
  version: '2.0.0',
  description: 'Full access to the Holons decentralized network — create tasks, log expenses, manage shopping lists, read data, and more.',
});

// ── Tool registry (also used for REST dispatch) ─────────────────────
const toolDefs = {};

function defineTool(name, description, schema, handler) {
  toolDefs[name] = { description, schema, handler };
  server.tool(name, description, schema, async (args) => {
    const result = await handler(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// WRITE TOOLS — go through the bot API (proper Telegram messages)
// ═══════════════════════════════════════════════════════════════════

defineTool('create_quest', 
  'Create a task/quest/proposal/offer/request in a holon. Sends a formatted bot message with interactive buttons.',
  {
    chatId: z.string().describe('Telegram chat ID (holon or personal)'),
    title: z.string().describe('Quest title'),
    description: z.string().optional().describe('Quest description'),
    type: z.enum(['task', 'quest', 'proposal', 'offer', 'request', 'todo', 'event']).optional().describe('Quest type (default: task)'),
    category: z.string().optional().describe('Category'),
    when: z.string().optional().describe('Start date (ISO string)'),
    until: z.string().optional().describe('End date (ISO string)'),
    sender: z.object({
      id: z.number().describe('Telegram user ID'),
      first_name: z.string().describe('First name'),
      last_name: z.string().optional(),
      username: z.string().optional(),
    }).describe('The person creating this quest'),
  },
  async (args) => botCall('/quest', args)
);

defineTool('log_expense',
  'Log a time/money expense in a holon. Sends a formatted expense message with split buttons.',
  {
    chatId: z.string().describe('Telegram chat ID (holon or personal)'),
    amount: z.number().describe('Amount spent'),
    currency: z.string().describe('Currency (e.g. "hours", "euro", "usd")'),
    description: z.string().optional().describe('What was the expense for'),
    sender: z.object({
      id: z.number().describe('Telegram user ID'),
      first_name: z.string().describe('First name'),
      last_name: z.string().optional(),
      username: z.string().optional(),
    }).describe('The person who spent'),
  },
  async (args) => botCall('/expense', args)
);

defineTool('add_shopping_item',
  'Add an item to a holon\'s shopping list.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    item: z.string().describe('Item to add to the shopping list'),
    sender: z.object({
      id: z.number(),
      first_name: z.string(),
      username: z.string().optional(),
    }).describe('Who is adding the item'),
  },
  async (args) => botCall('/shopping', args)
);

defineTool('announce',
  'Send an announcement to a holon.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    message: z.string().describe('Announcement text'),
    sender: z.object({
      id: z.number(),
      first_name: z.string(),
      username: z.string().optional(),
    }).describe('Who is announcing'),
  },
  async (args) => botCall('/announce', args)
);

defineTool('create_event',
  'Create a calendar event in a holon.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    title: z.string().describe('Event title'),
    description: z.string().optional(),
    when: z.string().optional().describe('Event date (ISO string)'),
    until: z.string().optional().describe('End date (ISO string)'),
    sender: z.object({
      id: z.number(),
      first_name: z.string(),
      username: z.string().optional(),
    }).describe('Who is creating the event'),
  },
  async (args) => botCall('/event', args)
);

defineTool('library_add',
  'Add an item to the Library of Things (shared inventory).',
  {
    chatId: z.string().describe('Telegram chat ID'),
    item: z.string().describe('Item name (e.g. "hammer", "projector")'),
    value: z.number().optional().describe('Estimated value'),
    category: z.string().optional().describe('Category (e.g. "tools", "electronics")'),
    sender: z.object({ id: z.number(), first_name: z.string(), username: z.string().optional() }).describe('Who is adding'),
  },
  async (args) => botCall('/library/add', args)
);

defineTool('library_remove',
  'Remove an item from the Library of Things.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    item: z.string().describe('Item name to remove'),
  },
  async (args) => botCall('/library/remove', args)
);

defineTool('library_borrow',
  'Borrow an item from the Library of Things.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    item: z.string().describe('Item name to borrow'),
    sender: z.object({ id: z.number(), first_name: z.string(), username: z.string().optional() }).describe('Who is borrowing'),
  },
  async (args) => botCall('/library/borrow', args)
);

defineTool('library_return',
  'Return a borrowed item to the Library of Things.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    item: z.string().describe('Item name to return'),
  },
  async (args) => botCall('/library/return', args)
);

// ── Roles ──

defineTool('list_roles',
  'List all roles in a holon.',
  { chatId: z.string().describe('Telegram chat ID') },
  async (args) => botCall('/roles', args)
);

defineTool('add_role',
  'Add a new role to a holon.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    name: z.string().describe('Role name'),
    description: z.string().optional().describe('Role description'),
  },
  async (args) => botCall('/roles/add', args)
);

defineTool('remove_role',
  'Remove a role from a holon.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    roleId: z.string().describe('Role ID to remove'),
  },
  async (args) => botCall('/roles/remove', args)
);

// ── Checklists ──

defineTool('list_checklists',
  'List all checklists in a holon.',
  { chatId: z.string().describe('Telegram chat ID') },
  async (args) => botCall('/checklists', args)
);

defineTool('create_checklist',
  'Create a new checklist with optional items.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    name: z.string().describe('Checklist name'),
    items: z.array(z.string()).optional().describe('Initial items'),
  },
  async (args) => botCall('/checklists/create', args)
);

defineTool('toggle_checklist_item',
  'Toggle a checklist item checked/unchecked.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    checklistId: z.string().describe('Checklist ID'),
    itemId: z.string().describe('Item ID to toggle'),
  },
  async (args) => botCall('/checklists/toggle', args)
);

// ── Leaderboard & Stats ──

defineTool('get_leaderboard',
  'Get appreciation/participation scores for a holon.',
  { chatId: z.string().describe('Telegram chat ID') },
  async (args) => botCall('/leaderboard', args)
);

// ── Settings ──

defineTool('get_settings',
  'Get holon settings (name, language, theme, purpose, values, domains, currencies).',
  { chatId: z.string().describe('Telegram chat ID') },
  async (args) => botCall('/settings', args)
);

defineTool('update_settings',
  'Update holon settings. Only provided fields are changed.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    name: z.string().optional().describe('Holon name'),
    language: z.string().optional().describe('Language code (en, it, es, fr, de, ru)'),
    theme: z.string().optional().describe('Theme (light, dark)'),
    purpose: z.string().optional().describe('Holon purpose'),
    values: z.array(z.string()).optional().describe('Core values'),
    domains: z.array(z.string()).optional().describe('Activity domains'),
    currencies: z.array(z.string()).optional().describe('Accepted currencies (e.g. ["hour", "euro"])'),
  },
  async (args) => botCall('/settings/update', args)
);

// ── Federation ──

defineTool('get_federation_links',
  'Get federation links for a holon (which holons it is connected to).',
  { chatId: z.string().describe('Telegram chat ID') },
  async (args) => botCall('/federation', args)
);

defineTool('federate',
  'Create a bidirectional federation link between two holons.',
  {
    chatId: z.string().describe('Source holon ID'),
    targetId: z.string().describe('Target holon ID to federate with'),
  },
  async (args) => botCall('/federation/add', args)
);

defineTool('unfederate',
  'Remove a federation link from a holon.',
  {
    chatId: z.string().describe('Source holon ID'),
    targetId: z.string().describe('Target holon ID to unfederate'),
  },
  async (args) => botCall('/federation/remove', args)
);

// ── Members ──

defineTool('list_members',
  'List all members of a holon.',
  { chatId: z.string().describe('Telegram chat ID') },
  async (args) => botCall('/members', args)
);

// ── Ledger / Balances ──

defineTool('get_ledger',
  'Get expense balances for a holon — who owes whom.',
  { chatId: z.string().describe('Telegram chat ID') },
  async (args) => botCall('/ledger', args)
);

// ── Agenda / Scheduling ──

defineTool('get_agenda',
  'Get upcoming scheduled quests and events for a holon.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    days: z.number().optional().describe('Look-ahead days (default 7)'),
  },
  async (args) => botCall('/agenda', args)
);

defineTool('send_message',
  'Send a plain text message to a chat via the bot.',
  {
    chatId: z.string().describe('Telegram chat ID'),
    text: z.string().describe('Message text'),
  },
  async (args) => botCall('/message', args)
);

// ═══════════════════════════════════════════════════════════════════
// READ TOOLS — go through HoloSphere directly (faster, no bot needed)
// ═══════════════════════════════════════════════════════════════════

defineTool('list_holons',
  'List known holons in the network with their names.',
  {
    limit: z.number().optional().describe('Max holons to return (default 50)'),
  },
  async ({ limit = 50 }) => {
    const h = await getHS();
    const holons = [];
    await new Promise(resolve => {
      let timer;
      const reset = () => { clearTimeout(timer); timer = setTimeout(resolve, 3000); };
      reset();
      h.gun.get(APP).map().once((_, key) => {
        if (key && key !== '_' && !key.startsWith('federation') && !key.startsWith('cell')) {
          holons.push(key);
          reset();
        }
      });
    });
    const results = [];
    for (const id of holons.slice(0, limit)) {
      let name = id;
      try {
        const s = await h.getAll(id, 'settings');
        const first = Array.isArray(s) ? s[0] : null;
        if (first?.name || first?.title) name = first.name || first.title;
      } catch {}
      results.push({ id, name });
    }
    return { total: holons.length, holons: results };
  }
);

defineTool('get_lens',
  'Get all items from a holon lens (quests, events, offers, shopping, roles, expenses, etc.)',
  {
    holon: z.string().describe('Holon ID'),
    lens: z.enum(LENSES).describe('Lens/category to read'),
  },
  async ({ holon, lens }) => {
    const h = await getHS();
    const items = await h.getAll(holon, lens);
    const arr = (Array.isArray(items) ? items : []).map(({ _nostr, ...r }) => r);
    return { holon, lens, count: arr.length, items: arr };
  }
);

defineTool('get_item',
  'Get a specific item from a holon lens by ID.',
  {
    holon: z.string().describe('Holon ID'),
    lens: z.enum(LENSES).describe('Lens'),
    id: z.string().describe('Item ID'),
  },
  async ({ holon, lens, id }) => {
    const h = await getHS();
    const item = await h.get(holon, lens, id);
    if (!item) return { error: `Not found: ${holon}/${lens}/${id}` };
    const { _nostr, ...clean } = item;
    return clean;
  }
);

defineTool('put_item',
  'Create or update a raw item in a holon lens (low-level write).',
  {
    holon: z.string().describe('Holon ID'),
    lens: z.enum(LENSES).describe('Lens'),
    data: z.string().describe('JSON string of item data (must include "id" field)'),
  },
  async ({ holon, lens, data }) => {
    const h = await getHS();
    const parsed = JSON.parse(data);
    await h.put(holon, lens, parsed);
    return { success: true, holon, lens, id: parsed.id };
  }
);

defineTool('delete_item',
  'Delete an item from a holon lens.',
  {
    holon: z.string().describe('Holon ID'),
    lens: z.enum(LENSES).describe('Lens'),
    id: z.string().describe('Item ID'),
  },
  async ({ holon, lens, id }) => {
    const h = await getHS();
    await h.delete(holon, lens, id);
    return { success: true, deleted: `${holon}/${lens}/${id}` };
  }
);

defineTool('get_holon_info',
  'Get settings and summary for a holon (name, description, member count, etc.)',
  {
    holon: z.string().describe('Holon ID'),
  },
  async ({ holon }) => {
    const h = await getHS();
    const [settings, users, quests, events, roles] = await Promise.all([
      h.getAll(holon, 'settings').catch(() => []),
      h.getAll(holon, 'users').catch(() => []),
      h.getAll(holon, 'quests').catch(() => []),
      h.getAll(holon, 'events').catch(() => []),
      h.getAll(holon, 'roles').catch(() => []),
    ]);
    const s = Array.isArray(settings) && settings[0] ? settings[0] : {};
    return {
      id: holon, name: s.name || s.title || holon,
      description: s.description || '', language: s.language || 'en', settings: s,
      counts: {
        users: users?.length || 0, quests: quests?.length || 0,
        events: events?.length || 0, roles: roles?.length || 0,
      }
    };
  }
);

defineTool('get_federation',
  'Get federation links for a holon.',
  { holon: z.string().describe('Holon ID') },
  async ({ holon }) => {
    const h = await getHS();
    return await h.getGlobal('federation', holon) || { error: `No federation data for ${holon}` };
  }
);

defineTool('search',
  'Search for items across lenses in a holon by keyword.',
  {
    holon: z.string().describe('Holon ID'),
    query: z.string().describe('Search keyword'),
    lenses: z.array(z.string()).optional().describe('Lenses to search (default: quests, events, offers, announcements)'),
  },
  async ({ holon, query, lenses }) => {
    const h = await getHS();
    const searchLenses = lenses || ['quests', 'events', 'offers', 'announcements'];
    const q = query.toLowerCase();
    const results = [];
    for (const lens of searchLenses) {
      try {
        const items = await h.getAll(holon, lens);
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (JSON.stringify(item).toLowerCase().includes(q)) {
            const { _nostr, ...clean } = item;
            results.push({ lens, ...clean });
          }
        }
      } catch {}
    }
    return { holon, query, matches: results.length, results };
  }
);

defineTool('get_global',
  'Read global data by table and key.',
  {
    table: z.string().describe('Global table (e.g. "federation")'),
    key: z.string().describe('Key'),
  },
  async ({ table, key }) => {
    const h = await getHS();
    return await h.getGlobal(table, key) || { error: `No data at ${table}/${key}` };
  }
);

// ── Resources ───────────────────────────────────────────────────────
server.resource('network-info', 'holons://network', async () => ({
  contents: [{
    uri: 'holons://network',
    mimeType: 'application/json',
    text: JSON.stringify({
      app: APP, peer: PEER, lenses: LENSES,
      description: 'Holons decentralized network. Each holon has lenses (quests, events, offers, roles, etc). Data in GunDB via HoloSphere.',
      knownHolons: {
        '-1002352632800': 'Holonic Technology',
        '-1002282981272': 'Holonic DAO',
        '-1002490801907': 'Holonic Funding',
        '235114395': 'Roberto Valenti (personal)',
      },
      tools: Object.keys(toolDefs),
    }, null, 2)
  }]
}));

// ── Start ───────────────────────────────────────────────────────────
async function main() {
  const portIdx = process.argv.indexOf('--port');

  if (portIdx !== -1 && process.argv[portIdx + 1]) {
    const port = parseInt(process.argv[portIdx + 1]);
    let sseTransport;

    const httpServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      // REST: POST /tool/<name>
      const toolMatch = req.method === 'POST' && req.url?.match(/^\/tool\/([a-z_]+)$/);
      if (toolMatch) {
        const name = toolMatch[1];
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const def = toolDefs[name];
            if (!def) { res.writeHead(404); res.end(JSON.stringify({ error: `Unknown tool: ${name}` })); return; }
            const args = JSON.parse(body || '{}');
            const result = await def.handler(args);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result, null, 2));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // SSE
      if (req.method === 'GET' && req.url === '/sse') {
        sseTransport = new SSEServerTransport('/messages', res);
        await server.connect(sseTransport);
        return;
      }
      if (req.method === 'POST' && req.url === '/messages') {
        if (sseTransport) {
          let body = '';
          req.on('data', c => body += c);
          req.on('end', async () => { await sseTransport.handlePostMessage(req, res, body); });
        } else { res.writeHead(400); res.end('No SSE connection'); }
        return;
      }

      // GET /tools
      if (req.method === 'GET' && req.url === '/tools') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          tools: Object.entries(toolDefs).map(([name, d]) => ({ name, description: d.description }))
        }, null, 2));
        return;
      }

      // Index
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'holons-mcp', version: '2.0.0',
        endpoints: {
          'GET /tools': 'List all available tools',
          'POST /tool/<name>': 'Call a tool with JSON body',
          'GET /sse': 'MCP SSE transport',
          'POST /messages': 'MCP SSE message endpoint',
        }
      }, null, 2));
    });

    httpServer.listen(port, () => {
      console.log(`Holons MCP server on port ${port} (SSE + REST)`);
      console.log(`Tools: ${Object.keys(toolDefs).join(', ')}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Holons MCP server running on stdio');
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
