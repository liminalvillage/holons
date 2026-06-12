/**
 * Persistence spike: prove the Nostr-relay round-trip end-to-end.
 *
 *   1. Sign a HoloSphere item as a NIP-01 event.
 *   2. Publish it to BOTH a Nostr relay and a GunDB instance (dual-transport).
 *   3. Confirm it reads back from Gun.
 *   4. Simulate GunDB data loss (wipe the radisk dir; open a fresh empty node).
 *   5. Confirm the data is GONE locally.
 *   6. Rehydrate from the relay by tag query; re-verify the signature; restore.
 *   7. Confirm tamper detection.
 *
 * Run: node spike/roundtrip.mjs
 */

import Gun from 'gun';
import WebSocket from 'ws';
import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import * as h3 from 'h3-js';

import { startRelay } from './mini-relay.js';
import { buildEvent, verifyEvent, eventToItem } from '../nostr-events.js';

const APP = 'spike-app';
const LENS = 'tasks';
const log = (...a) => console.log(...a);
const ok = (c, m) => log(`  ${c ? '✅' : '❌'} ${m}`);
let failures = 0;
const expect = (c, m) => { if (!c) failures++; ok(c, m); };

// --- tiny relay client helpers -------------------------------------------------
function publishToRelay(url, event) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { ws.close(); reject(new Error('publish timeout')); }, 4000);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m[0] === 'OK' && m[1] === event.id) { clearTimeout(t); ws.close(); resolve(m[2]); }
    });
    ws.on('error', reject);
  });
}

function queryRelay(url, filter) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const subId = 'rehydrate';
    const collected = [];
    const t = setTimeout(() => { ws.close(); reject(new Error('query timeout')); }, 4000);
    ws.on('open', () => ws.send(JSON.stringify(['REQ', subId, filter])));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m[0] === 'EVENT' && m[1] === subId) collected.push(m[2]);
      else if (m[0] === 'EOSE' && m[1] === subId) { clearTimeout(t); ws.close(); resolve(collected); }
    });
    ws.on('error', reject);
  });
}

// --- tiny gun helpers ----------------------------------------------------------
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
    gun.get(APP).get(holon).get(LENS).get(item).get(pubkey).once((data) => {
      if (data !== undefined && data !== null) { clearTimeout(t); finish(data); }
    });
  });
}

// --- main ----------------------------------------------------------------------
(async () => {
  const relay = await startRelay({ port: 0 });
  log(`\nMini Nostr relay listening on ${relay.url}\n`);

  // a holon = an H3 cell (San Francisco @ res 9), a deterministic id
  const holon = h3.latLngToCell(37.7749, -122.4194, 9);

  // actor keypair
  const sk = bytesToHex(schnorr.utils.randomPrivateKey());
  const item = { id: 'task-001', title: 'Repair the well', status: 'open' };

  log('STEP 1 — sign the item as a NIP-01 event');
  const event = buildEvent({ holon, lens: LENS, item, sk });
  log(`  holon ${holon}  pubkey ${event.pubkey.slice(0, 12)}…  id ${event.id.slice(0, 12)}…`);
  expect(verifyEvent(event), 'event verifies locally');

  log('STEP 2 — publish to relay AND gun (dual-transport)');
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-gunA-'));
  const gunA = Gun({ peers: [], axe: false, multicast: false, radisk: true, file: path.join(dirA, 'radata'), localStorage: false });
  const relayOk = await publishToRelay(relay.url, event);
  const gunOkA = await gunPut(gunA, holon, item.id, event.pubkey, JSON.stringify(event));
  expect(relayOk === true, 'relay accepted the event (OK true)');
  expect(gunOkA === true, 'gun accepted the event');
  await sleep(1800); // let radisk flush to disk

  log('STEP 3 — read back from gun (the live path)');
  const fromGunA = await gunGet(gunA, holon, item.id, event.pubkey);
  expect(!!fromGunA, 'item present in gun before the "outage"');
  try {
    const files = fs.readdirSync(dirA, { recursive: true });
    log(`  radisk artifacts on disk: ${files.length ? files.join(', ') : '(none yet)'}`);
  } catch { /* ignore */ }

  log('STEP 4 — simulate GunDB data loss (wipe radisk, fresh empty node)');
  gunA.off?.();
  fs.rmSync(dirA, { recursive: true, force: true });
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-gunB-'));
  const gunB = Gun({ peers: [], axe: false, multicast: false, radisk: true, file: path.join(dirB, 'radata'), localStorage: false });
  log(`  wiped ${path.basename(dirA)}; started fresh node ${path.basename(dirB)} (no peers)`);

  log('STEP 5 — confirm the data is gone locally');
  const lost = await gunGet(gunB, holon, item.id, event.pubkey, 1500);
  expect(lost === undefined, 'fresh gun node has NO copy (data was lost)');

  log('STEP 6 — rehydrate from the relay by tag query');
  const filter = { '#h': [holon], '#l': [LENS] };
  log(`  REQ ${JSON.stringify(filter)}`);
  const recovered = await queryRelay(relay.url, filter);
  expect(recovered.length === 1, `relay returned ${recovered.length} event(s) for the holon/lens`);

  let restoredCount = 0;
  for (const evt of recovered) {
    if (!verifyEvent(evt)) { log('  ✗ dropped an event with an invalid signature'); continue; }
    await gunPut(gunB, evt.tags.find((t) => t[0] === 'h')[1], eventToItem(evt).id, evt.pubkey, JSON.stringify(evt));
    restoredCount++;
  }
  await sleep(800);
  expect(restoredCount === 1, 'recovered event passed signature verification');

  const fromGunB = await gunGet(gunB, holon, item.id, event.pubkey);
  expect(!!fromGunB, 'item is back in the fresh gun node after rehydration');
  const restoredItem = fromGunB ? eventToItem(JSON.parse(fromGunB)) : null;
  expect(restoredItem?.title === item.title, `restored payload matches original ("${restoredItem?.title}")`);

  log('STEP 7 — tamper detection');
  const forged = { ...event, content: JSON.stringify({ ...item, title: 'Drain the well (forged)' }) };
  expect(verifyEvent(forged) === false, 'tampered content fails verification');
  const wrongSig = { ...event, sig: '00'.repeat(64) };
  expect(verifyEvent(wrongSig) === false, 'invalid signature fails verification');

  // teardown
  gunB.off?.();
  fs.rmSync(dirB, { recursive: true, force: true });
  await relay.close();

  log(`\n${failures === 0 ? '✅ SPIKE PASSED' : `❌ SPIKE FAILED (${failures} check(s))`} — sign → dual-write → lose gun → rehydrate from relay\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('spike error:', e); process.exit(1); });
