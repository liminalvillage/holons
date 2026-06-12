/**
 * Live demo of the dashboard model: sign with my key, read only the keys I trust.
 * Uses the exact API the dashboard calls: enableSigning({ enforce: true }) +
 * getAll + addReadKey/removeReadKey. No relay needed (local envelopes).
 *
 * Run: node spike/dashboard-demo.mjs
 */
import Gun from 'gun';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey, getPublicKey, buildEvent } from '../nostr-events.js';
import { nostrUtils } from '../nostr-utils-shim.js';

const HOLON = '89283082803ffff'; // an H3 cell — a shared "neighborhood" holon
const LENS = 'tasks';
const npub = (hex) => nostrUtils.hexToNpub(hex).slice(0, 14) + '…';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a stranger writing into the same open graph: signed envelope + raw item
async function writeAs(sphere, sk, item) {
  const evt = buildEvent({ holon: HOLON, lens: LENS, item, sk });
  await new Promise((r) => { let s = false; const d = () => { if (!s) { s = true; r(); } };
    setTimeout(d, 2000);
    sphere.gun.get(sphere.appname).get(HOLON).get('_events').get(LENS).get(item.id).get(evt.pubkey)
      .put(JSON.stringify(evt), () => d()); });
  await sphere.put(HOLON, LENS, item, null, { _skipSign: true, autoPropagate: false });
}

async function view(sphere, label, opts) {
  const items = await sphere.getAll(HOLON, LENS, null, opts);
  const rows = items.sort((a, b) => a.id.localeCompare(b.id)).map((i) => `   • ${i.title}  (${i.id})`);
  console.log(`\n${label}`);
  console.log(rows.length ? rows.join('\n') : '   (empty)');
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-demo-'));
  const me = generateSecretKey();
  const myPub = getPublicKey(me);
  const stranger = generateSecretKey();
  const strangerPub = getPublicKey(stranger);

  const sphere = new HoloSphere({
    appName: 'dashboard-demo',
    privateKey: me,
    gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false },
  });

  // exactly what the dashboard does on login:
  await sphere.enableSigning({ relays: [], enforce: true });

  console.log('================ HoloSphere dashboard — signed & filtered ================');
  console.log(`me        = ${npub(myPub)}   (I sign everything with this key)`);
  console.log(`stranger  = ${npub(strangerPub)}   (writes to the same open holon)`);

  // I create two tasks (signed by me, automatically)
  await sphere.put(HOLON, LENS, { id: 'mine-1', title: 'Repair the well' });
  await sphere.put(HOLON, LENS, { id: 'mine-2', title: 'Plant the orchard' });
  // A stranger writes a signed task + sneaks in an unsigned forgery
  await writeAs(sphere, stranger, { id: 'theirs-1', title: 'Buy crypto now!!!' });
  await sphere.put(HOLON, LENS, { id: 'forged-1', title: '<unsigned spam>' }, null, { _skipSign: true });
  await sleep(1500);

  await view(sphere, '🗄️  RAW open graph — everything anyone wrote (GunDB, unfiltered):', { _skipAuthorize: true });
  await view(sphere, '📋 MY DASHBOARD (getAll, enforce) — only keys I trust:');
  console.log('\n🚫 hidden from me (getPending):');
  console.log((await sphere.getPending(HOLON, LENS)).map((i) => `   • ${i.title}  (${i.id})`).join('\n'));

  console.log(`\n👀 I recognize the stranger and add them: addReadKey('${npub(strangerPub)}')  → saved to my federation`);
  await sphere.addReadKey(strangerPub);
  await view(sphere, '📋 MY DASHBOARD now — my key + the one I trust (forgery still hidden):');

  console.log('\n🙈 I stop trusting them: removeReadKey(...)  (current-list — their writes leave my view)');
  await sphere.removeReadKey(strangerPub);
  await view(sphere, '📋 MY DASHBOARD again:');

  console.log(`\nread-list = [ ${sphere.getReadKeys().map(npub).join(', ')} ]   (my own key is always implicit)`);
  console.log('\n==========================================================================');
  console.log('Nobody could forge into my view. The data never moved — only what *counts* did.');

  sphere.disableSigning();
  await sphere.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('demo error:', e); process.exit(1); });
