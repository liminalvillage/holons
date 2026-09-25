/**
 * Private lenses across instances over a relay: the owner reads on a second
 * device, a partner sees nothing until granted, one item or the whole lens
 * can be shared, revocation rotates, and a logout locks the partner out.
 */
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey, getPublicKey } from '../nostr-events.js';
import { isSealed } from '../store/sealed.js';
import { isLocked } from '../store/index.js';

const APP = 'privacy-grants-test';
const H = '-100999';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, { timeout = 8000, step = 100 } = {}) {
  const until = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v || Date.now() > until) return v; await wait(step); }
}
const titles = async (holo) => (await holo.getAll(H, 'quests')).map((q) => q.title).sort();

describe('privacy: grants over a relay', () => {
  let relay;
  const spheres = [];
  const sphere = (sk) => {
    const s = new HoloSphere({ appName: APP, privateKey: sk, nostr: { relays: [relay.url], syncTimeoutMs: 1500 }, store: { adapter: 'memory' } });
    spheres.push(s);
    return s;
  };
  beforeAll(async () => { relay = await startRelay(); });
  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } }
    await relay.close();
  });

  test('owner on two devices, partner without / with item grant / with lens grant, revocation, logout', async () => {
    const ownerSk = generateSecretKey();
    const partnerSk = generateSecretKey();
    const partnerPub = getPublicKey(partnerSk);

    // 1. Owner seals the lens; the relay holds ciphertext only.
    const ownerA = sphere(ownerSk);
    await ownerA.ready();
    // The owner founds the holon: its signed `_members` log is what tells a
    // partner that keys handed out by this key are the holon's keys.
    await ownerA.foundHolon(H);
    await ownerA.privacy.setLensMode(H, 'quests', 'private');
    await ownerA.put(H, 'quests', { id: 'q1', title: 'alpha' });
    await ownerA.put(H, 'quests', { id: 'q2', title: 'beta' });
    await eventually(() => relay.events().filter((e) => e.kind === 30078 && e.tags.some((t) => t[0] === 'l' && t[1] === 'quests')).length >= 2);
    for (const e of relay.events().filter((e) => e.kind === 30078)) {
      expect(e.content).not.toMatch(/alpha|beta/);
      if (e.tags.some((t) => t[1] === 'quests')) expect(isSealed(JSON.parse(e.content))).toBe(true);
    }

    // 2. The owner's second device recovers the vault from the relay.
    const ownerB = sphere(ownerSk);
    await ownerB.ready();
    expect(await eventually(async () => (await titles(ownerB)).length === 2 && (await titles(ownerB)))).toEqual(['alpha', 'beta']);

    // 3. A partner sees nothing: the records are locked stubs.
    const partner = sphere(partnerSk);
    await partner.ready();
    expect(await titles(partner)).toEqual([]);
    await eventually(() => partner.store.get(H, 'quests', 'q1'));
    expect(isLocked(partner.store.get(H, 'quests', 'q1').item)).toBe(true);

    // 4. An item grant opens exactly that item.
    const g1 = await ownerA.privacy.grantItem(H, 'quests', 'q1', partnerPub);
    expect(g1.sent).toBe(true);
    expect(await eventually(async () => (await titles(partner)).length === 1 && (await titles(partner)))).toEqual(['alpha']);
    expect(isLocked(partner.store.get(H, 'quests', 'q2').item)).toBe(true);
    // ... and survives an edit by the owner (the content key is stable).
    await ownerA.put(H, 'quests', { id: 'q1', title: 'alpha-2' });
    expect(await eventually(async () => (await titles(partner))[0] === 'alpha-2')).toBe(true);

    // 5. A lens grant opens everything, and a live subscription hears it without resubscribing.
    const heard = [];
    const sub = partner.subscribe(H, 'quests', (item, key) => { if (item) heard.push(`${key}:${item.title}`); });
    await wait(200);
    const g2 = await ownerA.privacy.grantLens(H, 'quests', partnerPub);
    expect(g2.sent).toBe(true);
    expect(await eventually(async () => (await titles(partner)).length === 2 && (await titles(partner)))).toEqual(['alpha-2', 'beta']);
    expect(await eventually(() => heard.includes('q2:beta'))).toBe(true);
    sub.unsubscribe();
    expect(await ownerA.privacy.listGrants(H, 'quests')).toEqual({ [partnerPub]: { lenses: ['quests'], items: { quests: ['q1'] } } });

    // A partner's own vault copy exists, sealed to the partner.
    const copyEvents = relay.events().filter((e) => e.kind === 30078 && e.tags.some((t) => t[0] === 'h' && t[1] === partnerPub));
    expect(copyEvents.length).toBeGreaterThan(0);
    for (const e of copyEvents) expect(JSON.parse(e.content).kid).toBe('self');

    // 6. Revoking the lens rotates every key; the partner drops to what it still holds (nothing: the item key rotated too).
    const before = JSON.parse(ownerA.store.getEvents(H, 'quests', 'q2')[0].content).kid;
    await ownerA.privacy.revokeItem(H, 'quests', 'q1', partnerPub);
    const r = await ownerA.privacy.revokeLens(H, 'quests', partnerPub);
    expect(r.rewritten).toBe(2);
    expect(r.kid).not.toBe(before);
    expect(await eventually(async () => (await titles(partner)).length === 0)).toBe(true);
    expect(await eventually(async () => (await titles(ownerB)).length === 2 && (await titles(ownerB)))).toEqual(['alpha-2', 'beta']);
    expect(await ownerA.privacy.listGrants(H, 'quests')).toEqual({});

    // 7. Re-grant, then the partner logs out and back in.
    await ownerA.privacy.grantLens(H, 'quests', partnerPub);
    expect(await eventually(async () => (await titles(partner)).length === 2)).toBe(true);
    await partner.logout();
    expect(await titles(partner)).toEqual([]);
    await partner.login(partnerSk);
    expect(await eventually(async () => (await titles(partner)).length === 2 && (await titles(partner)))).toEqual(['alpha-2', 'beta']);

    // 8. A fresh device of the partner recovers the grant from its own vault copy.
    const partner2 = sphere(partnerSk);
    await partner2.ready();
    expect(await eventually(async () => (await titles(partner2)).length === 2 && (await titles(partner2)))).toEqual(['alpha-2', 'beta']);
  }, 60000);
});
