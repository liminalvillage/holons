/**
 * NIP-17 DMs over the active relay set, and the federation handshake riding
 * on them (with the legacy Gun channel still served).
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere, { handshake } from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey, getPublicKey } from '../nostr-events.js';
import { sendDirectMessage, subscribeDirectMessages, unwrapDirectMessage, GIFT_WRAP_KIND } from '../nostr-dm.js';

const APP = 'dm-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, { timeout = 8000, step = 100 } = {}) {
  const until = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v || Date.now() > until) return v; await wait(step); }
}
function gunOptions(dirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-dm-'));
  dirs.push(dir);
  return { peers: [], axe: false, multicast: false, stats: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false };
}

describe('NIP-17 direct messages', () => {
  let relay;
  const dirs = [];
  const spheres = [];
  beforeAll(async () => { relay = await startRelay(); });
  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } }
    await relay.close();
    for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
  });

  test('gift-wrapped on the relay, readable only by the recipient, sender authenticated by the seal', async () => {
    const aliceSk = generateSecretKey();
    const bobSk = generateSecretKey();
    const alice = new HoloSphere({ appName: APP, privateKey: aliceSk, backend: 'nostr', nostr: { relays: [relay.url], syncTimeoutMs: 1000 }, gunOptions: gunOptions(dirs) });
    const bob = new HoloSphere({ appName: APP, privateKey: bobSk, gunOptions: gunOptions(dirs) });
    spheres.push(alice, bob);
    await bob.enableSigning({ relays: [relay.url], shadow: true });

    const got = [];
    const close = subscribeDirectMessages(bob, bobSk, (m) => got.push(m));
    await wait(200);
    expect(await sendDirectMessage(alice, { privateKey: aliceSk, recipientPubkey: getPublicKey(bobSk), content: 'hello bob', subject: 'hi' })).toBe(true);

    const m = await eventually(() => got[0]);
    expect(m.content).toBe('hello bob');
    expect(m.sender).toBe(getPublicKey(aliceSk));
    expect(m.subject).toBe('hi');
    close();

    const onRelay = relay.events().filter((e) => e.kind === GIFT_WRAP_KIND);
    expect(onRelay).toHaveLength(1);
    expect(onRelay[0].pubkey).not.toBe(getPublicKey(aliceSk)); // throwaway wrap key
    expect(onRelay[0].content).not.toContain('hello');
    expect(await unwrapDirectMessage(onRelay[0], generateSecretKey())).toBeNull(); // strangers cannot read it
  }, 20000);

  test('federation handshake rides on NIP-17 and is handled once despite the legacy Gun copy', async () => {
    const aSk = generateSecretKey();
    const bSk = generateSecretKey();
    const a = new HoloSphere({ appName: APP, privateKey: aSk, backend: 'nostr', nostr: { relays: [relay.url], syncTimeoutMs: 1000 }, gunOptions: gunOptions(dirs) });
    const b = new HoloSphere({ appName: APP, privateKey: bSk, backend: 'nostr', nostr: { relays: [relay.url], syncTimeoutMs: 1000 }, gunOptions: gunOptions(dirs) });
    spheres.push(a, b);
    const requests = [];
    const unsub = handshake.subscribeToFederationDMs(b, bSk, getPublicKey(bSk), { onRequest: (m, from) => requests.push({ m, from }) });
    await wait(200);
    const r = await handshake.initiateFederationHandshake(a, aSk, { partnerPubKey: getPublicKey(bSk), holonId: 'h-a', holonName: 'A' });
    expect(r.success).toBe(true);
    await eventually(() => requests.length);
    await wait(500);
    expect(requests).toHaveLength(1);
    expect(requests[0].from).toBe(getPublicKey(aSk));
    expect(requests[0].m.senderHolonId).toBe('h-a');
    unsub();
  }, 20000);
});
