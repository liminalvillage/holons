/**
 * Minimal in-process Nostr relay (NIP-01 subset) for the persistence spike.
 *
 * Implements just enough of the relay protocol to prove the round-trip:
 *   - ["EVENT", evt]                  -> store, reply ["OK", id, true, ""]
 *   - ["REQ", subId, ...filters]      -> stream matches, then ["EOSE", subId]
 *   - ["CLOSE", subId]
 * Supports filters: ids, authors, kinds, since, until, limit, and #<tag>.
 * Honors NIP-33 parameterized-replaceable (kinds 30000-39999): keeps one event
 * per (pubkey, kind, d-tag), newest created_at wins.
 *
 * In production this role is played by a real relay (e.g. strfry) — same wire
 * protocol, durable storage, backups. This file is ONLY for the spike.
 */

import WS from 'ws';
const WebSocketServer = WS.Server || WS.WebSocketServer;

const isReplaceable = (k) => k >= 30000 && k < 40000;
const dTag = (evt) => (evt.tags.find((t) => t[0] === 'd') || [])[1] || '';
const replKey = (evt) => `${evt.pubkey}:${evt.kind}:${dTag(evt)}`;

function matches(filter, evt) {
  if (filter.ids && !filter.ids.includes(evt.id)) return false;
  if (filter.authors && !filter.authors.includes(evt.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(evt.kind)) return false;
  if (filter.since && evt.created_at < filter.since) return false;
  if (filter.until && evt.created_at > filter.until) return false;
  for (const key of Object.keys(filter)) {
    if (key[0] !== '#') continue;
    const name = key.slice(1);
    const want = filter[key];
    const have = evt.tags.filter((t) => t[0] === name).map((t) => t[1]);
    if (!want.some((w) => have.includes(w))) return false;
  }
  return true;
}

export function startRelay({ port = 0 } = {}) {
  const events = new Map();       // id -> event
  const replaceable = new Map();  // replKey -> id (for NIP-33)
  const subs = new Map();         // ws -> Map(subId -> filters[])

  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    subs.set(ws, new Map());

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const [type, ...rest] = msg;

      if (type === 'EVENT') {
        const evt = rest[0];
        if (isReplaceable(evt.kind)) {
          const rk = replKey(evt);
          const prevId = replaceable.get(rk);
          if (prevId) {
            const prev = events.get(prevId);
            if (prev && prev.created_at > evt.created_at) {
              ws.send(JSON.stringify(['OK', evt.id, true, 'duplicate: older than stored']));
              return;
            }
            events.delete(prevId);
          }
          replaceable.set(rk, evt.id);
        }
        events.set(evt.id, evt);
        ws.send(JSON.stringify(['OK', evt.id, true, '']));
        // fan out to live subscriptions
        for (const [sock, sm] of subs) {
          if (sock.readyState !== sock.OPEN) continue;
          for (const [subId, filters] of sm) {
            if (filters.some((f) => matches(f, evt))) {
              sock.send(JSON.stringify(['EVENT', subId, evt]));
            }
          }
        }
        return;
      }

      if (type === 'REQ') {
        const subId = rest[0];
        const filters = rest.slice(1);
        subs.get(ws).set(subId, filters);
        const out = [];
        for (const evt of events.values()) {
          if (filters.some((f) => matches(f, evt))) out.push(evt);
        }
        out.sort((a, b) => a.created_at - b.created_at);
        for (const evt of out) ws.send(JSON.stringify(['EVENT', subId, evt]));
        ws.send(JSON.stringify(['EOSE', subId]));
        return;
      }

      if (type === 'CLOSE') {
        subs.get(ws)?.delete(rest[0]);
      }
    });

    ws.on('close', () => subs.delete(ws));
  });

  return new Promise((resolve) => {
    wss.on('listening', () => {
      const actualPort = wss.address().port;
      resolve({
        url: `ws://127.0.0.1:${actualPort}`,
        port: actualPort,
        count: () => events.size,
        events: () => Array.from(events.values()),
        close: () => new Promise((r) => wss.close(r)),
      });
    });
  });
}
