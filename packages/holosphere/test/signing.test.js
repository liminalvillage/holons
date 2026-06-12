/**
 * Phase 1 signing integration: sign-on-write + dual-publish, relay-backed
 * rehydrate, and relay migration — exercised through the real HoloSphere
 * put path against an embedded (Docker-free) relay.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey, verifyEvent, eventToItem, tag } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'tasks';

function tmpGun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-sign-'));
  return { dir, opts: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false } };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeout = 12000, step = 50) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await pred()) return true; await wait(step); }
  return false;
}

describe('signing (Phase 1) integration', () => {
  let relayA, relayB, sphere, gunDirs = [];

  beforeAll(async () => {
    relayA = await startRelay();
    relayB = await startRelay();
  });

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
    await relayA?.close();
    await relayB?.close();
    for (const d of gunDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  });

  test('put with signing enabled publishes a verifiable event to the relay', async () => {
    const g = tmpGun(); gunDirs.push(g.dir);
    sphere = new HoloSphere({ appName: 'sign-test', privateKey: generateSecretKey(), gunOptions: g.opts });
    await sphere.enableSigning({ relays: [relayA.url] });
    expect(sphere.signingEnabled).toBe(true);

    await sphere.put(HOLON, LENS, { id: 'task-1', title: 'Repair the well' });

    const got = await waitFor(() => relayA.count() >= 1);
    expect(got).toBe(true);

    const evt = relayA.events().find((e) => tag(e, 'd') === 'task-1');
    expect(evt).toBeTruthy();
    expect(verifyEvent(evt)).toBe(true);
    expect(tag(evt, 'h')).toBe(HOLON);
    expect(tag(evt, 'l')).toBe(LENS);
    expect(evt.pubkey).toBe(sphere._signer.pubkey);
    expect(eventToItem(evt).title).toBe('Repair the well');
  });

  test('default (no signing) does NOT publish — opt-in only', async () => {
    const g = tmpGun(); gunDirs.push(g.dir);
    const plain = new HoloSphere({ appName: 'sign-test', privateKey: generateSecretKey(), gunOptions: g.opts });
    const before = relayA.count();
    await plain.put(HOLON, LENS, { id: 'task-unsigned', title: 'no relay' });
    await wait(400);
    expect(relayA.count()).toBe(before); // nothing new on the relay
    await plain.close?.();
  });

  test('rehydrate restores a holon/lens from the relay into a fresh node', async () => {
    // fresh instance, empty gun, same relay — data exists only on the relay
    const g = tmpGun(); gunDirs.push(g.dir);
    const fresh = new HoloSphere({ appName: 'sign-test', privateKey: generateSecretKey(), gunOptions: g.opts });
    await fresh.enableSigning({ relays: [relayA.url] });

    const before = await fresh.getAll(HOLON, LENS);
    expect(before.find((i) => i.id === 'task-1')).toBeFalsy(); // not local yet

    const res = await fresh.rehydrate(HOLON, LENS);
    expect(res.restored).toBeGreaterThanOrEqual(1);

    const after = await fresh.getAll(HOLON, LENS);
    expect(after.find((i) => i.id === 'task-1')?.title).toBe('Repair the well');

    fresh.disableSigning();
    await fresh.close?.();
  });

  test('migrateRelays moves signed data to a new relay (take it with you)', async () => {
    expect(relayB.count()).toBe(0);
    const res = await sphere.migrateRelays({ to: [relayB.url] });
    expect(res.moved).toBeGreaterThanOrEqual(1);

    const moved = await waitFor(() => relayB.count() >= 1);
    expect(moved).toBe(true);

    // same signed event id on the destination — republished verbatim, still valid
    const onA = relayA.events().find((e) => tag(e, 'd') === 'task-1');
    const onB = relayB.events().find((e) => tag(e, 'd') === 'task-1');
    expect(onB?.id).toBe(onA.id);
    expect(verifyEvent(onB)).toBe(true);
  });
});
