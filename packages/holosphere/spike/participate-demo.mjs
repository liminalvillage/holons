/**
 * Does a "participate" toggle stack up and show the latest status under signing?
 * Depends entirely on the data model. This shows both.
 *
 *   Model A — participants ARRAY on the shared quest item (how holons does it now,
 *             tasks/participants.ts). Many writers overwrite one item.
 *   Model B — one signed record PER participant (self-asserted state).
 *
 * Two HoloSphere instances (A and B) share one embedded relay; every write is
 * a signed event that reaches the other instance over the wire.
 *
 * Run: node spike/participate-demo.mjs
 */
import HoloSphere from '../holosphere.js';
import { startRelay } from './mini-relay.js';
import { generateSecretKey, getPublicKey } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sphere(relayUrl, privateKey) {
  return new HoloSphere({
    appName: 'participate-demo',
    privateKey,
    relays: [relayUrl],
    store: { adapter: 'memory' },
    nostr: { syncTimeoutMs: 2000 },
  });
}

(async () => {
  const relay = await startRelay({ port: 0 });
  const skA = generateSecretKey(), skB = generateSecretKey();
  const A = sphere(relay.url, skA);
  const B = sphere(relay.url, skB);
  await A.enableSigning({ enforce: true, perActorLenses: ['participation'] });
  await A.addReadKey(getPublicKey(skB));   // I trust B too

  console.log('Two people, both trusted, both say "participate" on quest q1 — concurrently\n');

  // ---- Model A: participants[] array on the shared quest (current holons model) ----
  // A and B each read the (empty) quest and add themselves — neither saw the other.
  await A.put(HOLON, 'questsA', { id: 'q1', title: 'Fix the well', participants: [{ id: 'A' }] }, null, { autoPropagate: false });
  await sleep(300);
  await B.put(HOLON, 'questsA', { id: 'q1', title: 'Fix the well', participants: [{ id: 'B' }] }, null, { autoPropagate: false });
  await sleep(1200);
  const qA = (await A.getAll(HOLON, 'questsA'))[0];
  console.log('Model A  (participants array, one shared item):');
  console.log('   participants =', JSON.stringify((qA?.participants || []).map((p) => p.id)),
              '   ← last write wins; A was clobbered ❌\n');

  // ---- Model B: per-author records via the aggregate system (id = subject) ----
  // Each person signs their own record for quest 'q1'; the signer IS the owner.
  await A.put(HOLON, 'participation', { id: 'q1', user: 'A', status: 'in' }, null, { autoPropagate: false });
  await B.put(HOLON, 'participation', { id: 'q1', user: 'B', status: 'in' }, null, { autoPropagate: false });
  await sleep(1200);
  const inList = async () => (await A.aggregate(HOLON, 'participation', 'q1'))
    .filter((r) => r.status === 'in').map((r) => r.user).sort();
  console.log('Model B  (per-author aggregate — sphere.aggregate):');
  console.log('   participants =', JSON.stringify(await inList()), '   ← both stacked, nothing lost ✅');

  // A toggles off — a NEWER record from A's key, replacing only A's own record
  await sleep(1100); // created_at is in seconds: make sure the toggle is strictly newer
  await A.put(HOLON, 'participation', { id: 'q1', user: 'A', status: 'out' }, null, { autoPropagate: false });
  await sleep(1200);
  console.log('   after A toggles off →', JSON.stringify(await inList()), '  ← latest status per person, B untouched ✅');

  A.disableSigning();
  await A.close(); await B.close(); await relay.close(); process.exit(0);
})().catch((e) => { console.error('demo error:', e); process.exit(1); });
