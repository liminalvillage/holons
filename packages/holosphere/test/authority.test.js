/**
 * Who speaks for a holon, from signed envelopes only: a pubkey holon is its
 * key; a founded holon is its genesis; otherwise the EARLIEST settings
 * envelope signed by the key it declares. The current settings record — any
 * key can write it last — never decides.
 */
import HoloSphere from '../holosphere.js';
import { buildEvent, generateSecretKey, getPublicKey } from '../nostr-events.js';
import { holonAnchor, isAcceptedSender, settingsAnchor, membersGenesis, itemsByAuthor } from '../authority.js';

const APP = 'anchor-test';
const H = '-100700';

describe('authority: holon anchor', () => {
  const spheres = [];
  afterAll(async () => { for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } } });
  const make = (sk) => { const s = new HoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } }); spheres.push(s); return s; };
  const settingsEvent = (sk, declared, at) => buildEvent({ holon: H, lens: 'settings', item: { id: H, name: 'x', holonPubkey: declared }, sk, created_at: at, extraTags: [['n', APP]] });

  test('a pubkey holon is its own anchor', async () => {
    const holo = make(generateSecretKey());
    await holo.ready();
    const pub = getPublicKey(generateSecretKey());
    expect(holonAnchor(holo.store, pub.toUpperCase())).toBe(pub);
    expect(isAcceptedSender(holo.store, pub, pub)).toBe(true);
    expect(isAcceptedSender(holo.store, pub, getPublicKey(generateSecretKey()))).toBe(false);
  });

  test('the earliest self-signed holonPubkey wins over a later squat', async () => {
    const holo = make(generateSecretKey());
    await holo.ready();
    const botSk = generateSecretKey(), botPub = getPublicKey(botSk);
    const badSk = generateSecretKey(), badPub = getPublicKey(badSk);
    const t = Math.floor(Date.now() / 1000);
    holo.store.apply(settingsEvent(botSk, botPub, t), { origin: 'remote' });
    // A later, self-consistent squat: signed by the attacker, declaring the attacker.
    holo.store.apply(settingsEvent(badSk, badPub, t + 10), { origin: 'remote' });
    // The current (last-writer-wins) record now says the attacker...
    expect(holo.store.get(H, 'settings', H).item.holonPubkey).toBe(badPub);
    // ...and the anchor still says the bot.
    expect(settingsAnchor(holo.store, H)).toBe(botPub);
    expect(holonAnchor(holo.store, H)).toBe(botPub);
    expect(isAcceptedSender(holo.store, H, botPub)).toBe(true);
    expect(isAcceptedSender(holo.store, H, badPub)).toBe(false);
    // Records as the anchor signed them, not as the last writer left them.
    expect(itemsByAuthor(holo.store, H, 'settings', botPub).map((s) => s.holonPubkey)).toEqual([botPub]);
  });

  test('a declaration signed by someone else is not an anchor', async () => {
    const holo = make(generateSecretKey());
    await holo.ready();
    const botPub = getPublicKey(generateSecretKey());
    holo.store.apply(settingsEvent(generateSecretKey(), botPub, Math.floor(Date.now() / 1000)), { origin: 'remote' });
    expect(holonAnchor(holo.store, H)).toBeNull();
    expect(isAcceptedSender(holo.store, H, botPub)).toBe(false);
  });

  test('a founded holon is its genesis, and its members may hand out keys', async () => {
    const holo = make(generateSecretKey());
    await holo.ready();
    const member = getPublicKey(generateSecretKey());
    await holo.foundHolon(H);
    await holo.addMember(H, member);
    expect(membersGenesis(holo.store, H)).toBe(holo.currentPubkey);
    expect(holonAnchor(holo.store, H)).toBe(holo.currentPubkey);
    expect(isAcceptedSender(holo.store, H, member)).toBe(true);
    expect(isAcceptedSender(holo.store, H, getPublicKey(generateSecretKey()))).toBe(false);
    await holo.removeMember(H, member);
    expect(isAcceptedSender(holo.store, H, member)).toBe(false);
  });
});
