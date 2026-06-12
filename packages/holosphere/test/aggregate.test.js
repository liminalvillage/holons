/**
 * Per-author aggregate: collaborative state (participation, reactions, votes…)
 * as one signed record per actor — so it stacks, shows latest-per-actor, is
 * forge-proof (signer == owner), and is filtered by your read-list.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { generateSecretKey, getPublicKey, buildEvent } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'participation';
const Q = 'q1';
const T = 1700000000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const owners = (recs) => recs.map((r) => r._owner).sort();
const ins = (recs) => recs.filter((r) => r.status === 'in').map((r) => r.user).sort();

describe('per-author aggregate (signed, filterable collaborative state)', () => {
  let sphere, dir, Ask, Bsk, Csk, Apub, Bpub, Cpub;

  // a client writing its own signed per-actor record (envelope only)
  async function writeAs(sk, item, at) {
    const evt = buildEvent({ holon: HOLON, lens: LENS, item, sk, created_at: at });
    await new Promise((r) => { let s = false; const d = () => { if (!s) { s = true; r(); } };
      setTimeout(d, 2000);
      sphere.gun.get(sphere.appname).get(HOLON).get('_events').get(LENS).get(item.id).get(evt.pubkey)
        .put(JSON.stringify(evt), () => d()); });
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-agg-'));
    Ask = generateSecretKey(); Apub = getPublicKey(Ask);
    Bsk = generateSecretKey(); Bpub = getPublicKey(Bsk);
    Csk = generateSecretKey(); Cpub = getPublicKey(Csk);
    sphere = new HoloSphere({ appName: 'agg-test', privateKey: Ask,
      gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false } });
    await sphere.enableSigning({ relays: [], enforce: true, perActorLenses: [LENS] });
    await sphere.addReadKey(Bpub); // I trust B, but NOT C

    // A and B participate CONCURRENTLY (neither read the other) — C too (untrusted)
    await writeAs(Ask, { id: Q, user: 'alice', status: 'in' }, T + 1);
    await writeAs(Bsk, { id: Q, user: 'bob', status: 'in' }, T + 2);
    await writeAs(Csk, { id: Q, user: 'carol', status: 'in' }, T + 3);
    await wait(800);
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 15000);

  test('concurrent participants both stack (no clobber), untrusted excluded', async () => {
    const recs = await sphere.aggregate(HOLON, LENS, Q);
    expect(owners(recs)).toEqual([Apub, Bpub].sort()); // C filtered out by read-list
    expect(ins(recs)).toEqual(['alice', 'bob']);
  });

  test('enforce getAll routes a per-actor lens through aggregate', async () => {
    expect(owners(await sphere.getAll(HOLON, LENS))).toEqual([Apub, Bpub].sort());
  });

  test('toggling shows the latest status per actor — others untouched', async () => {
    await writeAs(Ask, { id: Q, user: 'alice', status: 'out' }, T + 5); // A toggles off
    await wait(500);
    const recs = await sphere.aggregate(HOLON, LENS, Q);
    expect(recs.find((r) => r._owner === Apub).status).toBe('out');
    expect(recs.find((r) => r._owner === Bpub).status).toBe('in');
    expect(ins(recs)).toEqual(['bob']); // only B is now participating
  });

  test('forge-proof: a record is owned by its signer, not its content', async () => {
    // B writes a record claiming to be "alice" — it lands in B's own slot.
    await writeAs(Bsk, { id: Q, user: 'alice', status: 'in' }, T + 6);
    await wait(500);
    const recs = await sphere.aggregate(HOLON, LENS, Q);
    // exactly one record per author; A's record is untouched by B's lie
    expect(owners(recs)).toEqual([Apub, Bpub].sort());
    expect(recs.find((r) => r._owner === Apub).status).toBe('out'); // still A's real state
    // B's record is attributed to B (_owner), regardless of its self-reported user
    expect(recs.find((r) => r._owner === Bpub)._owner).toBe(Bpub);
  });
});
