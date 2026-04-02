#!/usr/bin/env node
/**
 * Direct HoloSphere query tool for Atlas.
 * Usage: node mcp/query.js <command> [args...]
 * 
 * Commands:
 *   info <holonId>                    - Get holon info (settings + counts)
 *   lens <holonId> <lens>             - Get all items from a lens
 *   item <holonId> <lens> <itemId>    - Get a single item
 *   put <holonId> <lens> <json>       - Create/update an item
 *   del <holonId> <lens> <itemId>     - Delete an item
 *   search <holonId> <query>          - Search across lenses
 *   fed <holonId>                     - Get federation data
 *   global <table> <key>              - Get global data
 *   holons                            - List known holons
 *   quest <holonId> <title> [desc]    - Create a quest
 */
import 'dotenv/config';

const PEER = process.env.HOLONS_PEER || 'https://gun.holons.io/gun';
const APP = process.env.HOLONS_APP || 'Holons';

const { HoloSphere } = await import('holosphere');
const hs = new HoloSphere(APP, false, null, { peers: [PEER] });
await new Promise(r => setTimeout(r, 1000));

const [cmd, ...args] = process.argv.slice(2);
const out = (obj) => { console.log(JSON.stringify(obj, null, 2)); process.exit(0); };
const strip = (item) => { if (item?._nostr) delete item._nostr; return item; };

try {
  switch (cmd) {
    case 'info': {
      const [holon] = args;
      const [settings, users, quests, events, roles] = await Promise.all([
        hs.getAll(holon, 'settings').catch(() => []),
        hs.getAll(holon, 'users').catch(() => []),
        hs.getAll(holon, 'quests').catch(() => []),
        hs.getAll(holon, 'events').catch(() => []),
        hs.getAll(holon, 'roles').catch(() => []),
      ]);
      const s = (Array.isArray(settings) && settings[0]) || {};
      out({
        id: holon, name: s.name || s.title || holon,
        settings: strip(s),
        counts: { users: users?.length||0, quests: quests?.length||0, events: events?.length||0, roles: roles?.length||0 }
      });
      break;
    }
    case 'lens': {
      const [holon, lens] = args;
      const items = await hs.getAll(holon, lens);
      out({ holon, lens, count: items?.length||0, items: (items||[]).map(strip) });
      break;
    }
    case 'item': {
      const [holon, lens, id] = args;
      const item = await hs.get(holon, lens, id);
      out(strip(item));
      break;
    }
    case 'put': {
      const [holon, lens, json] = args;
      const data = JSON.parse(json);
      if (!data.id) data.id = hs.generateId();
      await hs.put(holon, lens, data);
      out({ success: true, id: data.id });
      break;
    }
    case 'del': {
      const [holon, lens, id] = args;
      await hs.delete(holon, lens, id);
      out({ success: true, deleted: id });
      break;
    }
    case 'search': {
      const [holon, ...qwords] = args;
      const query = qwords.join(' ').toLowerCase();
      const results = [];
      for (const lens of ['quests','events','offers','announcements','roles','shopping']) {
        const items = await hs.getAll(holon, lens).catch(() => []);
        for (const item of (items||[])) {
          if (JSON.stringify(item).toLowerCase().includes(query)) {
            results.push({ lens, ...strip(item) });
          }
        }
      }
      out({ holon, query, matches: results.length, results });
      break;
    }
    case 'fed': {
      const [holon] = args;
      const fed = await hs.getGlobal('federation', holon);
      out(strip(fed) || { error: 'no federation data' });
      break;
    }
    case 'global': {
      const [table, key] = args;
      const data = await hs.getGlobal(table, key);
      out(strip(data) || { error: 'not found' });
      break;
    }
    case 'quest': {
      const [holon, title, ...descWords] = args;
      const quest = {
        id: hs.generateId(), version: '0.1', holon, title,
        description: descWords.join(' '), type: 'task', status: 'ongoing',
        date: Date.now(), participants: [], appreciation: [], category: ''
      };
      await hs.put(holon, 'quests', quest);
      out({ success: true, quest: strip(quest) });
      break;
    }
    default:
      console.log('Unknown command:', cmd);
      console.log('Commands: info, lens, item, put, del, search, fed, global, holons, quest');
      process.exit(1);
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
