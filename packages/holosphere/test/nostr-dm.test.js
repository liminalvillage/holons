/**
 * NIP-17 DMs over the active relay set.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey, getPublicKey } from '../nostr-events.js';
import { sendDirectMessage, subscribeDirectMessages, unwrapDirectMessage, GIFT_WRAP_KIND } from '../nostr-dm.js';

const APP = 'dm-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, { timeout = 8000, step = 100 } = {}) {
  const until = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v || Date.now() > until) return v; await wait(step); }
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
    const alice = new HoloSphere({ appName: APP, privateKey: aliceSk, nostr: { relays: [relay.url], syncTimeoutMs: 1000 }, store: { adapter: 'memory' } });
    const bob = new HoloSphere({ appName: APP, privateKey: bobSk, store: { adapter: 'memory' } });
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
});
