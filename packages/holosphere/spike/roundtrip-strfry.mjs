/**
 * Persistence spike against a REAL strfry relay.
 *
 *   1. A HoloSphere instance (in-memory store) writes an item — signed as a
 *      NIP-01 event and published to strfry.
 *   2. That instance is closed: its local cache is gone.
 *   3. A FRESH instance (empty store, same relay) reads the item back —
 *      rehydrated from strfry by tag query, signature re-verified.
 *   4. The raw event verifies; tampered copies do not.
 *   5. Persist the event coordinates so relay-fetch.mjs can prove the event
 *      also survives a strfry restart (durability across relay process death).
 *
 * Prereq: strfry running. RELAY_URL defaults to ws://127.0.0.1:7777
 * Run: node spike/roundtrip-strfry.mjs
 */

import { SimplePool } from 'nostr-tools/pool';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as h3 from 'h3-js';

import HoloSphere from '../holosphere.js';
import { verifyEvent, eventToItem, generateSecretKey, getPublicKey } from '../nostr-events.js';

const RELAY = process.env.RELAY_URL || 'ws://127.0.0.1:7777';
const APP = 'spike-app';
const LENS = 'tasks';
const KIND = 30078;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const log = (...a) => console.log(...a);
let failures = 0;
const expect = (c, m) => { if (!c) failures++; log(`  ${c ? '✅' : '❌'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sphere(privateKey) {
  return new HoloSphere({
    appName: APP,
    privateKey,
    relays: [RELAY],
    store: { adapter: 'memory' },
    nostr: { syncTimeoutMs: 4000 },
  });
}

(async () => {
  log(`\nUsing real strfry relay at ${RELAY}\n`);
  const pool = new SimplePool();

  const holon = h3.latLngToCell(37.7749, -122.4194, 9);
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const item = { id: `task-${Date.now()}`, title: 'Repair the well', status: 'open' };

  log('STEP 1 — write through HoloSphere (signed event → strfry)');
  const a = sphere(sk);
  await a.put(holon, LENS, item, null, { autoPropagate: false });
  await sleep(1500);
  expect(!!(await a.get(holon, LENS, item.id)), 'item readable from the writing instance');

  log('STEP 2 — close the writer: its local store is gone');
  await a.close();

  log('STEP 3 — a fresh instance rehydrates from strfry');
  const b = sphere(generateSecretKey());
  const back = await b.get(holon, LENS, item.id);
  expect(!!back, 'fresh instance (empty store) reads the item back from strfry');
  expect(back?.title === item.title, `restored payload matches original ("${back?.title}")`);
  await b.close();

  log('STEP 4 — the raw event on strfry verifies; tampering is detected');
  const filter = { kinds: [KIND], '#h': [holon], '#l': [LENS], authors: [pubkey] };
  log(`  querySync ${JSON.stringify(filter)}`);
  const recovered = await pool.querySync([RELAY], filter);
  const mine = recovered.find((e) => eventToItem(e)?.id === item.id);
  expect(!!mine, `strfry returned ${recovered.length} event(s) for the holon/lens, ours among them`);
  if (mine) {
    expect(verifyEvent(mine), 'relay copy verifies against the author key');
    expect(verifyEvent({ ...mine, content: JSON.stringify({ ...item, title: 'forged' }) }) === false, 'tampered content fails verification');
    expect(verifyEvent({ ...mine, sig: '00'.repeat(64) }) === false, 'invalid signature fails verification');

    log('STEP 5 — record coordinates for the relay-restart durability check');
    fs.writeFileSync(path.join(HERE, '.last-event.json'), JSON.stringify({ relay: RELAY, holon, lens: LENS, kind: KIND, id: mine.id, pubkey, itemId: item.id, title: item.title }, null, 2));
    log('  wrote spike/.last-event.json');
  }

  pool.close([RELAY]);

  log(`\n${failures === 0 ? '✅ STRFRY SPIKE PASSED' : `❌ STRFRY SPIKE FAILED (${failures} check(s))`} — sign → publish → lose the cache → rehydrate from strfry\n`);
  setTimeout(() => process.exit(failures === 0 ? 0 : 1), 200);
})().catch((e) => { console.error('spike error:', e); process.exit(1); });
