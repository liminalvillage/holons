/**
 * Durability check: prove the event survives a strfry RESTART.
 *
 * Reads the coordinates written by roundtrip-strfry.mjs and re-fetches the
 * event from strfry — intended to be run AFTER `docker restart strfry-spike`.
 * If strfry persisted the event to its LMDB volume, it comes back and still
 * verifies: the relay is the durable copy, the local store is only a cache.
 *
 * Run: node spike/relay-fetch.mjs
 */

import { SimplePool } from 'nostr-tools/pool';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEvent, eventToItem } from '../nostr-events.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(fs.readFileSync(path.join(HERE, '.last-event.json'), 'utf8'));
const log = (...a) => console.log(...a);
let failures = 0;
const expect = (c, m) => { if (!c) failures++; log(`  ${c ? '✅' : '❌'} ${m}`); };

(async () => {
  log(`\nRe-fetching from ${meta.relay} AFTER restart — event ${meta.id.slice(0, 12)}…\n`);
  const pool = new SimplePool();

  // by id
  const byId = await pool.querySync([meta.relay], { ids: [meta.id] });
  expect(byId.length === 1, `event found by id after restart (${byId.length})`);

  // by the same tag query the app would use
  const byTag = await pool.querySync([meta.relay], { kinds: [meta.kind], '#h': [meta.holon], '#l': [meta.lens] });
  expect(byTag.some((e) => e.id === meta.id), 'event found by #h/#l tag query after restart');

  const evt = byId[0];
  if (evt) {
    expect(verifyEvent(evt), 'signature still verifies after restart');
    expect(eventToItem(evt)?.title === meta.title, `payload intact ("${eventToItem(evt)?.title}")`);
  }

  pool.close([meta.relay]);
  log(`\n${failures === 0 ? '✅ DURABILITY PASSED' : `❌ DURABILITY FAILED (${failures})`} — strfry retained the event across a process restart\n`);
  setTimeout(() => process.exit(failures === 0 ? 0 : 1), 200);
})().catch((e) => { console.error('fetch error:', e); process.exit(1); });
