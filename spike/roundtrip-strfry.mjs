/**
 * Persistence spike against a REAL strfry relay, using nostr-tools.
 *
 *   1. Sign a HoloSphere item as a NIP-01 event (nostr-tools).
 *   2. Publish to BOTH strfry and a GunDB node (dual-transport).
 *   3. Read it back from Gun (live path).
 *   4. Simulate GunDB data loss (wipe radisk, open a fresh peerless node).
 *   5. Confirm the data is GONE locally.
 *   6. Rehydrate from strfry by tag query; re-verify the signature; restore.
 *   7. Confirm tamper detection.
 *   8. Persist the event coordinates so relay-fetch.mjs can prove the event
 *      also survives a strfry restart (durability across relay process death).
 *
 * Prereq: strfry running. RELAY_URL defaults to ws://127.0.0.1:7777
 * Run: node spike/roundtrip-strfry.mjs
 */

import Gun from 'gun';
import { SimplePool } from 'nostr-tools/pool';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as h3 from 'h3-js';

import { buildEvent, verifyEvent, eventToItem, generateSecretKey, getPublicKey, tag } from '../nostr-events.js';

const RELAY = process.env.RELAY_URL || 'ws://127.0.0.1:7777';
const APP = 'spike-app';
const LENS = 'tasks';
const KIND = 30078;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const log = (...a) => console.log(...a);
let failures = 0;
const expect = (c, m) => { if (!c) failures++; log(`  ${c ? '✅' : '❌'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gunPut(gun, holon, item, pubkey, payload) {
  return new Promise((resolve) => {
    gun.get(APP).get(holon).get(LENS).get(item).get(pubkey).put(payload, (ack) => resolve(!ack.err));
  });
}
function gunGet(gun, holon, item, pubkey, ms = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const t = setTimeout(() => finish(undefined), ms);
    gun.get(APP).get(holon).get(LENS).get(item).get(pubkey).once((d) => {
      if (d !== undefined && d !== null) { clearTimeout(t); finish(d); }
    });
  });
}

(async () => {
  log(`\nUsing real strfry relay at ${RELAY}\n`);
  const pool = new SimplePool();

  const holon = h3.latLngToCell(37.7749, -122.4194, 9);
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const item = { id: `task-${Date.now()}`, title: 'Repair the well', status: 'open' };

  log('STEP 1 — sign the item as a NIP-01 event (nostr-tools)');
  const event = buildEvent({ holon, lens: LENS, item, sk, kind: KIND });
  log(`  holon ${holon}  pubkey ${pubkey.slice(0, 12)}…  id ${event.id.slice(0, 12)}…`);
  expect(verifyEvent(event), 'event verifies locally');

  log('STEP 2 — publish to strfry AND gun (dual-transport)');
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-gunA-'));
  const gunA = Gun({ peers: [], axe: false, multicast: false, radisk: true, file: path.join(dirA, 'radata'), localStorage: false });
  const pubResults = await Promise.allSettled(pool.publish([RELAY], event));
  const accepted = pubResults.filter((r) => r.status === 'fulfilled').length;
  if (accepted === 0) log('  relay publish reasons:', pubResults.map((r) => r.reason?.message || r.reason));
  expect(accepted > 0, `strfry accepted the event (${accepted}/${pubResults.length} relay)`);
  expect(await gunPut(gunA, holon, item.id, pubkey, JSON.stringify(event)), 'gun accepted the event');
  await sleep(1500);

  log('STEP 3 — read back from gun (the live path)');
  expect(!!(await gunGet(gunA, holon, item.id, pubkey)), 'item present in gun before the "outage"');

  log('STEP 4 — simulate GunDB data loss (wipe radisk, fresh peerless node)');
  gunA.off?.();
  fs.rmSync(dirA, { recursive: true, force: true });
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-gunB-'));
  const gunB = Gun({ peers: [], axe: false, multicast: false, radisk: true, file: path.join(dirB, 'radata'), localStorage: false });
  log(`  wiped ${path.basename(dirA)}; started fresh node ${path.basename(dirB)}`);

  log('STEP 5 — confirm the data is gone locally');
  expect((await gunGet(gunB, holon, item.id, pubkey, 1500)) === undefined, 'fresh gun node has NO copy (data was lost)');

  log('STEP 6 — rehydrate from strfry by tag query');
  const filter = { kinds: [KIND], '#h': [holon], '#l': [LENS] };
  log(`  querySync ${JSON.stringify(filter)}`);
  const recovered = await pool.querySync([RELAY], filter);
  expect(recovered.length >= 1, `strfry returned ${recovered.length} event(s) for the holon/lens`);

  const mine = recovered.find((e) => e.id === event.id);
  expect(!!mine, 'our exact event id is among the relay results');
  let restored = 0;
  if (mine && verifyEvent(mine)) {
    await gunPut(gunB, tag(mine, 'h'), eventToItem(mine).id, mine.pubkey, JSON.stringify(mine));
    restored++;
  }
  await sleep(600);
  expect(restored === 1, 'recovered event passed signature verification');
  const back = await gunGet(gunB, holon, item.id, pubkey);
  expect(!!back, 'item is back in the fresh gun node after rehydration');
  const restoredItem = back ? eventToItem(JSON.parse(back)) : null;
  expect(restoredItem?.title === item.title, `restored payload matches original ("${restoredItem?.title}")`);

  log('STEP 7 — tamper detection');
  expect(verifyEvent({ ...event, content: JSON.stringify({ ...item, title: 'forged' }) }) === false, 'tampered content fails verification');
  expect(verifyEvent({ ...event, sig: '00'.repeat(64) }) === false, 'invalid signature fails verification');

  log('STEP 8 — record coordinates for the relay-restart durability check');
  fs.writeFileSync(path.join(HERE, '.last-event.json'), JSON.stringify({ relay: RELAY, holon, lens: LENS, kind: KIND, id: event.id, pubkey, itemId: item.id, title: item.title }, null, 2));
  log('  wrote spike/.last-event.json');

  gunB.off?.();
  fs.rmSync(dirB, { recursive: true, force: true });
  pool.close([RELAY]);

  log(`\n${failures === 0 ? '✅ STRFRY SPIKE PASSED' : `❌ STRFRY SPIKE FAILED (${failures} check(s))`} — sign → dual-write → lose gun → rehydrate from strfry\n`);
  setTimeout(() => process.exit(failures === 0 ? 0 : 1), 200);
})().catch((e) => { console.error('spike error:', e); process.exit(1); });
