/**
 * A grant is only as good as who sent it: keys arrive from the holon's
 * anchor or a member, never from a stranger; a lens this identity owns takes
 * no foreign key; and a planted envelope never picks the content key of an
 * edit. Local-only (events are moved between stores by hand).
 */
import HoloSphere from '../holosphere.js';
import { buildEvent, generateSecretKey, getPublicKey } from '../nostr-events.js';
import { sealItem, sealSelf, generateKey, kidOf, unsealItem } from '../store/sealed.js';
import { bytesToHex } from '@noble/hashes/utils';

const APP = 'grant-policy-test';
const H = '-100800';

describe('privacy: grant policy', () => {
  const spheres = [];
  afterAll(async () => { for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } } });
  const make = (sk) => { const s = new HoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } }); spheres.push(s); return s; };
  const copyLens = (from, to, holon, lens) => {
    for (const id of from.store.listEventIds(holon, lens)) for (const e of from.store.getEvents(holon, lens, id)) to.store.apply(e, { origin: 'remote' });
  };
  const lensGrant = (owner, holon, lens) => {
    const v = owner.privacy._debug();
    const vaultKey = v.lensKeys.find((k) => k.startsWith(`${holon}|${lens}|`));
    const kid = vaultKey.split('|')[2];
    return { kid };
  };

  test('accepted from the anchor or a member, refused from a stranger or without a sender', async () => {
    const ownerSk = generateSecretKey(), ownerPub = getPublicKey(ownerSk);
    const memberSk = generateSecretKey(), memberPub = getPublicKey(memberSk);
    const strangerPub = getPublicKey(generateSecretKey());
    const owner = make(ownerSk); await owner.ready();
    const partner = make(generateSecretKey()); await partner.ready();
    await owner.foundHolon(H);
    await owner.addMember(H, memberPub);
    await owner.privacy.setLensMode(H, 'quests', 'private');
    await owner.put(H, 'quests', { id: 'q1', title: 'alpha' });
    copyLens(owner, partner, H, '_members');
    copyLens(owner, partner, H, 'quests');
    const { kid } = lensGrant(owner, H, 'quests');
    const key = bytesToHex(owner.privacy._keyFor(H, 'quests', kid));
    const payload = { t: 'holons/grant', v: 1, id: 'g', holon: H, lens: 'quests', kid, key, at: new Date().toISOString() };

    expect(await partner.privacy.acceptGrant(payload, strangerPub)).toMatchObject({ accepted: false, reason: 'sender does not speak for the holon' });
    expect(await partner.privacy.acceptGrant(payload, null)).toMatchObject({ accepted: false, reason: 'no sender' });
    expect(await partner.getAll(H, 'quests')).toEqual([]);
    expect(await partner.privacy.acceptGrant(payload, memberPub)).toMatchObject({ accepted: true });
    expect((await partner.getAll(H, 'quests')).map((q) => q.title)).toEqual(['alpha']);

    // A pasted grant the user chose to trust skips the policy.
    const other = make(generateSecretKey()); await other.ready();
    copyLens(owner, other, H, 'quests');
    expect(await other.privacy.acceptGrant(payload, null, { trusted: true })).toMatchObject({ accepted: true });
    expect((await other.getAll(H, 'quests')).map((q) => q.title)).toEqual(['alpha']);

    // A personal holon: its key is the sender that counts, no log needed.
    const meSk = generateSecretKey(), mePub = getPublicKey(meSk);
    const me = make(meSk); await me.ready();
    await me.privacy.setLensMode(mePub, 'notes', 'private');
    await me.put(mePub, 'notes', { id: 'n1', title: 'private note' });
    const friend = make(generateSecretKey()); await friend.ready();
    copyLens(me, friend, mePub, 'notes');
    const { kid: nkid } = lensGrant(me, mePub, 'notes');
    const npayload = { t: 'holons/grant', v: 1, id: 'g2', holon: mePub, lens: 'notes', kid: nkid, key: bytesToHex(me.privacy._keyFor(mePub, 'notes', nkid)), at: new Date().toISOString() };
    expect(await friend.privacy.acceptGrant(npayload, ownerPub)).toMatchObject({ accepted: false });
    expect(await friend.privacy.acceptGrant(npayload, mePub)).toMatchObject({ accepted: true });
    expect((await friend.getAll(mePub, 'notes')).map((n) => n.title)).toEqual(['private note']);
  });

  test('a lens this identity owns takes no foreign lens key', async () => {
    const ownerSk = generateSecretKey(), ownerPub = getPublicKey(ownerSk);
    const owner = make(ownerSk); await owner.ready();
    await owner.privacy.setLensMode(ownerPub, 'quests', 'private');
    const foreign = generateKey();
    const payload = { t: 'holons/grant', v: 1, id: 'g', holon: ownerPub, lens: 'quests', kid: kidOf(foreign), key: bytesToHex(foreign), at: new Date().toISOString() };
    expect(await owner.privacy.acceptGrant(payload, ownerPub)).toMatchObject({ accepted: false, reason: 'own lens' });
    expect(owner.privacy._debug().lensKeys).not.toContain(`${ownerPub}|quests|${kidOf(foreign)}`);
  });

  test('a planted envelope never picks the content key of an edit', async () => {
    const ownerSk = generateSecretKey(), ownerPub = getPublicKey(ownerSk);
    const attackerSk = generateSecretKey();
    const owner = make(ownerSk); await owner.ready();
    await owner.foundHolon(H);
    await owner.privacy.setLensMode(H, 'quests', 'private');
    await owner.put(H, 'quests', { id: 'q1', title: 'alpha' });
    const { kid: ownKid } = lensGrant(owner, H, 'quests');

    // The attacker plants a newer sealed record at q1 under their own lens key...
    const badLens = generateKey(), badCek = generateKey();
    const planted = sealItem({ id: 'q1', title: 'bait' }, { cek: badCek, lensKey: badLens, kid: kidOf(badLens) });
    const evt = buildEvent({ holon: H, lens: 'quests', item: { id: 'q1' }, sk: attackerSk, content: JSON.stringify(planted), created_at: Math.floor(Date.now() / 1000) + 5, extraTags: [['n', APP]] });
    owner.store.apply(evt, { origin: 'remote' });
    // ...and the owner somehow holds that key (accepted before the vault existed).
    owner.store.keysPut(`${APP}|${ownerPub}|${H}|quests|${kidOf(badLens)}`, JSON.stringify(sealSelf({ holon: H, lens: 'quests', kid: kidOf(badLens), key: bytesToHex(badLens), at: '2020-01-01T00:00:00.000Z' }, ownerSk)));
    await owner.privacy.reload();
    expect(owner.privacy._debug().lensKeys).toContain(`${H}|quests|${kidOf(badLens)}`);

    // The owner's edit is sealed under its own key with a FRESH content key.
    await owner.put(H, 'quests', { id: 'q1', title: 'alpha-2' });
    const [latest] = owner.store.getEvents(H, 'quests', 'q1').filter((e) => e.pubkey === ownerPub).sort((a, b) => b.created_at - a.created_at);
    const sealed = JSON.parse(latest.content);
    expect(sealed.kid).toBe(ownKid);
    expect(() => unsealItem(sealed, { cek: badCek })).toThrow();

    // A grantee holding the owner's key AND the planted key seals under the owner's.
    const partnerSk = generateSecretKey(), partnerPub = getPublicKey(partnerSk);
    const partner = make(partnerSk); await partner.ready();
    copyLens(owner, partner, H, '_members');
    partner.store.apply(evt, { origin: 'remote' });
    const good = { t: 'holons/grant', v: 1, id: 'g', holon: H, lens: 'quests', kid: ownKid, key: bytesToHex(owner.privacy._keyFor(H, 'quests', ownKid)), at: new Date().toISOString() };
    expect(await partner.privacy.acceptGrant(good, ownerPub)).toMatchObject({ accepted: true });
    partner.store.keysPut(`${APP}|${partnerPub}|${H}|quests|${kidOf(badLens)}`, JSON.stringify(sealSelf({ holon: H, lens: 'quests', kid: kidOf(badLens), key: bytesToHex(badLens), at: '2020-01-01T00:00:00.000Z' }, partnerSk)));
    await partner.privacy.reload();
    await partner.put(H, 'quests', { id: 'q1', title: 'from partner' });
    const [pl] = partner.store.getEvents(H, 'quests', 'q1').filter((e) => e.pubkey === partnerPub);
    expect(JSON.parse(pl.content).kid).toBe(ownKid);
  });
});
