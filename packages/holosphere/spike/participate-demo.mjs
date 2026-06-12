/**
 * Does a "participate" toggle stack up and show the latest status under signing?
 * Depends entirely on the data model. This shows both.
 *
 *   Model A — participants ARRAY on the shared quest item (how holons does it now,
 *             tasks/participants.ts). Many writers overwrite one item.
 *   Model B — one signed record PER participant (self-asserted state).
 *
 * Run: node spike/participate-demo.mjs
 */
import Gun from 'gun';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey, getPublicKey, buildEvent } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const T = 1700000000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signWrite(sphere, sk, lens, item, at) {
  const evt = buildEvent({ holon: HOLON, lens, item, sk, created_at: at });
  await new Promise((r) => { let s = false; const d = () => { if (!s) { s = true; r(); } };
    setTimeout(d, 2000);
    sphere.gun.get(sphere.appname).get(HOLON).get('_events').get(lens).get(item.id).get(evt.pubkey)
      .put(JSON.stringify(evt), () => d()); });
  await sphere.put(HOLON, lens, item, null, { _skipSign: true, autoPropagate: false });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-part-'));
  const A = generateSecretKey(), B = generateSecretKey();
  const sphere = new HoloSphere({ appName: 'participate-demo', privateKey: A,
    gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false } });
  await sphere.enableSigning({ relays: [], enforce: true, perActorLenses: ['participation'] });
  await sphere.addReadKey(getPublicKey(B));   // I trust B too

  console.log('Two people, both trusted, both say "participate" on quest q1 — concurrently\n');

  // ---- Model A: participants[] array on the shared quest (current holons model) ----
  // A and B each read the (empty) quest and add themselves — neither saw the other.
  await signWrite(sphere, A, 'questsA', { id: 'q1', title: 'Fix the well', participants: [{ id: 'A' }] }, T + 1);
  await signWrite(sphere, B, 'questsA', { id: 'q1', title: 'Fix the well', participants: [{ id: 'B' }] }, T + 2);
  await sleep(800);
  const qA = (await sphere.getAll(HOLON, 'questsA'))[0];
  console.log('Model A  (participants array, one shared item):');
  console.log('   participants =', JSON.stringify(qA.participants.map((p) => p.id)),
              '   ← last write wins; A was clobbered ❌\n');

  // ---- Model B: per-author records via the aggregate system (id = subject) ----
  // Each person signs their own record for quest 'q1'; the signer IS the owner.
  await signWrite(sphere, A, 'participation', { id: 'q1', user: 'A', status: 'in' }, T + 1);
  await signWrite(sphere, B, 'participation', { id: 'q1', user: 'B', status: 'in' }, T + 2);
  await sleep(800);
  const inList = async () => (await sphere.aggregate(HOLON, 'participation', 'q1'))
    .filter((r) => r.status === 'in').map((r) => r.user).sort();
  console.log('Model B  (per-author aggregate — sphere.aggregate):');
  console.log('   participants =', JSON.stringify(await inList()), '   ← both stacked, nothing lost ✅');

  // A toggles off — a NEWER record from A's key, replacing only A's own record
  await signWrite(sphere, A, 'participation', { id: 'q1', user: 'A', status: 'out' }, T + 5);
  await sleep(800);
  console.log('   after A toggles off →', JSON.stringify(await inList()), '  ← latest status per person, B untouched ✅');

  sphere.disableSigning(); await sphere.close?.(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.error('demo error:', e); process.exit(1); });
