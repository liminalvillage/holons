#!/usr/bin/env node
/**
 * HolonsBot REST API — simple HTTP wrapper around HoloSphere
 * Usage: node mcp/rest-api.js [--port 3100]
 */
import 'dotenv/config';
import http from 'http';

const PEER = process.env.HOLONS_PEER || 'https://gun.holons.io/gun';
const APP  = process.env.HOLONS_APP  || 'Holons';
const PORT = parseInt(process.argv[process.argv.indexOf('--port') + 1] || '3100');

const LENSES = ['quests','events','offers','shopping','roles','announcements','checklists','users','settings','expenses','badges','participants'];

let hs;
async function getHS() {
  if (hs) return hs;
  const { HoloSphere } = await import('holosphere');
  hs = new HoloSphere(APP, false, null, { peers: [PEER] });
  await new Promise(r => setTimeout(r, 2000));
  return hs;
}

// ── Tool handlers ───────────────────────────────────────────────────
const tools = {
  async list_holons({ limit = 50 } = {}) {
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
  },

  async get_lens({ holon, lens }) {
    const h = await getHS();
    const items = await h.getAll(holon, lens);
    const arr = (Array.isArray(items) ? items : []).map(({ _nostr, ...r }) => r);
    return { holon, lens, count: arr.length, items: arr };
  },

  async get_item({ holon, lens, id }) {
    const h = await getHS();
    const item = await h.get(holon, lens, id);
    if (!item) return { error: `Not found: ${holon}/${lens}/${id}` };
    const { _nostr, ...clean } = item;
    return clean;
  },

  async put_item({ holon, lens, data }) {
    const h = await getHS();
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    await h.put(holon, lens, parsed);
    return { success: true, holon, lens, id: parsed.id };
  },

  async delete_item({ holon, lens, id }) {
    const h = await getHS();
    await h.delete(holon, lens, id);
    return { success: true, deleted: `${holon}/${lens}/${id}` };
  },

  async get_holon_info({ holon }) {
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
      counts: { users: users?.length||0, quests: quests?.length||0, events: events?.length||0, roles: roles?.length||0 }
    };
  },

  async get_federation({ holon }) {
    const h = await getHS();
    return await h.getGlobal('federation', holon) || { error: `No federation data for ${holon}` };
  },

  async search_holon({ holon, query, lenses }) {
    const h = await getHS();
    const searchLenses = lenses || ['quests','events','offers','announcements'];
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
  },

  async create_quest({ holon, title, description, type, category, when, until }) {
    const h = await getHS();
    const quest = {
      id: h.generateId ? h.generateId() : `q_${Date.now()}`,
      version: '0.1', holon, title, description: description||'',
      type: type||'task', status: 'ongoing', date: Date.now(),
      participants: [], appreciation: [], category: category||'',
      when: when||'', until: until||'',
    };
    await h.put(holon, 'quests', quest);
    return { success: true, quest };
  },

  async get_global({ table, key }) {
    const h = await getHS();
    return await h.getGlobal(table, key) || { error: `No data at ${table}/${key}` };
  },
};

// ── HTTP Server ─────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  const toolMatch = req.method === 'POST' && req.url?.match(/^\/tool\/([a-z_]+)$/);
  if (toolMatch) {
    const name = toolMatch[1];
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const handler = tools[name];
        if (!handler) { res.writeHead(404); res.end(JSON.stringify({ error: `Unknown tool: ${name}` })); return; }
        const args = JSON.parse(body || '{}');
        const result = await handler(args);
        res.writeHead(200);
        res.end(JSON.stringify(result, null, 2));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.url === '/tools') {
    res.end(JSON.stringify({ tools: Object.keys(tools) }));
    return;
  }

  res.end(JSON.stringify({
    name: 'holonsbot-rest', version: '1.0.0',
    usage: 'POST /tool/<name> with JSON body. GET /tools for list.'
  }));
});

server.listen(PORT, () => console.log(`HolonsBot REST API on port ${PORT}`));
