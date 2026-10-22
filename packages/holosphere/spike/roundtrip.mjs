/**
 * Persistence spike: the relay is the durable copy, the local store is a cache.
 *
 *   1. A HoloSphere instance (in-memory store, one relay) writes an item —
 *      it is signed as a NIP-01 event and published to the relay.
 *   2. That instance is closed: its local cache is gone.
 *   3. A FRESH instance (empty store, same relay) reads the item back —
 *      rehydrated from the relay by tag query, signature re-verified.
 *   4. The raw event on the relay verifies; tampered copies do not.
 *
 * Docker-free: runs against the embedded mini relay.
 * Run: node spike/roundtrip.mjs
 */

import * as h3 from 'h3-js';

import HoloSphere from '../holosphere.js';
import { startRelay } from './mini-relay.js';
import { buildEvent, verifyEvent, eventToItem, generateSecretKey, getPublicKey } from '../nostr-events.js';

const APP = 'spike-app';
const LENS = 'tasks';
const KIND = 30078;
const log = (...a) => console.log(...a);
let failures = 0;
const expect = (c, m) => { if (!c) failures++; log(`  ${c ? '✅' : '❌'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sphere(relayUrl, privateKey) {
  return new HoloSphere({
    appName: APP,
    privateKey,
    relays: [relayUrl],
    store: { adapter: 'memory' },
    nostr: { syncTimeoutMs: 3000 },
  });
}

(async () => {
  const relay = await startRelay({ port: 0 });
  log(`\nMini Nostr relay listening on ${relay.url}\n`);

  // a holon = an H3 cell (San Francisco @ res 9), a deterministic id
  const holon = h3.latLngToCell(37.7749, -122.4194, 9);
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const item = { id: 'task-001', title: 'Repair the well', status: 'open' };

  log('STEP 1 — write through HoloSphere (signed event → relay)');
  const a = sphere(relay.url, sk);
  await a.put(holon, LENS, item, null, { autoPropagate: false });
  await sleep(800);
  expect(!!(await a.get(holon, LENS, item.id)), 'item readable from the writing instance');

  log('STEP 2 — close the writer: its local store is gone');
  await a.close();

  log('STEP 3 — a fresh instance rehydrates from the relay');
  const b = sphere(relay.url, generateSecretKey());
  const back = await b.get(holon, LENS, item.id);
  expect(!!back, 'fresh instance (empty store) reads the item back from the relay');
  expect(back?.title === item.title, `restored payload matches original ("${back?.title}")`);

  log('STEP 4 — the raw event on the relay verifies; tampering is detected');
  const events = await new Promise((resolve) => {
    const found = [];
    const stop = b.subscribeNostr({ kinds: [KIND], '#h': [holon], '#l': [LENS] }, (evt) => found.push(evt));
    setTimeout(() => { stop(); resolve(found); }, 1500);
  });
  const mine = events.find((e) => e.pubkey === pubkey && eventToItem(e)?.id === item.id);
  expect(!!mine, `relay holds ${events.length} event(s) for the holon/lens, ours among them`);
  if (mine) {
    expect(verifyEvent(mine), 'relay copy verifies against the author key');
    expect(verifyEvent({ ...mine, content: JSON.stringify({ ...item, title: 'Drain the well (forged)' }) }) === false, 'tampered content fails verification');
    expect(verifyEvent({ ...mine, sig: '00'.repeat(64) }) === false, 'invalid signature fails verification');
  }
  const local = buildEvent({ holon, lens: LENS, item, sk, kind: KIND });
  expect(verifyEvent(local), 'a locally built event verifies too (same primitives the library uses)');

  await b.close();
  await relay.close();

  log(`\n${failures === 0 ? '✅ SPIKE PASSED' : `❌ SPIKE FAILED (${failures} check(s))`} — sign → publish → lose the cache → rehydrate from the relay\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('spike error:', e); process.exit(1); });
