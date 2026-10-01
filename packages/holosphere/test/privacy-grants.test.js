/**
 * Private scopes across instances over a relay: the owner reads on a second
 * device, a partner sees nothing until granted, a card or a whole lens can
 * be shared, revocation rotates, a logout locks the partner out, and a
 * partner's fresh device recovers the grant from its own vault copy.
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
const LENS = { holon: H, lens: 'quests' };
const CARD = { holon: H, lens: 'quests', item: 'q1' };

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

  test('owner on two devices, partner without / with a card / with the lens, revocation, logout, fresh device', async () => {
    const ownerSk = generateSecretKey();
    const partnerSk = generateSecretKey();
    const partnerPub = getPublicKey(partnerSk);

    // 1. Owner locks one card, then writes; the relay holds ciphertext for that card only.
    const ownerA = sphere(ownerSk);
    await ownerA.ready();
    // The owner founds the holon: its signed `_members` log is what tells a
    // partner that keys handed out by this key are the holon's keys.
    await ownerA.foundHolon(H);
    await ownerA.put(H, 'quests', { id: 'q1', title: 'alpha' });
    await ownerA.put(H, 'quests', { id: 'q2', title: 'beta' });
    await ownerA.privacy.lock(CARD);
    await eventually(() => relay.events().filter((e) => e.kind === 30078 && e.tags.some((t) => t[0] === 'l' && t[1] === 'quests')).length >= 2);
    for (const e of relay.events().filter((e) => e.kind === 30078 && e.tags.some((t) => t[1] === 'quests'))) {
      const id = e.tags.find((t) => t[0] === 'd')[1].split('/').pop();
      if (id === 'q1') { expect(isSealed(JSON.parse(e.content))).toBe(true); expect(e.content).not.toContain('alpha'); }
      else expect(e.content).toContain('beta');
    }

    // 2. The owner's second device recovers the vault from the relay.
    const ownerB = sphere(ownerSk);
    await ownerB.ready();
    expect(await eventually(async () => (await titles(ownerB)).length === 2 && (await titles(ownerB)))).toEqual(['alpha', 'beta']);
    expect(ownerB.privacy.lockedScopes(H)).toEqual({ quests: { locked: false, items: ['q1'] } });

    // 3. A partner sees the public card and a locked stub for the other.
    const partner = sphere(partnerSk);
    await partner.ready();
    expect(await eventually(async () => (await titles(partner)).length === 1 && (await titles(partner)))).toEqual(['beta']);
    expect(isLocked(partner.store.get(H, 'quests', 'q1').item)).toBe(true);
    expect(partner.isPrivate(H, 'quests', 'q1')).toBe(true);
    expect(partner.privacy.owned(CARD)).toBe(false);

    // 4. A card grant opens exactly that card, and the partner's edit of it stays sealed.
    const g1 = await ownerA.privacy.grant(CARD, partnerPub);
    expect(g1).toEqual({ kid: expect.any(String), sent: [partnerPub], failed: [] });
    expect(await eventually(async () => (await titles(partner)).length === 2 && (await titles(partner)))).toEqual(['alpha', 'beta']);
    expect(await ownerA.privacy.sentGet(CARD)).toEqual({ [partnerPub]: g1.kid });
    await partner.put(H, 'quests', { id: 'q1', title: 'alpha by partner' });
    const [pe] = partner.store.getEvents(H, 'quests', 'q1').filter((e) => e.pubkey === partnerPub);
    expect(isSealed(JSON.parse(pe.content))).toBe(true);
    expect(JSON.parse(pe.content).kid).toBe(g1.kid);
    // ...while its NEW card in the public lens goes out plain.
    await partner.put(H, 'quests', { id: 'q3', title: 'gamma' });
    expect(partner.store.getEvents(H, 'quests', 'q3')[0].content).toContain('gamma');

    // 5. The owner locks the whole lens (folding the card) and grants it; a live subscription hears it.
    // (A second apart from the partner's writes: a same-second rewrite would tie on last-writer-wins.)
    await wait(1100);
    await eventually(() => ownerA.store.get(H, 'quests', 'q3'));
    await ownerA.privacy.lock(LENS);
    expect(await eventually(async () => (await titles(partner)).length === 0)).toBe(true);
    const heard = [];
    const sub = partner.subscribe(H, 'quests', (item, key) => { if (item) heard.push(`${key}:${item.title}`); });
    await wait(200);
    const g2 = await ownerA.privacy.grant(LENS, [partnerPub]);
    expect(g2.sent).toEqual([partnerPub]);
    expect(await eventually(async () => (await titles(partner)).length >= 2 && (await titles(partner)))).toEqual(expect.arrayContaining(['beta']));
    expect(await eventually(() => heard.some((h) => h.startsWith('q2:')))).toBe(true);
    sub.unsubscribe();

    // A partner's own vault copy exists, sealed to the partner.
    const copyEvents = relay.events().filter((e) => e.kind === 30078 && e.tags.some((t) => t[0] === 'h' && t[1] === partnerPub));
    expect(copyEvents.length).toBeGreaterThan(0);
    for (const e of copyEvents) expect(JSON.parse(e.content).kid).toBe('self');
    expect(copyEvents.some((e) => e.tags.some((t) => t[0] === 'd' && t[1] === `${partnerPub}/_vault/grant:${H}:quests`))).toBe(true);

    // 6. Revoking rotates the key and rewrites; the partner drops to nothing, the owner's other device keeps everything.
    const before = JSON.parse(ownerA.store.getEvents(H, 'quests', 'q2')[0].content).kid;
    const r = await ownerA.privacy.revoke(LENS, partnerPub);
    expect(r.kid).not.toBe(before);
    expect(r.rewritten).toBeGreaterThanOrEqual(2);
    expect(r.revoked).toEqual([partnerPub]);
    expect(await ownerA.privacy.sentGet(LENS)).toEqual({});
    expect(await eventually(async () => (await titles(partner)).length === 0)).toBe(true);
    expect(await eventually(async () => (await titles(ownerB)).length >= 2)).toBe(true);

    // 7. Re-grant, then the partner logs out and back in.
    await ownerA.privacy.grant(LENS, partnerPub);
    expect(await eventually(async () => (await titles(partner)).length >= 2)).toBe(true);
    await partner.logout();
    expect(await titles(partner)).toEqual([]);
    await partner.login(partnerSk);
    expect(await eventually(async () => (await titles(partner)).length >= 2)).toBe(true);

    // 8. A fresh device of the partner recovers the grant from its own vault copy.
    const partner2 = sphere(partnerSk);
    await partner2.ready();
    expect(await eventually(async () => (await titles(partner2)).length >= 2)).toBe(true);

    // 9. Unlocking sends everything in the clear; the partner reads without keys.
    await ownerA.privacy.unlock(LENS);
    const stranger = sphere(generateSecretKey());
    await stranger.ready();
    expect(await eventually(async () => (await titles(stranger)).length >= 2 && (await titles(stranger)))).toEqual(expect.arrayContaining(['beta']));
  }, 60000);
});
