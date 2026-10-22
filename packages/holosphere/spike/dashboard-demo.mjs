/**
 * Live demo of the dashboard model: sign with my key, read only the keys I trust.
 * Uses the exact API the dashboard calls: enableSigning({ enforce: true }) +
 * getAll + addReadKey/removeReadKey.
 *
 * Two HoloSphere instances share one embedded relay: "me" and a stranger who
 * writes into the same open holon. Every write is a signed event — the
 * stranger's records reach my store over the wire, and enforce mode decides
 * whether they count.
 *
 * Run: node spike/dashboard-demo.mjs
 */
import HoloSphere from '../holosphere.js';
import { startRelay } from './mini-relay.js';
import { generateSecretKey, getPublicKey } from '../nostr-events.js';
import { nostrUtils } from '../nostr-utils-shim.js';

const HOLON = '89283082803ffff'; // an H3 cell — a shared "neighborhood" holon
const LENS = 'tasks';
const npub = (hex) => nostrUtils.hexToNpub(hex).slice(0, 14) + '…';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sphere(appName, relayUrl, privateKey) {
  return new HoloSphere({
    appName,
    privateKey,
    relays: [relayUrl],
    store: { adapter: 'memory' },
    nostr: { syncTimeoutMs: 2000 },
  });
}

async function view(sphere, label, opts) {
  const items = await sphere.getAll(HOLON, LENS, null, opts);
  const rows = items.sort((a, b) => a.id.localeCompare(b.id)).map((i) => `   • ${i.title}  (${i.id})`);
  console.log(`\n${label}`);
  console.log(rows.length ? rows.join('\n') : '   (empty)');
}

(async () => {
  const relay = await startRelay({ port: 0 });
  const me = generateSecretKey();
  const myPub = getPublicKey(me);
  const stranger = generateSecretKey();
  const strangerPub = getPublicKey(stranger);

  const mine = sphere('dashboard-demo', relay.url, me);
  const theirs = sphere('dashboard-demo', relay.url, stranger);

  // exactly what the dashboard does on login:
  await mine.enableSigning({ enforce: true });

  console.log('================ HoloSphere dashboard — signed & filtered ================');
  console.log(`me        = ${npub(myPub)}   (I sign everything with this key)`);
  console.log(`stranger  = ${npub(strangerPub)}   (writes to the same open holon)`);

  // I create two tasks (signed by me, automatically)
  await mine.put(HOLON, LENS, { id: 'mine-1', title: 'Repair the well' }, null, { autoPropagate: false });
  await mine.put(HOLON, LENS, { id: 'mine-2', title: 'Plant the orchard' }, null, { autoPropagate: false });
  // A stranger writes a signed task into the same holon
  await theirs.put(HOLON, LENS, { id: 'theirs-1', title: 'Buy crypto now!!!' }, null, { autoPropagate: false });
  await sleep(1500);

  await view(mine, '🗄️  RAW store — everything that reached me over the relay (unfiltered):', { _skipAuthorize: true });
  await view(mine, '📋 MY DASHBOARD (getAll, enforce) — only keys I trust:');
  console.log('\n🚫 hidden from me (getPending):');
  console.log((await mine.getPending(HOLON, LENS)).map((i) => `   • ${i.title}  (${i.id})`).join('\n') || '   (none)');

  console.log(`\n👀 I recognize the stranger and add them: addReadKey('${npub(strangerPub)}')  → saved to my federation`);
  await mine.addReadKey(strangerPub);
  await view(mine, '📋 MY DASHBOARD now — my key + the one I trust:');

  console.log('\n🙈 I stop trusting them: removeReadKey(...)  (current-list — their writes leave my view)');
  await mine.removeReadKey(strangerPub);
  await view(mine, '📋 MY DASHBOARD again:');

  console.log(`\nread-list = [ ${mine.getReadKeys().map(npub).join(', ')} ]   (my own key is always implicit)`);
  console.log('\n==========================================================================');
  console.log('Nobody could forge into my view. The data never moved — only what *counts* did.');

  mine.disableSigning();
  await mine.close();
  await theirs.close();
  await relay.close();
  process.exit(0);
})().catch((e) => { console.error('demo error:', e); process.exit(1); });
